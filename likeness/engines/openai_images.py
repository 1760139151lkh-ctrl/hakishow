"""openai：工作室直接通过 OpenAI Images 接口使用 GPT Image，中间不经过 Codex。

这是工作室生成图像最快的方式：每张图像一次 HTTP 请求，以流式传输，在模型提供中间图像时，
可以展示逐步形成的画面。应用中选择的速度档位决定使用 studio.toml 的 [openai.pace.*]
（模型、质量、中间图像数量）。房间、外观与背景创意由文本模型生成，
采用与 Codex 引擎相同的严格 JSON 结构定义。

密钥从 OPENAI_API_KEY 或 [openai].key_file 指定的文件读取（该文件应保存在 private/ 下）。
它只发送到接口，不会发送到其他位置：不记入日志，不写入任务，也不返回给应用。
"""

from __future__ import annotations

import base64
import io
import json
import os
import secrets
import socket
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops

from .. import brief
from ..rooms import BACKDROPS_SCHEMA, LOOK_SCHEMA, ROOM_SCHEMA, STYLE_SCHEMA

REPLY_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["reply", "suggestions"],
                "properties": {"reply": {"type": "string"}, "suggestions": {"type": "array", "items": {"type": "string"}}}}
from ..turns import SIZES, BackdropAsk, Inputs, LookAsk, RoomAsk, StyleAsk, Turn
from . import EngineError, Work, shaped
from .codex import _composite_region

PACES = {"quick": "快速", "fine": "精细", "deep": "深度"}
DEFAULT_PACES = {
    "quick": {"model": "gpt-image-2.6-flare", "quality": "low", "partials": 1, "timeout": 90},
    "fine": {"model": "gpt-image-2.6-flare", "quality": "medium", "partials": 2, "timeout": 120},
    "deep": {"model": "gpt-image-2.6-sunburst", "quality": "high", "partials": 2, "timeout": 300},
}
EDIT_OPS = {"edit", "restyle", "reference", "blend", "region", "backdrop", "remove", "vary", "angles"}
# 每次调用生成一张图像：按此顺序分别请求每个角度
ANGLES = [
    "四分之三侧面视角，头部转动使鼻子朝向画面右边缘",
    "朝向画面右边缘的完整侧面视角",
    "四分之三侧面视角，头部转动使鼻子朝向画面左边缘",
    "略高的俯视角度，人物抬眼看向相机，下巴稍微放低",
]


def _key(config: dict) -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key and config.get("key_file"):
        path = Path(str(config["key_file"])).expanduser()
        key = path.read_text(encoding="utf-8").strip() if path.is_file() else ""
    return key


def _multipart(fields: list[tuple[str, str]], files: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    """multipart/form-data 请求体：先是普通字段，再是文件（名称、文件名、字节内容、类型）。"""
    boundary = "likeness" + secrets.token_hex(12)
    out = io.BytesIO()
    for name, value in fields:
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, filename, data, kind in files:
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {kind}\r\n\r\n'.encode())
        out.write(data)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def _jpeg(path: Path) -> bytes:
    """以接口可接收的最小字节量传送图像：已存储的 JPEG 原样发送，其他格式重新编码。"""
    if path.suffix == ".jpg":
        return path.read_bytes()
    with Image.open(path) as image:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, "JPEG", quality=92)
        return buf.getvalue()


def _png(path: Path, size: tuple[int, int] | None = None) -> bytes:
    with Image.open(path) as image:
        image = image.convert("RGB")
        if size and image.size != size:
            image = image.resize(size)
        buf = io.BytesIO()
        image.save(buf, "PNG")
        return buf.getvalue()


def _picture(b64: str) -> Image.Image:
    with Image.open(io.BytesIO(base64.b64decode(b64))) as image:
        image.load()
        return image.convert("RGB")


def _said(error: urllib.error.HTTPError) -> EngineError:
    """将接口拒绝原因转换成用户可据此采取行动的一句话。"""
    try:
        detail = json.loads(error.read().decode("utf-8", "replace")).get("error", {})
    except (ValueError, OSError):
        detail = {}
    message, code = str(detail.get("message") or ""), str(detail.get("code") or detail.get("type") or "")
    if error.code == 401:
        return EngineError("图像服务接口密钥不可用", "请检查工作室服务器上的 OPENAI_API_KEY。")
    if error.code == 429:
        return EngineError("图像服务繁忙或已达到配额上限", "请稍等片刻后重试。")
    if "moderation" in code or "safety" in code or "safety" in message.lower():
        return EngineError("图像服务经过安全审核后无法完成此请求", "请换一种描述或另一张照片。")
    return EngineError("无法生成图像" + (f" ({message[:120]})" if message else ""), "请重试，或换一种方式描述修改。")


class OpenAIImages:
    id = "openai"
    kind = "openai"

    def __init__(self, config: dict | None = None) -> None:
        self.config = dict(config or {})
        self.base = (os.environ.get("OPENAI_BASE_URL") or self.config.get("base_url") or "https://api.openai.com/v1").rstrip("/")
        self.key = _key(self.config)
        if not self.key:
            raise SystemExit("openai 引擎需要密钥：请设置 OPENAI_API_KEY（或在 private/studio.toml 中设置 [openai].key_file）。")

    # ---- 提供给应用的信息 ----
    def pace(self, name: str) -> dict:
        return {**DEFAULT_PACES.get(name, DEFAULT_PACES["fine"]), **(self.config.get("pace", {}).get(name) or {})}

    def describe(self) -> dict:
        return {"id": self.id, "kind": self.kind, "label": "GPT Image",
                "paces": {name: {k: self.pace(name).get(k, "") for k in ("model", "quality")} for name in PACES}}

    def provenance(self, turn: Turn) -> dict:
        return {"kind": "render", "label": "渲染结果", "detail": f"GPT Image · {PACES.get(turn.pace, turn.pace)} · {self.pace(turn.pace)['model']}"}

    # ---- HTTP 请求 ----
    def _open(self, path: str, body: bytes, kind: str, timeout: float):
        request = urllib.request.Request(self.base + path, data=body, method="POST", headers={
            "Authorization": "Bearer " + self.key, "Content-Type": kind, "Accept": "text/event-stream, application/json"})
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            raise _said(error) from None
        except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
            raise EngineError("无法连接图像服务", "请检查工作室服务器的网络连接。") from error

    def _stream(self, response, work: Work, index: int, prompt: str, aspect: str | None, keep=lambda picture: picture) -> bool:
        """读取一张图像的服务器推送事件：先接收陆续到达的局部生成结果，再接收完整图像。"""
        data: list[str] = []
        made = False
        for raw in response:
            work.check()
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line.startswith("data:"):
                data.append(line[5:].strip())
                continue
            if line or not data:
                continue
            event, data = json.loads("\n".join(data)), []
            kind = str(event.get("type", ""))
            if kind.endswith("partial_image") and event.get("b64_json"):
                work.stage("draw")
                work.partial(index, shaped(_picture(event["b64_json"]), aspect))
            elif kind.endswith("completed") and event.get("b64_json"):
                work.stage("finish")
                work.result(index, keep(shaped(_picture(event["b64_json"]), aspect)), prompt)
                made = True
            elif event.get("error"):
                raise EngineError("生成已停止：" + str(event["error"].get("message", ""))[:120], "请重试。")
        return made

    def _one(self, turn: Turn, inputs: Inputs, work: Work, index: int, prompt: str) -> None:
        pace = self.pace(turn.pace)
        size = SIZES.get(turn.aspect or "", "") or str(self.config.get("size") or "1024x1536")
        if turn.intent.op in EDIT_OPS and inputs.pictures and not turn.aspect:
            with Image.open(inputs.pictures[inputs.subject or next(iter(inputs.pictures))]) as im:   # 按照片自身的宽高比例进行编辑
                size = "1536x1024" if im.width > im.height * 1.15 else "1024x1024" if im.width > im.height * .85 else "1024x1536"
        common = [("model", str(pace["model"])), ("prompt", prompt), ("size", size), ("quality", str(pace["quality"])),
                  ("output_format", "jpeg"), ("output_compression", "90"), ("stream", "true"), ("partial_images", str(int(pace.get("partials", 0))))]
        subject = inputs.subject or next(iter(inputs.pictures), None)
        if turn.intent.op in EDIT_OPS and subject:
            first = inputs.pictures[subject]
            with Image.open(first) as im:
                base_size = im.size
            mask = self._mask(inputs, base_size)
            if mask is None:   # 没有蒙版时，上传 JPEG 所需时间仅为 PNG 的一小部分
                files = [("image[]", f"{subject}.jpg", _jpeg(first), "image/jpeg")]
                files += [("image[]", f"{h}.jpg", _jpeg(p), "image/jpeg") for h, p in inputs.pictures.items() if h != subject][:7]
            else:
                files = [("image[]", f"{subject}.png", _png(first), "image/png")]
                files += [("image[]", f"{h}.png", _png(p), "image/png") for h, p in inputs.pictures.items() if h != subject][:7]
                files.append(("mask", "mask.png", mask, "image/png"))
            body, kind = _multipart(common, files)
            path = "/images/edits"
        else:
            body = json.dumps({k: (v if k not in ("stream", "partial_images", "output_compression") else (v == "true" if k == "stream" else int(v))) for k, v in common}).encode()
            kind, path = "application/json", "/images/generations"
        work.stage("plan")
        keep = self._keeper(turn, inputs)
        with self._open(path, body, kind, float(pace.get("timeout", 180))) as response:
            if "text/event-stream" in (response.headers.get("Content-Type") or ""):
                if self._stream(response, work, index, prompt, turn.aspect, keep):
                    return
                raise EngineError("未返回图像", "请重试。")
            answer = json.loads(response.read().decode("utf-8"))
            work.result(index, keep(shaped(_picture(answer["data"][0]["b64_json"]), turn.aspect)), prompt)

    def _keeper(self, turn: Turn, inputs: Inputs):
        """区域编辑只修改标记区域：通过蒙版的
        （已羽化）并集将新图像叠入原图，因此区域外的每个像素都保持原样。"""
        subject = inputs.subject or next(iter(inputs.pictures), None)
        if turn.intent.op != "region" or not subject:
            return lambda picture: picture
        with Image.open(inputs.pictures[subject]) as im:
            original = im.convert("RGB")
        region = self._region(inputs, original.size)
        if region is None or not region.getbbox():
            return lambda picture: picture
        return lambda picture: _composite_region(picture, original, region)

    @staticmethod
    def _region(inputs: Inputs, size: tuple[int, int]) -> Image.Image | None:
        """将标记区域合并成与图像同尺寸的灰度蒙版：白色表示允许修改的位置。"""
        masks = [m for _, _, m in inputs.pins if m] + ([inputs.subject_mask] if inputs.subject_mask else [])
        if not inputs.pins or not masks:
            return None
        region = Image.new("L", size, 0)
        for path in masks[: len(inputs.pins)]:
            with Image.open(path) as m:
                region = ImageChops.lighter(region, m.convert("L").resize(size))
        return region

    @classmethod
    def _mask(cls, inputs: Inputs, size: tuple[int, int]) -> bytes | None:
        """将标记区域转换为接口要求的形式：透明表示图像可以修改的位置。"""
        region = cls._region(inputs, size)
        if region is None:
            return None
        out = Image.new("RGBA", size, (0, 0, 0, 255))
        out.putalpha(ImageChops.invert(region))
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue()

    def turn(self, turn: Turn, inputs: Inputs, work: Work) -> None:
        work.stage("read")
        prompt = brief.direct_brief(turn, inputs)
        work.plan("GPT Image, " + PACES.get(turn.pace, turn.pace).lower() + (f", {turn.n} 张图像" if turn.n > 1 else ""), prompt)
        talk = self._talk(turn)   # 在生成图像的同时撰写回复，因此不增加等待时间
        prompts = [prompt] * turn.n
        if turn.intent.op == "angles":
            prompts = [brief.angle_brief(turn, inputs, ANGLES[i % len(ANGLES)]) for i in range(turn.n)]
        if turn.n == 1:
            self._one(turn, inputs, work, 0, prompts[0])
        else:
            with ThreadPoolExecutor(max_workers=min(4, turn.n)) as pool:
                for future in [pool.submit(self._one, turn, inputs, work, i, prompts[i]) for i in range(turn.n)]:
                    future.result()
        work.reply(*self._answer(turn, talk))

    def _talk(self, turn: Turn):
        """在后台请求文本模型生成工作室回复；没有文本模型时返回 None。"""
        if not self.config.get("text_model", "gpt-5.4-mini"):
            return None
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            return pool.submit(self._words, brief.reply_brief(turn), REPLY_SCHEMA, None, 30.0)
        finally:
            pool.shutdown(wait=False)

    @staticmethod
    def _answer(turn: Turn, talk) -> tuple[str, list[str]]:
        """回复与三个创意：文本模型及时回答时使用其结果，否则使用风格自带的话语。"""
        voice = turn.room.voice if turn.room and turn.room.voice else ["你的人像作品已完成！"]
        fallback = (voice[secrets.randbelow(len(voice))], brief.IDEAS.get(turn.intent.op, brief.IDEAS["edit"]))
        if talk is None:
            return fallback
        try:
            answer = talk.result(timeout=5)   # 图像已经花费了一段时间：文本最多再等待几秒，绝不更久
        except Exception:
            talk.cancel()
            return fallback
        if not isinstance(answer, dict):
            return fallback
        reply = str(answer.get("reply") or "").strip()[:120]
        offered = answer.get("suggestions")
        offered = offered if isinstance(offered, list) else []
        ideas = []
        for suggestion in [*offered, *fallback[1]]:
            suggestion = str(suggestion).strip()[:48]
            if suggestion and suggestion.casefold() not in {idea.casefold() for idea in ideas}:
                ideas.append(suggestion)
            if len(ideas) == 3:
                break
        return reply or fallback[0], ideas

    # ---- 仅文本 ----
    def _words(self, text: str, schema: dict, picture: Path | None = None, timeout: float = 90.0) -> dict:
        content: list[dict] = [{"type": "text", "text": text}]
        if picture is not None:
            content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(_png(picture)).decode()}})
        body = json.dumps({"model": str(self.config.get("text_model") or "gpt-5.4-mini"), "messages": [{"role": "user", "content": content}],
                           "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}}}).encode()
        with self._open("/chat/completions", body, "application/json", timeout) as response:
            answer = json.loads(response.read().decode("utf-8"))
        try:
            return json.loads(answer["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise EngineError("无法读取模型回复", "请重试。") from error

    def room(self, ask: RoomAsk) -> dict:
        return self._words(brief.room_brief(ask.text, ask.palette), ROOM_SCHEMA)

    def look(self, ask: LookAsk, picture: Path | None) -> dict:
        return self._words(brief.look_brief(ask.text, picture is not None), LOOK_SCHEMA, picture)

    def style(self, ask: StyleAsk, picture: Path | None) -> dict:
        return self._words(brief.style_brief(ask.text, picture is not None), STYLE_SCHEMA, picture)

    def backdrops(self, ask: BackdropAsk, picture: Path | None) -> list[dict]:
        return self._words(brief.backdrops_brief(ask.text, ask.near, ask.dream, ask.room, picture is not None), BACKDROPS_SCHEMA, picture).get("backdrops") or []


# ---- likeness probe openai 探测 ----
PROBLEMS = {
    401: "接口密钥无效、已删除或已过期（401）。请将有效密钥写入 .env.local，并重启工作室。",
    403: "此接口密钥没有访问权限（403）。请检查对应的 OpenAI 项目和组织权限。",
    429: "已达到配额或速率限制（429）。请检查接口账户余额和项目预算。",
}


def probe(config: dict | None = None) -> dict:
    """检查密钥是否存在、是否有效，以及是否可以使用工作室要求的模型。GET /models 不产生费用，也不生成
    任何内容。报告只说明是否找到密钥，绝不包含密钥本身。"""
    config = dict(config or {})
    base = (os.environ.get("OPENAI_BASE_URL") or config.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    key = _key(config)
    paces = {name: {**DEFAULT_PACES[name], **(config.get("pace", {}).get(name) or {})} for name in PACES}
    images = sorted({str(p["model"]) for p in paces.values() if p.get("model")})
    text = str(config.get("text_model") or "gpt-5.4-mini")
    report: dict = {"engine": "openai", "base": base, "key": "found" if key else "missing", "image_models": {}, "text_model": {}, "ok": False}
    if not key:
        report["problem"] = "未找到 OPENAI_API_KEY。请在项目根目录的 .env.local 中添加 OPENAI_API_KEY=...；此文件由 Git 忽略。"
        return report
    request = urllib.request.Request(base + "/models", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            listed = {str(m.get("id")) for m in json.loads(response.read().decode("utf-8")).get("data", []) if isinstance(m, dict)}
    except urllib.error.HTTPError as error:
        report["status"] = error.code
        report["problem"] = PROBLEMS.get(error.code, f"OpenAI 返回了{error.code}。请稍后重试。")
        return report
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError, ValueError):
        report["problem"] = "无法连接 OpenAI。请检查网络连接；使用其他接口地址时请设置 OPENAI_BASE_URL。"
        return report
    # 某些网关不列出模型：此时无法核验，也不据此判定密钥有问题
    report["image_models"] = {m: (m in listed) if listed else None for m in images}
    report["text_model"] = {text: (text in listed) if listed else None}
    missing = [m for m, ok in report["image_models"].items() if ok is False]
    report["ok"] = not missing
    if missing:
        report["problem"] = "此接口密钥无法使用" + ", ".join(missing) + "。请在 private/studio.toml 的 [openai.pace.*] 中选择可用模型。"
    elif report["text_model"].get(text) is False:
        report["note"] = f"此接口密钥无法使用文本模型{text}。图像生成仍然可用；回复使用本地英语备用文案。"
    return report

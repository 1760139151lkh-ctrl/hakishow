"""工作站引擎：Codex 命令行工具执行任务，并使用 GPT Image 制作图像。

每一轮都是一次 codex exec，在工作室私有目录下的独立文件夹中运行：

  jobs/<id>/in/        本轮图像按句柄命名（A.png、B.png），以及相应蒙版（A.pin1.png、A.edit.png、A.subject.png）
  jobs/<id>/out/       Codex 保存生成内容的位置（1.png、2.png、……）；每个文件完成后立即收集
  jobs/<id>/brief.md   发送给 Codex 的任务说明（也会通过标准输入发送）
  jobs/<id>/events.jsonl、stderr.log   Codex 输出的全部内容，供排查问题时查看

Codex 的 JSON 事件流成为应用的进度：推理标题转为任务卡片上的说明，任务说明要求的 PLAN、DONE
与 FAILED 行分别转为计划、回复与失败信息。配置位于 studio.toml 的 [codex] 下；
应用中选择的速度档位决定使用 [codex.pace.quick|fine|deep]（模型、推理投入、图像质量、超时）。
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import itertools
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat

from .. import brief, paths
from ..jobs import Cancelled
from ..rooms import BACKDROPS_SCHEMA, LOOK_SCHEMA, ROOM_SCHEMA
from ..turns import SIZES, BackdropAsk, Inputs, LookAsk, RoomAsk, Turn
from . import EngineError, Work

PACES = {"quick": "快速", "fine": "精细", "deep": "深度"}
DEFAULT_PACE = {"quick": {"effort": "low", "quality": "low", "timeout": 300},
                "fine": {"effort": "medium", "quality": "medium", "timeout": 600},
                "deep": {"effort": "high", "quality": "high", "timeout": 900}}
IMAGE_HINT = ("使用你的图像生成工具（GPT Image）。任务涉及修改图像时，向工具提供该图像"
              "在 in/ 中的文件作为输入，并在标记了区域时提供编辑蒙版，而不是从头描述图像。")
MARK = re.compile(r"^[\s>*_\x60]*(PLAN|DONE|FAILED)\b[\s:*_\x60]*(\{.*\})[\s*_\x60]*$", re.M)
NUMBERED = re.compile(r"^(\d+)\.(png|jpe?g|webp)$", re.I)
PICTURES = {".png", ".jpg", ".jpeg", ".webp"}
KEEP = 40
LOCAL_FILE = re.compile(r'''(?ix)
    (?: [a-z]:[\\/] | \\\\ | file:/+ | /(?:home|Users|private|mnt|tmp|var)/ )
    [^\s"'<>]*
''')


def _composite_region(generated: Image.Image, original: Image.Image, mask: Image.Image) -> Image.Image:
    """在选区附近配准新图像，然后向内羽化边缘。"""
    width, height = original.size
    scale = min(1.0, 180.0 / max(width, height))
    sample_size = (max(24, round(width * scale)), max(24, round(height * scale)))
    source = original.resize(sample_size, Image.Resampling.BILINEAR)
    selection = mask.resize(sample_size, Image.Resampling.NEAREST)
    radius = max(9, (min(sample_size) // 6) | 1)
    collar = ImageChops.subtract(selection.filter(ImageFilter.MaxFilter(radius)), selection)
    if sum(collar.histogram()[1:]) < 40:
        collar = ImageOps.invert(selection)

    def warp(size: tuple[int, int], mode: str, zoom: float, dx: float, dy: float) -> Image.Image:
        w, h = size
        sx, sy = w / generated.width, h / generated.height
        if mode == "fill":
            sx = sy = max(sx, sy)
        elif mode == "fit":
            sx = sy = min(sx, sy)
        ax, ay = 1 / (sx * zoom), 1 / (sy * zoom)
        return generated.transform(size, Image.Transform.AFFINE,
                                   (ax, 0, generated.width / 2 - w * (.5 + dx) * ax,
                                    0, ay, generated.height / 2 - h * (.5 + dy) * ay), Image.Resampling.BICUBIC)

    def error(mode: str, zoom: float, dx: float, dy: float) -> float:
        difference = ImageChops.difference(source, warp(sample_size, mode, zoom, dx, dy))
        return sum(ImageStat.Stat(difference, mask=collar).mean) / 3

    aligned = generated.resize(original.size, Image.Resampling.LANCZOS)
    if collar.getbbox() and max(ImageStat.Stat(source, mask=collar).stddev) > 4:
        baseline = error("stretch", 1.0, 0.0, 0.0)
        best = (baseline, "stretch", 1.0, 0.0, 0.0)
        if baseline > 3.5 or abs(generated.width / generated.height - width / height) > .02:
            coarse = itertools.product(("stretch", "fill", "fit"), (.94, .97, 1.0, 1.03, 1.06, 1.10),
                                       (-.05, -.025, 0.0, .025, .05), (-.08, -.04, 0.0, .04, .08))
            best = min(best, min((error(*pose), *pose) for pose in coarse), key=lambda result: result[0])
            for step in (.015, .006, .002):
                _, mode, zoom, x, y = best
                offsets = itertools.product((-step, 0.0, step), repeat=3)
                poses = ((mode, zoom + dz, x + dx, y + dy) for dz, dx, dy in offsets)
                best = min(best, min((error(*pose), *pose) for pose in poses), key=lambda result: result[0])
        if best[0] < baseline - .8:
            aligned = warp(original.size, *best[1:])

    softness = max(1.5, min(width, height) / 180)
    soft = mask.filter(ImageFilter.GaussianBlur(softness))
    core = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(softness * .7))
    feathered = ImageChops.multiply(ImageChops.lighter(soft, core), mask)
    return Image.composite(aligned, original, feathered)


def resolve(command: list[str]) -> list[str]:
    """在 Windows 上，codex 通常是 .cmd 启动包装文件，仅用名称无法启动；which() 用于定位它。"""
    return [shutil.which(command[0]) or command[0], *command[1:]]


def version(command: list[str]) -> str | None:
    """命令行工具的版本；没有响应时返回 None。"""
    try:
        done = subprocess.run([*resolve(command), "--version"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return (done.stdout.strip() or done.stderr.strip() or "unknown") if done.returncode == 0 else None


def kill(proc: subprocess.Popen) -> None:
    """停止 Codex 以及它启动的所有进程。"""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=15)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(8)
    except (OSError, subprocess.TimeoutExpired):
        proc.kill()


def heading(text: str) -> str:
    """推理摘要的标题（Codex 以 **加粗行** 输出），或摘要的第一句话。"""
    text = (text or "").strip()
    bold = re.match(r"^\*\*(.+?)\*\*", text)
    line = bold.group(1) if bold else re.split(r"(?<=[.!?])\s|\n", text, maxsplit=1)[0]
    return re.sub(r"[*_\x60#]", "", line).strip()[:90]


def loads(text: str) -> dict:
    """从模型回答中提取 JSON，允许其周围存在代码围栏与说明文字。"""
    text = re.sub(r"^\x60{3}(?:json)?|\x60{3}$", "", (text or "").strip(), flags=re.M).strip()
    for candidate in (text, text[text.find("{"): text.rfind("}") + 1] if "{" in text else ""):
        try:
            value = json.loads(candidate)
            return value if isinstance(value, dict) else {}
        except ValueError:
            continue
    return {}


class Follow:
    """将 Codex 的 JSON 事件流读取为进度。兼容条目事件（thread.started、item.completed 等）
    以及旧版的 {"msg": {...}} 行。"""

    def __init__(self, work: Work | None) -> None:
        self.work = work
        self.prompt = ""
        self.planned = False
        self.thread_id = ""
        self.reply: dict | None = None
        self.failed: tuple[str, str] | None = None
        self.error = ""
        self.messages: list[str] = []
        self.loose: list[Path] = []   # 图像工具保存在 out/ 以外位置的图像
        self.spill: Path | None = None   # 随事件到达的图像的写入位置

    def _stage(self, key: str) -> None:
        if self.work:
            self.work.stage(key)

    def _note(self, text: str) -> None:
        if self.work and text:
            self.work.note(text)

    def line(self, raw: str) -> None:
        try:
            event = json.loads(raw)
        except ValueError:
            return
        if not isinstance(event, dict):
            return
        if isinstance(event.get("msg"), dict):
            return self._legacy(event["msg"])
        kind = event.get("type", "")
        if kind == "thread.started":
            thread_id = str(event.get("thread_id") or "")
            if re.fullmatch(r"[A-Za-z0-9_-]{8,128}", thread_id):
                self.thread_id = thread_id
        elif kind.startswith("item."):
            self._item(event.get("item") or {}, kind.split(".", 1)[1])
        elif kind == "turn.failed":
            self.error = str((event.get("error") or {}).get("message") or "Codex 已停止。")
        elif kind == "error":
            self.error = str(event.get("message") or "Codex 报告了错误。")

    def _item(self, item: dict, phase: str) -> None:
        kind = str(item.get("type") or item.get("item_type") or "")
        if kind == "reasoning":
            if not self.planned:
                self._stage("plan")
            if phase == "completed":
                self._note(heading(str(item.get("text") or "")))
        elif kind in ("agent_message", "assistant_message") and phase == "completed":
            self.message(str(item.get("text") or ""))
        elif "image" in kind:
            self._stage("draw")
            if phase == "completed":
                self._adopt(item)
        elif kind in ("command_execution", "file_change", "mcp_tool_call", "web_search") and phase == "started" and self.planned:
            self._stage("draw")
        elif kind == "error":
            self.error = str(item.get("message") or self.error)

    def _legacy(self, msg: dict) -> None:
        kind = msg.get("type", "")
        if kind in ("agent_reasoning", "agent_reasoning_raw_content"):
            if not self.planned:
                self._stage("plan")
            self._note(heading(str(msg.get("text") or "")))
        elif kind == "agent_message":
            self.message(str(msg.get("message") or ""))
        elif kind == "task_complete" and msg.get("last_agent_message") and not self.messages:
            self.message(str(msg["last_agent_message"]))
        elif kind == "exec_command_begin" and self.planned:
            self._stage("draw")
        elif kind == "error":
            self.error = str(msg.get("message") or "Codex 报告了错误。")

    def _adopt(self, item: dict) -> None:
        """图像工具的结果，无论它保存在哪里：文件路径，或采用 base64 编码的图像本身。"""
        for key, value in item.items():
            if not isinstance(value, str):
                continue
            if Path(value).suffix.lower() in PICTURES and len(value) < 600 and Path(value).exists():
                self.loose.append(Path(value))
            elif len(value) > 64 and value.lstrip()[:12].startswith(("iVBOR", "/9j/", "UklGR", "data:image")):
                try:
                    data = base64.b64decode(value.split(",", 1)[1] if value.startswith("data:") else value)
                except (ValueError, binascii.Error):
                    continue
                if self.spill is not None:
                    self.spill.mkdir(exist_ok=True)
                    target = self.spill / f"tool-{len(self.loose) + 1}.png"
                    target.write_bytes(data)
                    self.loose.append(target)

    def message(self, text: str) -> None:
        self.messages.append(text)
        marks = MARK.findall(text)
        for mark, body in marks:
            data = loads(body)
            if mark == "PLAN":
                self.planned = True
                self.prompt = str(data.get("prompt") or "")[:1600]
                if self.work:
                    self.work.plan(str(data.get("summary") or "正在规划图像"), self.prompt)
                self._stage("draw")
            elif mark == "DONE":
                self.reply = data
            else:
                self.failed = (str(data.get("message") or "工作室无法完成该操作。"), str(data.get("hint") or ""))
        if not marks and not self.planned:
            self._note(heading(text))


class Watcher:
    """从任务与当前 Codex 线程收集完整图像，每张图像只收集一次。"""

    def __init__(self, folder: Path, n: int) -> None:
        self.folder, self.n = folder, n
        self.sizes: dict[Path, tuple[int, int]] = {}
        self.taken: set[Path] = set()
        self.hashes: set[bytes] = set()
        self.used: set[int] = set()

    def _index(self, name: str) -> int:
        numbered = NUMBERED.match(name)
        if numbered and 0 < int(numbered.group(1)) <= self.n and int(numbered.group(1)) - 1 not in self.used:
            index = int(numbered.group(1)) - 1
        else:
            index = next(i for i in range(self.n) if i not in self.used)
        self.used.add(index)
        return index

    def ready(self, generated: Path | None = None, loose: tuple[Path, ...] = (), *, final: bool = False) -> list[tuple[int, Image.Image]]:
        candidates = sorted(self.folder.iterdir()) if self.folder.is_dir() else []
        if generated and generated.is_dir():
            stamped = []
            for path in generated.iterdir():
                try:
                    stamped.append((path.stat().st_mtime_ns, path))
                except OSError:
                    continue
            candidates.extend(path for _, path in sorted(stamped))
        candidates.extend(loose)
        found = []
        for path in candidates:
            if len(self.used) >= self.n:
                break
            if path.suffix.lower() not in PICTURES or path in self.taken:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            mark = (stat.st_size, stat.st_mtime_ns)
            if not final and self.sizes.get(path) != mark:
                self.sizes[path] = mark
                continue
            try:
                raw = path.read_bytes()
                digest = hashlib.sha256(raw).digest()
                if digest in self.hashes:
                    self.taken.add(path)
                    continue
                with Image.open(io.BytesIO(raw)) as image:
                    image.load()
                    picture = ImageOps.exif_transpose(image).convert("RGB")
            except Exception:
                continue
            self.taken.add(path)
            self.hashes.add(digest)
            found.append((self._index(path.name), picture))
        return found


class Codex:
    id = "codex"
    kind = "codex"

    def __init__(self, config: dict | None = None, home: Path | None = None) -> None:
        self.config = config or {}
        self.home = home or paths.home()
        self.command = list(self.config.get("command") or ["codex"])

    # ---- 提供给应用的信息 -------------------------------------------------------------------------------------
    def pace(self, name: str) -> dict:
        return {**DEFAULT_PACE.get(name, DEFAULT_PACE["fine"]), **((self.config.get("pace") or {}).get(name) or {})}

    def describe(self) -> dict:
        return {"id": self.id, "kind": self.kind, "label": "Codex · GPT Image", "ready": True,
                "detail": "Codex 命令行工具在本机上使用 GPT Image 制作每张图像。",
                "paces": {name: {k: self.pace(name).get(k, "") for k in ("model", "effort", "quality")} for name in PACES}}

    def provenance(self, turn: Turn) -> dict:
        model = self.pace(turn.pace).get("model")
        return {"kind": "render", "label": "渲染结果", "detail": f"Codex · GPT Image · {PACES.get(turn.pace, turn.pace)}" + (f" · {model}" if model else "")}

    # ---- 命令行 -----------------------------------------------------------------------------------------
    def argv(self, workdir: Path, settings: dict, images: list[Path], *, sandbox: str | None = None,
             schema: Path | None = None, answer: Path | None = None) -> list[str]:
        argv = [*resolve(self.command), "exec", "--json", "--skip-git-repo-check", "-C", str(workdir),
                "--sandbox", sandbox or str(self.config.get("sandbox") or "workspace-write")]
        if settings.get("model"):
            argv += ["-m", str(settings["model"])]
        if settings.get("effort"):
            argv += ["-c", f"model_reasoning_effort={settings['effort']}"]   # 使用不加引号的单词，以兼容 Windows 上的 .cmd 包装文件
        for key, value in (self.config.get("overrides") or {}).items():   # 更多 -c key=value 覆盖项，值使用 TOML 格式
            argv += ["-c", f"{key}={json.dumps(value)}"]
        if schema:
            argv += ["--output-schema", str(schema)]
        if answer:
            argv += ["-o", str(answer)]
        argv += [str(a) for a in self.config.get("args") or []]
        for image in images:
            argv += ["-i", str(image)]
        return argv + ["--", "-"]   # 任务说明通过标准输入传入；-- 防止它被当作另一张图像

    def _folder(self, kind: str) -> Path:
        root = self.home / kind
        root.mkdir(parents=True, exist_ok=True)
        for old in sorted(p for p in root.iterdir() if p.is_dir())[:-KEEP]:
            shutil.rmtree(old, ignore_errors=True)
        folder = root / f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
        folder.mkdir()
        return folder

    def lay_out(self, folder: Path, inputs: Inputs) -> tuple[dict[str, str], list[Path], Image.Image | None]:
        """将本轮的图像与蒙版放在 in/ 下，并命名以便任务说明引用。"""
        (folder / "in").mkdir()
        (folder / "out").mkdir()
        files, attach, sizes = {}, [], {}
        for handle, path in inputs.pictures.items():
            target = folder / "in" / f"{handle}.png"
            with Image.open(path) as image:
                picture = ImageOps.exif_transpose(image).convert("RGB")
            picture.save(target)
            files[handle], sizes[handle] = f"in/{handle}.png", picture.size
            attach.append(target)
        subject = inputs.subject or next(iter(inputs.pictures), None)
        union = None
        for n, _note, mask in inputs.pins:
            if mask is None or subject is None:
                continue
            with Image.open(mask) as m:
                region = m.convert("L").resize(sizes[subject])
            region.save(folder / "in" / f"{subject}.pin{n}.png")
            files[f"pin{n}"] = f"in/{subject}.pin{n}.png"
            union = region if union is None else ImageChops.lighter(union, region)
        if union is not None and subject is not None:   # 将相同区域合并为符合图像编辑约定的蒙版：透明表示修改
            with Image.open(folder / "in" / f"{subject}.png") as image:
                edit = image.convert("RGBA")
            edit.putalpha(ImageOps.invert(union.point(lambda v: 255 if v > 96 else 0)))
            edit.save(folder / "in" / f"{subject}.edit.png")
            files["edit"] = f"in/{subject}.edit.png"
        if inputs.subject_mask is not None and subject is not None:
            with Image.open(inputs.subject_mask) as m:
                m.convert("L").resize(sizes[subject]).save(folder / "in" / f"{subject}.subject.png")
            files["subject"] = f"in/{subject}.subject.png"
        return files, attach, union

    # ---- 一个交互轮次 ---------------------------------------------------------------------------------------------------
    def turn(self, turn: Turn, inputs: Inputs, work: Work) -> None:
        folder = self._folder("jobs")
        files, attach, mask = self.lay_out(folder, inputs)
        pace = self.pace(turn.pace)
        text = brief.turn_brief(turn, inputs, files, size=SIZES.get(turn.aspect or "", "") or str(self.config.get("size") or "1024x1536"), quality=str(pace.get("quality") or "medium"),
                                image_hint=str((self.config.get("images") or {}).get("hint") or IMAGE_HINT))
        (folder / "brief.md").write_text(text, encoding="utf-8")
        work.stage("read")
        follow = Follow(work)
        follow.spill = folder / "tool"
        argv = self.argv(folder, pace, attach if self.config.get("attach", True) else [])
        region = None
        if turn.intent.op == "region" and mask is not None:
            # 工具需要硬边编辑蒙版。最终合成会保留选区的柔和边缘。
            with Image.open(folder / files["edit"]) as guide:
                region = guide.convert("RGB"), mask
        single_portrait = turn.intent.op == "restyle" and turn.aspect is not None and turn.n == 1
        code = self._run(argv, text, folder, follow, work, turn.n, float(pace.get("timeout") or 600), region,
                         single_portrait=single_portrait)
        if follow.failed:
            raise EngineError(*(LOCAL_FILE.sub("一个本地文件", part) for part in follow.failed))
        if not work.results:
            stderr = (folder / "stderr.log").read_text(encoding="utf-8", errors="replace")[-2000:]
            if re.search(r"log ?in|auth|unauthori[sz]ed|401", stderr + follow.error, re.I):
                raise EngineError("工作站上的 Codex 尚未登录。", "请在工作站上运行 codex login，然后重试。")
            if follow.error or code:
                raise EngineError("Codex 已停止，但未生成图像。", "请重试。如果持续发生，请检查工作站上的工作室。")
            raise EngineError("工作室已完成任务，但未生成图像。", "请重试，也可以尝试用更少的文字描述。")
        if len(work.results) < turn.n:
            work.note(f"{len(work.results)} / {turn.n}已返回")
        reply = follow.reply or {}
        work.reply(str(reply.get("reply") or ""), [str(s) for s in reply.get("suggestions") or []])

    def _run(self, argv: list[str], text: str, folder: Path, follow: Follow, work: Work, n: int, timeout: float,
             region: tuple[Image.Image, Image.Image] | None = None, *, single_portrait: bool = False) -> int:
        events = (folder / "events.jsonl").open("w", encoding="utf-8")
        errors = (folder / "stderr.log").open("w", encoding="utf-8")
        try:
            proc = subprocess.Popen(argv, cwd=folder, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, encoding="utf-8",
                                    errors="replace", start_new_session=os.name != "nt")
        except OSError:
            events.close()
            errors.close()
            raise EngineError("无法在工作站上启动 Codex。", "请检查工作站上工作室配置的命令。") from None

        def feed() -> None:
            try:
                proc.stdin.write(text)
                proc.stdin.close()
            except OSError:
                pass

        def read() -> None:
            for raw in proc.stdout:
                events.write(raw)
                events.flush()
                follow.line(raw)

        threads = [threading.Thread(target=feed, daemon=True), threading.Thread(target=read, daemon=True)]
        for thread in threads:
            thread.start()
        watcher, deadline = Watcher(folder / "out", n), time.monotonic() + timeout
        generated_root = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "generated_images"
        reply_deadline = None

        def deliver(*, final: bool = False) -> None:
            thread_id = follow.thread_id
            generated = generated_root / thread_id if thread_id else None
            for index, picture in watcher.ready(generated, tuple(follow.loose), final=final):
                if region is not None:
                    original, mask = region
                    picture = _composite_region(picture, original, mask)
                work.result(index, picture, follow.prompt)

        try:
            while proc.poll() is None:
                if work.job.stop.is_set():
                    kill(proc)
                    raise Cancelled()
                deliver()
                now = time.monotonic()
                # 即使 Codex 在撰写结束消息时停滞，已完成的人像仍可使用。
                if single_portrait and work.results and reply_deadline is None:
                    reply_deadline = min(deadline, now + 10)
                if reply_deadline is not None and now >= reply_deadline and not follow.failed:
                    kill(proc)
                    threads[1].join(10)
                    return 0
                if now >= deadline:
                    kill(proc)
                    hint = "请重试，或减少请求的图像数量。" if n > 1 else "请稍后重试。"
                    raise EngineError("工作室耗时过长，已被停止。", hint)
                time.sleep(0.3)
            threads[1].join(10)
            deliver(final=True)
            return proc.returncode or 0
        finally:
            kill(proc)
            events.close()
            errors.close()

    # ---- 仅文本：房间、外观与背景创意 -----------------------------------------------------------------
    def ask(self, text: str, schema: dict, picture: Path | None = None) -> dict:
        folder = self._folder("asks")
        settings = {"effort": "low", "timeout": 150, **(self.config.get("text") or {})}
        (folder / "schema.json").write_text(json.dumps(schema), encoding="utf-8")
        (folder / "brief.md").write_text(text, encoding="utf-8")
        images = []
        if picture is not None:
            images.append(folder / f"picture{picture.suffix.lower()}")
            shutil.copy(picture, images[0])
        argv = self.argv(folder, settings, images, sandbox="read-only", schema=folder / "schema.json", answer=folder / "answer.json")
        try:
            done = subprocess.run(argv, input=text, cwd=folder, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=float(settings["timeout"]))
        except subprocess.TimeoutExpired:
            raise EngineError("工作室回复超时。", "请稍后重试。") from None
        except OSError:
            raise EngineError("无法在工作站上启动 Codex。", "请检查工作站上工作室配置的命令。") from None
        (folder / "events.jsonl").write_text(done.stdout, encoding="utf-8")
        (folder / "stderr.log").write_text(done.stderr, encoding="utf-8")
        answer = folder / "answer.json"
        follow = Follow(None)
        for raw in done.stdout.splitlines():
            follow.line(raw)
        data = loads(answer.read_text(encoding="utf-8")) if answer.exists() else {}
        if not data and follow.messages:
            data = loads(follow.messages[-1])
        if not data:
            raise EngineError("无法读取工作室的回答。", "请重试，也可以换一种说法。")
        return data

    def room(self, ask: RoomAsk) -> dict:
        return self.ask(brief.room_brief(ask.text, ask.palette), ROOM_SCHEMA)

    def look(self, ask: LookAsk, picture: Path | None) -> dict:
        return self.ask(brief.look_brief(ask.text, picture is not None), LOOK_SCHEMA, picture)

    def style(self, ask, picture: Path | None) -> dict:
        from ..rooms import STYLE_SCHEMA
        return self.ask(brief.style_brief(ask.text, picture is not None), STYLE_SCHEMA, picture)

    def backdrops(self, ask: BackdropAsk, picture: Path | None) -> list[dict]:
        return self.ask(brief.backdrops_brief(ask.text, ask.near, ask.dream, ask.room, picture is not None), BACKDROPS_SCHEMA, picture).get("backdrops") or []


# ---- 探测：是否安装了 Codex，它是否支持工作室所需的调用方式？ ------------------------------------------------
FLAGS = ("--json", "--skip-git-repo-check", "--cd", "--sandbox", "--model", "--config", "--image", "--output-schema", "--output-last-message")
SMOKE = [   # 不含个人内容：先生成静物，再编辑它
    {"id": "smoke-create", "text": "一幅静物：蓝色桌布上摆着三个梨，晨光从左侧照入", "pace": "quick", "intent": {"op": "create"}},
    {"id": "smoke-edit", "text": "将桌布改成深红色；其余所有内容保持不变", "pace": "quick", "intent": {"op": "edit", "subject": "{made}"}, "handles": {"A": "{made}"}},
]


def probe(config: dict, smoke: bool = False, out: Path | None = None, home: Path | None = None) -> dict:
    command = list(config.get("command") or ["codex"])
    report: dict = {"command": command, "found": bool(shutil.which(command[0])), "version": version(command)}
    if report["version"]:
        try:
            helped = subprocess.run([*resolve(command), "exec", "--help"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
            report["flags"] = {flag: flag in helped.stdout for flag in FLAGS}
        except (OSError, subprocess.TimeoutExpired):
            report["flags"] = {}
        try:
            status = subprocess.run([*resolve(command), "login", "status"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
            report["signed_in"] = status.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            report["signed_in"] = None
    report["ok"] = bool(report["version"]) and bool(report.get("flags")) and all(report["flags"].values()) and report.get("signed_in") is not False
    if smoke and report["ok"]:
        report["smoke"] = smoke_test(config, out, home)
        report["ok"] = report["smoke"]["ok"]
    return report


def smoke_test(config: dict, out: Path | None = None, home: Path | None = None) -> dict:
    """按服务器的实际运行方式让真实交互轮次通过引擎，记录耗时，并将图像保存在报告旁边。"""
    from ..jobs import Job
    from ..store import Store

    home = home or paths.home()
    engine, store, rows, made = Codex(config, home), Store(home), [], None
    for spec in SMOKE:
        if "{made}" in json.dumps(spec) and made is None:
            continue
        turn = Turn.model_validate(json.loads(json.dumps(spec).replace("{made}", made or "")))
        inputs = Inputs(pictures={h: store.path(a) for h, a in turn.handles.items()}, subject=turn.handle_of(turn.intent.subject))
        job = Job()
        work = Work(job, store, engine.provenance(turn))
        started, error = time.monotonic(), ""
        try:
            engine.turn(turn, inputs, work)
        except Exception as failure:
            error = f"{failure} {getattr(failure, 'hint', '')}".strip()
        row = {"turn": turn.id, "pace": turn.pace, "ok": bool(work.results) and not error, "ms": int((time.monotonic() - started) * 1000), "error": error,
               "events": [e["type"] for e in job.events], "notes": [e["text"] for e in job.events if e["type"] == "note"][:12],
               "plan": next((e["plan"] for e in job.events if e["type"] == "plan"), None), "reply": next((e for e in job.events if e["type"] == "reply"), None)}
        if work.results:
            first = work.results[min(work.results)]
            made = first["id"]
            row["size"] = [first["w"], first["h"]]
            if out:
                out.mkdir(parents=True, exist_ok=True)
                shutil.copy(store.path(made), out / f"{turn.id}.png")
        rows.append(row)
    return {"ok": bool(rows) and all(r["ok"] for r in rows), "rows": rows}

"""引擎负责制作图像。工作室将每一轮交给引擎，同时提供磁盘上的图像与用于报告进度的 Work。
引擎在执行时报告自己正在做什么（阶段、说明、计划），每张图像完成后立即交回，
最后给出简短回复。三个引擎遵循相同协议：

  simulator  在任何环境下用 Pillow 绘制替代示例：用于搭建与测试完整流程，并如实标记
  codex      在工作站上由 Codex 命令行工具使用 GPT Image 制作图像
  openai     直接通过 OpenAI 接口使用 GPT Image：速度最快、支持流式传输（需要 OPENAI_API_KEY）
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from PIL import Image

from ..jobs import Job
from ..store import Store
from ..turns import BackdropAsk, Inputs, LookAsk, RoomAsk, Turn


class EngineError(RuntimeError):
    """显示给用户的失败信息：消息说明发生了什么，提示说明用户可以调整什么。"""

    def __init__(self, message: str, hint: str = "") -> None:
        super().__init__(message)
        self.hint = hint


def _tidy(text, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


class Work:
    """应用所看到的一个进行中的交互轮次：这里的每次调用都会成为任务事件流中的一个事件。"""

    def __init__(self, job: Job, store: Store, provenance: dict) -> None:
        self.job, self.store, self.provenance = job, store, provenance
        self.results: dict[int, dict] = {}
        self._stage = ""

    def check(self) -> None:
        self.job.check()

    def stage(self, key: str) -> None:
        if key != self._stage:
            self._stage = key
            self.job.emit("stage", stage=key)

    def note(self, text: str) -> None:
        if text := _tidy(text, 160):
            self.job.emit("note", text=text)

    def plan(self, summary: str, prompt: str = "") -> None:
        self.job.emit("plan", plan={"summary": _tidy(summary, 240), "prompt": str(prompt or "")[:1600]})

    def progress(self, value: float) -> None:
        self.job.emit("progress", value=round(max(0.0, min(1.0, value)), 3))

    def partial(self, index: int, image: Image.Image) -> None:
        if index not in self.results:
            asset = self.store.add_image(image, "partial")
            self.job.emit("partial", index=index, url=self.store.url(asset["id"]))

    def result(self, index: int, image: Image.Image, prompt: str = "") -> None:
        if index in self.results:
            return
        asset = self.store.add_image(image, "made", prompt=str(prompt or "")[:1600], provenance=self.provenance)
        self.results[index] = asset
        self.job.emit("result", index=index, url=self.store.url(asset["id"]), w=asset["w"], h=asset["h"], provenance=self.provenance, prompt=str(prompt or "")[:1600])

    def reply(self, text: str, suggestions: list[str] | None = None) -> None:
        ideas = [_tidy(s, 48) for s in suggestions or [] if _tidy(s, 48)]
        self.job.emit("reply", text=_tidy(text, 320), suggestions=ideas[:3])


def shaped(image: Image.Image, aspect: str | None) -> Image.Image:
    """按本轮要求的格式裁剪图像（居中，略高于中点，即面部通常所在的位置）。"""
    if not aspect or aspect == "portrait" and image.height >= image.width * 1.45:
        return image
    ratio = {"square": 1.0, "tall": 16 / 9, "portrait": 1.5}.get(aspect, 0)
    if not ratio:
        return image
    w, h = image.size
    if h / w > ratio:
        ch = int(w * ratio)
        top = max(0, min(h - ch, int((h - ch) * .35)))
        return image.crop((0, top, w, top + ch))
    cw = int(h / ratio)
    left = (w - cw) // 2
    return image.crop((left, 0, left + cw, h))


class Engine(Protocol):
    id: str
    kind: str   # "simulator"、"codex" 或 "openai"：决定应用显示的版本标记

    def describe(self) -> dict: ...
    def provenance(self, turn: Turn) -> dict: ...
    def turn(self, turn: Turn, inputs: Inputs, work: Work) -> None: ...
    def room(self, ask: RoomAsk) -> dict: ...
    def look(self, ask: LookAsk, picture: Path | None) -> dict: ...
    def backdrops(self, ask: BackdropAsk, picture: Path | None) -> list[dict]: ...


def create(name: str = "auto", config: dict | None = None, home: Path | None = None) -> Engine:
    """auto：配置了密钥（OPENAI_API_KEY、.env.local 或 [openai].key_file）时，通过接口使用 GPT Image，
    否则若本机上的 Codex 命令可用则使用 Codex，再否则使用模拟器。"""
    from .. import settings

    config = settings.load(home) if config is None else config
    name = (name or config.get("studio", {}).get("engine") or "auto").lower()
    if name == "auto":
        import os

        from .codex import version

        key_file = config.get("openai", {}).get("key_file")
        if os.environ.get("OPENAI_API_KEY", "").strip() or (key_file and Path(str(key_file)).expanduser().is_file()):
            from .openai_images import OpenAIImages

            return OpenAIImages(config.get("openai", {}))

        name = "codex" if version(list(config.get("codex", {}).get("command") or ["codex"])) else "simulator"
    if name in ("simulator", "mock"):
        from .simulator import Simulator

        return Simulator()
    if name == "codex":
        from .codex import Codex

        return Codex(config.get("codex", {}), home)
    if name == "openai":
        from .openai_images import OpenAIImages

        return OpenAIImages(config.get("openai", {}))
    raise SystemExit(f"不存在名为以下名称的引擎：{name}：请选择 auto、simulator、codex 或 openai。")

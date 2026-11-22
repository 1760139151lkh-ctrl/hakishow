"""工作室存储在磁盘上的图像：手机上传的全部内容，以及工作室生成的全部内容；每项素材对应一个文件，
旁边附有简短 JSON 记录。所有内容位于由 Git 忽略的私有文件夹下。"""

from __future__ import annotations

import io
import json
import re
import secrets
import time
from pathlib import Path

from PIL import Image, ImageOps

MAX_UPLOAD = 24 * 2**20
KINDS = ("image", "mask", "made", "partial")
ASSET_ID = re.compile(r"[0-9a-f]{16}(?:[0-9a-f]{16})?")


class Store:
    def __init__(self, home: Path, *, isolated: bool = False) -> None:
        self.dir = home / "assets"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.isolated = isolated

    def _note(self, asset_id: str) -> Path:
        return self.dir / f"{asset_id}.json"

    def add_bytes(self, data: bytes, kind: str = "image") -> dict:
        """一次上传：打开、校正方向、规范化（蒙版转为灰度 PNG，图像转为 RGB），然后保存。"""
        if len(data) > MAX_UPLOAD:
            raise ValueError("此图像超过24 MB。请选择更小的图像。")
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except Exception as error:
            raise ValueError("无法打开此文件。请尝试另一张照片。") from error
        return self.add_image(ImageOps.exif_transpose(image), kind)

    def add_image(self, image: Image.Image, kind: str = "made", **extra) -> dict:
        if kind not in KINDS:
            raise ValueError(f"未知素材类型：{kind}")
        asset_id = secrets.token_hex(16 if self.isolated else 8)
        if kind == "mask":
            image = image.convert("LA").getchannel("A") if image.mode in ("LA", "RGBA", "PA") else image.convert("L")
            name, fmt = f"{asset_id}.png", "PNG"
        else:
            # 图像以 JPEG 传输：字节量仅为 PNG 的一小部分，使上传、生成结果传输及手机端下载更快
            image = image.convert("RGB")
            name, fmt = f"{asset_id}.jpg", "JPEG"
        quality = {"partial": 80, "made": 92, "image": 92}.get(kind, 90)
        image.save(self.dir / name, fmt, **({"quality": quality, "optimize": kind == "made"} if fmt == "JPEG" else {"optimize": False}))
        note = {"id": asset_id, "file": name, "kind": kind, "w": image.width, "h": image.height, "created": time.time(), **extra}
        self._note(asset_id).write_text(json.dumps(note), encoding="utf-8")
        return note

    def get(self, asset_id: str) -> dict | None:
        if not asset_id or not ASSET_ID.fullmatch(asset_id):
            return None
        path = self._note(asset_id)
        if path.resolve().parent != self.dir.resolve():
            return None
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    def path(self, asset_id: str) -> Path | None:
        note = self.get(asset_id)
        if not note or note.get("file") not in (f"{asset_id}.png", f"{asset_id}.jpg"):
            return None
        path = self.dir / note["file"]
        return path if path.resolve().parent == self.dir.resolve() else None

    def open(self, asset_id: str) -> Image.Image:
        path = self.path(asset_id)
        if path is None:
            raise KeyError(asset_id)
        with Image.open(path) as image:
            image.load()
            return image.copy()

    def made(self, limit: int = 120) -> list[dict]:
        """工作室在此处生成的内容，按时间从新到旧排列：每张图像的地址、尺寸、时间及生成时使用的文字。"""
        notes = []
        for path in self.dir.glob("*.json"):
            try:
                note = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if note.get("kind") == "made":
                notes.append(note)
        notes.sort(key=lambda n: n.get("created", 0), reverse=True)
        return [{"id": n["id"], "url": self.url(n["id"]), "w": n.get("w"), "h": n.get("h"), "created": n.get("created", 0),
                 "prompt": str(n.get("prompt", ""))[:1600], "provenance": n.get("provenance", {})} for n in notes[:limit]]

    @staticmethod
    def url(asset_id: str) -> str:
        return f"api/assets/{asset_id}"

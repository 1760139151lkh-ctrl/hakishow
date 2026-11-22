"""HakiShow · 为网页优化生成的原始素材，并创建素材清单。

    uv run python tools/process_assets.py

读取 private/assets-raw/ 并写入 web/img/。每张人像包含三种尺寸：
完整作品为1024 × 1536，卡片图为540 × 810，以面部为中心的缩略图为240 × 240。
贴纸保留透明度，并裁去空白边缘。应用图标导出为192、512与180像素的 PNG。
仅在完整的原始素材集可用时运行。
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "private" / "assets-raw"
WEB = ROOT / "web"
IMG = WEB / "img"
FACE_Y = 0.36   # 人像采用头肩构图：面部约位于从顶部向下三分之一处


def save(im: Image.Image, path: Path, quality: int, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6, **kw)


def fit(im: Image.Image, w: int, h: int) -> Image.Image:
    """以覆盖裁剪方式裁成 w × h，并将面部（略高于中点）保留在画面内。"""
    if im.size == (w, h):
        return im
    scale = max(w / im.width, h / im.height)
    r = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left = (r.width - w) // 2
    top = max(0, min(r.height - h, int(r.height * FACE_Y - h * 0.42)))
    return r.crop((left, top, left + w, top + h))


def face_square(im: Image.Image, size: int, span: float = 0.66) -> Image.Image:
    side = int(im.width * span)
    cx, cy = im.width // 2, int(im.height * FACE_Y)
    top = max(0, min(im.height - side, cy - side // 2))
    left = max(0, min(im.width - side, cx - side // 2))
    return im.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def portrait_set(src: Path, dest: Path) -> dict:
    with Image.open(src) as raw:
        im = raw.convert("RGB")
    save(fit(im, 1024, 1536), dest.with_suffix(".webp"), 92)
    save(fit(im, 540, 810), dest.with_name(dest.name + "-m.webp"), 85)
    save(face_square(im, 240), dest.with_name(dest.name + "-t.webp"), 88)
    return {"w": 1024, "h": 1536}


def main() -> None:
    started = time.time()
    required = ("people", "styles", "bg", "stickers", "scenes")
    absent = [name for name in required if not (RAW / name).is_dir()]
    if absent:
        raise SystemExit("需要完整的原始素材集。缺少文件夹：" + ", ".join(absent) + "。现有网页素材保持不变。")
    current_manifest = IMG / "manifest.json"
    if current_manifest.is_file():
        current = json.loads(current_manifest.read_text(encoding="utf-8"))
        expected = [RAW / "people" / f"{name}.webp" for name in current.get("people", [])]
        expected += [RAW / "styles" / style / f"{person}.webp" for style, people in current.get("styles", {}).items() for person in people]
        expected += [RAW / "bg" / f"{name}.webp" for name in current.get("bg", [])]
        expected += [RAW / "stickers" / f"{name}.png" for name in current.get("stickers", {})]
        expected += [RAW / "scenes" / f"{name}.webp" for name in current.get("scenes", [])]
        missing = [str(path.relative_to(RAW)) for path in expected if not path.is_file()]
        if missing:
            raise SystemExit("原始素材集不完整：" + ", ".join(missing) + "。现有网页素材保持不变。")
    provenance = json.loads((RAW / "provenance.json").read_text()) if (RAW / "provenance.json").is_file() else {}
    manifest: dict = {"by": "GPT Image (gpt-image-2.6-sunburst)", "made": time.strftime("%Y-%m-%d"), "people": [], "styles": {}, "bg": [], "stickers": {}, "scenes": []}
    # 仅在确认所有当前源素材均存在后，重新生成派生尺寸。
    for sub in ("people", "styles", "bg", "stickers", "scenes"):
        shutil.rmtree(IMG / sub, ignore_errors=True)

    for src in sorted((RAW / "people").glob("*.webp")):
        if "." in src.stem:
            continue
        portrait_set(src, IMG / "people" / src.stem)
        manifest["people"].append(src.stem)

    for folder in sorted((RAW / "styles").iterdir()):
        if not folder.is_dir():
            continue
        made = []
        for src in sorted(folder.glob("*.webp")):
            if "." in src.stem:
                continue
            portrait_set(src, IMG / "styles" / folder.name / src.stem)
            made.append(src.stem)
        manifest["styles"][folder.name] = made

    for src in sorted((RAW / "bg").glob("*.webp")):
        if "." in src.stem:
            continue
        with Image.open(src) as raw:
            save(fit(raw.convert("RGB"), 540, 810), IMG / "bg" / f"{src.stem}.webp", 70)
        manifest["bg"].append(src.stem)

    for src in sorted((RAW / "stickers").glob("*.png")):
        if "." in src.stem:
            continue
        with Image.open(src) as raw:
            im = raw.convert("RGBA")
        alpha = im.getchannel("A").point(lambda a: 255 if a > 12 else 0)
        box = alpha.getbbox() or (0, 0, im.width, im.height)
        im = im.crop(box)
        im.thumbnail((512, 512), Image.LANCZOS)
        save(im, IMG / "stickers" / f"{src.stem}.webp", 86, exact=True)
        manifest["stickers"][src.stem] = {"w": im.width, "h": im.height}

    # 本地编辑工作区的背景选项缩略图。
    for src in sorted((RAW / "scenes").glob("*.webp")):
        if "." in src.stem:
            continue
        with Image.open(src) as raw:
            save(fit(raw.convert("RGB"), 256, 256), IMG / "scenes" / f"{src.stem}.webp", 76)
        manifest["scenes"].append(src.stem)

    icon = RAW / "brand" / "icon.webp"
    if icon.is_file():
        with Image.open(icon) as raw:
            im = raw.convert("RGB")
        for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")):
            im.resize((size, size), Image.LANCZOS).save(WEB / name, "PNG", optimize=True)
        save(im.resize((128, 128), Image.LANCZOS), IMG / "brand" / "icon.webp", 84)

    (IMG / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    # 模型、日期以及生成或创意参考记录保存在素材旁边，不内嵌到页面中。
    live = {f"people/{p}" for p in manifest["people"]} | {f"styles/{k}/{p}" for k, v in manifest["styles"].items() for p in v} | {f"bg/{b}" for b in manifest["bg"]} \
        | {f"stickers/{k}" for k in manifest["stickers"]} | {f"scenes/{k}" for k in manifest["scenes"]} | {"brand/icon"}
    provenance = {k: v for k, v in provenance.items() if k in live}
    (IMG / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum(f.stat().st_size for f in IMG.rglob("*") if f.is_file())
    print(f"web/img: {total / 2**20:.1f} MB in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()

"""HakiShow · 把新增的生成素材加入 web/img，并更新素材清单与来源记录。

    uv run python tools/add_art.py
    uv run --with numpy python tools/add_art.py   # 含 private/assets-raw/glow 发光素材时需要 numpy

与 tools/process_assets.py 不同，本脚本只做增量添加，不要求完整的原始素材集，也不会删除已有素材：
- private/assets-raw/covers/<风格>.png  → web/img/covers/<风格>.webp（768 × 768 方形封面）
                                       与 <风格>-t.webp（240 × 240，以眼睛为中心的轮播缩略图）
- private/assets-raw/stickers/<名称>.png → web/img/stickers/<名称>.webp（保留透明度、裁去空白，最长边 512）
  只处理清单中尚未登记的贴纸，已有贴纸保持原样。
- private/assets-raw/decor/<名称>.png   → web/img/decor/<名称>.webp（主题装饰插画，保留透明度，最长边 1024）
- private/assets-raw/bg/<风格>.png      → web/img/bg/<风格>.webp（720 × 1080 竖幅氛围背景，同时用作实时相机的场景背景）
- private/assets-raw/glow/<名称>.png    → web/img/stickers/<名称>.webp（黑底的发光素材，例如火焰与火星：
                                       以三通道最大值作为透明度转成透明贴图，用加色混合叠加时与黑底原图效果一致）
加 --force 会重新处理已登记的贴纸。
来源记录（模型、日期、创意描述）从 private/assets-raw/provenance.json 合并到 web/img/provenance.json。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "private" / "assets-raw"
IMG = ROOT / "web" / "img"
EYE_Y = 0.40   # 封面生成时要求双眼位于自上而下 40% 处


def save(im: Image.Image, path: Path, quality: int, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6, **kw)


def trimmed(src: Path, longest: int) -> Image.Image:
    with Image.open(src) as raw:
        im = raw.convert("RGBA")
    alpha = im.getchannel("A").point(lambda a: 255 if a > 12 else 0)
    im = im.crop(alpha.getbbox() or (0, 0, im.width, im.height))
    im.thumbnail((longest, longest), Image.LANCZOS)
    return im


def glow_to_alpha(src: Path, longest: int) -> Image.Image:
    """黑底发光图 → 透明贴图：去掉黑场噪点，透明度取三通道最大值，颜色按透明度还原（非预乘）。"""
    import numpy as np

    with Image.open(src) as raw:
        a = np.asarray(raw.convert("RGB")).astype(np.float32) / 255.0
    a = np.clip((a - 0.035) / 0.965, 0.0, 1.0)
    alpha = a.max(axis=2)
    rgb = np.where(alpha[..., None] > 1e-4, a / np.maximum(alpha[..., None], 1e-4), 0.0)
    out = np.dstack([rgb, alpha]) * 255.0
    im = Image.fromarray(out.round().astype(np.uint8), "RGBA")
    # 保留原有构图：火舌的喷口在预处理时已对齐到左侧中点，裁边会破坏这一锚点。
    im.thumbnail((longest, longest), Image.LANCZOS)
    return im


def main() -> None:
    force = "--force" in sys.argv[1:]
    manifest = json.loads((IMG / "manifest.json").read_text(encoding="utf-8"))
    provenance = json.loads((IMG / "provenance.json").read_text(encoding="utf-8"))
    extra = json.loads((RAW / "provenance.json").read_text(encoding="utf-8")) if (RAW / "provenance.json").is_file() else {}
    added: list[str] = []

    covers = sorted((RAW / "covers").glob("*.png")) if (RAW / "covers").is_dir() else []
    if covers:
        manifest["covers"] = sorted({*manifest.get("covers", []), *(c.stem for c in covers)})
    for src in covers:
        with Image.open(src) as raw:
            im = raw.convert("RGB")
        side = min(im.size)
        im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
        save(im.resize((768, 768), Image.LANCZOS), IMG / "covers" / f"{src.stem}.webp", 88)
        # 缩略图：以双眼略下方为中心的 72% 区域，圆形轮播里脸部更饱满。
        crop = int(side * 0.72)
        cx, cy = side // 2, int(side * (EYE_Y + 0.08))
        top = max(0, min(side - crop, cy - crop // 2))
        save(im.crop((cx - crop // 2, top, cx + crop // 2, top + crop)).resize((240, 240), Image.LANCZOS), IMG / "covers" / f"{src.stem}-t.webp", 88)
        added.append(f"covers/{src.stem}")

    stickers = manifest.setdefault("stickers", {})
    for src in sorted((RAW / "stickers").glob("*.png")) if (RAW / "stickers").is_dir() else []:
        if not force and src.stem in stickers and (IMG / "stickers" / f"{src.stem}.webp").is_file():
            continue
        im = trimmed(src, 512)
        save(im, IMG / "stickers" / f"{src.stem}.webp", 88, exact=True)
        stickers[src.stem] = {"w": im.width, "h": im.height}
        added.append(f"stickers/{src.stem}")

    decor = sorted((RAW / "decor").glob("*.png")) if (RAW / "decor").is_dir() else []
    if decor:
        manifest["decor"] = sorted({*manifest.get("decor", []), *(d.stem for d in decor)})
    for src in decor:
        im = trimmed(src, 1024)
        save(im, IMG / "decor" / f"{src.stem}.webp", 86, exact=True)
        added.append(f"decor/{src.stem}")

    for src in sorted((RAW / "glow").glob("*.png")) if (RAW / "glow").is_dir() else []:
        if not force and src.stem in stickers and (IMG / "stickers" / f"{src.stem}.webp").is_file():
            continue
        im = glow_to_alpha(src, 512 if "tongue" in src.stem else 384)
        save(im, IMG / "stickers" / f"{src.stem}.webp", 86, exact=True)
        stickers[src.stem] = {"w": im.width, "h": im.height}
        added.append(f"stickers/{src.stem}")

    bgs = sorted((RAW / "bg").glob("*.png")) if (RAW / "bg").is_dir() else []
    if bgs:
        manifest["bg"] = sorted({*manifest.get("bg", []), *(b.stem for b in bgs)})
    for src in bgs:
        with Image.open(src) as raw:
            im = raw.convert("RGB")
        # 统一裁成 2:3 竖幅再缩放。
        w, h = im.size
        if w * 3 > h * 2:
            nw = h * 2 // 3
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        elif w * 3 < h * 2:
            nh = w * 3 // 2
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        save(im.resize((720, 1080), Image.LANCZOS), IMG / "bg" / f"{src.stem}.webp", 82)
        added.append(f"bg/{src.stem}")

    for key in added:
        if key in extra:
            provenance[key] = extra[key]
    (IMG / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (IMG / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"已添加 {len(added)} 项：" + ", ".join(added))


if __name__ == "__main__":
    main()

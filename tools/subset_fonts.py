"""生成界面字体子集：收集 web/ 与 likeness/ 源码中实际出现的字符，从 Noto Sans SC / Noto Serif SC 可变字体中裁出子集，输出 woff2。

原始字体（约 40 MB）放在 private/fonts/，缺失时自动从 google/fonts 仓库下载；private/ 不提交。
界面文案变化后重新运行：uv run --with fonttools --with brotli python tools/subset_fonts.py
"""
from __future__ import annotations

import pathlib
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "private" / "fonts"
OUT = ROOT / "web" / "fonts"
SOURCES = {
    "NotoSansSC.ttf": "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
    "NotoSerifSC.ttf": "https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
}
# 常用标点与符号；用户输入的其他字符由系统字体回退显示。
EXTRA = "，。、；：？！…—～·“”‘’（）《》【】「」『』〈〉￥％＋－×÷＝＃＠＆＊／｜・↑↓←→✓✕★☆♡♥●○◆◇■□▶◀·•°℃%+-×"


def raw(name: str) -> pathlib.Path:
    path = RAW / name
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print("下载", name)
        urllib.request.urlretrieve(SOURCES[name], path)
    return path


def charset() -> str:
    chars: set[str] = set(chr(c) for c in range(0x20, 0x7F)) | set(EXTRA)
    files = [*ROOT.glob("web/js/**/*.js"), ROOT / "web" / "index.html", *ROOT.glob("likeness/**/*.py"), ROOT / "web" / "css" / "app.css"]
    for f in files:
        for ch in f.read_text(encoding="utf-8"):
            if ord(ch) >= 0x2000 and not (0xD800 <= ord(ch) <= 0xDFFF) and ord(ch) < 0x1F000:
                chars.add(ch)
    return "".join(sorted(chars))


def build(src: str, dst: str, text: str) -> None:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    font = TTFont(raw(src))
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    out = OUT / dst
    font.flavor = "woff2"
    font.save(out)
    print(dst, len(text), "字符", out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    text = charset()
    build("NotoSansSC.ttf", "noto-sans-sc.woff2", text)
    build("NotoSerifSC.ttf", "noto-serif-sc.woff2", text)

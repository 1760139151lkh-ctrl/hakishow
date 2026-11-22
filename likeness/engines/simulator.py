"""模拟器：不使用模型也能走通工作室的完整流程。它像真实引擎一样读取一个交互轮次，耗时大致
相当于快速档位，并使用 Pillow 绘制替代示例（调色、蒙版处理、合成、风格化），为其加上明确印记，
使其绝不会被误认为真实生成结果。房间、外观与背景创意来自小型词汇表，而非模型。"""

from __future__ import annotations

import colorsys
import hashlib
import math
import os
import random
import re
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from .. import brief
from ..estimates import DEFAULTS, OPS
from ..rooms import colours_for
from ..turns import BackdropAsk, Inputs, LookAsk, RoomAsk, Turn
from . import Work, shaped

STAMP = "模拟图像 · 非真实生成结果"
PROVENANCE = {"kind": "simulated", "label": "模拟", "detail": "模拟器 · 替代示例，非真实生成结果"}
SIZE = (768, 1152)
HUES = {"scarlet": 355, "crimson": 350, "red": 2, "blush": 345, "rose": 340, "pink": 335, "coral": 12, "peach": 22, "orange": 25,
        "amber": 38, "golden": 42, "gold": 44, "cream": 42, "lemon": 58, "yellow": 54, "lime": 85, "sage": 110, "green": 125,
        "emerald": 145, "mint": 158, "teal": 178, "aqua": 185, "cyan": 188, "sky": 200, "azure": 208, "blue": 215, "navy": 228,
        "indigo": 245, "lavender": 262, "violet": 265, "purple": 280, "lilac": 285, "plum": 300, "magenta": 310, "sepia": 32, "brown": 28}
PLANS = {
    "create": "正在根据你的文字绘制新图像", "edit": "正在按你的要求修改 {subject}",
    "restyle": "正在将 {subject} 重绘为 {look}", "reference": "正在为 {subject} 借用 {ref} 的光线",
    "blend": "正在合成 {pictures}", "region": "仅修改 {subject} 的标记部分",
    "backdrop": "正在将 {subject} 移至 {place}", "remove": "正在从 {subject} 中移除该内容", "vary": "正在为 {subject} 尝试 {n} 种表现",
    "angles": "正在围绕 {subject} 变换视角",
}
NOTES = {
    "create": ["正在寻找光线", "正在铺设天空", "正在确定地平线"], "edit": ["正在分析图像", "正在匹配光线", "正在保持面孔原样"],
    "restyle": ["正在研究外观", "正在调配颜色", "正在保持构图"], "reference": ["正在研究参考图", "正在借鉴参考图的调色", "正在匹配光线"],
    "blend": ["正在对齐图像", "正在寻找接缝", "正在融合光线"], "region": ["正在定位标记部分", "仅修改这些部分", "正在羽化边缘"],
    "backdrop": ["正在提取主体", "正在搭建场景", "正在匹配光线"], "remove": ["正在定位待移除内容", "正在填补空缺", "正在检查接缝"],
    "vary": ["第一种表现", "另一种表现", "正在比较结果"], "angles": ["从人物右侧观察", "侧面视角", "从人物左侧观察"],
}
ROOM_WORDS = [   # （关键词、对应设置）；每项设置采用首次匹配结果
    (r"night|midnight|noir|space|neon|goth|dark|moon|cosmic|galaxy", {"dark": True}),
    (r"love|heart|valentine|princess|romance|sweet", {"weather": "hearts", "ornament": "heart", "type": "romance", "wipe": "heart", "frame": "arch", "sound": "musicbox"}),
    (r"rain|storm|drizzle|monsoon", {"weather": "rain", "ornament": "drop", "set": "window"}),
    (r"snow|winter|frost|ice|christmas", {"weather": "snow", "ornament": "snowflake", "light": "dawn"}),
    (r"flower|rose|garden|spring|bloom|petal|sakura|cherry", {"weather": "petals", "ornament": "flower", "set": "glasshouse"}),
    (r"music|jazz|song|piano|melody|opera", {"weather": "notes", "ornament": "notes", "sound": "musicbox"}),
    (r"autumn|fall|forest|leaf|woods|cabin", {"weather": "leaves", "ornament": "leaf", "wipe": "leaf", "texture": "linen"}),
    (r"sea|ocean|beach|wave|surf|summer|riviera|coast", {"weather": "glints", "ornament": "wave", "wipe": "wave", "set": "awning", "light": "day"}),
    (r"retro|arcade|pixel|8.?bit|game|synth|vapou?r|cyber", {"type": "pixel", "texture": "scanlines", "sound": "synth", "wipe": "scan", "frame": "glow", "ornament": "bolt"}),
    (r"typewriter|office|paper|letter|newspaper|detective|library", {"type": "typewriter", "sound": "typewriter", "texture": "grain-heavy", "frame": "polaroid"}),
    (r"fire|ember|cosy|cozy|hearth|campfire|candle", {"weather": "embers", "ornament": "flame", "light": "golden"}),
    (r"party|birthday|celebrat|confetti|festival|carnival", {"weather": "confetti", "ornament": "confetti", "motion": "bouncy"}),
    (r"fairy|magic|sparkle|glitter|enchant|wish", {"weather": "sparkles", "ornament": "sparkle", "wipe": "star", "motion": "float"}),
    (r"underwater|bubble|aquarium|mermaid", {"weather": "bubbles", "ornament": "shell", "motion": "float"}),
    (r"fog|mist|haze|moor|ghost", {"weather": "fog", "ornament": "cloud"}),
    (r"firefl|meadow|summer night", {"weather": "fireflies"}),
    (r"star|astro|planet|cosmic|galaxy", {"weather": "stars", "ornament": "planet", "wipe": "star"}),
    (r"tea|cafe|café|coffee|bakery|cake", {"ornament": "teacup", "set": "window", "texture": "linen"}),
    (r"royal|palace|regal|crown|baroque|castle", {"type": "classical", "ornament": "crown", "frame": "arch", "set": "dome"}),
    (r"minimal|clean|modern|swiss|gallery", {"type": "grotesk", "texture": "none", "frame": "square", "motion": "crisp", "ornament": "asterisk"}),
]
PLACES = [   # 名称、描述、near（0近景至1远景）、dream（0真实至1梦幻）
    ("厨房窗边", "阳光照耀的厨房窗户，窗台上有香草，柔和晨光", .1, .1),
    ("图书馆角落", "安静的图书馆角落，高书架，一盏发光绿灯", .15, .15),
    ("画家工作室", "画家的工作室，画布靠墙放置，来自北面的光线", .15, .25),
    ("茶室", "带玫瑰壁纸、蕾丝与瓷器的茶室", .1, .45),
    ("温室", "长满蕨类和悬挂植物的玻璃温室", .3, .3),
    ("天鹅绒剧院", "空荡的剧院，红色天鹅绒座椅，金色幕布", .35, .4),
    ("糖果店", "粉彩色糖果店，一罐罐糖果，条纹遮阳篷", .2, .6),
    ("霓虹小巷", "雨中的小巷，映着粉色与蓝色霓虹倒影", .45, .35),
    ("黄昏屋顶", "黄昏时的城市屋顶，串灯，紫罗兰色天空", .6, .2),
    ("港湾清晨", "清晨的小港湾，船只、海鸥与淡金色光线", .75, .1),
    ("野花原野", "傍晚前的野花原野，温暖薄雾", .8, .2),
    ("雪中松林", "蓝调时刻的新雪松林", .7, .25),
    ("灯塔悬崖", "汹涌大海上方悬崖上的灯塔", .9, .3),
    ("水下舞厅", "海底舞厅、枝形吊灯与游动的鱼群", .45, .95),
    ("童话森林", "童话森林、巨型蘑菇与发光萤火虫", .55, .85),
    ("沙漠天文台", "满天繁星下的沙漠天文台", .85, .55),
    ("云端宫殿", "云朵构成的宫殿、粉色光线与漂浮阶梯", .7, .9),
    ("月球花园", "月球上的花园、银色花朵与天空中的地球", .85, 1.0),
]


def _seed(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def _rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, max(0, min(1, l)), max(0, min(1, s)))
    return round(r * 255), round(g * 255), round(b * 255)


def _hue_in(text: str, default: int | None = None) -> int | None:
    for word, hue in HUES.items():
        if re.search(rf"\b{word}\b", text, re.I):
            return hue
    return default


def _luma(c) -> float:
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _gradient(size, top, bottom) -> Image.Image:
    return Image.composite(Image.new("RGB", size, bottom), Image.new("RGB", size, top), Image.linear_gradient("L").resize(size))


def _palette(image: Image.Image, n: int = 5) -> list[tuple[int, int, int]]:
    small = image.convert("RGB").resize((64, 64)).quantize(n).convert("RGB")
    return sorted((c for _, c in small.getcolors(4096) or []), key=_luma)


def scene(words: str, size=SIZE, salt: int = 0) -> Image.Image:
    """根据文字生成地点：房间、城市、大海或山丘，采用文字所暗示的时段。"""
    rnd, w = random.Random(_seed(words, salt)), words.lower()
    width, height = size
    night = bool(re.search(r"\b(night|midnight|moon|stars?|neon|dark|observatory)\b", w))
    dusk = bool(re.search(r"\b(dusk|sunset|golden|evening|twilight|blue hour)\b", w))
    named = _hue_in(w)
    hue = named if named is not None else rnd.choice((18, 28, 340, 45, 200))   # 强调色；天空颜色仍遵循相应时段
    shift = 0 if named is None else ((named - 220 + 180) % 360 - 180) * .12
    if night:
        top, low = _rgb(232 + shift, .55, .07), _rgb(252 + shift, .42, .25)
    elif dusk:
        top, low = _rgb(258 + shift, .36, .34), _rgb(16 + shift, .82, .7)
    else:
        top, low = _rgb(206 + shift, .58, .64), _rgb(196 + shift, .5, .9)
    image = _gradient(size, top, low)
    d = ImageDraw.Draw(image, "RGBA")
    if night:
        for _ in range(140):
            x, y, r = rnd.uniform(0, width), rnd.uniform(0, height * .6), rnd.choice((1, 1, 1.5, 2.2))
            d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 250, 235, rnd.randrange(120, 255)))
    r = int(width * rnd.uniform(.07, .13))
    cx, cy = int(width * rnd.uniform(.22, .78)), int(height * rnd.uniform(.14, .3))
    d.ellipse([cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2], fill=(255, 240, 210, 26))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*(_rgb(48, .25, .9) if night else _rgb(hue if dusk else 44, .9, .78)), 240))
    sea = bool(re.search(r"sea|ocean|beach|lake|coast|lighthouse|surf|water|underwater", w))
    if not sea and re.search(r"room|kitchen|library|studio|tea ?room|theatre|shop|ballroom|nook|wall|window|indoor|cafe|café", w):
        wall = _rgb(hue, .22, .18 if night else .84)
        d.rectangle([0, 0, width, height], fill=(*wall, 255))
        wx0, wy0, wx1, wy1 = int(width * .18), int(height * .12), int(width * .82), int(height * .52)
        image.paste(_gradient((wx1 - wx0, wy1 - wy0), top, low), (wx0, wy0))
        d = ImageDraw.Draw(image, "RGBA")
        d.rectangle([wx0, wy0, wx1, wy1], outline=_rgb(hue, .15, .12 if night else .97), width=max(6, width // 60))
        d.line([(width // 2, wy0), (width // 2, wy1)], fill=_rgb(hue, .15, .12 if night else .97), width=max(4, width // 90))
        d.rectangle([0, int(height * .7), width, height], fill=(*_rgb(hue + 10, .3, .1 if night else .5), 255))
        for i in range(rnd.randrange(3, 7)):
            x = rnd.uniform(.05, .9) * width
            d.rectangle([x, height * .6, x + width * .06, height * .7], fill=(*_rgb(hue + rnd.randrange(-30, 30), .45, .5), 255))
    elif not sea and re.search(r"city|street|rooftop|alley|neon|skyline|town", w):
        x = 0.0
        while x < width:
            bw, bh = rnd.uniform(.08, .2) * width, rnd.uniform(.25, .6) * height
            d.rectangle([x, height - bh, x + bw, height], fill=(*_rgb(hue + 220, .25, .1 if night else .32), 255))
            for wy in range(int(height - bh + 14), height - 10, 22):
                for wx in range(int(x + 8), int(x + bw - 8), 16):
                    if rnd.random() < (.45 if night else .2):
                        d.rectangle([wx, wy, wx + 7, wy + 10], fill=(255, 214, 140, 230) if night else (220, 236, 255, 160))
            x += bw + rnd.uniform(2, 10)
    elif sea or re.search(r"harbou?r", w):
        horizon = int(height * .56)
        image.paste(_gradient((width, height - horizon), _rgb(212 + shift, .45, .42 if not night else .14), _rgb(222 + shift, .5, .18 if not night else .05)), (0, horizon))
        d = ImageDraw.Draw(image, "RGBA")
        for i in range(40):
            y = horizon + (i / 40) ** 1.6 * (height - horizon)
            half = (6 + i * 2.2) * rnd.uniform(.6, 1.4)
            d.line([(cx - half, y), (cx + half, y)], fill=(255, 236, 200, 150 - i * 3), width=2)
    else:
        for layer in range(3):
            base = height * (.55 + layer * .13)
            amp, phase, freq = height * (.06 - layer * .012), rnd.uniform(0, 6.3), rnd.uniform(1.2, 2.6)
            points = [(x, base - amp * (1 + math.sin(phase + freq * x / width * math.pi))) for x in range(0, width + 8, 8)]
            shade = _rgb((named if named is not None else 128) + layer * 10, .3, (.16 if night else .46) - layer * .1)
            d.polygon(points + [(width, height), (0, height)], fill=(*shade, 255))
            if layer == 2 and re.search(r"forest|pine|wood|tree|garden|field", w):
                for _ in range(26):
                    tx, th = rnd.uniform(0, width), rnd.uniform(.08, .18) * height
                    d.polygon([(tx, base - th), (tx - th * .3, base + 6), (tx + th * .3, base + 6)], fill=(*_rgb(140, .3, .1 if night else .2), 255))
    return image.filter(ImageFilter.SMOOTH)


def grade(image: Image.Image, words: str, salt: int = 0, strength: float = 1.0) -> Image.Image:
    """根据文字调整颜色与光线：温暖、冷色、指定颜色、更明亮、更暗、更鲜艳、更柔和或黑白。"""
    rnd, w, out = random.Random(_seed(words, salt)), words.lower(), image.convert("RGB")
    if re.search(r"black and white|b&w|\bmono|greyscale|grayscale|noir", w):
        out = ImageEnhance.Contrast(ImageOps.grayscale(out).convert("RGB")).enhance(1.25)
    hue = _hue_in(w)
    if hue is None and re.search(r"warm|golden|sunset|sunny|summer|cosy|cozy|autumn", w):
        hue = 32
    if hue is None and re.search(r"cool|cold|winter|icy|moon|night|blue hour", w):
        hue = 215
    if hue is None and salt:
        hue = rnd.randrange(360)
    if hue is not None:
        tinted = ImageOps.colorize(ImageOps.grayscale(out), _rgb(hue + 200, .5, .08), _rgb(hue, .6, .95), mid=_rgb(hue, .65, .5))
        out = Image.blend(out, tinted, min(.75, .32 * strength))
    if re.search(r"bright|lighter|airy|sunlit", w):
        out = ImageEnhance.Brightness(out).enhance(1 + .18 * strength)
    if re.search(r"dark|moody|dramatic|night", w):
        out = ImageEnhance.Contrast(ImageEnhance.Brightness(out).enhance(1 - .16 * strength)).enhance(1 + .15 * strength)
    if re.search(r"vivid|saturat|\bpop|colou?rful|bold", w):
        out = ImageEnhance.Color(out).enhance(1 + .45 * strength)
    if re.search(r"soft|dream|hazy|misty|glow", w):
        out = Image.blend(out, out.filter(ImageFilter.GaussianBlur(6)), .45)
    return out


def restyle(image: Image.Image, words: str) -> Image.Image:
    """根据名称与提示词生成外观：像素、素描、漫画、绘画、胶片，或相应颜色的双色调。"""
    w, gray = words.lower(), ImageOps.grayscale(image)
    if re.search(r"pixel|8.?bit|arcade|retro game", w):
        small = image.resize((max(1, image.width // 14), max(1, image.height // 14)), Image.Resampling.BILINEAR)
        return small.quantize(18).convert("RGB").resize(image.size, Image.Resampling.NEAREST)
    if re.search(r"sketch|pencil|charcoal|line art|\bink", w):
        lines = ImageOps.invert(gray.filter(ImageFilter.FIND_EDGES).point(lambda v: min(255, v * 3))).convert("RGB")
        paper = Image.new("RGB", image.size, (246, 240, 228))
        return Image.blend(ImageChops.multiply(paper, lines), ImageChops.multiply(paper, gray.convert("RGB")), .22)
    if re.search(r"comic|pop art|poster|cel|cartoon|anime", w):
        edges = gray.filter(ImageFilter.FIND_EDGES).point(lambda v: 0 if v > 38 else 255).convert("RGB")
        return ImageChops.multiply(ImageOps.posterize(ImageEnhance.Color(image).enhance(1.5), 3), edges)
    if re.search(r"water ?colou?r|paint|oil|gouache|impression", w):
        soft = image.filter(ImageFilter.ModeFilter(7)).filter(ImageFilter.SMOOTH_MORE)
        return ImageChops.soft_light(soft, Image.effect_noise(image.size, 22).convert("RGB"))
    if re.search(r"film|analog|polaroid|vintage|sepia|old", w):
        toned = Image.blend(image, ImageOps.colorize(gray, (30, 20, 14), (250, 236, 210), mid=(160, 120, 90)), .55)
        return ImageChops.soft_light(toned, Image.effect_noise(image.size, 30).convert("RGB"))
    hue = _hue_in(w, _seed(w) % 360)
    return Image.blend(image, ImageOps.colorize(gray, _rgb(hue + 180, .5, .1), _rgb(hue, .5, .94), mid=_rgb(hue, .6, .55)), .7)


def _mask(path: Path | None, size, guess: str = "centre") -> Image.Image:
    if path is not None:
        with Image.open(path) as m:
            mask = m.convert("L").resize(size)
    else:
        mask = Image.new("L", size, 0)
        w, h = size
        box = [w * .2, h * .14, w * .8, h * 1.08] if guess == "figure" else [w * .3, h * .3, w * .7, h * .7]
        ImageDraw.Draw(mask).ellipse(box, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(2, size[0] // 150)))


def _open(path: Path, longest: int = 1024) -> Image.Image:
    with Image.open(path) as image:
        picture = ImageOps.exif_transpose(image).convert("RGB")
    picture.thumbnail((longest, longest))
    return picture


def _borrow(image: Image.Image, ref: Image.Image, salt: int = 0) -> Image.Image:
    """借用参考图外观的替代示例：将参考图颜色叠加到原图自身的明暗上。"""
    colours = _palette(ref)
    dark, mid, light = colours[0], colours[len(colours) // 2], colours[-1]
    return Image.blend(image, ImageOps.colorize(ImageOps.grayscale(image), dark, light, mid=mid), .55 + .05 * (salt % 3))


def _marked(image: Image.Image, base: Image.Image, marked: Image.Image | None) -> Image.Image:
    """在用户绘制的位置淡淡显示标记，使替代示例展示它所遵循的输入。"""
    if marked is None:
        return image
    marked = marked.resize(base.size)
    where = ImageOps.grayscale(ImageChops.difference(marked, base)).point(lambda v: 150 if v > 48 else 0)
    return Image.composite(marked, image, where.filter(ImageFilter.MaxFilter(3)))


def stamp(image: Image.Image) -> Image.Image:
    out = image.convert("RGB").copy()
    w, h = out.size
    band = max(24, h // 26)
    d = ImageDraw.Draw(out, "RGBA")
    d.rectangle([0, h - band, w, h], fill=(16, 14, 12, 214))
    font = _font(max(10, int(band * .46)))
    d.text((w / 2, h - band / 2), STAMP, fill=(250, 244, 232, 255), font=font, anchor="mm")
    return out


def _developing(image: Image.Image, step: int) -> Image.Image:
    if step == 1:
        w, h = image.size
        return image.resize((max(1, w // 28), max(1, h // 28)), Image.Resampling.BILINEAR).resize(image.size, Image.Resampling.BICUBIC)
    return image.filter(ImageFilter.GaussianBlur(7))


class Simulator:
    id = "simulator"
    kind = "simulator"

    def __init__(self, speed: float | None = None) -> None:
        self.speed = float(os.environ.get("LIKENESS_SIM_SPEED", "1")) if speed is None else speed

    def describe(self) -> dict:
        return {"id": self.id, "kind": self.kind, "label": "模拟器", "ready": True,
                "detail": "使用 Pillow 绘制替代示例，便于在任何环境尝试完整流程。它生成的内容均非真实模型生成结果。"}

    def provenance(self, turn: Turn) -> dict:
        return PROVENANCE

    def _wait(self, work: Work, ms: float) -> None:
        end = time.monotonic() + ms * self.speed / 1000
        while (left := end - time.monotonic()) > 0:
            work.check()
            time.sleep(min(.05, left))
        work.check()

    def paint(self, turn: Turn, inputs: Inputs, index: int) -> Image.Image:
        op, text = turn.intent.op, turn.text
        subject = inputs.subject or next(iter(inputs.pictures), None)
        if subject is None or op == "create":
            return scene(text or "a quiet morning", SIZE, index)  # 英文内部匹配原值：宁静的早晨
        base = _open(inputs.pictures[subject])
        others = [_open(p) for h, p in inputs.pictures.items() if h != subject]
        # 借用的外观与用户标记：镜像编辑器在修改请求旁一并发送的内容
        borrowed = {role: _open(inputs.pictures[h]) for h, role in inputs.refs if role in ("look", "marks") and h in inputs.pictures}
        if op == "restyle":
            return restyle(base, f"{turn.look.name} {turn.look.prompt}" if turn.look else text)
        if op == "reference" and others:
            colours = _palette(others[0])
            dark, mid, light = colours[0], colours[len(colours) // 2], colours[-1]
            return Image.blend(base, ImageOps.colorize(ImageOps.grayscale(base), dark, light, mid=mid), .62)
        if op == "blend" and others:
            fade = Image.linear_gradient("L").rotate(90, expand=True).resize(base.size)
            return Image.composite(others[0].resize(base.size), base, fade)
        if op in ("region", "remove") and inputs.pins:
            out = base
            for n, note, mask_path in inputs.pins:
                mask = _mask(mask_path, base.size)
                if op == "remove" or re.search(r"remove|erase|take out|get rid|delete", note, re.I):
                    changed = base.filter(ImageFilter.GaussianBlur(max(12, base.width // 28)))
                    mask = mask.filter(ImageFilter.MaxFilter(9))
                elif "look" in borrowed:
                    changed = _borrow(out, borrowed["look"], index)
                else:
                    changed = grade(out, note, strength=1.8)
                    if ImageChops.difference(changed, out).getbbox() is None:
                        changed = ImageEnhance.Color(grade(out, note, salt=n + index + 1, strength=1.6)).enhance(1.3)
                out = Image.composite(changed, out, mask)
            return _marked(out, base, borrowed.get("marks"))
        if op == "backdrop":
            words = turn.backdrop.words if turn.backdrop else text
            place = scene(words, base.size, index)
            return Image.composite(grade(base, words, strength=.4), place, _mask(inputs.subject_mask, base.size, "figure"))
        if op == "remove":
            return Image.composite(base.filter(ImageFilter.GaussianBlur(base.width // 28)), base, _mask(None, base.size))
        if op == "angles":
            # 模拟相机绕人物移动：让图像产生透视转动，另一侧采用相反方向
            w, h = base.size
            k = (-.16, .0, .16)[index % 3]
            squeezed = base.resize((max(1, int(w * (1 - abs(k) * 1.6))), h)) if k else ImageOps.mirror(base).resize((int(w * .78), h))
            out = Image.new("RGB", (w, h), _palette(base, 1)[0])
            out.paste(squeezed, ((w - squeezed.width) // 2 + int(k * w * .6), 0))
            return out
        if op == "vary" or index:
            varied = grade(base, text, salt=index + 1, strength=1.2)
            zoom = random.Random(_seed(text, index)).uniform(1.0, 1.08)
            w, h = varied.size
            cw, ch = w / zoom, h / zoom
            return varied.crop(((w - cw) / 2, (h - ch) / 2, (w + cw) / 2, (h + ch) / 2)).resize((w, h))
        if "look" in borrowed:
            return _marked(_borrow(base, borrowed["look"], index), base, borrowed.get("marks"))
        changed = grade(base, text, strength=1.3)
        return changed if ImageChops.difference(changed, base).getbbox() else grade(base, text, salt=1)

    def turn(self, turn: Turn, inputs: Inputs, work: Work) -> None:
        op, rnd = turn.intent.op, random.Random(_seed(turn.id))
        total = DEFAULTS["simulator"][turn.pace] * OPS.get(op, 1.0) * (1 + (turn.n - 1) * .45)
        subject = inputs.subject or next(iter(inputs.pictures), "it")
        names = {"subject": f"@{subject}", "look": f"«{turn.look.name}»" if turn.look else "新外观", "n": turn.n,
                 "ref": next((f"@{h}" for h, role in inputs.refs if role == "style"), "参考图"),
                 "pictures": " 和 ".join(f"@{h}" for h in inputs.pictures) or "这些图像",
                 "place": f"«{turn.backdrop.name}»" if turn.backdrop else "新地点"}
        notes = NOTES.get(op, NOTES["edit"])
        work.stage("read")
        self._wait(work, total * .12)
        work.stage("plan")
        work.plan(PLANS.get(op, PLANS["edit"]).format(**names), turn.text)
        work.note(notes[0])
        self._wait(work, total * .14)
        work.stage("draw")
        pictures = [shaped(self.paint(turn, inputs, i), turn.aspect) for i in range(turn.n)]
        for step, note in ((1, notes[1]), (2, notes[2])):
            self._wait(work, total * .22)
            work.note(note)
            for i, picture in enumerate(pictures):
                work.partial(i, _developing(picture, step))
            work.progress(step / 3)
        self._wait(work, total * .2)
        work.stage("finish")
        self._wait(work, total * .1)
        for i, picture in enumerate(pictures):
            work.result(i, stamp(picture), turn.text)
        voice = turn.room.voice if turn.room and turn.room.voice else ["你的人像作品已完成！"]
        work.reply(rnd.choice(voice), brief.IDEAS.get(op, brief.IDEAS["edit"]))

    def room(self, ask: RoomAsk) -> dict:
        text = ask.text.strip()
        raw: dict = {"name": " ".join(text.split()[:4]).title() or "新房间", "line": f"根据以下内容创建的房间：“{text[:80]}”.", "motifs": []}
        for pattern, patch in ROOM_WORDS:
            if re.search(pattern, text, re.I):
                for key, value in patch.items():
                    raw.setdefault(key, value)
                if patch.get("ornament"):
                    raw["motifs"].append(patch["ornament"])
        hue = _hue_in(text)
        if hue is None and ask.palette:
            r, g, b = (int(ask.palette[0][i:i + 2], 16) / 255 for i in (1, 3, 5))
            hue = round(colorsys.rgb_to_hls(r, g, b)[0] * 360)
        raw["colors"] = colours_for(_seed(text) % 360 if hue is None else hue, .5, bool(raw.get("dark")))
        return raw

    def look(self, ask: LookAsk, picture: Path | None) -> dict:
        raw = {"name": ask.text.strip().title()[:40] or "来自图像", "line": f"根据以下内容创建的外观：“{ask.text.strip()[:60]}”." if ask.text.strip() else "从图像中提取的外观。",
               "prompt": ask.text.strip() or "附件图像的颜色与光线"}
        if picture is not None:
            raw["ramp"] = ["#%02x%02x%02x" % c for c in _palette(_open(picture, 256))]
        return raw

    def style(self, ask, picture: Path | None) -> dict:
        """替代示例风格：颜色来自文字或图像，采用英语名称，并明确标记为模拟。"""
        text = ask.text.strip()
        hue = _hue_in(text)
        if hue is None and picture is not None:
            r, g, b = (c / 255 for c in _palette(_open(picture, 256))[0])
            hue = round(colorsys.rgb_to_hls(r, g, b)[0] * 360)
        hue = _seed(text) % 360 if hue is None else hue
        dark = bool(re.search(r"dark|night|noir|gothic|cyber", text, re.I))
        c = colours_for(hue, .55, dark)
        return {"name": (" ".join(text.split()[:4])[:48] or "图像启发的风格"),
                "line": f"灵感来自{text[:90] or '你的图像'}的模拟风格。", "hook": "模拟风格",
                "prompt": f"按以下风格重绘此人物：{text or '参考图像的颜色与光线'}。人物仍应清晰可辨。",
                "dark": dark, "colors": {"bg": c["ground"], "bg2": c["ground2"], "surface": c["surface"], "ink": c["ink"], "soft": c["soft"], "accent": c["accent"], "accent2": c["accent2"]},
                "look": {"sat": 1.15, "contrast": 1.05, "warmth": .1, "posterize": .25, "edge": .2, "bloom": .25, "grain": .1, "vignette": .25, "smooth": .6},
                "frame": "poster", "deco": "sparkle", "display": "round", "details": []}

    def backdrops(self, ask: BackdropAsk, picture: Path | None) -> list[dict]:
        rnd = random.Random()
        ranked = sorted(PLACES, key=lambda p: (p[2] - ask.near) ** 2 + (p[3] - ask.dream) ** 2 + rnd.uniform(0, .05))
        ideas = [{"name": name, "words": words} for name, words, _, _ in ranked[:6]]
        if ask.text.strip():
            ideas = [{"name": ask.text.strip().capitalize()[:40], "words": ask.text.strip()}] + ideas[:5]
        return ideas

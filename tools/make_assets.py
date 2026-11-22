"""HakiShow · 使用 GPT Image 生成视觉素材。

    uv run python tools/make_assets.py [--only people,styles,bg,stickers,scenes,icon] [--force] [--lanes 6] [--pick dragon,hero]

生成的原始文件保存到 private/assets-raw/（由 Git 忽略）。独立的
tools/process_assets.py 脚本会将它们裁剪、优化并输出到 web/img/。

- people：六位虚构的亚太地区创作者，用作示例的源人像。
- styles：Mei（导览全程使用同一张脸）、每种风格的主展示人物及另一人，
  通过图像编辑从各自的源人像转换而来。
- bg：每种风格对应的不含人物的界面背景。
- stickers：用于实时相机与界面的透明 PNG 配饰。
- scenes：本地编辑工作区的背景选项。
- icon：应用图标。

后续生成通过 Node 从 web/js/presets.js 加载与应用相同的 promptFor 函数。
接口密钥仅来自 OPENAI_API_KEY 或 .env.local；
绝不会写入生成素材。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "private" / "assets-raw"
API = "https://api.openai.com/v1"
MODEL = "gpt-image-2.6-sunburst"
LOG_LOCK = threading.Lock()


def key() -> str:
    k = os.environ.get("OPENAI_API_KEY", "").strip()
    env = ROOT / ".env.local"
    if not k and env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                k = line.split("=", 1)[1].strip()
    if not k:
        sys.exit("请设置 OPENAI_API_KEY（或将它写入 .env.local）。")
    return k


def log(*a) -> None:
    with LOG_LOCK:
        print(time.strftime("%H:%M:%S"), *a, flush=True)


def presets() -> dict:
    code = ("import('./web/js/presets.js').then(m => console.log(JSON.stringify({"
            "presets: m.PRESETS.map(p => ({ id: p.id, hero: p.hero, also: p.also, prompt: m.promptFor(p, m.defaultsOf(p), { format: 'portrait' }) })),"
            "people: m.PEOPLE })))")
    out = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


SELFIE = ("一张手臂伸直距离拍摄、自然且未经滤镜处理的手机自拍，照片般真实，皮肤纹理贴近现实，"
          "直视镜头，呈现头部与肩部，面部光线均匀且清晰可见。人物为虚构。不要文字。")
PEOPLE = {
    "mei": "一位22岁的新加坡年轻女性，黑色长直发，清淡自然的妆容，温柔微笑，穿休闲白色T恤，窗边柔和均匀的日光，身后是素净的浅色墙面。",
    "aiman": "一位24岁的马来西亚马来族年轻男性，整齐的黑色短发，两侧稍作渐层修剪，浅浅的胡茬，温暖友好的笑容，白色T恤外穿橄榄绿色衬衫式外套，柔和日光，身后是浅灰色墙面。",
    "priya": "一位21岁的新加坡印度裔年轻女性，深棕色波浪长发，佩戴小巧的金色耳钉，笑容明亮而自信，穿芥末黄色上衣，温暖的午后窗光，身后是奶油色墙面。",
    "jun": "一位20岁的马来西亚年轻男性，蓬松的黑色两段式发型，柔软刘海，戴细框银色圆眼镜，略带羞涩的浅笑，穿海军蓝连帽衫，偏冷的日光，身后是淡蓝色墙面。",
    "nur": "一位23岁的马来族年轻女性，佩戴固定整齐的灰粉色头巾，柔和自然的妆容，温柔微笑，穿奶油色衬衫，柔和日光，身后是暖米色墙面。",
    "kai": "一位19岁的菲律宾年轻女性，染成铜色的短波波头与齐刘海，佩戴小银色圈状耳环，俏皮地抿嘴微笑，穿宽松的纯黑T恤，明亮日光，身后是白色墙面。",
}

NO_PEOPLE = "不要人物、人脸、角色、文字或标志。画面柔和，中央为界面元素留出充足而安静的空间，采用纵向手机壁纸构图。"
BACKGROUNDS = {
    "dragon": "欢快的抽象背景：柔和的蛋奶黄色与桃色渐变，漂浮的亮面糖果气泡，小巧圆润的星星与闪光，软糯而俏皮。",
    "bighead": "有冲击力的漫画艺术背景：暖奶油色纸面上分布醒目的橙红色与钴蓝色半调网点，从中心向外放射的漫画爆发线条，充满波普艺术活力。",
    "faceart": "日式漫画风格背景：白纸上呈现从中心向外放射的戏剧性黑色速度线、点状网纹渐变，以及少量亮粉色冲击爆发形状。",
    "clay": "手工黏土微缩场景背景：柔和粉彩色的橡皮泥形状、圆润糖果团块、小黏土云朵与星星、隐约可见的指纹，温暖的微缩场景灯光与柔和景深。",
    "pet": "温馨可爱的背景：柔和的腮红粉与杏色渐变、蓬松云朵形状、细小爪印、小爱心与闪光，温暖而柔和。",
    "hero": "宏大的复古特摄科幻背景：深蓝天空下的黄昏城市天际线、远处的烟雾与探照灯、银色和红色光带、明亮的青色光束与镜头光晕，呈现20世纪70年代特效电影剧照的电影感。",
    "robot": "明亮的20世纪80年代复古电视卡通背景，采用平面赛璐璐动画风格：绿色草坡上方是天蓝色天空与圆滚蓬松的白云，漂浮着小齿轮与星星，欢快的平涂色彩，粗而柔和的轮廓线。",
    "pilot": "科幻机甲驾驶舱背景：深青黑色内部空间，发光的青色全息抬头显示圆环、网格与瞄准标线，少量暖橙色指示灯，浅景深。",
    "figure": "高端设计师潮玩摄影棚背景：柔和薰衣草色的无缝弧面背景、亮面的粉彩色展示台、漂浮的小闪光、柔光箱反射，干净的产品摄影氛围。",
    "arcade": "采用精细16位像素艺术的20世纪90年代街机背景：紫色到洋红色的日落渐变、远处的像素城市、发光的黄色与粉色能量火花，以及阴极射线管显示器的扫描线辉光。",
    "fantasy": "电影感奇幻背景：黎明时高耸而雾气缭绕的竹林、柔和光束、飘落的竹叶、远处水墨般的山崖，以玉绿色与石灰色为主，富有绘画感且宁静。",
    "princess": "童话公主背景：柔和腮红粉与香槟金色散景，漂浮的半透明爱心、缎带、玫瑰花瓣与珍珠，以及透出暖光的优雅拱窗。",
    "gothic": "深暗的哥特式背景：深梅紫色与黑色天鹅绒阴影、发光的哥特式彩色玻璃玫瑰花窗、古银色金属丝花饰、烛光，以及飘落的深色玫瑰花瓣。",
    "ethereal": "工笔画背景：温暖质感纸面上的水墨群山与流动云气，几盏柔和发光的红色装饰灯笼，飘落的桃花，金箔碎片与朱红点缀，诗意而轻盈。",
    "tarot": "神秘的塔罗背景：午夜蓝与紫罗兰色夜空中布满繁星和月相，边缘饰以华丽的金色新艺术卷曲纹样与金属丝花饰，柔和发光的尘埃，奢华而迷人。",
    "anime": "动画电影背景画：高远的夏日天空与发光的积云、镜头光晕、少量飘落的樱花花瓣，令人惊叹且通透轻盈。",
    "toon3d": "三维动画电影背景：黄金时刻温暖而奇趣的童话小镇、柔软圆润的形状、发光光球与柔和散景，采用高端工作室渲染效果。",
    "magical": "20世纪90年代魔法少女动画背景：粉彩色繁星夜空与巨大发光新月、旋转的光带、流星、小爱心和闪光、粉色与薰衣草色渐变，采用赛璐璐着色的二维动画风格。",
    "shonen": "少年热血战斗动画背景：血红日落下的幽暗废墟战场、爆发的金色能量气场与火焰、向外放射的强烈速度线、飞散碎片，采用鲜明赛璐璐着色的二维动画关键帧效果。",
    "handdrawn": "手绘动画电影背景：郁郁葱葱的夏日乡野与稻田、小小的乡间公交站、明亮蓝天中高耸蓬松的积云，柔和的水粉与水彩质感，温暖而怀旧的光线。",
    "vtuber": "虚拟主播直播背景：温馨的粉彩色直播房间、发光的发光二极管灯带、柔和环形补光灯、漂浮的爱心与星星、赛博流行风格的霓虹青色和粉色，干净的动画插画风格。",
    "shoujo": "少女漫画背景：梦幻的粉彩粉色与淡紫色薄雾、层叠垂落的玫瑰和百合、漂浮气泡与星形闪光、柔和的网纹渐变，浪漫而闪耀。",
    "retro": "20世纪90年代电视动画背景：日落中发光的城市天际线、紫色与橙色天空、电线和安静的火车站台，手绘赛璐璐背景带有褪色的 VHS（家用录像系统）录像带色彩与柔和颗粒。",
    "ccd": "21世纪初电荷耦合器件相机风格的夜景背景：使用强烈闪光拍摄的幽暗城市夜间街道、扩散的冷色高光、细微数字噪点，以及模糊的橙色和蓝色路灯。",
    "film": "清新的胶片摄影背景：柔和阳光穿过绿叶照在安静小巷中、奶油般提亮的阴影、细腻的35毫米胶片颗粒、梦幻浅景深，通透而平静。",
    "neon": "赛博朋克背景：雨水浸润的夜间城市中，发光的洋红色与青色霓虹招牌化为散景，雨丝与湿润倒影，富有电影感。",
    "retrocinema": "20世纪90年代复古都市电影背景：密集的夜间街道上，发光的红绿色霓虹招牌化为柔和散景，温暖的钨丝路灯、湿润路面、浓郁胶片颗粒与光晕，情绪鲜明且怀旧。不要可读文字。",
    "oil": "古典大师油画背景：深暗的暖赭棕色背景带有柔和罩染油画纹理，隐约可见厚重天鹅绒帘幕、细微龟裂纹，呈现烛光照明的博物馆氛围。",
    "storybook": "儿童绘本背景：有纹理的棉纸上铺着柔和水彩晕染、由圆润树木构成的奇趣森林、小小的手绘星星与云朵，以及温暖粉彩色调。",
    "pop": "俏皮的复古平面设计背景：平涂的亮黄色、亮粉色与钴蓝色色块、大圆形半调网点、粗黑轮廓线和星芒爆发形状，呈现欢快的20世纪60年代印刷风格。",
    "woodblock": "浮世绘木版画背景：有纹理的和纸上呈现风格化的靛蓝卷浪、赭黄色云朵与巨大的朱红日轮，雕刻般轮廓线及可见木纹。",
    "calendar": "20世纪30年代热带复古海报背景：柔和喷绘粉彩花园中有鸡蛋花与棕榈叶，殖民时期风格阳台配装饰艺术栏杆，温暖怀旧光线与陈旧纸张质感。",
    "heritage": "新加坡传统文化背景：成排带有精细花卉纹样的粉彩色瓷砖、色彩丰富的店屋立面、木制百叶窗与盆栽兰花，明亮热带日光，欢快且细节丰富。",
    "brand": "充满活力的创意应用背景：流动的亮粉色、紫罗兰色与电光青色渐变、柔和发光轨迹和少量闪光，光泽鲜亮且充满能量。",
}

ISO = "单独置于完全透明背景上，正面视图、居中，清晰高质量的产品渲染，无地面阴影，不要文字。"
HEADWEAR = ("只呈现作为独立物件的配饰本身：不要头部、头发、脸、人物或人体模型。"
            "以佩戴时的正面视角呈现，下缘对应它与发际线相接的位置。")
STICKERS = {
    "tiara": f"精致的珍珠与玫瑰金公主头冠，带有小钻石闪光及心形中央珍珠。{HEADWEAR}",
    "gothic-crown": f"华丽的古银色哥特金属丝花饰王冠，带有黑色短蕾丝面纱与细小深紫色宝石。{HEADWEAR}",
    "dragon-hood": f"原创设计的可爱毛绒幼龙兜帽发箍：软糯的蛋奶黄色头带上有两只小巧圆润的橙色角与两只柔软圆耳，呈现有光泽的软玩具外观。{HEADWEAR}",
    "cat-ears": f"细发箍上有一对蓬松的奶油色与粉色小猫耳，毛发柔软，耳朵内侧为粉色。{HEADWEAR}",
    "dog-ears": f"细发箍上有一对下垂的金色小狗耳，毛发柔软。{HEADWEAR}",
    "beanie": f"用柔软珊瑚色与薄荷色橡皮泥制作的粗针手编便帽，带绒球与可见指纹，定格动画风格。{HEADWEAR}",
    "hero-visor": f"原创设计的利落未来英雄头饰：银红色流线型头带，正面横贯一条发光青色镜片带，像王冠一样佩戴在额头上方。{HEADWEAR}",
    "robot-antenna": f"可爱的卡通机器人天线发箍：亮面天蓝色头带上有两颗小螺栓与一根弹簧天线，天线顶部为发光黄色球体，平面赛璐璐卡通风格。{HEADWEAR}",
    "magic-tiara": f"20世纪90年代魔法少女头冠：金色头冠中央有发光的粉色星形宝石，装饰小星星和两个小缎带蝴蝶结。{HEADWEAR}",
    "fight-band": f"系在头上的红色布质武术头带，带两条长而飘动的尾带，素布上没有符号。{HEADWEAR}",
    "straw-hat": f"夏日宽檐草编遮阳帽，配红色缎带帽带，手绘动画风格。{HEADWEAR}",
    "woven-hat": f"竹编斗笠，帽檐周围带有短而轻透的白色面纱，奇幻冒险风格。{HEADWEAR}",
    "hair-ornament": f"精美的金色发饰：凤凰与花卉造型的发簪冠，垂挂珍珠与玉石流苏，细致的工笔插画风格。{HEADWEAR}",
    "flower-clip": f"发夹上装饰一簇粉彩粉色玫瑰、小白花与缎带，少女漫画风格。{HEADWEAR}",
    "cat-headset": f"可爱的粉彩色游戏耳机，顶部有发光粉色猫耳，并配小型悬臂麦克风，动画风格。{HEADWEAR}",
    "bow": "亮面的腮红粉缎带蝴蝶结，带长尾带，结心有一颗小珍珠。",
    "heart": "亮面饱满的粉色心形宝石，带柔和高光与细小闪光。",
    "bolt": "发光的电光蓝能量闪电，带银色金属边缘与光带。",
    "candy": "可爱的粉彩色黏土糖果星星，带指纹与亮面表层。",
    "paw": "可爱的蓬松粉色猫爪印形靠垫。",
    "sparkle": "白色与浅蓝色的四角动画闪光星，带柔和辉光。",
    "neon-heart": "发光的洋红色与青色霓虹灯管心形标志。",
    "lantern": "发光的红色装饰灯笼，配金边与红色丝绸流苏，精细的工笔插画风格。",
    "tarot-card": "单张直立的华丽塔罗牌，牌背在午夜蓝底色上装饰金色星星与新月，配新艺术风格边框，不要可辨读内容。",
    "cassette": "可爱的复古磁带，带粉彩色标签（空白，无任何文字）与小闪光，20世纪90年代动画风格。",
    "film-reel": "小型复古胶片卷盘，带一段卷曲胶片，呈现温暖金属质感。",
    "paintbrush": "经典画家画笔，带少量金色颜料与小木制调色板。",
    "flower": "单朵粉彩水彩花，花瓣柔软，手绘故事书风格。",
    "wave": "小巧风格化的靛蓝色与白色浮世绘浪尖，木版画风格。",
    "tile": "单块方形粉彩花卉瓷砖，饰有精细的粉色与青绿色花卉纹样。",
    "bamboo": "一小枝以水墨笔触绘制的绿色竹叶。",
}
# 本地编辑工作区中不含人物的背景选项。
SCENES = {
    "beach": "热带海滩上的金色日落，伴随轻柔海浪与棕榈剪影。",
    "sakura": "樱花盛开的大道，花瓣在柔和春光中飘落。",
    "neonstreet": "雨夜街道上，发光的洋红色与青色霓虹招牌化为散景，不要可读文字。",
    "galaxy": "宁静山丘上方令人惊叹的繁星夜空与银河。",
    "moon": "灰色月球表面，蓝色地球正在地平线上升起。",
    "snow": "晴朗蓝天下的雪山，空中飘着柔软粉雪。",
    "flowers": "梦幻粉色天空下，无边无际的粉彩色花田。",
    "cafe": "温馨的咖啡馆角落，配有暖色灯光、绿植与大窗户。",
    "nightmarket": "热闹的亚洲夜市，发光灯笼与小吃摊柔和虚化，不要可读文字。",
    "skyline": "蓝调时刻的现代滨水城市天际线，发光高楼倒映在海湾中。",
    "funfair": "黄昏时色彩缤纷的游乐场，带发光摩天轮与旋转木马灯光。",
    "studio": "干净、柔和渐变的摄影棚背景，采用暖粉彩色调与柔光箱照明。",
}
SCENE_STYLE = "摄影风格，光线优美，不要人物、人脸或文字，方形构图。"
ICON = ("亮面现代应用图标：俏皮的魔法闪光星周围环绕一个小相机快门环，底色为鲜明的"
        "亮粉色、紫罗兰色与电光青色渐变，圆角方形图标填满画面，柔和的三维纵深感，不要文字。")


class Client:
    def __init__(self, k: str) -> None:
        self.k = k

    def _call(self, path: str, body: bytes, ctype: str, timeout: float = 300) -> dict:
        req = urllib.request.Request(API + path, data=body, method="POST", headers={"Authorization": "Bearer " + self.k, "Content-Type": ctype})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def generate(self, prompt: str, size: str, quality: str = "high", transparent: bool = False) -> bytes:
        body = {"model": MODEL, "prompt": prompt, "size": size, "quality": quality, "output_format": "png" if transparent else "webp"}
        if transparent:
            body["background"] = "transparent"
        else:
            body["output_compression"] = 90
        return base64.b64decode(self._call("/images/generations", json.dumps(body).encode(), "application/json")["data"][0]["b64_json"])

    def edit(self, prompt: str, image: bytes, filename: str, size: str, quality: str = "high") -> bytes:
        boundary = "hakishow" + uuid.uuid4().hex
        parts = []
        for name, value in (("model", MODEL), ("prompt", prompt), ("size", size), ("quality", quality), ("output_format", "webp"), ("output_compression", "90")):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        kind = "image/webp" if filename.endswith(".webp") else "image/png"
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="{filename}"\r\nContent-Type: {kind}\r\n\r\n'.encode() + image + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        return base64.b64decode(self._call("/images/edits", b"".join(parts), f"multipart/form-data; boundary={boundary}")["data"][0]["b64_json"])


def retry(fn, label: str):
    for attempt in range(5):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                log(label, "重试", e.code)
                time.sleep(6 * (attempt + 1))
                continue
            raise RuntimeError(f"{e.code} {detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 4:
                log(label, "重试", e)
                time.sleep(6 * (attempt + 1))
                continue
            raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="people,styles,bg,stickers,scenes,icon")
    ap.add_argument("--pick", default="", help="仅处理这些预设标识符／贴纸名称")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--lanes", type=int, default=6)
    ap.add_argument("--variant", default="", help="将备选版本写为 name.<variant>.webp，以便选择最佳版本")
    ap.add_argument("--people", default="", help="'all' 会将每种风格绘制到全部六个人物上（默认：mei、主展示人物和另一人）")
    ap.add_argument("--who", default="", help="仅处理这些人物（用逗号分隔）")
    a = ap.parse_args()
    only, pick = set(a.only.split(",")), set(filter(None, a.pick.split(",")))
    c = Client(key())
    data = presets()
    suffix = f".{a.variant}" if a.variant else ""
    for sub in ("people", "styles", "bg", "stickers", "scenes", "brand"):
        (RAW / sub).mkdir(parents=True, exist_ok=True)
    meta_path = RAW / "provenance.json"
    meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
    meta_lock = threading.Lock()

    def remember(name: str, **info) -> None:
        with meta_lock:
            meta[name] = {"model": MODEL, "made": time.strftime("%Y-%m-%d"), **info}
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    def todo(path: Path) -> bool:
        return a.force or not path.exists()

    def people_job(pid: str, desc: str):
        out = RAW / "people" / f"{pid}{suffix}.webp"
        if not todo(out):
            return
        prompt = f"{desc} {SELFIE}"
        t = time.time()
        out.write_bytes(retry(lambda: c.generate(prompt, "1024x1536"), pid))
        remember(f"people/{pid}", prompt=prompt)
        log("people", pid, f"{time.time() - t:.0f}s")

    def style_job(preset: dict, person: str):
        out = RAW / "styles" / preset["id"] / f"{person}{suffix}.webp"
        if not todo(out):
            return
        src = RAW / "people" / f"{person}.webp"
        for _ in range(240):   # 人物图像正在同一次运行中生成
            if src.exists():
                break
            time.sleep(2)
        out.parent.mkdir(parents=True, exist_ok=True)
        t = time.time()
        out.write_bytes(retry(lambda: c.edit(preset["prompt"], src.read_bytes(), f"{person}.webp", "1024x1536"), f"{preset['id']}/{person}"))
        remember(f"styles/{preset['id']}/{person}", prompt=preset["prompt"], source=f"people/{person}")
        log("style", preset["id"], person, f"{time.time() - t:.0f}s")

    def bg_job(sid: str, desc: str):
        out = RAW / "bg" / f"{sid}{suffix}.webp"
        if not todo(out):
            return
        prompt = f"{desc} {NO_PEOPLE}"
        t = time.time()
        out.write_bytes(retry(lambda: c.generate(prompt, "1024x1536"), "bg " + sid))
        remember(f"bg/{sid}", prompt=prompt)
        log("bg", sid, f"{time.time() - t:.0f}s")

    def sticker_job(name: str, desc: str):
        out = RAW / "stickers" / f"{name}{suffix}.png"
        if not todo(out):
            return
        prompt = f"{desc} {ISO}"
        t = time.time()
        out.write_bytes(retry(lambda: c.generate(prompt, "1024x1024", transparent=True), "sticker " + name))
        remember(f"stickers/{name}", prompt=prompt)
        log("sticker", name, f"{time.time() - t:.0f}s")

    def scene_job(sid: str, desc: str):
        out = RAW / "scenes" / f"{sid}{suffix}.webp"
        if not todo(out):
            return
        prompt = f"{desc} {SCENE_STYLE}"
        t = time.time()
        out.write_bytes(retry(lambda: c.generate(prompt, "1024x1024", quality="medium"), "scene " + sid))
        remember(f"scenes/{sid}", prompt=prompt)
        log("scene", sid, f"{time.time() - t:.0f}s")

    def icon_job():
        out = RAW / "brand" / f"icon{suffix}.webp"
        if not todo(out):
            return
        out.write_bytes(retry(lambda: c.generate(ICON, "1024x1024"), "icon"))
        remember("brand/icon", prompt=ICON)
        log("图标已完成")

    jobs = []
    if "people" in only:
        jobs += [(people_job, pid, desc) for pid, desc in PEOPLE.items() if not pick or pid in pick]
    if "bg" in only:
        jobs += [(bg_job, sid, desc) for sid, desc in BACKGROUNDS.items() if not pick or sid in pick]
    if "stickers" in only:
        jobs += [(sticker_job, n, desc) for n, desc in STICKERS.items() if not pick or n in pick]
    if "scenes" in only:
        jobs += [(scene_job, sid, desc) for sid, desc in SCENES.items() if not pick or sid in pick]
    if "icon" in only:
        jobs.append((icon_job,))
    if "styles" in only:
        for p in data["presets"]:
            if pick and p["id"] not in pick:
                continue
            cast = ["mei", p["hero"], *p["also"]] + (list(PEOPLE) if a.people == "all" else [])
            for person in dict.fromkeys(cast):
                if a.who and person not in a.who.split(","):
                    continue
                jobs.append((style_job, p, person))

    failures = []

    def run(job):
        try:
            job[0](*job[1:])
        except Exception as e:   # 继续运行；最后统一报告
            label = " ".join(str(x.get("id") if isinstance(x, dict) else x)[:20] for x in job[1:])
            failures.append((label, str(e)[:300]))
            log("失败", label, str(e)[:300])

    log(f"{len(jobs)} 个任务，{a.lanes} 条并行通道")
    with ThreadPoolExecutor(max_workers=a.lanes) as pool:
        list(pool.map(run, jobs))
    log("完成", f"{len(failures)} 个失败")
    for f in failures:
        log(" -", *f)


if __name__ == "__main__":
    main()

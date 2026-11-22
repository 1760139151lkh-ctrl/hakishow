"""集中保存交给工作室模型的文字，以便调整文案而无需改动底层流程。

每份任务说明都要求相同的三个里程碑，使应用能够如实显示进度：
  PLAN {json}    模型确定将要执行的操作后立即输出
  （图像保存到 out/1.png、out/2.png、……）
  DONE {json}    以房间语气给出简短回复，以及接下来可尝试的三个创意
  FAILED {json}  无法完成时改为输出此项
"""

from __future__ import annotations

from .turns import Inputs, Turn

ROLE = {
    "style": "风格参考：借鉴其调色、光线与纹理，不借用其画面内容",
    "backdrop": "地点参考：将它用作新背景",
    "with": "另一张参与处理的图像",
    "look": ("外观参考：从中提取文字指定的内容（发型、刘海、颜色、妆容、服饰），并"
             "将其应用到主体上；绝不使用参考图中的面孔、人物或背景"),
    "marks": ("绘有用户粗略标记的主体图像（圈选、划掉、草绘线条）：这些标记"
              "说明修改位置与方式。遵循这些标记，但绝不要将标记画进结果中"),
}
OPS = {
    "create": "根据文字绘制一张新图像。",
    "edit": "按文字要求修改主体图像。保留文字未提及的所有内容：人物、面孔、姿势与构图均保持相同。",
    "restyle": "在下述世界设定与艺术媒介中创作人物肖像。让该设定决定服饰、姿势、表情与光线。",
    "reference": "修改主体图像，使其采用风格参考的调色、光线与纹理。保持主体图像的构图与内容。",
    "blend": "按文字要求将这些图像合为一张。",
    "region": "仅修改主体图像中标记的区域，每个区域遵循各自说明。蒙版外的所有内容保持完全不变。"
              " 在蒙版内也仅修改说明要求的内容：该区域内的其他内容（王冠、发夹、帽子、眼镜、首饰）保持原样。",
    "backdrop": "将主体身后的背景替换为下述地点。主体保持完全一致，并让光线匹配新地点。",
    "remove": "移除文字（或标记区域）指向的内容，并自然填补空缺，让人看不出修补痕迹。",
    "vary": "为主体图像制作变体：相同主体，不同表现方式。",
    "angles": ("从其他角度展示主体图像中的人物，每个角度一张图像；除非文字另有要求，否则依次为："
               "鼻子朝向右边缘的四分之三侧面、朝向同一边缘的完整侧面、"
               "然后是鼻子朝向左边缘的四分之三侧面。保持拍摄氛围不变，仅移动相机。"),
}
PIN_MARKS = "①②③④⑤⑥⑦⑧⑨"
# 工作室中文回复中对各类修改的称呼。
OP_WORDS = {"create": "一张新图像", "edit": "用户通过文字要求的修改", "restyle": "整张照片转换为艺术风格",
            "reference": "借鉴参考图外观的修改", "blend": "图像合成", "region": "仅修改面部或头发的部分区域",
            "backdrop": "新背景", "remove": "移除某些内容", "vary": "同一图像的另外三种表现", "angles": "从其他角度展示相同外观"}
# 文本模型不可用或太慢时使用的简短中文建议。
IDEAS = {
    "restyle": ["添加霓虹夜景背景", "添加一点闪光", "试试灿烂的笑容"], "edit": ["让效果更自然", "使用日落海滩背景", "添加一点闪光"],
    "region": ["让颜色更浅", "试试另一种发型", "添加一顶小王冠"], "vary": ["试试另一个角度", "添加星空背景", "添加一些烟花"],
    "angles": ["回到正面视角", "添加樱花", "让效果更梦幻"], "backdrop": ["使用黄金时刻的光线", "试试另一处场景", "改成夜景"],
    "create": ["让光线更温暖", "改成夜景", "再创作几张"], "reference": ["更贴近参考图", "保留更多原始颜色", "再创作几张"],
    "blend": ["更多采用第一张图像的内容", "更多采用第二张图像的内容", "试试另一种背景"], "remove": ["进一步清理该区域", "试试另一种背景", "让光线更温暖"],
}


def direct_brief(turn: Turn, inputs: Inputs) -> str:
    """直接请求图像模型时使用的提示词（openai 引擎）：执行什么、各张图像的角色，以及用户文字。"""
    op = turn.intent.op if inputs.pictures else "create"
    lines = [OPS.get(op, OPS["edit"])]
    if len(inputs.pictures) > 1:
        order = [inputs.subject or next(iter(inputs.pictures))] + [h for h in inputs.pictures if h != inputs.subject]
        roles = dict(inputs.refs)
        lines.append("图像依次为：" + "; ".join(
            f"@{h}, " + ("主体" if i == 0 else ROLE.get(roles.get(h, "with"), ROLE["with"])) for i, h in enumerate(order)) + ".")
    if turn.text.strip():
        lines.append(turn.text.strip())
    for n, note, _mask in inputs.pins:
        lines.append(f"在标记区域{PIN_MARKS[n - 1]}: {note or '修改此处'}.")
    if turn.look:
        lines.append(f"外观“{turn.look.name}»: {turn.look.prompt}")
    if turn.backdrop:
        lines.append(f"新地点：{turn.backdrop.words}")
    if turn.taste.strip():
        lines.append(f"一贯偏好（除非另有说明）：{turn.taste.strip()}")
    return " ".join(line for line in lines if line)[:3900]


def reply_brief(turn: Turn) -> str:
    """交给文本模型生成工作室回复的任务说明：以应用语气写一句简短的简体中文回复，以及接下来可尝试的三个内容。"""
    op = turn.intent.op
    said = (turn.say or turn.text).strip()[:600]
    style = turn.room.name if turn.room and turn.room.name else (turn.preset or "")
    return "\n".join([
        "你代表 HakiShow 发言。它是面向新加坡与亚太地区创作者、将自拍变成艺术作品的俏皮工作室。",
        f"用户刚刚提出了以下要求，其图像正在生成：“{said or OP_WORDS.get(op, '一张新图像')}».",
        f"修改类型：{OP_WORDS.get(op, OP_WORDS['edit'])}." + (f" 他们的风格：“{style}»." if style else ""),
        "使用自然的简体中文填写 reply：一句温暖、俏皮的话，最多60个汉字和一个表情符号，告知结果已完成。"
        " 若用户要求具体修改，请简短提及，例如“你的新刘海已完成！”或“你的滨水场景已完成！”。"
        " 不要描述用户的面孔或身体，也不要承诺你无法看到的细节。",
        "使用简体中文填写 suggestions：恰好3项用户会喜欢、针对同一图像的不同后续修改；每项4至14个汉字，最多"
        " 24个字符，写成直接指令（例如“使用日落海滩背景”或“在我肩上添加一只小猫”）。"
        " 不要重复用户刚提出的要求；内容应适合所有年龄。",
    ])


def angle_brief(turn: Turn, inputs: Inputs, angle: str) -> str:
    """多个角度中的一个，单独发出请求（openai 引擎为每个角度分别调用一次）。"""
    lines = [f"围绕人物移动相机，切换到以下视角：{angle}.",
             "保持人物外观与拍摄氛围。让新视角自然呈现人物。"]
    if turn.text.strip():
        lines.append(turn.text.strip())
    return " ".join(lines)[:3900]


def turn_brief(turn: Turn, inputs: Inputs, files: dict[str, str], *, size: str, quality: str, image_hint: str) -> str:
    """一个交互轮次的任务说明。files 将每张图像的句柄（及蒙版名称）映射到任务文件夹内的路径。"""
    lines = ["你是个人图像工作室 HakiShow 的执行助手。仅在当前文件夹内工作。", ""]
    lines += ["用户写道：", f"«{turn.text.strip() or '（没有文字；参见下方说明）'}»", ""]
    if inputs.pictures:
        lines.append("图像（也已按此顺序附在消息中）：")
        for handle in inputs.pictures:
            role = "主体：待修改的图像" if handle == inputs.subject else ROLE.get(dict(inputs.refs).get(handle, "with"), ROLE["with"])
            lines.append(f"- {handle} = {files[handle]}: {role}")
        lines.append("在用户的文字中，@A 表示图像 A，其他编号以此类推。")
        lines.append("")
    lines.append("要执行的操作：" + OPS.get(turn.intent.op if inputs.pictures else "create", OPS["edit"]))
    for n, note, _mask in inputs.pins:
        mask = files.get(f"pin{n}")
        lines.append(f"- 区域{PIN_MARKS[n - 1]} ({mask}；白色＝修改，黑色＝保留）：{note or '修改此处'}")
    if files.get("edit"):
        lines.append(f"- 将相同区域合并为符合图像编辑工具约定的单个编辑蒙版（透明＝修改）：{files['edit']}")
        if turn.intent.op == "region":
            lines.append("保持源图的裁剪、缩放与对齐，使编辑区域准确重合。工作室会将这些区域合成到原图上。不要自行调整工具输出的尺寸或进行合成。")
    if inputs.subject_mask is not None:
        lines.append(f"- 需要保留的主体已标记在{files['subject']}中（白色＝保留在前景）。")
    if turn.look:
        lines.append(f"外观：“{turn.look.name}»: {turn.look.prompt}")
    if turn.backdrop:
        lines.append(f"新地点：“{turn.backdrop.name}»: {turn.backdrop.words}")
    if turn.taste.strip():
        lines.append(f"他们的一贯偏好（除非上方文字另有说明，否则遵循）：“{turn.taste.strip()}»")
    if turn.room and turn.room.name:
        lines.append(f"（仅供偏好参考：用户正在以下名称的房间内工作：“{turn.room.name}», {turn.room.line})")
    lines += ["", f"制作 {turn.n} 张图像{'' if turn.n > 1 else ''}，{size}，质量为 {quality}。", "",
              "工作方式：",
              '1. 先用一行回复：PLAN {"summary": "<一句简短的话：你将执行什么>", "prompt": "<你将使用的图像提示词>"}',
              f"2. 制作图像{'' if turn.n > 1 else ''}. {image_hint}",
              "3. 如果图像工具自行保存 PNG 文件，就将文件保留在该位置。工作室会按生成顺序收集这些文件。"
              "否则只写入以下 PNG：" + ", ".join(f"out/{i + 1}.png" for i in range(turn.n)) + ".",
              f'4. 最后，用一行回复：DONE {{"reply": "<以以下语气给用户写一至两句温暖的话：{", ".join(turn.room.voice[:3]) if turn.room and turn.room.voice else "温暖、简洁、准确"}>", "suggestions": ["<用户接下来可能提出的三个简短请求，每项最多十四个汉字>"]}}',
              '如果无法完成，改用一行回复：FAILED {"message": "<用直白语言说明原因>", "hint": "<用户可以调整什么>"}',
              "所有摘要、回复、建议、失败消息与提示均使用自然的简体中文。",
              "不要提问，直接决定。不要修改 out/ 之外的文件。"]
    return "\n".join(lines)


def room_brief(text: str, palette: list[str] | None) -> str:
    extra = f" 以图像中的以下颜色作为起点：{', '.join(palette)}." if palette else ""
    return (f"根据以下氛围，为 HakiShow 应用创造一个房间：“{text}».{extra}\n"
            "房间决定应用的整体氛围：颜色、字体、装饰、景色、天气、进入房间的擦拭过渡、小音效、动态方式，以及工作室说话的语气。\n"
            "颜色采用 #rrggbb 格式。ground 与 ground2 是背景色（浅色房间使用淡色，深色房间使用深色）。surface 用于卡片；ink 在 surface 上必须清晰可读；soft 用于弱化文字；accent 与 accent2 是强调色。\n"
            "每个名称、描述和语气文案均使用自然的简体中文。语气文案应简短、温暖且符合角色；"
            "placeholder 最多20个汉字；send 是一个两字的词。\n"
            "仅返回符合结构定义的 JSON。")


def look_brief(text: str, has_picture: bool) -> str:
    source = "附件图像的外观" if has_picture and not text else f"«{text}»" + ("（附件图像展示了该外观）" if has_picture else "")
    return (f"根据以下内容描述一个 HakiShow 外观（图像风格）：{source}.\n"
            "name 与 line 使用简体中文。name：二至六个汉字。line：一句能引发联想的话。"
            "prompt：图像模型应遵循的风格指令，用英语写成一行。\n"
            "ramp：从最深阴影到最亮高光的五个 #rrggbb 颜色。keep：0至1，表示保留原图颜色的程度。grain、bloom、vignette：0至1。\n"
            "仅返回符合结构定义的 JSON。")


def backdrops_brief(text: str, near: float, dream: float, room: str, has_picture: bool) -> str:
    return ("为以下内容建议六个背景（人物所处的新地点）：" + ("附件图像" if has_picture else "一幅人像") + ".\n"
            + (f"用户要求：“{text}”。先满足该要求，再提供变体。\n" if text else "")
            + f"倾向于{'近距离而亲密的场景（房间、墙面、窗户）' if near < .4 else '宽广而遥远的场景（风景、天际线）' if near > .6 else '介于近景与远景之间'}, "
            + f"并且 {'真实而具有摄影感' if dream < .4 else '梦幻而超现实' if dream > .6 else '介于现实与梦境之间'}.\n"
            + (f"用户正在以下名称的房间内工作：“{room}”；让它稍微影响这些创意。\n" if room else "")
            + "每个背景包括：name（简体中文，最多八个汉字）和 words（图像模型能够据此绘制的一行生动英语描述）。\n"
            + "仅返回符合结构定义的 JSON。")


def style_brief(text: str, has_picture: bool) -> str:
    """根据用户文字或其喜爱外观的图像，为 HakiShow 创造一种全新风格。"""
    source = ("附件图像的外观（艺术媒介、调色、光线与情绪，绝不包括其中的人物）" if has_picture and not text
              else f"«{text}»" + ("（附件图像展示了用户所指的外观）" if has_picture else ""))
    return (f"根据以下内容，为将自拍变成艺术人像的俏皮应用 HakiShow 创造一种新的艺术头像风格：{source}.\n"
            "面向新加坡与亚太地区创作者，name、line、hook 与 details 的 label 使用自然的简体中文：简短、生动、俏皮。"
            "name：二至六个汉字。line：一句话，最多60个汉字。"
            "hook：简短短语，最多16个汉字。\n"
            "prompt：用英语撰写图像模型按此风格重绘人物照片时遵循的指令：艺术媒介、调色、光线、纹理、"
            "情绪与场景，并以 'Still clearly them.' 结尾。绝不提及在世艺术家、工作室、品牌或已有角色。\n"
            "colors：以 #rrggbb 格式给出此风格的应用主题颜色：bg 与 bg2（背景渐变）、surface（卡片）、ink（文字，在 surface 上清晰可读）、"
            "soft（弱化文字）、accent 与 accent2（强调色）。dark：是否为深色主题。\n"
            "look：能体现此风格的实时相机滤镜；各项取值0至1，sat 与 contrast 除外（0.5至1.6，1为中性）。\n"
            "details：恰好八个选项，每组两个（acc：配饰，light：光效，scene：背景，frame：边框），"
            "每项包含二至八个汉字的简体中文 label，以及供图像模型使用的英语 words。\n"
            "仅返回符合结构定义的 JSON。")

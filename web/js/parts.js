/** 局部编辑词汇：可编辑的面部与头发区域、每个区域的选项、强度级别，以及发送给图像模型的英语描述。在刘海、眉毛、发色、发型、眼妆、嘴唇和胡须之外，还包括腮红、耳饰、头饰、眼镜和表情。每个部位对应 core/face.js 中的一个蒙版。服务器将编辑区域合成回原图，保留蒙版外的像素。此模块只包含界面与测试共用的数据和纯函数。 */

/** @typedef {{ id: string, label: string, words: string, hex?: string }} PartOption */
/** @typedef {{ label: string, words: string }} TuneStep */
/**
 * @typedef {{ id: string, label: string, en: string, hint: string, kind: 'pick' | 'swatch', options: PartOption[],
 *   tune?: { label: string, steps: TuneStep[], start: number } }} Part
 */
/** @typedef {{ part: string, option: string, tune?: number, say?: string }} Pick 一个已选中的局部编辑。 */

/** @type {Part[]} */
export const PARTS = [
  {
    id: 'bangs', label: "刘海", en: '刘海', hint: "换一种刘海，修饰脸部轮廓。", kind: 'pick',
    options: [
      { id: 'air', label: "空气刘海", words: '轻盈、细薄、若隐若现的“空气刘海”' },
      { id: 'curtain', label: "八字刘海", words: '柔和的中分八字刘海向两侧延伸，修饰脸部轮廓' },
      { id: 'blunt', label: "齐刘海", words: '厚实、横向剪齐的齐刘海' },
      { id: 'side', label: "斜刘海", words: '长长的侧分斜刘海' },
      { id: 'choppy', label: "碎刘海", words: '短而有层次纹理的碎刘海' },
      { id: 'none', label: "向后梳", words: '完全没有刘海：露出额头，头发向后梳' },
    ],
    tune: { label: "长度", start: 1, steps: [{ label: "眉毛上方", words: '长度明显短于眉毛位置' }, { label: "齐眉", words: '长度恰好到眉毛' }, { label: "眉毛下方", words: '长度足以轻触睫毛' }] },
  },
  {
    id: 'cut', label: "发型", en: '发型', hint: "尝试新的剪裁、长度或发丝质感。", kind: 'pick',
    options: [
      { id: 'waves', label: "松散波浪", words: '长而蓬松、富有光泽的波浪发' },
      { id: 'straight', label: "柔顺长直发", words: '柔顺的长直发' },
      { id: 'bob', label: "波波头", words: '时尚的齐下巴波波头' },
      { id: 'lob', label: "齐肩长波波", words: '齐肩的长波波头，发尾柔和外翘' },
      { id: 'wolf', label: "狼尾发型", words: '层次丰富、蓬松的狼尾发型' },
      { id: 'pixie', label: "精灵短发", words: '利落的精灵短发' },
      { id: 'bun', label: "高丸子头", words: '可爱的高位蓬松丸子头，散落发丝修饰脸部' },
      { id: 'twin', label: "双马尾", words: '俏皮的双马尾' },
      { id: 'braid', label: "侧编辫", words: '长而松散的侧编辫' },
      { id: 'kpop', label: "纹理两段式短发", words: '具有纹理的韩式两段式短发，配柔和刘海' },
      { id: 'slick', label: "整齐背头", words: '整齐地向后梳拢的头发' },
      { id: 'buzz', label: "寸头", words: '干净的寸头' },
    ],
  },
  {
    id: 'colour', label: "发色", en: '发色', hint: "新发色，新心情。", kind: 'swatch',
    options: [
      { id: 'black', label: "自然黑", hex: '#211c1b', words: '自然且有光泽的黑色' },
      { id: 'brown', label: "巧克力棕", hex: '#5d3b2a', words: '浓郁的巧克力棕色' },
      { id: 'milktea', label: "奶茶棕", hex: '#b5906f', words: '奶茶米棕色' },
      { id: 'honey', label: "蜂蜜金", hex: '#cca15b', words: '蜂蜜金色' },
      { id: 'ash', label: "烟灰色", hex: '#8f949b', words: '烟熏灰色' },
      { id: 'pink', label: "樱花粉", hex: '#eda3bd', words: '粉彩樱花粉色' },
      { id: 'wine', label: "勃艮第酒红", hex: '#7d2435', words: '深沉的勃艮第葡萄酒红色' },
      { id: 'blue', label: "冰蓝色", hex: '#79acd9', words: '冰感粉彩蓝色' },
      { id: 'taro', label: "薰衣草紫", hex: '#a88ed0', words: '香芋薰衣草紫色' },
      { id: 'mint', label: "薄荷绿", hex: '#8fd4bd', words: '柔和的薄荷绿色' },
      { id: 'peach', label: "蜜桃橙", hex: '#f0a273', words: '蜜桃橙色' },
      { id: 'silver', label: "铂金色", hex: '#e3e4ea', words: '铂金银色' },
    ],
    tune: { label: "染色位置", start: 0, steps: [{ label: "全头", words: '全头染色' }, { label: "挑染", words: '在原发色上增加修饰脸部的挑染' }, { label: "渐变染", words: '从自然发根向下渐变的渐层染色' }, { label: "内层染", words: '若隐若现的隐藏内层染色' }] },
  },
  {
    id: 'brows', label: "眉毛", en: '眉毛', hint: "给眉毛换个新形状。", kind: 'pick',
    options: [
      { id: 'natural', label: "自然", words: '柔和自然的眉毛' },
      { id: 'straight', label: "平直", words: '平直的韩式眉毛' },
      { id: 'willow', label: "柔和弯眉", words: '弧度柔和的柳叶眉' },
      { id: 'feather', label: "羽毛眉", words: '蓬松、向上梳的羽毛状眉毛' },
      { id: 'arch', label: "高挑眉", words: '高挑、轮廓鲜明的弯眉' },
      { id: 'sword', label: "英气剑眉", words: '棱角分明、有力的剑眉' },
    ],
    tune: { label: "浓度", start: 1, steps: [{ label: "柔和", words: '柔和轻淡' }, { label: "自然", words: '自然浓密度' }, { label: "浓烈", words: '浓烈饱满' }] },
  },
  {
    id: 'eyes', label: "眼妆", en: '眼妆', hint: "眼线、眼影与睫毛。", kind: 'pick',
    options: [
      { id: 'bare', label: "若有若无", words: '若有若无的自然眼妆' },
      { id: 'wing', label: "上挑眼线", words: '利落上挑的猫眼眼线' },
      { id: 'peach', label: "桃花眼影", words: '玫瑰桃花色眼影' },
      { id: 'smoky', label: "柔和烟熏", words: '柔和的烟熏眼妆' },
      { id: 'glitter', label: "下眼睑亮片", words: '沿下眼睑点缀闪亮亮片' },
      { id: 'lashes', label: "浓密睫毛", words: '纤长、轻盈的睫毛' },
      { id: 'graphic', label: "彩色眼线", words: '一抹醒目的彩色图形眼线' },
    ],
    tune: { label: "浓度", start: 1, steps: [{ label: "柔和", words: '轻柔' }, { label: "日常", words: '日常浓度' }, { label: "浓烈", words: '戏剧化且浓烈' }] },
  },
  {
    id: 'lips', label: "嘴唇", en: '嘴唇', hint: "一点颜色，就能改变形象。", kind: 'swatch',
    options: [
      { id: 'nude', label: "裸色", hex: '#c98d7f', words: '裸色唇色' },
      { id: 'rose', label: "灰玫瑰色", hex: '#b96d6e', words: '灰玫瑰唇色' },
      { id: 'peach', label: "蜜桃色", hex: '#f08c7b', words: '蜜桃珊瑚唇色' },
      { id: 'berry', label: "浆果色", hex: '#932d55', words: '浆果唇色' },
      { id: 'red', label: "经典红", hex: '#c8152f', words: '经典红唇' },
      { id: 'brick', label: "砖棕色", hex: '#8c3b2c', words: '砖棕唇色' },
      { id: 'pink', label: "婴儿粉", hex: '#f3a5c0', words: '婴儿粉唇色' },
      { id: 'straw', label: "草莓红", hex: '#e2435c', words: '草莓红唇色' },
    ],
    tune: { label: "妆效", start: 1, steps: [{ label: "哑光", words: '呈柔和哑光妆效' }, { label: "水亮", words: '呈水润亮泽妆效' }, { label: "丝绒", words: '呈丝绒妆效' }, { label: "柔和渐变", words: '采用柔焦渐变的“咬唇妆”风格' }] },
  },
  {
    id: 'blush', label: "腮红", en: '腮红', hint: "为脸颊增添一丝暖意。", kind: 'swatch',
    options: [
      { id: 'peach', label: "蜜桃色", hex: '#f7a891', words: '柔和的蜜桃腮红' },
      { id: 'sakura', label: "樱花色", hex: '#f4a4c1', words: '樱花粉腮红' },
      { id: 'coral', label: "珊瑚色", hex: '#f2866d', words: '珊瑚色腮红' },
      { id: 'sunkiss', label: "日晒色", hex: '#e6826d', words: '横跨双颊与鼻梁的日晒感腮红' },
    ],
    tune: { label: "浓度", start: 1, steps: [{ label: "若有若无", words: '若有若无' }, { label: "轻柔红晕", words: '轻柔的红晕' }, { label: "鲜明", words: '鲜明活泼' }] },
  },
  {
    id: 'beard', label: "胡须", en: '胡须', hint: "尝试胡须、胡茬，或剃净效果。", kind: 'pick',
    options: [
      { id: 'clean', label: "剃净", words: '剃净胡须' },
      { id: 'stubble', label: "胡茬", words: '精心修整的浅浅胡茬' },
      { id: 'goatee', label: "山羊胡", words: '整齐的山羊胡' },
      { id: 'full', label: "络腮胡", words: '浓密且修整整齐的络腮胡' },
      { id: 'tache', label: "小胡子", words: '整齐的小胡子' },
    ],
  },
  {
    id: 'earrings', label: "耳饰", en: '耳饰', hint: "增添一点闪耀。", kind: 'pick',
    options: [
      { id: 'pearl', label: "珍珠", words: '优雅的珍珠垂坠耳饰' },
      { id: 'hoops', label: "金色耳环", words: '金色圆环耳饰' },
      { id: 'tassel', label: "流苏", words: '纤长精巧的流苏耳饰' },
      { id: 'stars', label: "星月", words: '小巧的星月耳钉' },
      { id: 'none', label: "移除", words: '不戴耳饰' },
    ],
  },
  {
    id: 'headwear', label: "头饰", en: '头饰', hint: "头冠、帽子、发箍与蝴蝶结。", kind: 'pick',
    options: [
      { id: 'tiara', label: "小王冠", words: '精巧闪亮的头冠' },
      { id: 'bow', label: "缎带蝴蝶结", words: '大缎带蝴蝶结' },
      { id: 'band', label: "发箍", words: '加厚发箍' },
      { id: 'wreath', label: "花冠", words: '鲜花编成的花冠' },
      { id: 'cat', label: "猫耳", words: '可爱的猫耳发箍' },
      { id: 'cap', label: "棒球帽", words: '棒球帽' },
      { id: 'bucket', label: "渔夫帽", words: '渔夫帽' },
      { id: 'clips', label: "彩色发夹", words: '几枚彩色发夹' },
    ],
  },
  {
    id: 'glasses', label: "眼镜", en: '眼镜', hint: "试试新镜框，或摘下眼镜。", kind: 'pick',
    options: [
      { id: 'off', label: "移除", words: '不戴眼镜：摘下眼镜，清晰露出眼睛' },
      { id: 'wire', label: "细金属镜框", words: '细金色金属镜框眼镜' },
      { id: 'bold', label: "黑色镜框", words: '醒目的黑框眼镜' },
      { id: 'round', label: "圆形镜框", words: '复古圆框眼镜' },
      { id: 'shades', label: "太阳镜", words: '时尚太阳镜' },
    ],
  },
  {
    id: 'expression', label: "表情", en: '表情', hint: "新表情，依然是你。", kind: 'pick',
    options: [
      { id: 'smile', label: "温柔微笑", words: '甜美温柔的微笑' },
      { id: 'laugh', label: "开心大笑", words: '开心的大笑' },
      { id: 'wink', label: "眨眼", words: '俏皮地眨眼' },
      { id: 'cool', label: "自信", words: '酷酷的自信神情' },
      { id: 'pout', label: "嘟嘴", words: '可爱的嘟嘴' },
      { id: 'wow', label: "惊讶", words: '惊讶地发出“哇”的表情' },
    ],
  },
];

export const partById = (/** @type {string} */ id) => PARTS.find(p => p.id === id) || null;
export const optionOf = (/** @type {Pick} */ k) => partById(k.part)?.options.find(o => o.id === k.option) || null;

/** 局部编辑标签，例如：刘海 · 八字刘海 · 齐眉。 @param {Pick} k */
export function labelOf(k) {
  const p = partById(k.part), o = optionOf(k);
  if (!p || !o) return '';
  const t = p.tune && k.tune != null ? p.tune.steps[k.tune]?.label : '';
  return [p.label, o.label, t].filter(Boolean).join(' · ');
}

/** 一个局部编辑蒙版的图像模型描述。 @param {Pick} k */
export function noteOf(k) {
  const p = partById(k.part), o = optionOf(k);
  if (!p || !o) return '';
  const t = p.tune && k.tune != null ? p.tune.steps[k.tune]?.words : '';
  const said = String(k.say || '').trim().replace(/[.\u3002\s]+$/, '');
  return `${p.en}: ${o.words}${t ? ', ' + t : ''}${said ? '。按照他们的要求：' + said : ''}`;
}

/** 每个部位选择一个选项；再次选择相同选项会将其移除。 @param {Pick[]} picks @param {Pick} k @returns {Pick[]} */
export function togglePick(picks, k) {
  const same = picks.find(x => x.part === k.part);
  if (same && same.option === k.option) return picks.filter(x => x.part !== k.part);
  const p = partById(k.part);
  const tune = k.tune ?? same?.tune ?? p?.tune?.start;
  return [...picks.filter(x => x.part !== k.part), { ...k, ...(tune != null ? { tune } : {}) }];
}

/** 随蒙版说明发送的共用指令：只编辑所选区域，并匹配已有风格和光线。 @param {Pick[]} picks @param {{ styled?: boolean, words?: string }} [o]
 */
export function regionText(picks, o = {}) {
  const lines = [
    '只修改已标记的面部和头发部位，每处均按照其说明修改。',
    '其余一切必须完全保持原样：同一个人、脸型、皮肤、表情（除非要求修改）、姿势、服装、光线和背景。',
    o.styled ? "精确匹配图片现有的艺术风格、笔触、色板和照明，让改动看起来像原本就绘制在画中。" : '保持自然的照片写实效果；改动必须真实，具有自然的纹理和光线。',
    '保留人物佩戴的所有头部遮盖物。',
  ];
  const said = String(o.words || '').trim();
  if (said) lines.push('此外，按照他们的要求：' + said + '.');
  void picks;   // 每段说明随其蒙版发送；服务器添加标记区域标签。
  return lines.join(' ');
}

/** 描述手工涂抹的选区。 @param {string} words */
export function paintedNote(words) {
  const said = String(words || '').trim().replace(/[.\u3002\s]+$/, '');
  return said ? '在涂抹区域内：' + said : '改善涂抹区域，使其更好看，同时保持原有风格';
}

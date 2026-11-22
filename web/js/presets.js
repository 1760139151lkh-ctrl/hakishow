/** HakiShow · 风格与角色预设矩阵（第 3 版）。每个预设都是一个完整的视觉世界：名称与简短介绍、共用视觉主题（色板、装饰形状和边框）、实时相机滤镜与贴纸、生成提示词，以及可叠加到结果上的可选细节。本模块只包含数据与纯函数。浏览器和 tools/make_assets.py（通过 Node）使用相同的提示词构建器，使今后的示例素材与交互生成保持一致。角色变换是对复古特摄电影、童年动画和趣味反应艺术的原创致敬。提示词描述主体与视觉处理方式，例如银红装甲、圆润的蓝白赛璐璐阴影或圆胖小黄龙，而不是已有角色设计。 */

/** @typedef {'acc' | 'light' | 'scene' | 'frame'} DetailGroup */
/** @typedef {{ id: string, label: string, group: DetailGroup, words: string, solo?: string }} Detail */
/**
 * @typedef {{ dark: boolean, bg: string, bg2: string, surface: string, ink: string, soft: string, accent: string,
 *   accent2: string, onAccent: string, glow: string, line: string, radius: string, display: string, deco: string, frame: string }} Theme
 */
/**
 * @typedef {{ grade: number[], sat: number, contrast: number, lift: number, warmth: number, grain: number, vignette: number,
 *   bloom: number, posterize: number, edge: number, halftone: number, pixel: number, bulge: number, eyes: number,
 *   smooth: number, rim: number[], scan: number, overlay: string, sticker?: string }} Live
 */
/**
 * @typedef {{ id: string, name: string, cat: string, hot: number, line: string, hook: string, theme: Theme, live: Live,
 *   prompt: string, details: Detail[], defaults: Params, hero: string, also: string[], emblem: string[], isNew?: boolean, custom?: boolean }} Preset
 */
/** @typedef {{ strength: number, likeness: number, richness: number, beauty: number, details: string[], words: string }} Params */

/** 顶层分类胶囊按钮。“精选”是经过策划的混合列表。 */
export const CATEGORIES = [
  { id: 'hot', label: "精选" },
  { id: 'fun', label: "趣味" },
  { id: 'role', label: "角色" },
  { id: 'dream', label: "奇幻" },
  { id: 'acg', label: "动漫" },
  { id: 'mood', label: "氛围" },
  { id: 'art', label: "艺术" },
];

/** 艺术肖像的四类细节。 */
export const DETAIL_GROUPS = [
  { id: 'acc', label: "配饰" },
  { id: 'light', label: "灯光" },
  { id: 'scene', label: "背景布景" },
  { id: 'frame', label: "边框" },
];

/** 四个参数控制项。 */
export const KNOBS = [
  { id: 'strength', label: "风格强度", low: "轻柔", high: "浓烈" },
  { id: 'likeness', label: "相似度保留", low: "自由发挥", high: "清晰可辨" },
  { id: 'richness', label: "细节程度", low: "简约", high: "繁复" },
  { id: 'beauty', label: "美颜", low: "自然", high: "精致" },
];

const base = { strength: 70, likeness: 75, richness: 60, beauty: 35, words: '' };
const d = (/** @type {DetailGroup} */ group, /** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ words, solo = '') => ({ id, label, group, words, ...(solo ? { solo } : {}) });
/** 实时滤镜参数集；省略值为零或中性值。 @param {Partial<Live>} o @returns {Live} */
const live = o => ({ grade: [1, 1, 1], sat: 1, contrast: 1, lift: 0, warmth: 0, grain: 0, vignette: .25, bloom: 0, posterize: 0, edge: 0, halftone: 0, pixel: 0, bulge: 0, eyes: 0, smooth: 0, rim: [0, 0, 0, 0, 0, 0], scan: 0, overlay: '', ...o });
/** 可复用的边框细节。 */
const STICKER_EDGE = '人物周围带有厚实的白色模切贴纸轮廓，置于纯色背景上';

/** @type {Preset[]} */
export const PRESETS = [
  // ───────────── 趣味 ─────────────
  {
    id: 'dragon', name: "小小龙", cat: 'fun', hot: 3,
    line: "俏皮的小龙，散发柔和的阳光黄色光泽。", hook: "小小龙，大大吼！",
    theme: { dark: false, bg: '#fff6cc', bg2: '#ffe27a', surface: '#fffaea', ink: '#3d2a00', soft: '#8a6a1f', accent: '#ffb800', accent2: '#ff7a45', onAccent: '#3d2a00', glow: 'rgba(255,190,0,.45)', line: 'rgba(61,42,0,.14)', radius: '26px', display: 'bubble', deco: 'bubbles', frame: 'sticker' },
    live: live({ grade: [1.08, 1.04, .82], sat: 1.25, contrast: 1.05, warmth: .25, bulge: .22, smooth: .5, vignette: .1, overlay: 'bubbles', sticker: 'dragon-hood' }),
    prompt: '把这个人变成可爱圆胖的幼龙吉祥物，采用原创角色设计：圆润、软乎乎的奶黄色幼龙连体服兜帽，带两只小巧圆角龙角、柔软的小翅膀和短粗尾巴，以及圆鼓鼓的柔软肚子；本人的脸清晰地露在兜帽开口中，带着俏皮的张嘴大笑。采用光滑柔和的三维卡通渲染、饱和明亮的阳光色彩，呈现活泼的表情贴纸气质，适合分享。',
    details: [
      d('acc', 'wings', "小翅膀", '背上扑腾着的小翅膀'),
      d('acc', 'snack', "零食时间", '抱着一大袋零食'),
      d('light', 'gloss', "糖果光泽", '光滑、糖果般的高光'),
      d('light', 'spark', "闪光", '周围迸发漫画式闪光'),
      d('scene', 'plain', "贴纸背景", '纯色、平涂的阳光黄色背景', 'scene'),
      d('scene', 'park', "游乐园", '身后是色彩缤纷的游乐园', 'scene'),
      d('frame', 'sticker', "白色描边", STICKER_EDGE, 'frame'),
      d('frame', 'panel', "漫画分格", '粗黑色漫画分格边框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['gloss', 'plain', 'sticker'] },
    hero: 'jun', also: ['kai'], emblem: ['dragon-hood', 'heart'],
  },
  {
    id: 'bighead', name: "大头", cat: 'fun', hot: 2,
    line: "夸张的五官与利落的漫画线条，个性十足。", hook: "大脑袋，更强存在感。",
    theme: { dark: false, bg: '#fff1e2', bg2: '#ffd0a8', surface: '#fffaf4', ink: '#1d1d1f', soft: '#6b5b4f', accent: '#ff5a36', accent2: '#2b6cff', onAccent: '#ffffff', glow: 'rgba(255,90,54,.35)', line: '#1d1d1f', radius: '14px', display: 'comic', deco: 'halftone', frame: 'comic' },
    live: live({ sat: 1.2, contrast: 1.12, bulge: .62, edge: .35, posterize: .25, vignette: .05, overlay: 'burst' }),
    prompt: '把这个人变成幽默的大头漫画肖像：头部放大到正常比例的大约三倍，搭配小小的身体；采用利落、果断的漫画墨线轮廓与平涂的鲜艳色彩；五官夸张但亲切，仍然一眼看得出是本人，配以滑稽且富于表现力的姿势，呈现肢体喜剧般的活力。',
    details: [
      d('acc', 'shades', "太阳镜", '超大号趣味太阳镜'),
      d('acc', 'crown', "小王冠", '一顶微微歪斜的小王冠'),
      d('light', 'spot', "聚光灯", '一道舞台聚光灯'),
      d('light', 'boom', "光芒迸发", '头部后方呈放射状猛烈迸发的光芒'),
      d('scene', 'flat', "纯色背景", '平涂的鲜艳色彩背景', 'scene'),
      d('scene', 'street', "繁忙街道", '繁忙的卡通街道', 'scene'),
      d('frame', 'panel', "漫画分格", '粗黑色漫画分格边框', 'frame'),
      d('frame', 'sticker', "白色描边", STICKER_EDGE, 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['boom', 'flat'] },
    hero: 'aiman', also: ['priya'], emblem: ['heart', 'sparkle'],
  },
  {
    id: 'faceart', name: "漫画反应", cat: 'fun', hot: 1,
    line: "戏剧化表情与冲击线，定格绝佳反应。", hook: "所有情绪，尽情表达。",
    theme: { dark: false, bg: '#ffffff', bg2: '#ffe3ea', surface: '#fff8fa', ink: '#111111', soft: '#555555', accent: '#ff2d55', accent2: '#111111', onAccent: '#ffffff', glow: 'rgba(255,45,85,.3)', line: '#111111', radius: '10px', display: 'comic', deco: 'speed', frame: 'jagged' },
    live: live({ sat: .2, contrast: 1.45, halftone: .55, edge: .55, eyes: .35, vignette: 0, overlay: 'speed' }),
    prompt: '把这个人变成极其夸张的漫画反应分格：高度夸张、充满戏剧性的面部表情（瞪大惊讶的双眼、下巴惊掉，或反派般得意的咧嘴笑），但仍清楚地保留本人特征；强烈的速度线与冲击爆发从背后放射，采用大胆的黑色墨线排线和网点阴影，呈现高能喜剧漫画效果，成为适合制作表情包的反应图。',
    details: [
      d('acc', 'sweat', "汗滴", '巨大的漫画汗滴'),
      d('acc', 'vein', "生气符号", '额头上的漫画青筋生气符号'),
      d('light', 'lines', "冲击线", '向外放射的速度线与冲击线'),
      d('light', 'bolt', "闪电", '背后锯齿状的闪电裂纹'),
      d('scene', 'tone', "网点", '点状漫画网点背景', 'scene'),
      d('scene', 'fire', "火焰", '身后咆哮的漫画火焰', 'scene'),
      d('frame', 'panel', "漫画分格", '倾斜的漫画分格边框', 'frame'),
      d('frame', 'torn', "撕纸", '撕裂的纸张边缘', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['lines', 'tone'] },
    hero: 'kai', also: ['aiman'], emblem: ['bolt', 'sparkle'],
  },
  {
    id: 'clay', name: "黏土伙伴", cat: 'fun', hot: 2,
    line: "手工黏土的趣味，带一点定格动画的摇晃感。", hook: "手作而成，以你为形。",
    theme: { dark: false, bg: '#ffe9dc', bg2: '#ffd2bf', surface: '#fff6ef', ink: '#4a2c22', soft: '#946a5a', accent: '#ff8a65', accent2: '#5cc6a0', onAccent: '#ffffff', glow: 'rgba(255,138,101,.4)', line: 'rgba(74,44,34,.12)', radius: '30px', display: 'round', deco: 'candy', frame: 'candy' },
    live: live({ grade: [1.06, 1, .94], sat: 1.15, contrast: .92, lift: .06, warmth: .2, posterize: .45, smooth: .9, vignette: .2, overlay: 'candy', sticker: 'beanie' }),
    prompt: '把这个人重塑为迷人的手工定格动画黏土人偶：柔软的橡皮泥上带有淡淡的指纹和工具痕迹，五官略微不对称且圆润，眼睛像光亮的大珠子，头发由粗块黏土发束塑成；表情呆萌讨喜，同时仍能清晰认出本人；采用温暖的微缩布景照明与极浅的景深。',
    details: [
      d('acc', 'beanie', "针织帽", '一顶黏土质感的针织帽'),
      d('acc', 'scarf', "小围巾", '厚实的条纹黏土围巾'),
      d('light', 'lamp', "暖色台灯", '温暖的台灯光'),
      d('light', 'soft', "柔和影棚", '柔和均匀的影棚灯光'),
      d('scene', 'town', "玩具小镇", '微型手工玩具小镇', 'scene'),
      d('scene', 'candy', "糖果粉彩", '糖果粉彩色的无缝背景', 'scene'),
      d('frame', 'blobs', "糖果边框", '由彩色黏土团块和糖果形状组成的边框', 'frame'),
      d('frame', 'sticker', "白色描边", STICKER_EDGE, 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 70, details: ['soft', 'candy'] },
    hero: 'priya', also: ['jun'], emblem: ['candy', 'candy'],
  },
  {
    id: 'pet', name: "萌宠伙伴", cat: 'fun', hot: 2,
    line: "与你心情同步的毛茸茸伙伴。", hook: "来一声喵？",
    theme: { dark: false, bg: '#fff1ef', bg2: '#ffd9d2', surface: '#fff8f6', ink: '#4b2b2b', soft: '#9a6b66', accent: '#ff8fab', accent2: '#ffb86b', onAccent: '#ffffff', glow: 'rgba(255,143,171,.45)', line: 'rgba(75,43,43,.12)', radius: '28px', display: 'round', deco: 'paws', frame: 'paws' },
    live: live({ grade: [1.05, 1, 1], sat: 1.1, lift: .05, warmth: .12, smooth: .7, bloom: .25, eyes: .2, vignette: .15, overlay: 'paws', sticker: 'cat-ears' }),
    prompt: '将这个人与可爱宠物趣味融合：在本人的脸上添加柔软蓬松的动物耳朵、淡淡的胡须痕迹和小小的粉红鼻尖，同时清晰保留本人的五官与表情；脸旁有一只与之相配的毛茸茸宠物，模仿完全相同的表情。呈现柔和、明亮、舒适又可爱的照片插画效果。',
    details: [
      d('acc', 'cat', "小猫", '猫耳朵和一只小猫', 'acc'),
      d('acc', 'dog', "小狗", '耷拉的小狗耳朵，并用小狗替代小猫', 'acc'),
      d('light', 'glow', "柔光", '柔和蓬松的光晕'),
      d('light', 'stars', "星星眼", '眼中的闪亮星形高光'),
      d('scene', 'nest', "温暖小窝", '用毯子搭成的温暖小窝', 'scene'),
      d('scene', 'lawn', "阳光草坪", '阳光照耀的草坪', 'scene'),
      d('frame', 'paws', "爪印", '由小爪印组成的边框', 'frame'),
      d('frame', 'sticker', "白色描边", STICKER_EDGE, 'frame'),
    ],
    defaults: { ...base, strength: 70, likeness: 85, details: ['cat', 'glow', 'nest'] },
    hero: 'nur', also: ['kai'], emblem: ['paw', 'heart'],
  },

  // ───────────── 角色 ─────────────
  {
    id: 'hero', name: "特摄英雄", cat: 'role', hot: 3,
    line: "银红装甲，闪耀的能量核心。", hook: "变身，登场！",
    theme: { dark: true, bg: '#0b1222', bg2: '#1f2a4d', surface: '#141c33', ink: '#eef3ff', soft: '#9fb0d6', accent: '#ff3b47', accent2: '#4fd7ff', onAccent: '#ffffff', glow: 'rgba(79,215,255,.55)', line: 'rgba(206,220,255,.18)', radius: '8px', display: 'hero', deco: 'energy', frame: 'energy' },
    live: live({ grade: [1.02, 1.02, 1.1], sat: 1.15, contrast: 1.18, bloom: .45, rim: [1, .25, .3, .3, .85, 1], vignette: .45, overlay: 'energy', sticker: 'hero-visor' }),
    prompt: '把这个人变成经典日本特摄科幻电视剧中的英雄，采用完全原创的战衣设计：流畅的拉丝银色装甲，搭配棱角鲜明的深红甲片与发光的青色电路线；胸部中央有发光的六边形能量核心；采用面罩式露面头盔，两侧有向后掠起的棱角侧翼，让本人的脸始终清晰可辨；运用电影感轮廓光与镜头光晕、英雄式低机位角度，呈现宏大的复古特摄电影剧照效果。不得使用任何已有角色。',
    details: [
      d('acc', 'visor', "能量面罩", '横跨头盔眉部的发光青色面罩镜片'),
      d('acc', 'beam', "光束", '抬起一只手臂，发射耀眼光束'),
      d('light', 'core', "能量核心", '胸部能量核心发出明亮的青光，照亮面部'),
      d('light', 'warn', "红色警报", '胸部能量核心闪烁红光，英雄已到极限'),
      d('scene', 'city', "黄昏城市", '黄昏中的城市天际线，探照灯扫过飘动的烟雾', 'scene'),
      d('scene', 'nebula', "星云", '深空中发光的星云', 'scene'),
      d('frame', 'energy', "能量边框", '由光迹构成的发光能量边框', 'frame'),
      d('frame', 'flare', "光芒爆发", '从背后爆发的耀眼光束', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 80, details: ['core', 'city'] },
    hero: 'aiman', also: ['jun'], emblem: ['bolt', 'sparkle'],
  },
  {
    id: 'robot', name: "复古机器人", cat: 'role', hot: 3,
    line: "圆滚滚的蓝白机器人，经典卡通趣味。", hook: "哔哔，准备出发！",
    theme: { dark: false, bg: '#e6f4ff', bg2: '#bfe3ff', surface: '#f7fbff', ink: '#0d3156', soft: '#4f7396', accent: '#1e88e5', accent2: '#ff7043', onAccent: '#ffffff', glow: 'rgba(30,136,229,.4)', line: 'rgba(13,49,86,.14)', radius: '999px', display: 'round', deco: 'dots', frame: 'tv' },
    live: live({ grade: [.94, 1.02, 1.12], sat: 1.25, contrast: 1.08, posterize: .6, edge: .45, smooth: .6, vignette: .1, overlay: 'robot', sticker: 'robot-antenna' }),
    prompt: '把这个人变成可爱的复古卡通机器人，采用原创设计：圆胖的机器人套装以光亮的天蓝色和白色为主，形状简洁圆润，点缀几颗亲切可爱的螺栓；圆形机器人头盔兜帽带有小天线和两盏发光的面颊灯，本人的脸清晰露在开口中，带着开心的大笑。采用明亮的二十世纪八十年代电视卡通赛璐璐动画效果、粗而柔和的轮廓、平涂的欢快色彩，以及干净的双色赛璐璐阴影。',
    details: [
      d('acc', 'prop', "螺旋桨帽", '机器人兜帽顶上旋转的小螺旋桨'),
      d('acc', 'gadget', "神奇道具", '开心地举起一件发光的未来小装置'),
      d('light', 'cel', "赛璐璐阴影", '利落的双色赛璐璐阴影'),
      d('light', 'sun', "阳光", '明亮的阳光'),
      d('scene', 'sky', "蓝天草地", '草地上方的蔚蓝天空与圆滚滚的蓬松白云', 'scene'),
      d('scene', 'lab', "发明家工坊", '摆满小装置的温馨卡通发明家工坊', 'scene'),
      d('frame', 'tv', "复古电视", '圆角的复古电视屏幕边框', 'frame'),
      d('frame', 'sticker', "白色描边", STICKER_EDGE, 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 75, details: ['prop', 'cel', 'sky'] },
    hero: 'kai', also: ['nur'], emblem: ['robot-antenna', 'sparkle'],
  },
  {
    id: 'pilot', name: "机甲驾驶员", cat: 'role', hot: 2,
    line: "驾驶舱显示屏与掠过面庞的全息光。", hook: "同步率 100%。",
    theme: { dark: true, bg: '#061017', bg2: '#0d2635', surface: '#0c1c26', ink: '#dff8ff', soft: '#7fb3c4', accent: '#34e1ff', accent2: '#ff8a2a', onAccent: '#04131a', glow: 'rgba(52,225,255,.5)', line: 'rgba(52,225,255,.22)', radius: '6px', display: 'tech', deco: 'grid', frame: 'brackets' },
    live: live({ grade: [.9, 1.04, 1.12], sat: .9, contrast: 1.15, rim: [.2, .9, 1, 1, .55, .15], scan: .25, vignette: .4, overlay: 'hud' }),
    prompt: '把这个人变成坐在驾驶舱里的未来机甲驾驶员：身穿流畅的高领驾驶服，透明面罩上带有发光的全息抬头显示瞄准标记与投射到脸上的数据，青色和橙色仪表光映在脸颊上；仍能清晰认出本人，呈现浅景深的电影感科幻剧照。',
    details: [
      d('acc', 'helmet', "驾驶员头盔", '打开面罩的驾驶员头盔'),
      d('acc', 'headset', "通信耳机", '纤细的通信耳机'),
      d('light', 'hud', "抬头显示光", '投射到面部的全息抬头显示光'),
      d('light', 'alert', "警报灯", '脉动的红色警报灯'),
      d('scene', 'cockpit', "驾驶舱", '布满屏幕的昏暗机甲驾驶舱', 'scene'),
      d('scene', 'hangar', "机库", '宽阔的机甲机库', 'scene'),
      d('frame', 'brackets', "目标框", '环绕面部的瞄准框', 'frame'),
      d('frame', 'data', "数据流", '沿边缘流动的发光数据流', 'frame'),
    ],
    defaults: { ...base, strength: 75, likeness: 85, details: ['hud', 'cockpit'] },
    hero: 'jun', also: ['priya'], emblem: ['bolt', 'sparkle'],
  },
  {
    id: 'figure', name: "潮玩手办", cat: 'role', hot: 3,
    line: "哑光搪胶、明亮眼神与精致的影棚灯光。", hook: "特别版就是你。",
    theme: { dark: false, bg: '#f3f0ff', bg2: '#e2dbff', surface: '#faf8ff', ink: '#2a2154', soft: '#7468a8', accent: '#7b61ff', accent2: '#ff9cc8', onAccent: '#ffffff', glow: 'rgba(123,97,255,.4)', line: 'rgba(42,33,84,.12)', radius: '22px', display: 'round', deco: 'sparkle', frame: 'box' },
    live: live({ grade: [1.02, 1, 1.05], sat: 1.12, contrast: 1.02, lift: .05, smooth: 1, eyes: .35, bloom: .2, vignette: .12, overlay: 'box' }),
    prompt: '把这个人重塑为高品质设计师潮玩盲盒手办：光滑的哑光搪胶材质，大头的可爱缩小比例，光亮、富于表现力的大眼睛，简化且可爱的五官仍清楚保留本人特征；站在小圆底座上，采用柔和的影棚柔光箱照明、干净的粉彩背景和高端产品摄影效果。',
    details: [
      d('acc', 'prop', "小道具", '拿着一个与角色相配的小型配饰道具'),
      d('acc', 'outfit', "街头穿搭", '时尚的街头服装'),
      d('light', 'box', "柔光箱", '柔和的影棚柔光箱灯光'),
      d('light', 'rim', "轮廓光", '利落的轮廓光'),
      d('scene', 'pastel', "粉彩背景", '马卡龙粉彩色背景', 'scene'),
      d('scene', 'shelf', "展示柜", '玻璃收藏展示架', 'scene'),
      d('frame', 'box', "玩具盒", '置于可爱的盲盒包装展示窗内', 'frame'),
      d('frame', 'dome', "透明罩", '置于透明亚克力展示罩下', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 70, details: ['box', 'pastel'] },
    hero: 'nur', also: ['aiman'], emblem: ['sparkle', 'heart'],
  },
  {
    id: 'arcade', name: "街机格斗家", cat: 'role', hot: 1,
    line: "细腻的复古像素，角色选择界面的气势。", hook: '准备好了吗？开战！',
    theme: { dark: true, bg: '#160b33', bg2: '#33104d', surface: '#1e1240', ink: '#fff6d6', soft: '#c3a8ff', accent: '#ffcc00', accent2: '#ff3d6e', onAccent: '#1a0d00', glow: 'rgba(255,204,0,.45)', line: 'rgba(255,246,214,.2)', radius: '0px', display: 'pixel', deco: 'pixels', frame: 'pixel' },
    live: live({ sat: 1.35, contrast: 1.2, pixel: .55, posterize: .55, scan: .5, vignette: .3, overlay: 'fight' }),
    prompt: '把这个人变成二十世纪九十年代街机格斗游戏角色：精细的 16 位像素画，充满自信的格斗姿态与炽热的能量气场，采用戏剧化的角色选择肖像构图和醒目的渐变背景，使用清晰的有限色板与柔和的阴极射线管屏幕光晕。仍清楚保留本人特征。采用原创角色。不要文字，不要标志。',
    details: [
      d('acc', 'band', "格斗头带", '格斗家的素色布头带'),
      d('acc', 'gloves', "格斗手套", '露指格斗手套'),
      d('light', 'aura', "能量气场", '炽热的能量气场'),
      d('light', 'flash', "必杀技", '必杀技释放时的闪光'),
      d('scene', 'street', "街头场景", '日落时的像素街头格斗场景', 'scene'),
      d('scene', 'dojo', "道场", '像素画道场', 'scene'),
      d('frame', 'select', "选择界面", '发光的角色选择肖像边框', 'frame'),
      d('frame', 'scan', "扫描线", '可见的阴极射线管屏幕扫描线', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['aura', 'select'] },
    hero: 'priya', also: ['jun'], emblem: ['bolt', 'sparkle'],
  },
  {
    id: 'fantasy', name: "奇幻剑客", cat: 'role', hot: 2, isNew: true,
    line: "衣袂飘扬、落叶纷飞，雾中一柄剑。", hook: "下一段冒险正在等你。",
    theme: { dark: true, bg: '#0f1712', bg2: '#22352b', surface: '#16211b', ink: '#eef3ea', soft: '#9fb3a2', accent: '#7fc8a0', accent2: '#e0b45a', onAccent: '#0b140f', glow: 'rgba(127,200,160,.45)', line: 'rgba(224,180,90,.22)', radius: '6px', display: 'serif', deco: 'mist', frame: 'scroll' },
    live: live({ grade: [.98, 1.03, .96], sat: .78, contrast: 1.15, edge: .2, smooth: .45, warmth: .05, vignette: .45, bloom: .12, overlay: 'bamboo', sticker: 'woven-hat' }),
    prompt: '把这个人变成电影奇幻冒险中的持剑英雄：层叠的长袍在风中翻飞，肩后露出剑柄，头发随风飘扬；置身薄雾竹林与远山峭壁之间，伴随飘落的树叶，采用富于动感的电影构图、带一点水墨意味的绘画写实风格。仍清楚保留本人特征。',
    details: [
      d('acc', 'hat', "斗笠", '带薄纱的竹编斗笠'),
      d('acc', 'sword', "长剑", '以优雅姿态手持长剑'),
      d('light', 'mist', "晨雾", '柔和的晨雾与穿透云雾的光束'),
      d('light', 'moon', "月光", '清冷月光与萤火虫'),
      d('scene', 'bamboo', "竹林", '高耸的雾中竹林', 'scene'),
      d('scene', 'cliff', "悬崖边", '云海上方的悬崖边缘', 'scene'),
      d('frame', 'ink', "水墨边缘", '逐渐化为水墨笔触的边缘', 'frame'),
      d('frame', 'scroll', "卷轴装裱", '以挂轴装裱环绕肖像', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 80, details: ['mist', 'bamboo'] },
    hero: 'jun', also: ['priya'], emblem: ['bamboo', 'sparkle'],
  },

  // ───────────── 奇幻 ─────────────
  {
    id: 'princess', name: "童话公主", cat: 'dream', hot: 3,
    line: "粉金光芒、缎带与童话高定服装。", hook: "属于你的童话时刻。",
    theme: { dark: false, bg: '#fff3f6', bg2: '#ffd9e5', surface: '#fff7f9', ink: '#5a2338', soft: '#a2687d', accent: '#ec6d9b', accent2: '#c9a25a', onAccent: '#ffffff', glow: 'rgba(236,109,155,.42)', line: 'rgba(201,162,90,.35)', radius: '999px 999px 24px 24px', display: 'serif', deco: 'hearts', frame: 'arch' },
    live: live({ grade: [1.05, .97, 1.01], sat: 1.06, contrast: .98, lift: .04, warmth: .08, smooth: .7, bloom: .22, vignette: .14, overlay: 'hearts', sticker: 'tiara' }),
    prompt: '将这个人重绘为童话公主的高定肖像：采用柔和的淡粉与香槟金色板，梦幻的粉彩绘画质感，皮肤明亮、笔触细腻，呈现浪漫、甜美而精致的气质。',
    details: [
      d('acc', 'tiara', "珍珠冠", '精巧的珍珠与玫瑰金头冠'),
      d('acc', 'bows', "缎带蝴蝶结", '缎带蝴蝶结'),
      d('light', 'glow', "粉金光晕", '柔和的粉金色光晕'),
      d('light', 'hearts', "爱心闪光", '漂浮的小爱心与闪光'),
      d('scene', 'roses', "玫瑰花园", '盛放的玫瑰花园', 'scene'),
      d('scene', 'ballroom', "水晶舞厅", '烛光照耀的水晶舞厅', 'scene'),
      d('frame', 'arch', "拱形边框", '围绕肖像的优雅玫瑰金拱形边框，缠绕攀援玫瑰', 'frame'),
      d('frame', 'lace', "蕾丝边框", '精致的蕾丝边框', 'frame'),
    ],
    defaults: { ...base, strength: 75, likeness: 85, beauty: 50, details: ['tiara', 'bows', 'hearts', 'roses', 'arch'] },
    hero: 'nur', also: ['priya'], emblem: ['bow', 'heart'],
  },
  {
    id: 'gothic', name: "暗夜哥特", cat: 'dream', hot: 2,
    line: "天鹅绒暗影、银饰与彩绘玻璃光影。", hook: "一点午夜的神秘。",
    theme: { dark: true, bg: '#110a16', bg2: '#2a1534', surface: '#1b1121', ink: '#efe6f5', soft: '#a993b8', accent: '#a46bff', accent2: '#cfd2df', onAccent: '#ffffff', glow: 'rgba(164,107,255,.45)', line: 'rgba(207,210,223,.2)', radius: '60% 60% 14px 14px / 30% 30% 14px 14px', display: 'gothic', deco: 'thorns', frame: 'gothic' },
    live: live({ grade: [.98, .9, 1.08], sat: .75, contrast: 1.25, smooth: .5, vignette: .65, bloom: .15, overlay: 'gothic', sticker: 'gothic-crown' }),
    prompt: '将这个人重绘为暗黑哥特肖像：深沉的天鹅绒梅紫与黑色，华丽的古董银饰，戏剧化的烛光，带有情绪感的绘画式明暗对照，优雅、神秘且冷峻。',
    details: [
      d('acc', 'choker', "银色颈圈", '华丽的银丝细工颈圈'),
      d('acc', 'veil', "蕾丝面纱", '黑色蕾丝面纱头饰'),
      d('light', 'candle', "烛光", '闪烁的烛光'),
      d('light', 'moon', "冷月光", '清冷的蓝色月光'),
      d('scene', 'window', "彩绘玻璃", '哥特式彩绘玻璃玫瑰花窗', 'scene'),
      d('scene', 'hall', "城堡走廊", '幽暗的城堡走廊', 'scene'),
      d('frame', 'silver', "银色画框", '华丽的古董银雕画框', 'frame'),
      d('frame', 'roses', "黑玫瑰", '边缘环绕黑色玫瑰', 'frame'),
    ],
    defaults: { ...base, strength: 75, likeness: 85, beauty: 45, details: ['choker', 'candle', 'window'] },
    hero: 'kai', also: ['priya'], emblem: ['gothic-crown', 'sparkle'],
  },
  {
    id: 'ethereal', name: "空灵水墨", cat: 'dream', hot: 3, isNew: true,
    line: "轻盈墨云、金箔与柔和灯笼光。", hook: "走进画中的梦。",
    theme: { dark: false, bg: '#f5efe2', bg2: '#e9dcc4', surface: '#fbf7ef', ink: '#2a2420', soft: '#7d6e5f', accent: '#c8372d', accent2: '#b8913a', onAccent: '#fff8ef', glow: 'rgba(200,55,45,.35)', line: 'rgba(42,36,32,.16)', radius: '4px', display: 'brush', deco: 'swirlclouds', frame: 'scroll' },
    live: live({ grade: [1.03, .99, .93], sat: .58, contrast: 1.06, lift: .08, warmth: .1, posterize: .2, edge: .35, smooth: .8, grain: .15, bloom: .15, vignette: .25, overlay: 'ink', sticker: 'hair-ornament' }),
    prompt: '将这个人重绘为空灵仙人，以细腻工笔与水墨结合的肖像呈现，并带有精致的现代质感：飘逸的丝绸长袍与半透明纱袖随风浮动，精巧的金色发饰，水墨山峦与旋转云气，点缀朱红漆色与闪耀金箔，温暖的装饰灯笼光，细致优雅的线条，诗意、宁静且明亮。',
    details: [
      d('acc', 'hair-ornament', "金色发饰", '带垂坠珍珠流苏的精美金簪'),
      d('acc', 'fan', "团扇", '手持绘有梅花的圆形丝绸团扇'),
      d('light', 'lantern', "灯笼光", '红色宫灯的温暖光芒'),
      d('light', 'moon', "银色月光", '柔和的银色月光与漂浮光尘'),
      d('scene', 'mountains', "云中山峦", '云海上方的水墨山峦', 'scene'),
      d('scene', 'peach', "花林", '梦幻桃花林，花瓣飘落', 'scene'),
      d('frame', 'scroll', "卷轴边框", '带锦缎边缘的古典挂轴装裱', 'frame'),
      d('frame', 'seal', "朱红点缀", '角落里的小型朱红几何印章与抽象挥毫笔触，不含文字', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 80, beauty: 45, details: ['hair-ornament', 'lantern', 'mountains'] },
    hero: 'mei', also: ['nur'], emblem: ['lantern', 'sparkle'],
  },
  {
    id: 'tarot', name: "星辰塔罗", cat: 'dream', hot: 2, isNew: true,
    line: "新艺术曲线与星辰金色，专属命运牌。", hook: "星光与你很相配。",
    theme: { dark: true, bg: '#120e26', bg2: '#2b1d4f', surface: '#1b1534', ink: '#f6edd8', soft: '#b9a9d6', accent: '#e8c46a', accent2: '#8f7cff', onAccent: '#1a1206', glow: 'rgba(232,196,106,.45)', line: 'rgba(232,196,106,.28)', radius: '18px', display: 'gothic', deco: 'stars', frame: 'tarot' },
    live: live({ grade: [1.04, .98, 1.08], sat: 1.1, contrast: 1.1, posterize: .2, edge: .2, bloom: .3, vignette: .35, overlay: 'tarot' }),
    prompt: '把这个人变成华丽新艺术风格塔罗牌上的人物：优雅流动的装饰线条，头后环绕星辰与月相光环，闪亮的金箔装饰，午夜蓝、紫罗兰与金色的浓郁宝石色调，象征性花卉纹样在身旁盘绕，呈现神秘而华丽的插画。不要可读文字。',
    details: [
      d('acc', 'circlet', "新月头环", '带新月的精致头环'),
      d('acc', 'crystal', "水晶球", '捧着发光的水晶球'),
      d('light', 'halo', "星辰光环", '璀璨的星辰光环'),
      d('light', 'gold', "金箔", '闪耀的金箔高光'),
      d('scene', 'cosmos', "星空宇宙", '带有月相的深邃星空宇宙', 'scene'),
      d('scene', 'garden', "神秘花园", '百合盛开的神秘夜间花园', 'scene'),
      d('frame', 'card', "塔罗边框", '华丽的塔罗牌边框，带空白标题饰框和类似小型罗马数字的装饰，不含可辨读内容', 'frame'),
      d('frame', 'nouveau', "花卉拱门", '以新艺术风格花卉拱门环绕人物', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 80, details: ['halo', 'cosmos', 'card'] },
    hero: 'priya', also: ['kai'], emblem: ['tarot-card', 'sparkle'],
  },

  // ───────────── 动漫 ─────────────
  {
    id: 'anime', name: "动漫主角", cat: 'acg', hot: 3,
    line: "明亮的动漫光影，细腻发丝与灵动双眼。", hook: "主角模式：开启。",
    theme: { dark: false, bg: '#e9f5ff', bg2: '#ffe3f1', surface: '#f7fbff', ink: '#1b2a4a', soft: '#5f7398', accent: '#3b82f6', accent2: '#ff6fa8', onAccent: '#ffffff', glow: 'rgba(59,130,246,.38)', line: 'rgba(27,42,74,.12)', radius: '20px', display: 'sans', deco: 'sparkle', frame: 'poster' },
    live: live({ grade: [1, 1.02, 1.06], sat: 1.25, contrast: 1.05, lift: .05, posterize: .35, edge: .3, smooth: .8, eyes: .25, bloom: .3, vignette: .08, overlay: 'sparkle' }),
    prompt: '手绘校园动漫中的一个宁静瞬间。春日光线穿过樱花树，照进学校走廊。让角色穿着校园日常服装，捕捉其注意到画面外某样事物的一刻。脸部、衣服和景物使用统一的二维赛璐璐语言绘制：轮廓清晰，墨线简洁，阴影形状宽阔而利落。',
    details: [
      d('acc', 'clips', "发夹", '可爱的发夹'),
      d('acc', 'phones', "耳机", '挂在脖子上的耳机'),
      d('light', 'backlit', "逆光发丝", '透过头发的明亮逆光'),
      d('light', 'sparkle', "光点", '空气中的闪亮光点'),
      d('scene', 'summer', "夏日天空", '高远的夏日天空与大片云朵', 'scene'),
      d('scene', 'sakura', "樱花大道", '樱花飘落的大道', 'scene'),
      d('frame', 'poster', "海报构图", '具有电影感的主视觉海报构图', 'frame'),
      d('frame', 'petals', "花瓣边缘", '漂浮的花瓣环绕边缘', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 68, details: ['backlit', 'summer'] },
    hero: 'priya', also: ['aiman'], emblem: ['sparkle', 'sparkle'],
  },
  {
    id: 'toon3d', name: "三维动画", cat: 'acg', hot: 2,
    line: "动画长片级三维角色渲染，柔和明亮。", hook: "下一位动画明星。",
    theme: { dark: false, bg: '#fff5e6', bg2: '#ffe0bd', surface: '#fffaf2', ink: '#3a2412', soft: '#8b6a4c', accent: '#ff9f1c', accent2: '#2ec4b6', onAccent: '#2a1600', glow: 'rgba(255,159,28,.4)', line: 'rgba(58,36,18,.12)', radius: '28px', display: 'round', deco: 'orbs', frame: 'circle' },
    live: live({ grade: [1.04, 1.01, .98], sat: 1.15, contrast: 1.02, lift: .04, warmth: .12, smooth: 1, eyes: .3, bloom: .3, vignette: .15, overlay: 'orbs' }),
    prompt: '将这个人重塑为大制作三维动画长片的主角（明确呈现动画感，不是照片写实）：讨喜的卡通比例，头部略大，闪亮且富有表现力的大眼睛，以及小巧简化的鼻子；光滑的风格化皮肤带有柔和的次表面散射，雕塑般的风格化发型，温暖的电影照明搭配柔和反弹光，呈现高端动画工作室渲染效果。仍能清晰认出本人。',
    details: [
      d('acc', 'hoodie', "连帽衫", '舒适的连帽衫'),
      d('acc', 'glasses', "圆眼镜", '圆框眼镜'),
      d('light', 'golden', "金色阳光", '温暖的黄金时刻光线'),
      d('light', 'cine', "电影灯光", '电影式三点布光'),
      d('scene', 'town', "绘本小镇", '奇妙的绘本小镇', 'scene'),
      d('scene', 'room', "温馨卧室", '温馨的卧室', 'scene'),
      d('frame', 'circle', "圆形边框", '干净的圆形头像徽章', 'frame'),
      d('frame', 'poster', "海报构图", '电影海报构图', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 62, details: ['golden', 'town'] },
    hero: 'jun', also: ['nur'], emblem: ['sparkle', 'heart'],
  },
  {
    id: 'magical', name: "魔法少女", cat: 'acg', hot: 3,
    line: "星星魔杖、缎带蝴蝶结与耀眼变身。", hook: "让魔法开始吧！",
    theme: { dark: false, bg: '#fbefff', bg2: '#ffd6f1', surface: '#fff8ff', ink: '#4a1f5c', soft: '#9a6cad', accent: '#e05cc4', accent2: '#7b8cff', onAccent: '#ffffff', glow: 'rgba(224,92,196,.45)', line: 'rgba(123,140,255,.3)', radius: '34px', display: 'round', deco: 'stars', frame: 'magic' },
    live: live({ grade: [1.04, .98, 1.06], sat: 1.2, contrast: 1, lift: .06, posterize: .4, edge: .25, smooth: .9, eyes: .3, bloom: .4, vignette: .1, overlay: 'magic', sticker: 'magic-tiara' }),
    prompt: '把这个人变成正在变身的九十年代风格魔法少女动漫女主角，采用原创设计：带褶边的粉彩魔法服装，配大蝴蝶结与多层衬裙、镶宝石的星形头冠、闪亮的爱心与星星魔杖；闪耀星辰和光带环绕旋转，巨大的明亮动漫眼睛，头发被魔法托起。采用手绘二维赛璐璐阴影动漫效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'wand', "星星魔杖", '手持镶宝石的星形魔杖'),
      d('acc', 'bow', "醒目蝴蝶结", '胸前的巨型缎带蝴蝶结'),
      d('light', 'transform', "变身光芒", '环绕人物旋转的耀眼变身光芒'),
      d('light', 'stardust', "星光闪粉", '闪耀星尘与小爱心'),
      d('scene', 'moon', "月亮与星星", '繁星夜空中一弯巨大的发光新月', 'scene'),
      d('scene', 'clouds', "粉色云海", '日落时的粉彩粉色云海', 'scene'),
      d('frame', 'moonframe', "星月边框", '由新月和星星组成的华丽边框', 'frame'),
      d('frame', 'hearts', "爱心闪粉", '由闪亮爱心与亮片组成的边框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, beauty: 50, details: ['wand', 'transform', 'moon'] },
    hero: 'priya', also: ['nur'], emblem: ['magic-tiara', 'sparkle'],
  },
  {
    id: 'shonen', name: "热血少年", cat: 'acg', hot: 3,
    line: "爆发能量、速度线与最终决战画面。", hook: "拼尽全力！",
    theme: { dark: true, bg: '#120c1c', bg2: '#3a1410', surface: '#1c1420', ink: '#fff3e6', soft: '#d8b39a', accent: '#ff6a1a', accent2: '#ffd23f', onAccent: '#1a0a00', glow: 'rgba(255,106,26,.55)', line: 'rgba(255,210,63,.25)', radius: '6px', display: 'comic', deco: 'flames', frame: 'slash' },
    live: live({ grade: [1.08, 1, .92], sat: 1.25, contrast: 1.25, posterize: .45, edge: .5, smooth: .6, rim: [1, .42, .1, 1, .82, .25], vignette: .45, overlay: 'aura', sticker: 'fight-band' }),
    prompt: '将这个人重绘为热血战斗少年动漫中的英雄，采用原创角色：坚定炯炯的目光、随风飞扬的头发，炽热的能量火焰气场在周围爆发；使用动态速度线、戏剧化低机位的最终决战关键帧、大胆墨线与有冲击力的赛璐璐阴影。采用二维动漫效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'band', "英雄头带", '额头系着红色布头带，长尾随风飘扬'),
      d('acc', 'cape', "战斗披风", '饱经战斗的披风在风中翻飞'),
      d('light', 'aura', "炽热气场", '炽热的金色能量气场'),
      d('light', 'thunder', "雷电光", '噼啪闪烁的蓝色闪电'),
      d('scene', 'ruins', "战场废墟", '尘土升起的破败战场', 'scene'),
      d('scene', 'roof', "日落屋顶", '血红夕阳下的屋顶', 'scene'),
      d('frame', 'slash', "斩击边框", '划过画面边缘的锐利剑斩痕迹', 'frame'),
      d('frame', 'panel', "漫画画格", '富于动感的漫画分格排版边框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['band', 'aura', 'ruins'] },
    hero: 'aiman', also: ['jun'], emblem: ['fight-band', 'bolt'],
  },
  {
    id: 'handdrawn', name: "手绘时光", cat: 'acg', hot: 3,
    line: "手绘的夏天，有风、有云，也有你。", hook: "跟随夏日微风。",
    theme: { dark: false, bg: '#eef6e6', bg2: '#cfe8f5', surface: '#fbfcf4', ink: '#2c3b2a', soft: '#6f8466', accent: '#4f9a5a', accent2: '#e8a34a', onAccent: '#ffffff', glow: 'rgba(79,154,90,.35)', line: 'rgba(44,59,42,.14)', radius: '20px', display: 'serif', deco: 'clouds', frame: 'paper' },
    live: live({ grade: [1.02, 1.04, .98], sat: 1.12, contrast: .95, lift: .08, warmth: .12, posterize: .35, edge: .18, smooth: .85, bloom: .2, vignette: .12, overlay: 'breeze', sticker: 'straw-hat' }),
    prompt: '将这个人重绘为温柔手绘二维动画电影中的角色：柔和的水粉与水彩背景，郁郁葱葱的夏日乡野，高耸蓬松的积云，温暖怀旧的光线，简洁且富于表现力的动漫五官与柔和赛璐璐阴影，充满绘画感与暖意。采用二维动漫效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'hat', "草帽", '带红色缎带的草帽'),
      d('acc', 'dandelion', "蒲公英", '吹着蒲公英，种子随微风飘散'),
      d('light', 'summer', "夏日阳光", '斑驳的夏日阳光'),
      d('light', 'fireflies', "萤火虫", '黄昏中柔和发光的萤火虫'),
      d('scene', 'fields', "乡间田野", '绿色稻田与小小的乡村公交站', 'scene'),
      d('scene', 'seaside', "海滨小镇", '阳光中的海滨小镇，带红屋顶与灯塔', 'scene'),
      d('frame', 'paper', "水彩边缘", '柔和的水彩边缘逐渐融入纸张', 'frame'),
      d('frame', 'cel', "胶片画框", '复古的动画赛璐璐画框', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 70, details: ['summer', 'fields', 'paper'] },
    hero: 'nur', also: ['mei'], emblem: ['straw-hat', 'sparkle'],
  },
  {
    id: 'vtuber', name: "虚拟主播", cat: 'acg', hot: 2,
    line: "动漫角色插画、双色头发与直播光芒。", hook: "大家好，开播啦！",
    theme: { dark: false, bg: '#eefbff', bg2: '#ffe0f4', surface: '#f8fdff', ink: '#1d2550', soft: '#6a73a8', accent: '#ff4fa3', accent2: '#29d3ff', onAccent: '#ffffff', glow: 'rgba(41,211,255,.45)', line: 'rgba(29,37,80,.12)', radius: '24px', display: 'tech', deco: 'sparkle', frame: 'stream' },
    live: live({ grade: [1, 1.02, 1.06], sat: 1.25, contrast: 1.04, lift: .06, posterize: .4, edge: .28, smooth: 1, eyes: .4, bloom: .3, vignette: .06, overlay: 'stream', sticker: 'cat-headset' }),
    prompt: '把这个人变成虚拟主播动漫形象：精致的 Live2D（二维角色动画）风格动漫角色插画，带闪亮大眼睛，色彩丰富的双色头发与鲜艳挑染，可爱的猫耳游戏耳机配麦克风，赛博流行偶像服装；以柔和霓虹光营造发光的直播氛围，采用干净的赛璐璐阴影。采用二维动漫效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'headset', "猫耳耳机", '发光的猫耳游戏耳机'),
      d('acc', 'streak', "双色挑染", '带鲜艳挑染的双色头发'),
      d('light', 'ring', "直播灯光", '眼中柔和的环形灯光晕'),
      d('light', 'sparkle', "星星闪光", '小星星与爱心闪光'),
      d('scene', 'room', "主播房间", '带发光二极管灯光的温馨主播房间', 'scene'),
      d('scene', 'stage', "赛博舞台", '全息偶像舞台', 'scene'),
      d('frame', 'stream', "直播边框", '带漂浮爱心的可爱直播叠加边框，不含可读文字', 'frame'),
      d('frame', 'card', "角色卡", '带粉彩渐变的角色卡边框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, beauty: 50, details: ['headset', 'streak', 'room'] },
    hero: 'kai', also: ['priya'], emblem: ['cat-headset', 'heart'],
  },
  {
    id: 'shoujo', name: "少女漫画", cat: 'acg', hot: 3, isNew: true,
    line: "闪亮眼睛、飘落花瓣与温柔漫画恋情。", hook: "一格画面，一次心动。",
    theme: { dark: false, bg: '#fff0f6', bg2: '#f3e3ff', surface: '#fff8fb', ink: '#4d2346', soft: '#a1739a', accent: '#f472b6', accent2: '#a78bfa', onAccent: '#ffffff', glow: 'rgba(244,114,182,.42)', line: 'rgba(77,35,70,.12)', radius: '26px', display: 'serif', deco: 'blossom', frame: 'blossom' },
    live: live({ grade: [1.04, .98, 1.04], sat: 1.1, lift: .1, posterize: .3, edge: .25, smooth: 1, eyes: .35, bloom: .45, vignette: .05, overlay: 'flowers', sticker: 'flower-clip' }),
    prompt: '将这个人重绘为经典少女漫画主角：精致的细线条，带星形高光的巨大闪亮眼睛，飘逸有光泽的头发，身旁浮动玫瑰、泡泡与闪光；柔和的网点阴影，梦幻的粉彩粉红与淡紫色板，浪漫且令人心动。采用二维漫画插画效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'ribbon', "发带", '头发上的缎带'),
      d('acc', 'rose', "玫瑰花束", '手持一支粉玫瑰'),
      d('light', 'stars', "星星眼", '眼中的星形闪光'),
      d('light', 'bubbles', "泡泡光晕", '柔和漂浮的泡泡与发光薄雾'),
      d('scene', 'flowers', "花海", '层层倾泻的玫瑰与百合', 'scene'),
      d('scene', 'school', "学校走廊", '阳光照耀的学校走廊，外面是樱花树', 'scene'),
      d('frame', 'tone', "花卉网点", '带网点花卉的漫画分格边框', 'frame'),
      d('frame', 'lace', "蕾丝爱心", '蕾丝心形暗角', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, beauty: 55, details: ['stars', 'bubbles', 'flowers'] },
    hero: 'nur', also: ['mei'], emblem: ['flower-clip', 'heart'],
  },
  {
    id: 'retro', name: "复古动漫", cat: 'acg', hot: 2, isNew: true,
    line: "怀旧赛璐璐动画、褪色色彩与 VHS（家用录像系统）录像带式日落。", hook: "下集再见。",
    theme: { dark: true, bg: '#1b1230', bg2: '#4a1f3d', surface: '#231839', ink: '#fdeedd', soft: '#c6a6b8', accent: '#ff8a5b', accent2: '#7dd3c0', onAccent: '#1e0d06', glow: 'rgba(255,138,91,.45)', line: 'rgba(253,238,221,.16)', radius: '10px', display: 'mono', deco: 'vhs', frame: 'vhs' },
    live: live({ grade: [1.06, .98, .92], sat: 1.1, contrast: .95, warmth: .1, posterize: .4, edge: .3, smooth: .7, grain: .35, scan: .35, vignette: .35, overlay: 'vhs' }),
    prompt: '将这个人重绘为二十世纪九十年代电视动漫中的角色：手绘赛璐璐动画，色彩略微褪色而怀旧；复古角色设计，头发带大片光泽高光，眼睛棱角锐利；身后城市天际线在日落中发光，带有柔和的模拟 VHS（家用录像系统）录像带模糊、细微胶片颗粒与色彩溢出。采用二维动漫效果（不是照片写实），仍清楚保留本人特征。',
    details: [
      d('acc', 'jacket', "复古夹克", '宽大的复古飞行员夹克'),
      d('acc', 'walkman', "磁带播放器", '磁带播放器的耳机'),
      d('light', 'sunset', "夕阳光", '温暖的橙色夕阳光'),
      d('light', 'glow', "霓虹微光", '柔和的城市霓虹光'),
      d('scene', 'city', "城市日落", '黄昏中的复古城市天际线', 'scene'),
      d('scene', 'train', "列车站台", '日落时安静的列车站台', 'scene'),
      d('frame', 'vhs', "VHS 录像带边框", '边缘带细微的 VHS（家用录像系统）录像带磁迹线，不含可读文字', 'frame'),
      d('frame', 'cel', "动画赛璐璐", '复古的动画赛璐璐画框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 70, details: ['sunset', 'city'] },
    hero: 'kai', also: ['aiman'], emblem: ['cassette', 'sparkle'],
  },

  // ───────────── 氛围 ─────────────
  {
    id: 'ccd', name: "复古数码相机", cat: 'mood', hot: 3,
    line: "早期数码闪光、细腻颗粒与冷色溢光高光。", hook: "2005 年的一次夜出。",
    theme: { dark: true, bg: '#0b0d12', bg2: '#1a1f2b', surface: '#141821', ink: '#eef2f8', soft: '#9aa6b8', accent: '#ff9a2f', accent2: '#9ec9ff', onAccent: '#1a0d00', glow: 'rgba(255,154,47,.45)', line: 'rgba(238,242,248,.14)', radius: '4px', display: 'mono', deco: 'stamp', frame: 'ccd' },
    live: live({ grade: [.96, 1, 1.1], sat: .9, contrast: 1.15, lift: .02, warmth: -.15, grain: .5, bloom: .55, vignette: .55, overlay: 'ccd' }),
    prompt: '二十一世纪初口袋相机拍下的夜出快照。短促闪光捕捉人物安静、不刻意摆拍的一刻，街灯延伸进冷色阴影。加入少量数码颗粒与溢光高光，仿佛小型电荷耦合器件传感器拍摄的效果。让人物穿着适合晚间外出的服装。',
    details: [
      d('acc', 'glitter', "闪粉", '脸颊上的闪粉'),
      d('acc', 'clips', "千禧年发夹", '千禧年风格的蝴蝶发夹'),
      d('light', 'flash', "直射闪光", '生硬的直射闪光'),
      d('light', 'bloom', "高光溢出", '溢出、拖抹的高光'),
      d('scene', 'street', "夜间街道", '夜间街道', 'scene'),
      d('scene', 'party', "派对", '家庭派对', 'scene'),
      d('frame', 'stamp', "日期印记", '右下角带橙色数码相机日期印记，内容为 \'05 11 20', 'frame'),
      d('frame', 'vignette', "暗角", '深重的暗角', 'frame'),
    ],
    defaults: { ...base, strength: 75, likeness: 95, richness: 45, beauty: 20, details: ['flash', 'street', 'stamp'] },
    hero: 'kai', also: ['jun'], emblem: ['sparkle', 'sparkle'],
  },
  {
    id: 'film', name: "清新胶片", cat: 'mood', hot: 2,
    line: "轻盈光线、自然五官与梦幻浅焦。", hook: "把日常片刻留在胶片上。",
    theme: { dark: false, bg: '#f6f2e9', bg2: '#e6eadb', surface: '#fcfaf3', ink: '#2f3527', soft: '#7a8069', accent: '#6f9a6a', accent2: '#d9a06b', onAccent: '#ffffff', glow: 'rgba(111,154,106,.35)', line: 'rgba(47,53,39,.12)', radius: '6px', display: 'serif', deco: 'leaves', frame: 'print' },
    live: live({ grade: [1.03, 1.03, .96], sat: .88, contrast: .88, lift: .12, warmth: .12, grain: .25, bloom: .2, vignette: .15, overlay: 'film' }),
    prompt: '将画面处理成清新通透的胶片照片：使用 35 毫米彩色负片拍摄，柔和的自然日光，轻柔低对比度，奶油般提亮的阴影，细腻微小的颗粒，浅景深与梦幻背景虚化，保留自然骨相和真实皮肤纹理。轻盈、干净、毫不费力。',
    details: [
      d('acc', 'hat', "草帽", '遮阳草帽'),
      d('acc', 'knit', "针织服装", '柔软的针织开衫'),
      d('light', 'sun', "午后阳光", '温暖的午后阳光'),
      d('light', 'haze', "逆光光晕", '逆光镜头薄雾'),
      d('scene', 'sea', "海边", '安静的海边', 'scene'),
      d('scene', 'lane', "林荫小巷", '树荫笼罩的小巷', 'scene'),
      d('frame', 'sprocket', "胶片边框", '带齿孔的 35 毫米胶片边框', 'frame'),
      d('frame', 'print', "相纸边框", '带白边的照片冲印效果', 'frame'),
    ],
    defaults: { ...base, strength: 65, likeness: 95, richness: 45, beauty: 25, details: ['sun', 'lane'] },
    hero: 'nur', also: ['aiman'], emblem: ['sparkle', 'sparkle'],
  },
  {
    id: 'neon', name: "赛博霓虹", cat: 'mood', hot: 3,
    line: "品红与青色轮廓光，雨夜霓虹城市散景。", hook: "欢迎来到霓虹之夜。",
    theme: { dark: true, bg: '#07060f', bg2: '#1d0b2e', surface: '#120d1f', ink: '#f4f0ff', soft: '#a99cc8', accent: '#ff2bd6', accent2: '#22e6ff', onAccent: '#ffffff', glow: 'rgba(255,43,214,.5)', line: 'rgba(34,230,255,.25)', radius: '12px', display: 'tech', deco: 'neon', frame: 'neon' },
    live: live({ grade: [.95, .9, 1.12], sat: 1.2, contrast: 1.25, rim: [1, .17, .84, .13, .9, 1], scan: .15, grain: .2, bloom: .35, vignette: .5, overlay: 'rain' }),
    prompt: '刚下过雨、仍然湿润的城市街道。人物走过光线时，青色与品红色反光沿着高领机能夹克流动。让金属上的雨水、深色剪影以及远处街招的光芒共同讲述故事。使用电影感对比度和克制的胶片颗粒。',
    details: [
      d('acc', 'chrome', "科技耳饰", '镀铬科技耳饰'),
      d('acc', 'tattoo', "发光纹身", '微微发光的电路纹身'),
      d('light', 'rim', "品红与青色", '强烈的品红与青色轮廓光'),
      d('light', 'rain', "雨水反光", '映出霓虹的雨滴'),
      d('scene', 'street', "雨中街道", '雨中的霓虹街道', 'scene'),
      d('scene', 'roof', "屋顶", '发光巨型都市上方的屋顶', 'scene'),
      d('frame', 'tube', "霓虹边框", '发光的霓虹灯管边框', 'frame'),
      d('frame', 'glitch', "故障效果", '故障扫描线与红绿蓝通道分离', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 85, details: ['rim', 'rain', 'street'] },
    hero: 'aiman', also: ['kai'], emblem: ['neon-heart', 'neon-heart'],
  },
  {
    id: 'retrocinema', name: "复古电影", cat: 'mood', hot: 3, isNew: true,
    line: "温暖钨丝光、红绿霓虹与怀旧胶片模糊。", hook: "这一刻属于电影。",
    theme: { dark: true, bg: '#140b0b', bg2: '#2b1414', surface: '#1d1111', ink: '#fbeee2', soft: '#cfa894', accent: '#e8434f', accent2: '#3fd0a0', onAccent: '#ffffff', glow: 'rgba(232,67,79,.45)', line: 'rgba(251,238,226,.15)', radius: '4px', display: 'serif', deco: 'neon', frame: 'cinema' },
    live: live({ grade: [1.08, 1, .9], sat: 1.05, contrast: 1.15, warmth: .25, grain: .45, bloom: .35, vignette: .55, rim: [1, .2, .2, .2, .8, .6], overlay: 'cinema' }),
    prompt: '二十世纪九十年代复古都市电影中的一个安静片刻。人物停在钨丝灯暖光与街道红绿霓虹之间。让其穿着符合时代的服装。浓郁的胶片颗粒、光晕以及一丝抽帧印片般的拖影，带出周围夜色的流动。',
    details: [
      d('acc', 'shirt', "花纹衬衫", '宽松的复古花纹衬衫'),
      d('acc', 'specs', "复古墨镜", '小巧的复古有色太阳镜'),
      d('light', 'tungsten', "钨丝灯光", '温暖的钨丝街灯'),
      d('light', 'neon', "红绿霓虹", '红色与绿色霓虹光'),
      d('scene', 'street', "霓虹街道", '霓虹密布的夜间街道', 'scene'),
      d('scene', 'diner', "街坊咖啡馆", '带绿色卡座与瓷砖墙面的复古餐馆', 'scene'),
      d('frame', 'letterbox', "电影宽银幕", '上下带电影宽银幕黑边', 'frame'),
      d('frame', 'blur', "运动拖影", '梦幻的抽帧印片式运动轨迹', 'frame'),
    ],
    defaults: { ...base, strength: 75, likeness: 92, richness: 55, beauty: 25, details: ['tungsten', 'street'] },
    hero: 'jun', also: ['mei'], emblem: ['film-reel', 'sparkle'],
  },

  // ───────────── 艺术 ─────────────
  {
    id: 'oil', name: "古典油画", cat: 'art', hot: 2, isNew: true,
    line: "浓郁明暗对照、肌理笔触与镀金画框。", hook: "准备挂上画廊墙壁。",
    theme: { dark: true, bg: '#17110b', bg2: '#33231a', surface: '#21180f', ink: '#f6ead6', soft: '#c3a885', accent: '#d4a548', accent2: '#8c3b2e', onAccent: '#1b1205', glow: 'rgba(212,165,72,.45)', line: 'rgba(212,165,72,.25)', radius: '3px', display: 'serif', deco: 'canvas', frame: 'gilt' },
    live: live({ grade: [1.06, .98, .86], sat: .85, contrast: 1.2, warmth: .2, smooth: .5, grain: .2, vignette: .75, overlay: 'gilt' }),
    prompt: '将这个人重绘为古典大师风格的油画肖像：厚润的罩染油彩，清晰而果断的笔触与细微龟裂纹；从高窗落下的戏剧性明暗对照光线，深沉温暖的大地色调，幽暗而有氛围的背景，华贵的天鹅绒服装配精巧蕾丝领口，呈现博物馆级纯艺术作品质感。仍清楚保留本人特征。',
    details: [
      d('acc', 'pearl', "珍珠耳饰", '一枚明亮的珍珠耳饰'),
      d('acc', 'lace', "蕾丝领", '挺括的白色蕾丝褶领'),
      d('light', 'window', "天窗光", '来自高窗的柔和光线'),
      d('light', 'candle', "烛光", '温暖的烛光'),
      d('scene', 'dark', "深色背景", '深沉幽暗、富于氛围的背景', 'scene'),
      d('scene', 'landscape', "远处风景", '身后窗外可见柔和的田园风景', 'scene'),
      d('frame', 'gilt', "镀金画框", '华丽的雕刻镀金画框', 'frame'),
      d('frame', 'museum', "画廊墙面", '装在镀金画框中，悬挂于博物馆墙面', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 85, details: ['window', 'dark', 'gilt'] },
    hero: 'aiman', also: ['priya'], emblem: ['paintbrush', 'sparkle'],
  },
  {
    id: 'storybook', name: "绘本故事", cat: 'art', hot: 2, isNew: true,
    line: "水彩晕染与铅笔线条，仿佛来自图画书。", hook: "很久很久以前，有一个可爱的你。",
    theme: { dark: false, bg: '#fbf6ec', bg2: '#f0e6d4', surface: '#fffcf5', ink: '#3b3127', soft: '#8d7c69', accent: '#e07a5f', accent2: '#3d8eb9', onAccent: '#ffffff', glow: 'rgba(224,122,95,.35)', line: 'rgba(59,49,39,.14)', radius: '22px', display: 'serif', deco: 'doodle', frame: 'paper' },
    live: live({ grade: [1.03, 1.02, .96], sat: .95, contrast: .85, lift: .14, posterize: .25, edge: .25, smooth: .8, grain: .25, vignette: .12, overlay: 'doodle' }),
    prompt: '将这个人重绘为温柔儿童图画书中的插画：疏朗的水彩在有肌理的棉纸上晕染，柔和的彩色铅笔线条，奇妙温暖的小细节，轻盈的粉彩色板，舒适而暖心。仍清楚保留本人特征。',
    details: [
      d('acc', 'scarf', "小围巾", '舒适的手织围巾'),
      d('acc', 'balloon', "气球", '手持一束气球'),
      d('light', 'warm', "温暖午后", '温暖的午后光线'),
      d('light', 'stars', "小星星", '人物周围的小型手绘星星'),
      d('scene', 'forest', "绘本森林", '奇妙的绘本森林', 'scene'),
      d('scene', 'town', "彩色小镇", '色彩缤纷的绘本小镇', 'scene'),
      d('frame', 'paper', "水彩纸", '柔和的水彩边缘逐渐融入纸张', 'frame'),
      d('frame', 'doodle', "涂鸦边框", '可爱手绘涂鸦组成的边框', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 75, details: ['warm', 'forest', 'paper'] },
    hero: 'nur', also: ['jun'], emblem: ['flower', 'sparkle'],
  },
  {
    id: 'pop', name: "波普艺术", cat: 'art', hot: 2, isNew: true,
    line: "大胆色块、黑色轮廓与复古印刷网点。", hook: "让画面跳起来！",
    theme: { dark: false, bg: '#fff35c', bg2: '#ff9ec7', surface: '#fffbe6', ink: '#111111', soft: '#4a4a4a', accent: '#ff2d6f', accent2: '#1f6bff', onAccent: '#ffffff', glow: 'rgba(255,45,111,.35)', line: '#111111', radius: '0px', display: 'comic', deco: 'bendays', frame: 'pop' },
    live: live({ sat: 1.6, contrast: 1.35, posterize: .7, edge: .55, halftone: .4, vignette: 0, overlay: 'pop' }),
    prompt: '把这个人变成大胆的二十世纪六十年代波普艺术丝网印刷作品：平涂饱和色块、粗黑轮廓、本戴网点、冲击力强的对比背景，具有鲜明的平面图形感和标志性。仍清楚保留本人特征。不要文字。',
    details: [
      d('acc', 'shades', "亮色墨镜", '色彩鲜艳的复古太阳镜'),
      d('acc', 'gum', "泡泡糖", '吹出一个粉色泡泡糖泡泡'),
      d('light', 'flat', "平涂色彩", '以平涂的图形色块表现明暗'),
      d('light', 'dots', "网点阴影", '本戴网点阴影'),
      d('scene', 'solid', "对比背景", '单一醒目的对比色背景', 'scene'),
      d('scene', 'burst', "漫画爆发", '漫画爆炸式放射背景', 'scene'),
      d('frame', 'grid', "四格印刷", '同一肖像以四种不同配色组成两行两列的网格', 'frame'),
      d('frame', 'thick', "粗黑边框", '粗黑色平面图形边框', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 80, details: ['dots', 'solid'] },
    hero: 'kai', also: ['aiman'], emblem: ['heart', 'bolt'],
  },
  {
    id: 'woodblock', name: "浮世绘版画", cat: 'art', hot: 1, isNew: true,
    line: "雕刻线条、靛蓝与朱红，伴随波浪和云。", hook: "你的肖像，以色彩刻印。",
    theme: { dark: false, bg: '#f3ead6', bg2: '#e2d3b2', surface: '#faf4e6', ink: '#1f2a44', soft: '#6e6a5e', accent: '#2b4c7e', accent2: '#c8462c', onAccent: '#ffffff', glow: 'rgba(43,76,126,.35)', line: 'rgba(31,42,68,.18)', radius: '2px', display: 'brush', deco: 'waves', frame: 'print' },
    live: live({ grade: [1.04, 1, .88], sat: .7, contrast: 1.2, posterize: .65, edge: .5, grain: .25, warmth: .15, vignette: .2, overlay: 'wave' }),
    prompt: '将这个人重绘为传统日本浮世绘木版画：平整的色面、优雅的雕刻轮廓、细微木纹肌理与可见纸纤维；使用靛蓝、朱红和赭石的有限色板，周围环绕风格化波浪与云朵，优美且隽永。仍清楚保留本人特征。不要文字。',
    details: [
      d('acc', 'kanzashi', "发簪", '优雅的发簪'),
      d('acc', 'umbrella', "纸伞", '手持油纸伞'),
      d('light', 'sun', "朱红太阳", '人物身后巨大的朱红色太阳圆盘'),
      d('light', 'snow', "飘雪", '轻柔飘落的雪'),
      d('scene', 'waves', "卷浪", '风格化的卷曲波浪', 'scene'),
      d('scene', 'mountain', "远山", '远处的雪顶山峰', 'scene'),
      d('frame', 'cartouche', "空白饰框", '角落里的装饰性空白饰框，没有可辨读内容', 'frame'),
      d('frame', 'print', "版画留边", '如博物馆版画般宽阔的纸张留边', 'frame'),
    ],
    defaults: { ...base, strength: 85, likeness: 75, details: ['sun', 'waves'] },
    hero: 'jun', also: ['nur'], emblem: ['wave', 'sparkle'],
  },
  {
    id: 'calendar', name: "热带复古", cat: 'art', hot: 2, isNew: true,
    line: "热带复古海报趣味，柔和喷绘与装饰艺术。", hook: "一点三十年代的华美。",
    theme: { dark: false, bg: '#f7eedd', bg2: '#e8d2b0', surface: '#fdf8ee', ink: '#3b2a1e', soft: '#8b6e55', accent: '#b8463a', accent2: '#3e8a7e', onAccent: '#ffffff', glow: 'rgba(184,70,58,.35)', line: 'rgba(59,42,30,.16)', radius: '8px', display: 'serif', deco: 'deco', frame: 'deco' },
    live: live({ grade: [1.06, 1, .92], sat: .9, contrast: .9, lift: .1, warmth: .2, smooth: 1, bloom: .25, grain: .2, vignette: .3, overlay: 'deco' }),
    prompt: '将这个人重绘为受二十世纪三十年代新加坡启发的热带海报画：柔和喷绘水粉与明亮红润的皮肤，优雅的当年复古服装（飘逸长裙、刺绣上衣或利落西装，选择适合人物的一种），装饰艺术纹样，柔和粉彩花园或阳台背景中带有热带植物，怀旧而华美。保留人物佩戴的眼镜或头部遮盖物。不要文字。',
    details: [
      d('acc', 'fan', "羽毛扇", '手持羽毛扇'),
      d('acc', 'pearls', "珍珠项链", '一长串珍珠'),
      d('light', 'soft', "喷绘柔光", '柔和的喷绘光线'),
      d('light', 'golden', "黄金时刻", '温暖的黄金时刻光晕'),
      d('scene', 'garden', "热带花园", '长有鸡蛋花的茂盛热带花园', 'scene'),
      d('scene', 'balcony', "店屋阳台", '殖民时期店屋的阳台', 'scene'),
      d('frame', 'deco', "装饰艺术边框", '装饰艺术风格的海报边框', 'frame'),
      d('frame', 'aged', "旧纸", '陈旧、略微泛黄的海报纸张', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 85, beauty: 45, details: ['soft', 'garden', 'deco'] },
    hero: 'mei', also: ['priya'], emblem: ['flower', 'sparkle'],
  },
  {
    id: 'heritage', name: "传统花砖", cat: 'art', hot: 3, isNew: true,
    line: "花卉瓷砖、精细刺绣与金色热带点缀。", hook: "用色彩讲述你的故事。",
    theme: { dark: false, bg: '#eef8f3', bg2: '#ffe0e6', surface: '#fbfffd', ink: '#22303a', soft: '#6b7f86', accent: '#e05a7a', accent2: '#2ea39b', onAccent: '#ffffff', glow: 'rgba(224,90,122,.38)', line: 'rgba(34,48,58,.14)', radius: '14px', display: 'serif', deco: 'tiles', frame: 'tiles' },
    live: live({ grade: [1.04, 1, 1.02], sat: 1.2, contrast: 1.05, lift: .05, smooth: .6, bloom: .15, vignette: .15, overlay: 'tiles' }),
    prompt: '将这个人重绘为充满活力的新加坡传统文化肖像：带繁复花卉纹样的粉彩陶瓷砖围绕场景，人物穿着精细刺绣上衣或蜡染衬衫，饰有华丽金胸针与珠绣；身后是色彩缤纷、带木质百叶窗的店屋立面；画面欢快、纹样丰富且精致，以细腻插画呈现。保留人物佩戴的眼镜或头部遮盖物。',
    details: [
      d('acc', 'brooch', "金色胸针", '一组华丽的金色胸针'),
      d('acc', 'beads', "珠绣", '精细的珠绣细节'),
      d('light', 'sun', "热带日光", '明亮的热带日光'),
      d('light', 'warm', "暖色灯笼", '温暖的灯笼光'),
      d('scene', 'shophouse', "店屋街道", '一排粉彩色店屋', 'scene'),
      d('scene', 'garden', "庭院花园", '种有兰花的天井庭院', 'scene'),
      d('frame', 'tiles', "花砖边框", '由粉彩传统花卉瓷砖组成的边框', 'frame'),
      d('frame', 'window', "木窗", '雕刻木质窗框', 'frame'),
    ],
    defaults: { ...base, strength: 80, likeness: 85, details: ['brooch', 'sun', 'shophouse', 'tiles'] },
    hero: 'priya', also: ['mei'], emblem: ['tile', 'flower'],
  },
];

/** 为早期改名或重做的风格保留兼容标识，确保已保存作品仍能打开。 */
const ALIASES = /** @type {Record<string, string>} */ ({ giant: 'hero', robocat: 'robot', ghibli: 'handdrawn' });

/** 虚构示例人物，均由图像模型生成。 */
export const PEOPLE = [
  { id: 'mei', name: '美' }, { id: 'aiman', name: '艾曼' }, { id: 'priya', name: "美 · 抓拍" },
  { id: 'jun', name: '俊' }, { id: 'nur', name: "美 · 窗边光" }, { id: 'kai', name: "美 · 日光" },
];

/** 用户通过文字或参考图创建的风格，保存在其个人空间中。 @type {Preset[]} */
let CUSTOM = [];
/** @param {Preset[]} list */
export function setCustom(list) { CUSTOM = list.filter(p => p && p.id && p.custom); }
export const customStyles = () => CUSTOM.slice();
export const allPresets = () => [...PRESETS, ...CUSTOM];

export const presetById = (/** @type {string} */ id) => {
  const key = ALIASES[id] || id;
  return PRESETS.find(p => p.id === key) || CUSTOM.find(p => p.id === key) || null;
};
/** 存在自定义风格时，分类按钮增加“我的风格”入口。 */
export const categories = () => (CUSTOM.length ? [...CATEGORIES, { id: 'mine', label: "我的风格" }] : CATEGORIES);
/** “精选”交错排列新风格和已有风格，展示不同视觉世界的多样性。 */
const HOT = ['princess', 'ethereal', 'anime', 'hero', 'dragon', 'shoujo', 'neon', 'heritage', 'robot', 'magical', 'retrocinema', 'figure', 'ccd', 'handdrawn', 'shonen', 'clay'];
export const inCategory = (/** @type {string} */ cat) => cat === 'hot'
  ? /** @type {Preset[]} */ (HOT.map(id => PRESETS.find(p => p.id === id)).filter(Boolean))
  : cat === 'mine' ? CUSTOM.slice() : PRESETS.filter(p => p.cat === cat);
export const categoryOf = (/** @type {Preset} */ p) => categories().find(c => c.id === (p.custom ? 'mine' : p.cat)) || CATEGORIES[0];
/** @param {Preset} p @returns {Params} */
export const defaultsOf = p => ({ ...p.defaults, details: [...p.defaults.details] });

/** 选择细节。共享同一个 solo 分组的选项互斥，例如只能选择一个背景。 @param {Preset} p @param {string[]} picked @param {string} id */
export function toggleDetail(p, picked, id) {
  const it = p.details.find(x => x.id === id);
  if (!it) return picked;
  if (picked.includes(id)) return picked.filter(x => x !== id);
  const out = it.solo ? picked.filter(x => p.details.find(y => y.id === x)?.solo !== it.solo || p.details.find(y => y.id === x)?.group !== it.group) : [...picked];
  return [...out, id];
}

const band = (/** @type {number} */ v, /** @type {string[]} */ words) => words[Math.min(words.length - 1, Math.floor(v / (100 / words.length)))];

/** 生成提示词顺序：风格、相似度、强度、细节、美颜、已选附加项、用户备注、构图。tools/make_assets.py 中的素材生成器也使用此函数。 @param {Preset} p @param {Params} params @param {{ format?: 'avatar' | 'portrait' }} [o]
 */
export function promptFor(p, params, o = {}) {
  const out = [p.prompt];
  out.push(band(params.likeness, [
    '从人物身上获得宽泛灵感，让作品形成自己的个性。',
    '将一些熟悉的特征带入新的艺术媒介。',
    '让肖像显现人物本人的特征。',
    '在所选媒介中鲜明地保留人物相貌，使其易于辨认。',
  ]));
  out.push(band(params.strength, [
    '轻柔地运用风格，仍接近真实照片。',
    '清晰但克制地运用风格。',
    '充分而果断地运用风格。',
    '将风格推至极致：大胆、鲜明且富于戏剧性。',
  ]));
  out.push(band(params.richness, [
    '保持干净简约，背景简单且不杂乱。',
    '适量细节。',
    '丰富、精心制作的细节与肌理。',
    '装饰、肌理、光线和背景等各处均布满精细而华丽的细节。',
  ]));
  out.push(band(params.beauty, [
    '在所选媒介中自然地呈现肤色。',
    '让柔光为肤色带来一点暖意。',
    '在所选媒介中让面部呈现柔和明亮的质感。',
    '让肤色呈现与作品相融的精致明亮质感。',
  ]));
  out.push('让场景引导动作与注意方向，视线、下颌、颈部和肩膀形成连续统一的动作，让人物穿着符合场景的服装。');
  const picked = (params.details || []).map(id => p.details.find(x => x.id === id)).filter(Boolean);
  if (picked.length) out.push('包含：' + picked.map(x => /** @type {Detail} */ (x).words).join('; ') + '.');
  const said = String(params.words || '').trim().replace(/[.\u3002\s]+$/, '');
  if (said) out.push('此外，按照人物本人的要求（保留其原话）：' + said + '.');
  out.push(o.format === 'portrait'
    ? '竖幅肖像，为姿态和场景留出舒展空间。'
    : '方形肖像，轮廓清晰，头部周围留出足够空间用于圆形裁剪。');
  const framed = picked.some(x => x?.group === 'frame');
  out.push(framed ? '不要水印，不要签名，不要标志。' : '不要文字，不要字母，不要水印，不要边框。');
  out.push('完整绘制的不透明图像：绝不能出现代表透明背景的棋盘格。');
  return out.join(' ');
}

/** 为作品卡片和创作历史描述当前选择。 @param {Preset} p @param {Params} params */
export function captionOf(p, params) {
  const picked = (params.details || []).map(id => p.details.find(x => x.id === id)?.label).filter(Boolean);
  return [p.name, ...picked.slice(0, 3)].join(' · ');
}

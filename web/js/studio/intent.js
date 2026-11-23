/** 一句话意图识别：把对话里的大白话变成精确的局部修改或风格切换，让“对话”和“局部修改”成为同一件事。
 *  · “把头发染成蓝色”“口红换成草莓红”“加一点蜜桃腮红”“剪个波波头”→ 局部修改：自动选好区域蒙版并即时预览，只改这里，其余像素保持不变；
 *  · “换成公主风”“来个赛博霓虹风格”→ 切换风格；
 *  · 其余（换背景、加小猫、整体氛围……）仍交给整张图的对话编辑。
 *  一句话里有多个分句时，只有每个分句都能识别成局部修改，才整体转为局部修改；否则整句交给对话编辑，避免漏掉要求。 */
import { allPresets } from '../presets.js';

/** @typedef {import('../parts.js').Pick} Pick */
/** @typedef {{ kind: 'region', picks: Pick[] } | { kind: 'style', id: string } | null} Intent */

/** [部位, 触发词, [[选项词, 选项 id], ...], 可选的位置/妆效词] —— 先匹配更具体的部位。 */
const RULES = /** @type {[string, RegExp, [RegExp, string][], [RegExp, number][]?][]} */ ([
  ['lips', /口红|唇色|嘴唇|唇妆|唇釉|咬唇/, [[/草莓/, 'straw'], [/裸/, 'nude'], [/玫瑰|豆沙/, 'rose'], [/蜜桃|珊瑚|橘|橙/, 'peach'], [/浆果|紫红|莓/, 'berry'], [/砖|棕|咖/, 'brick'], [/粉/, 'pink'], [/红/, 'red']],
    [[/哑光|雾面/, 0], [/水亮|水润|亮泽|镜面/, 1], [/丝绒/, 2], [/渐变|咬唇/, 3]]],
  ['blush', /腮红|红晕|脸红/, [[/蜜桃|桃/, 'peach'], [/樱花|粉/, 'sakura'], [/珊瑚|橘|橙/, 'coral'], [/日晒|晒/, 'sunkiss']], [[/若有若无|淡/, 0], [/轻柔|自然/, 1], [/鲜明|浓|明显/, 2]]],
  ['brows', /眉毛|眉型|眉形/, [[/平|一字|韩式/, 'straight'], [/柳叶|弯/, 'willow'], [/野生|羽毛|毛流/, 'feather'], [/挑|高/, 'arch'], [/剑|英气/, 'sword'], [/自然/, 'natural']], [[/淡|柔和/, 0], [/自然/, 1], [/浓|粗/, 2]]],
  ['eyes', /眼线|眼影|睫毛|眼妆/, [[/烟熏/, 'smoky'], [/亮片|闪/, 'glitter'], [/睫毛/, 'lashes'], [/彩色/, 'graphic'], [/桃花|眼影/, 'peach'], [/眼线|猫眼|上挑/, 'wing'], [/淡|素/, 'bare']], [[/淡|柔和/, 0], [/日常/, 1], [/浓|夸张/, 2]]],
  ['bangs', /刘海/, [[/不要|没有|去掉|向后梳|露额头|露出额头/, 'none'], [/空气/, 'air'], [/八字|中分/, 'curtain'], [/齐/, 'blunt'], [/斜|侧分/, 'side'], [/碎/, 'choppy']], [[/短|眉毛上/, 0], [/齐眉/, 1], [/长|盖住眉/, 2]]],
  ['colour', /头发|发色|染发|染成|染个|染一|挑染|发尾/, [[/奶茶/, 'milktea'], [/蜂蜜|金色|金发|亚麻/, 'honey'], [/烟灰|灰/, 'ash'], [/樱花|粉/, 'pink'], [/酒红|红/, 'wine'], [/冰蓝|蓝/, 'blue'], [/薰衣草|香芋|紫/, 'taro'], [/薄荷|绿/, 'mint'], [/蜜桃|橙|橘/, 'peach'], [/铂金|银|白金|白/, 'silver'], [/巧克力|棕|咖啡|茶色/, 'brown'], [/黑/, 'black']],
    [[/挑染/, 1], [/渐变/, 2], [/内层|隐藏/, 3], [/全头|整头/, 0]]],
  ['cut', /发型|剪成|剪个|剪短|留个|换个发型|波浪|卷发|直发|波波|狼尾|丸子头|双马尾|编辫|辫子|寸头|背头|短发/, [[/波浪|卷/, 'waves'], [/长直|直发/, 'straight'], [/齐肩|长波波/, 'lob'], [/波波|短发/, 'bob'], [/狼尾/, 'wolf'], [/精灵|超短/, 'pixie'], [/丸子/, 'bun'], [/双马尾/, 'twin'], [/辫/, 'braid'], [/两段/, 'kpop'], [/背头/, 'slick'], [/寸头/, 'buzz']]],
]);
/** 风格的常用叫法。 */
const STYLE_ALIAS = /** @type {[RegExp, string][]} */ ([[/公主/, 'princess'], [/赛博|霓虹/, 'neon'], [/特摄|英雄|光之/, 'hero'], [/油画/, 'oil'], [/水墨|古风|国风/, 'ethereal'], [/手办|潮玩/, 'figure'], [/黏土|粘土/, 'clay'], [/塔罗/, 'tarot'], [/哥特/, 'gothic'],
  [/魔法少女/, 'magical'], [/动漫|二次元/, 'anime'], [/少女漫/, 'shoujo'], [/热血/, 'shonen'], [/胶片/, 'film'], [/ccd|CCD|数码相机/, 'ccd'], [/波普/, 'pop'], [/浮世绘/, 'woodblock'], [/娘惹|花砖/, 'heritage'], [/绘本/, 'storybook'], [/机甲/, 'pilot'], [/小龙|龙/, 'dragon']]);

/** 没有部位触发词的补充说明（“水亮一点”“露出额头”）并入上一个局部修改；能识别出选项或程度时返回 true。
 *  @param {Pick} k @param {string} s */
function refine(k, s) {
  const rule = RULES.find(r => r[0] === k.part); if (!rule) return false;
  const hit = rule[2].find(([re]) => re.test(s)), t = rule[3]?.find(([re]) => re.test(s));
  if (hit) k.option = hit[1];
  if (t) k.tune = t[1];
  if (hit || t) k.say = (k.say ? k.say + '，' : '') + s;
  return !!(hit || t);
}

/** 一个分句 → 一个局部修改，识别不了返回 null。 @param {string} s @returns {Pick | null} */
function clausePick(s) {
  for (const [part, on, opts, tunes] of RULES) {
    if (!on.test(s)) continue;
    // “头发”类触发词也会出现在嘴唇、腮红的句子里（例如“头发和口红”），前面的规则已优先匹配。
    const hit = opts.find(([re]) => re.test(s));
    if (!hit) return null;
    /** @type {Pick} */ const k = { part, option: hit[1] };
    const t = tunes?.find(([re]) => re.test(s));
    if (t) k.tune = t[1];
    return k;
  }
  return null;
}

/** @param {string} words @returns {Intent} */
export function intentOf(words) {
  const text = String(words || '').trim();
  if (!text) return null;
  // 风格：“换成公主风”“来个赛博霓虹风格”“变成油画”。涉及背景、衣服、妆发时不当作换风格。
  if (/风格|画风|风$|风[。！!，,]|变成|换成|改成/.test(text) && !/背景|衣服|服装|头发|发色|刘海|口红|唇|腮红|眉|眼妆|妆/.test(text)) {
    const exact = allPresets().find(p => !p.custom && text.includes(p.name));
    const alias = STYLE_ALIAS.find(([re]) => re.test(text));
    const id = exact?.id || alias?.[1];
    if (id && (exact || /风格|画风|风$|风[。！!，,]/.test(text) || /^(把?(照片|图片|我|它|这张)?)?(变成|换成|改成|做成)/.test(text))) return { kind: 'style', id };
  }
  const clauses = text.split(/[，,；;。！!\n]|然后|并且|同时|再把|还要|顺便/).map(s => s.trim()).filter(Boolean);
  /** @type {Pick[]} */ const picks = [];
  for (const c of clauses) {
    // 同一分句里“头发染成粉色和口红换成红色”这种写法，按“和/跟/与”再拆一次；拆开后识别不了就整句再试一次。
    const subs = c.split(/和|跟|与|以及/).map(s => s.trim()).filter(Boolean);
    const parts = subs.length > 1 && subs.some(s => !clausePick(s) && !(picks.length && RULES.some(r => r[1].test(s)))) ? [c] : subs;
    for (const s of parts) {
      const k = clausePick(s);
      if (k) { if (!picks.some(p => p.part === k.part)) picks.push({ ...k, say: s }); continue; }
      const prev = picks.at(-1);
      if (prev && !RULES.some(r => r[1].test(s)) && refine(prev, s)) continue;
      return null;
    }
  }
  return picks.length ? { kind: 'region', picks } : null;
}

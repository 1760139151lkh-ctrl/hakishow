/** 实时特效包：每种风格在相机中的完整表现。选中后由渲染器与叠加层共同接管：
 *  美型与美颜（warp / beauty）、妆容（makeup）、背景（bg：场景替换、虚化或原样）、三维挂件（wear，随头部偏航俯仰翻滚）、
 *  可切换造型（variants，点击或动作切换，部分为随机“盲盒”）、动作触发（triggers：张嘴、微笑、挑眉、转头、点击）及配套音效。
 *  预设中原有的实时参数（调色、放大头部等）作为默认值保留。 */
import { presetById } from '../presets.js';

/**
 * 挂件：s 贴纸名；at 挂点；w 宽度（瞳距单位）；dx/dy/dz 沿人脸 X/Y/Z 的偏移；tilt 绕 X 轴后仰角度；spin 平面内旋转；anchor 贴纸图上的挂接点。
 * @typedef {{ s: string, at: 'crown' | 'eyes' | 'brow' | 'nose' | 'lip' | 'mouth' | 'cheeks' | 'chin', w: number, dx?: number, dy?: number, dz?: number, tilt?: number, spin?: number, anchor?: number[] }} Wear
 * @typedef {{ on: 'mouth' | 'smile' | 'brow' | 'turn' | 'tap', fx: string, sfx?: string, hold?: boolean }} Trigger
 * comic：夸张喜剧类特效（大头、漫画反应），其五官放大是笑点本身，不参与智能美型收敛。
 * @typedef {{ comic?: boolean, look?: Record<string, any>, warp?: Record<string, number>, beauty?: Record<string, number>, makeup?: { lip?: number[], blush?: number[] },
 *   bg?: 'scene' | 'blur' | 'none', wear?: Wear[], variants?: Wear[][], random?: boolean, triggers?: Trigger[], hint?: string, whiskers?: boolean, frame?: boolean }} Pack
 */

/** 新贴纸在图上的挂接点（由生成时测量）；旧贴纸默认取底边中点。 */
export const ANCHOR = /** @type {Record<string, number[]>} */ ({
  'glasses-heart': [.5, .47], 'glasses-round': [.5, .49], 'glasses-neon': [.5, .49], 'glasses-star': [.5, .55], halo: [.5, .51],
  'horns-devil': [.5, .15], 'ears-bunny': [.5, .51], 'crown-flower': [.5, .41], beret: [.5, .84], flame: [.49, .58],
  'cheek-heart': [.5, .44], 'star-freckle': [.5, .55], mustache: [.5, .21], 'mask-fox': [.5, .66],
});

const LIP = { rose: [.86, .32, .42, .55], berry: [.62, .1, .26, .7], coral: [.98, .42, .36, .5], red: [.82, .08, .14, .62], plum: [.36, .06, .2, .8], nude: [.78, .45, .42, .4], pink: [.96, .45, .62, .55] };
const BLUSH = { peach: [1, .62, .55, .45], pink: [1, .5, .62, .55], rose: [.95, .45, .5, .4], soft: [1, .66, .66, .3], doll: [1, .42, .55, .75] };

const crown = (/** @type {string} */ s, /** @type {number} */ w, dy = .2, tilt = -14, extra = {}) => /** @type {Wear} */ ({ s, at: 'crown', w, dy, tilt, ...extra });
const glasses = (/** @type {string} */ s, w = 2.35) => /** @type {Wear} */ ({ s, at: 'eyes', w, dz: .32, dy: .02 });
const cheeks = (/** @type {string} */ s, w = .42) => /** @type {Wear} */ ({ s, at: 'cheeks', w, dz: .2 });

/** @type {Record<string, Pack>} */
export const PACKS = {
  // ── 趣味 ──
  dragon: { warp: { eyes: .15, head: .14, wide: .12 }, makeup: { blush: BLUSH.peach }, bg: 'scene', wear: [crown('dragon-hood', 3.4, -.18, -6)],
    triggers: [{ on: 'mouth', fx: 'fire', sfx: 'roar', hold: true }], hint: '张大嘴巴，喷出火焰' },
  bighead: { comic: true, warp: { head: .75, eyes: .22 }, bg: 'scene', random: true,
    variants: [[{ s: 'mustache', at: 'lip', w: 1.55, dz: .45 }, glasses('glasses-round', 2.3)], [crown('beret', 3, .08, -8, { spin: -10 }), glasses('glasses-star', 2.4)], [crown('horns-devil', 3, .55, -10), { s: 'mustache', at: 'lip', w: 1.5, dz: .45 }], [crown('ears-bunny', 2.5, .5, -6), glasses('glasses-heart', 2.35)]],
    triggers: [{ on: 'tap', fx: 'random', sfx: 'boing' }, { on: 'mouth', fx: 'wow', sfx: 'boing' }], hint: '点击屏幕，随机抽一套造型' },
  faceart: { comic: true, warp: { eyes: .65, mouth: .45 }, bg: 'scene', triggers: [{ on: 'mouth', fx: 'wow', sfx: 'boing' }, { on: 'brow', fx: 'sweat', sfx: 'pop' }], hint: '张嘴来个夸张反应，挑眉冒汗' },
  clay: { warp: { eyes: .18, wide: .22 }, beauty: { smooth: .7 }, makeup: { blush: BLUSH.doll }, bg: 'scene', wear: [crown('beanie', 3.05, -.3, -10)],
    triggers: [{ on: 'smile', fx: 'candy', sfx: 'pop' }], hint: '笑一笑，掉落糖果' },
  pet: { warp: { eyes: .2, chin: .12 }, makeup: { blush: BLUSH.pink, lip: LIP.pink }, bg: 'scene', whiskers: true,
    variants: [[crown('cat-ears', 3.2, .12, -10)], [crown('dog-ears', 3.5, -.2, -6)], [crown('ears-bunny', 2.6, .52, -8)]],
    triggers: [{ on: 'turn', fx: 'variant', sfx: 'pop' }, { on: 'tap', fx: 'variant', sfx: 'pop' }, { on: 'smile', fx: 'paws', sfx: 'chime' }], hint: '转转头，切换小动物' },
  // ── 角色 ──
  hero: { warp: { chin: .12 }, bg: 'scene', wear: [crown('hero-visor', 2.45, -.25, -4)], triggers: [{ on: 'mouth', fx: 'beam', sfx: 'zap', hold: true }], hint: '张嘴，释放能量光束' },
  robot: { warp: { eyes: .1, wide: .1 }, bg: 'scene', wear: [crown('robot-antenna', 2.4, .05, -8)], triggers: [{ on: 'mouth', fx: 'beep', sfx: 'beep' }, { on: 'tap', fx: 'bolt', sfx: 'zap' }], hint: '张嘴发出哔哔信号' },
  pilot: { bg: 'scene', wear: [glasses('glasses-neon', 2.5)], triggers: [{ on: 'turn', fx: 'lock', sfx: 'beep' }, { on: 'tap', fx: 'variant', sfx: 'zap' }], variants: [[glasses('glasses-neon', 2.5)], []], hint: '转头锁定目标，点击收起护目镜' },
  figure: { warp: { eyes: .28, head: .25, slim: .2, chin: .12 }, beauty: { smooth: .8, whiten: .2 }, makeup: { blush: BLUSH.soft, lip: LIP.coral }, bg: 'scene', triggers: [{ on: 'smile', fx: 'sparkle', sfx: 'chime' }], hint: '微笑，闪亮登场' },
  arcade: { bg: 'scene', wear: [crown('fight-band', 2.55, -.62, -4)], triggers: [{ on: 'mouth', fx: 'ko', sfx: 'hit' }], hint: '张嘴出招！' },
  fantasy: { warp: { slim: .1 }, bg: 'scene', variants: [[crown('woven-hat', 4.4, -.45, -8)], [{ s: 'mask-fox', at: 'eyes', w: 3.05, dz: .4, dy: -.02 }]],
    triggers: [{ on: 'tap', fx: 'variant', sfx: 'whoosh' }, { on: 'turn', fx: 'leaves', sfx: 'whoosh' }], hint: '点击屏幕戴上狐狸面具，转头落叶纷飞' },
  // ── 奇幻 ──
  princess: { warp: { eyes: .06, slim: .12, chin: .08 }, beauty: { smooth: .3, whiten: .25, rosy: .3 }, makeup: { lip: LIP.rose, blush: BLUSH.pink }, bg: 'scene',
    variants: [[crown('tiara', 2.05, .2, -16)], [crown('crown-flower', 2.7, .16, -12)]],
    triggers: [{ on: 'smile', fx: 'hearts', sfx: 'chime', hold: true }, { on: 'tap', fx: 'variant', sfx: 'magic' }], hint: '微笑，满屏爱心飘起来；点击换花冠' },
  gothic: { warp: { slim: .15, chin: .1 }, beauty: { whiten: .45 }, makeup: { lip: LIP.plum }, bg: 'scene',
    variants: [[crown('gothic-crown', 2.25, .18, -14)], [crown('horns-devil', 3, .55, -10)]],
    triggers: [{ on: 'tap', fx: 'variant', sfx: 'bell' }, { on: 'smile', fx: 'roses', sfx: 'bell' }], hint: '点击换上恶魔角' },
  ethereal: { warp: { slim: .1, chin: .08 }, beauty: { smooth: .4, whiten: .3 }, makeup: { lip: LIP.red, blush: BLUSH.rose }, bg: 'scene', wear: [crown('hair-ornament', 2.2, .05, -10, { dx: .95, spin: 14 })],
    triggers: [{ on: 'turn', fx: 'blossom', sfx: 'chime' }], hint: '转转头，桃花纷飞' },
  tarot: { bg: 'scene', wear: [cheeks('star-freckle', .38)], makeup: { lip: LIP.berry }, triggers: [{ on: 'brow', fx: 'stars', sfx: 'magic' }, { on: 'smile', fx: 'stars', sfx: 'magic' }], hint: '挑眉或微笑，星光闪烁' },
  // ── 动漫 ──
  anime: { warp: { eyes: .3, chin: .25, slim: .2, nose: .2 }, beauty: { smooth: .3 }, makeup: { blush: BLUSH.pink, lip: LIP.pink }, bg: 'scene', triggers: [{ on: 'smile', fx: 'sparkle', sfx: 'chime' }], hint: '微笑，眼中有光' },
  toon3d: { warp: { eyes: .35, head: .2, chin: .2, nose: .15 }, beauty: { smooth: .6 }, makeup: { blush: BLUSH.peach }, bg: 'scene', triggers: [{ on: 'mouth', fx: 'stars', sfx: 'boing' }], hint: '张嘴，星星蹦出来' },
  magical: { warp: { eyes: .28, chin: .18 }, makeup: { blush: BLUSH.pink, lip: LIP.pink }, bg: 'scene', variants: [[crown('magic-tiara', 2.15, .25, -14)], [crown('crown-flower', 2.7, .16, -12), cheeks('cheek-heart', .4)]],
    triggers: [{ on: 'smile', fx: 'transform', sfx: 'magic' }, { on: 'tap', fx: 'variant', sfx: 'magic' }], hint: '微笑，开始变身' },
  shonen: { warp: { chin: .18, eyes: .06 }, bg: 'scene', wear: [crown('fight-band', 2.55, -.62, -4)], triggers: [{ on: 'mouth', fx: 'aura', sfx: 'roar', hold: true }], hint: '张嘴，燃起斗气' },
  handdrawn: { warp: { eyes: .15, chin: .1 }, beauty: { smooth: .4 }, makeup: { blush: BLUSH.soft }, bg: 'scene', wear: [crown('straw-hat', 3.9, -.42, -12)], triggers: [{ on: 'turn', fx: 'leaves', sfx: 'whoosh' }], hint: '转转头，夏风吹过' },
  vtuber: { warp: { eyes: .3, chin: .2, slim: .18 }, beauty: { smooth: .6 }, makeup: { blush: BLUSH.doll, lip: LIP.pink }, bg: 'scene', wear: [crown('cat-headset', 3.75, -1.65, -2)],
    triggers: [{ on: 'smile', fx: 'likes', sfx: 'pop' }, { on: 'mouth', fx: 'hearts', sfx: 'chime' }], hint: '微笑收获点赞' },
  shoujo: { warp: { eyes: .32, slim: .2, chin: .15 }, beauty: { smooth: .5, rosy: .4 }, makeup: { blush: BLUSH.pink, lip: LIP.rose }, bg: 'scene', wear: [crown('flower-clip', 1.9, .02, -10, { dx: .95, spin: 18 })],
    triggers: [{ on: 'brow', fx: 'blossom', sfx: 'chime' }, { on: 'smile', fx: 'sparkle', sfx: 'chime' }], hint: '挑眉，花瓣飘落' },
  retro: { warp: { eyes: .12 }, bg: 'scene', triggers: [{ on: 'tap', fx: 'glitch', sfx: 'zap' }], hint: '点击屏幕，录像带跳帧' },
  // ── 氛围 ──
  ccd: { beauty: { whiten: .25 }, bg: 'none', triggers: [{ on: 'tap', fx: 'flash', sfx: 'shutter' }], hint: '复古 CCD 闪光直出' },
  film: { beauty: { rosy: .2 }, bg: 'blur', hint: '柔焦胶片质感' },
  neon: { bg: 'scene', variants: [[], [glasses('glasses-neon', 2.5)]], triggers: [{ on: 'tap', fx: 'variant', sfx: 'zap' }, { on: 'smile', fx: 'glow', sfx: 'zap' }], hint: '点击戴上霓虹目镜' },
  retrocinema: { bg: 'scene', makeup: { lip: LIP.red }, hint: '港风电影光影' },
  // ── 艺术 ──
  oil: { bg: 'scene', makeup: { lip: LIP.nude } },
  storybook: { bg: 'scene', warp: { eyes: .1 }, makeup: { blush: BLUSH.soft } },
  pop: { bg: 'scene', warp: { eyes: .1 }, makeup: { lip: LIP.red }, variants: [[], [glasses('glasses-star', 2.4)], [glasses('glasses-heart', 2.35)]], random: true,
    triggers: [{ on: 'mouth', fx: 'wow', sfx: 'boing' }, { on: 'tap', fx: 'random', sfx: 'pop' }], hint: '张嘴来一声“砰！”' },
  woodblock: { bg: 'scene', makeup: { lip: LIP.red } },
  calendar: { bg: 'scene', makeup: { lip: LIP.coral, blush: BLUSH.peach }, wear: [crown('crown-flower', 2.7, .16, -12)] },
  heritage: { bg: 'scene', makeup: { lip: LIP.red, blush: BLUSH.rose }, wear: [crown('flower-clip', 1.9, .02, -10, { dx: -.95, spin: -16 })] },
};

/** 合并预设原有的实时参数与特效包。原先的“放大头部 / 放大眼睛 / 磨皮”迁移到网格形变与美颜。 @param {string} id @returns {Pack} */
export function packOf(id) {
  const p = presetById(id), live = /** @type {any} */ (p?.live || {}), pack = PACKS[id] || {};
  const warp = { head: (live.bulge || 0) * .6, eyes: (live.eyes || 0) * .8, ...(pack.warp || {}) };
  const beauty = { smooth: (live.smooth || 0) * .35, ...(pack.beauty || {}) };
  return { ...pack, warp, beauty, look: { ...(pack.look || {}) } };
}
/** 特效包的挂件：有造型变体时取第 k 套。 */
export const wearOf = (/** @type {Pack} */ pack, k = 0) => pack.variants?.length ? pack.variants[((k % pack.variants.length) + pack.variants.length) % pack.variants.length] : pack.wear || [];
export const TRIGGER_WORDS = { mouth: '张嘴', smile: '微笑', brow: '挑眉', turn: '转头', tap: '点击' };

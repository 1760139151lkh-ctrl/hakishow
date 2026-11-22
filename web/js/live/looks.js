/** 全局基础调色（滤镜）：每个滤镜是一个颜色变换函数，运行时烘焙为 64³ 查找表纹理（512×512），在片元着色器中一次采样完成。
 * 也用于实时特效包的配套色调。霓虹描边等需要邻域信息的效果由渲染器的风格层完成，这里只提供对应参数。 */

const clamp = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
const luma = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => r * .299 + g * .587 + b * .114;
/** 柔和 S 曲线：k>0 增强对比，k<0 降低对比。 */
const curve = (/** @type {number} */ x, /** @type {number} */ k) => clamp(x + k * x * (1 - x) * (x - .5) * 4);
const lift = (/** @type {number} */ x, /** @type {number} */ lo, /** @type {number} */ hi = 1) => lo + x * (hi - lo);
const sat = (/** @type {number[]} */ c, /** @type {number} */ s) => { const l = luma(c[0], c[1], c[2]); return c.map(v => clamp(l + (v - l) * s)); };

/** @typedef {(c: number[]) => number[]} Grade */
/** @type {Record<string, { name: string, grade: Grade | null, glow?: number[] }>} */
export const LOOKS = {
  none: { name: '原图', grade: null },
  clear: { name: '清透', grade: ([r, g, b]) => sat([curve(lift(r, .02, 1), .12), curve(lift(g, .03, 1), .12), curve(lift(b, .05, 1), .1)], 1.06) },
  cream: { name: '奶油', grade: ([r, g, b]) => sat([lift(curve(r, -.15), .07, .99) * 1.02, lift(curve(g, -.15), .06, .97), lift(curve(b, -.15), .07, .93)], .9).map(clamp) },
  film: { name: '胶片', grade: ([r, g, b]) => {
    const l = luma(r, g, b), sh = 1 - l;
    return sat([lift(curve(r, .18), .06, .97) + .03 * l - .02 * sh, lift(curve(g, .14), .06, .95) + .01 * sh, lift(curve(b, .1), .1, .88) + .05 * sh - .02 * l], .88).map(clamp);
  } },
  airy: { name: '日系', grade: ([r, g, b]) => sat([lift(curve(r, -.1), .1, 1), lift(curve(g, -.1), .12, 1), lift(curve(b, -.08), .14, 1)], .82).map((v, i) => clamp(v + [-.01, .015, .02][i])) },
  cool: { name: '冷白', grade: ([r, g, b]) => sat([curve(lift(r, .04), .08) * .97, curve(lift(g, .05), .08), curve(lift(b, .08), .08) * 1.03], .92).map(clamp) },
  vintage: { name: '复古', grade: ([r, g, b]) => {
    const l = luma(r, g, b);
    return [clamp(lift(mix(r, l, .45), .1, .92) + .07), clamp(lift(mix(g, l, .45), .08, .88) + .03), clamp(lift(mix(b, l, .45), .1, .78))];
  } },
  mono: { name: '黑白', grade: ([r, g, b]) => { const l = curve(luma(r * 1.05, g, b * .9), .35); return [l, l, l]; } },
  thermal: { name: '热成像', grade: ([r, g, b]) => {
    const l = curve(luma(r, g, b), .2);
    const stops = [[0, 0, .08], [.18, 0, .5], [.55, 0, .62], [.9, .12, .2], [1, .55, 0], [1, .9, .2], [1, 1, .95]];
    const t = l * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    return stops[i].map((v, k) => mix(v, stops[i + 1][k], f));
  } },
  neon: { name: '霓虹描边', grade: ([r, g, b]) => sat([r * .55, g * .5, b * .7], 1.2).map(clamp), glow: [1, .2, .85, .95] },
};
export const LOOK_ORDER = ['none', 'clear', 'cream', 'film', 'airy', 'cool', 'vintage', 'mono', 'thermal', 'neon'];

const cache = new Map();
/** 将调色函数烘焙为 512×512 RGBA 像素（8×8 格，每格 64×64，蓝色通道逐格递增）。 @param {string} id */
export function lutPixels(id) {
  if (cache.has(id)) return cache.get(id);
  const fn = LOOKS[id]?.grade;
  if (!fn) return null;
  const px = new Uint8Array(512 * 512 * 4);
  for (let bz = 0; bz < 64; bz++) {
    const tx = (bz % 8) * 64, ty = Math.floor(bz / 8) * 64;
    for (let gy = 0; gy < 64; gy++) for (let rx = 0; rx < 64; rx++) {
      const out = fn([rx / 63, gy / 63, bz / 63]);
      const o = ((ty + gy) * 512 + tx + rx) * 4;
      px[o] = Math.round(clamp(out[0]) * 255); px[o + 1] = Math.round(clamp(out[1]) * 255); px[o + 2] = Math.round(clamp(out[2]) * 255); px[o + 3] = 255;
    }
  }
  cache.set(id, px);
  return px;
}

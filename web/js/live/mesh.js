/** 人脸网格形变（美型）：以 MediaPipe 规范网格的 854 个三角形为骨架，补上双眼与口腔的空洞，再向外扩展三圈过渡环到头发与颈部。
 * 形变在人脸局部坐标（以瞳距为单位、去除翻滚）中计算平滑位移场：瘦脸、V 脸、大眼、瘦鼻、大头、长脸等，
 * 最外圈位移为零，因此与未形变画面无缝衔接；网格顶点同时携带皮肤、嘴唇、腮红权重，供磨皮与上妆使用。 */

export const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYE_R = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];   // 画面左侧的眼睛，虹膜中心 468
const EYE_L = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];   // 画面右侧的眼睛，虹膜中心 473
const LIP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const RINGS = [1.3, 1.75, 2.4], RING_W = [.6, .22, 0];
const N = 478, NR = OVAL.length;
/** 顶点布局：pos.xy（裁剪空间）、uv.xy（视频纹理）、skin、lip、blush、spare。 */
export const STRIDE = 8;

/** eyesFx：喜剧特效的五官放大，不参与智能收敛。 @typedef {{ slim: number, chin: number, eyes: number, nose: number, head: number, long: number, wide: number, mouth: number, jaw: number, eyesFx?: number }} Warp */
export const NO_WARP = /** @type {Warp} */ ({ slim: 0, chin: 0, eyes: 0, nose: 0, head: 0, long: 0, wide: 0, mouth: 0, jaw: 0, eyesFx: 0 });
const clamp01 = (/** @type {number} */ v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
/** 智能美型：眼睛本来就大（睁眼高度 ≥ 瞳距的 17.5%）时几乎不再放大；脸本来就窄（下颌宽 ≤ 1.48 瞳距）时少瘦脸。
 *  阈值来自六位示例人物的实测（睁眼 0.08–0.17，下颌 1.58–1.74 瞳距）。 */
const EYE_FULL = .175, EYE_SPAN = .07, JAW_SLIM = 1.48, JAW_SPAN = .25;

/** 由连线表重建三角形，并补齐空洞与过渡环。 @param {{ start: number, end: number }[]} edges */
export function buildTopology(edges) {
  /** @type {Map<number, Set<number>>} */ const adj = new Map();
  const link = (/** @type {number} */ a, /** @type {number} */ b) => { if (!adj.has(a)) adj.set(a, new Set()); /** @type {Set<number>} */ (adj.get(a)).add(b); };
  for (const { start: a, end: b } of edges) { link(a, b); link(b, a); }
  const seen = new Set(), face = [];
  for (const { start: a, end: b } of edges) for (const c of adj.get(a) || []) {
    if (!adj.get(b)?.has(c)) continue;
    const t = [a, b, c].sort((x, y) => x - y), key = t.join(',');
    if (seen.has(key)) continue; seen.add(key); face.push(...t);
  }
  const ring = (/** @type {number} */ k, /** @type {number} */ i) => N + k * NR + (i % NR);
  const MOUTH = N + RINGS.length * NR, DUP = MOUTH + 1, COUNT = DUP + LIP_IN.length;
  const idx = [];
  // 过渡环先画，人脸三角形覆盖其上。
  for (let k = RINGS.length - 1; k >= 0; k--) for (let i = 0; i < NR; i++) {
    const a = k === 0 ? OVAL[i] : ring(k - 1, i), b = k === 0 ? OVAL[(i + 1) % NR] : ring(k - 1, i + 1), c = ring(k, i + 1), d = ring(k, i);
    idx.push(a, b, c, a, c, d);
  }
  idx.push(...face);
  for (const [eye, iris] of /** @type {[number[], number][]} */ ([[EYE_R, 468], [EYE_L, 473]])) for (let i = 0; i < eye.length; i++) idx.push(iris, eye[i], eye[(i + 1) % eye.length]);
  for (let i = 0; i < LIP_IN.length; i++) idx.push(MOUTH, DUP + i, DUP + (i + 1) % LIP_IN.length);
  return { count: COUNT, index: new Uint16Array(idx), mouth: MOUTH, dup: DUP };
}

const inPoly = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number[][]} */ poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const grow = (/** @type {number[][]} */ poly, /** @type {number} */ k) => {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
};
const sstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 网格生成器：每帧根据人脸状态与形变参数输出顶点数据。 @param {ReturnType<typeof buildTopology>} topo */
export function createMesh(topo) {
  const data = new Float32Array(topo.count * STRIDE);
  const lx = new Float32Array(topo.count), ly = new Float32Array(topo.count), wr = new Float32Array(topo.count);
  /** 顶点的静态属性（皮肤、嘴唇、腮红），在第一帧稳定的人脸上计算一次。 */
  let attrs = /** @type {Float32Array | null} */ (null);
  /** 本人五官的自然尺度（瞳距单位）：睁眼高度与下颌宽度的慢速平均，眨眼帧不计入。 */
  const nat = { open: 0, jaw: 0, n: 0 };
  const adaptive = { eyes: 1, slim: 1, ready: false };

  function classify() {
    const a = new Float32Array(topo.count * 3);
    const poly = (/** @type {number[]} */ ids) => ids.map(i => [lx[i], ly[i]]);
    const eyes = [grow(poly(EYE_R), 1.35), grow(poly(EYE_L), 1.35)], brows = [grow(poly(BROW_R), 1.3), grow(poly(BROW_L), 1.3)];
    const lipOut = poly(LIP_OUT), lipWide = grow(lipOut, 1.18), lipIn = poly(LIP_IN);
    const nostril = [[lx[98], ly[98]], [lx[327], ly[327]]];
    const ovalSet = new Set(OVAL), lipSet = new Set([...LIP_OUT, ...LIP_IN]);
    const cheeks = [[(lx[205] + lx[50]) / 2, (ly[205] + ly[50]) / 2], [(lx[425] + lx[280]) / 2, (ly[425] + ly[280]) / 2]];
    for (let i = 0; i < topo.count; i++) {
      let skin = 0, lip = 0, blush = 0;
      if (i < N) {
        const x = lx[i], y = ly[i];
        const isLip = lipSet.has(i) || (inPoly(x, y, lipOut) && !inPoly(x, y, lipIn));
        lip = isLip ? (LIP_OUT.includes(i) ? .8 : 1) : 0;
        skin = 1;
        if (eyes.some(p => inPoly(x, y, p)) || brows.some(p => inPoly(x, y, p)) || inPoly(x, y, lipWide) || i >= 468) skin = 0;
        else if (nostril.some(([nx, ny]) => Math.hypot(x - nx, y - ny) < .12)) skin = .3;
        else if (ovalSet.has(i)) skin = .55;
        for (const [cx, cy] of cheeks) blush = Math.max(blush, Math.exp(-((x - cx) ** 2 + ((y - cy) * 1.25) ** 2) / (2 * .2 * .2)));
      }
      a[i * 3] = skin; a[i * 3 + 1] = lip; a[i * 3 + 2] = blush;
    }
    return a;
  }

  /**
   * @param {import('./tracker.js').Track} f 人脸状态（视频像素）
   * @param {Warp} w 形变强度（约 0–1）
   * @param {(x: number, y: number) => [number, number]} toClip 视频像素 → 裁剪空间
   */
  function update(f, w, toClip) {
    const p = f.pts, vw = f.vw, vh = f.vh;
    const ox = (p[468 * 3] + p[473 * 3]) / 2, oy = (p[468 * 3 + 1] + p[473 * 3 + 1]) / 2;
    const u = Math.hypot(p[473 * 3] - p[468 * 3], p[473 * 3 + 1] - p[468 * 3 + 1]) || 1;
    const ang = Math.atan2(p[473 * 3 + 1] - p[468 * 3 + 1], p[473 * 3] - p[468 * 3]), ca = Math.cos(ang), sa = Math.sin(ang);
    // 1. 关键点转到局部坐标：x 向右、y 向下，单位为瞳距。
    for (let i = 0; i < N; i++) { const dx = p[i * 3] - ox, dy = p[i * 3 + 1] - oy; lx[i] = (dx * ca + dy * sa) / u; ly[i] = (-dx * sa + dy * ca) / u; wr[i] = 1; }
    // 2. 过渡环：以脸部中心向外扩展，上半部分额外抬高以覆盖头发。
    const cy0 = .45;
    for (let k = 0; k < RINGS.length; k++) for (let j = 0; j < NR; j++) {
      const o = OVAL[j], vi = N + k * NR + j, dx = lx[o], dy = ly[o] - cy0, up = dy < 0 ? 1.12 : 1;
      lx[vi] = dx * RINGS[k]; ly[vi] = cy0 + dy * RINGS[k] * up; wr[vi] = RING_W[k];
    }
    lx[topo.mouth] = (lx[13] + lx[14]) / 2; ly[topo.mouth] = (ly[13] + ly[14]) / 2; wr[topo.mouth] = 1;
    for (let j = 0; j < LIP_IN.length; j++) { lx[topo.dup + j] = lx[LIP_IN[j]]; ly[topo.dup + j] = ly[LIP_IN[j]]; wr[topo.dup + j] = 1; }
    if (!attrs) attrs = classify();
    // 3. 形变场。侧脸时逐渐减弱，避免拉扯。
    const k = Math.max(0, Math.cos(f.yaw)) ** 2 * Math.max(0, Math.cos(f.pitch * 1.4));
    // 智能美型：正脸时更新五官自然尺度，再据此收敛大眼与瘦脸。
    const openNow = ((ly[145] - ly[159]) + (ly[374] - ly[386])) / 2, jawNow = Math.abs(lx[397] - lx[172]);
    if (k > .6 && openNow > 0) {
      if (!nat.n) { nat.open = openNow; nat.jaw = jawNow; }
      else { if (openNow > nat.open * .6) nat.open += (openNow - nat.open) * .04; nat.jaw += (jawNow - nat.jaw) * .04; }
      nat.n++;
    }
    if (nat.n > 0) { adaptive.eyes = clamp01((EYE_FULL - nat.open) / EYE_SPAN, .12); adaptive.slim = clamp01((nat.jaw - JAW_SLIM) / JAW_SPAN, .25); adaptive.ready = true; }
    const eyesW = w.eyes * adaptive.eyes + (w.eyesFx || 0), slimW = w.slim * adaptive.slim, chinW = w.chin * adaptive.slim;
    const eR = [lx[468], ly[468]], eL = [lx[473], ly[473]], mc = [lx[topo.mouth], ly[topo.mouth]];
    const chinY = ly[152], noseY = ly[4];
    for (let i = 0; i < topo.count; i++) {
      let x = lx[i], y = ly[i];
      const r = wr[i];
      const x0 = x, y0 = y;
      if (r > 0) {
        // 大头：整体放大，过渡环逐级衰减。
        if (w.head) { const s = 1 + w.head * .42 * r; x *= s; y = cy0 + (y - cy0) * s; }
        if (w.long) { y = cy0 + (y - cy0) * (1 + w.long * .35 * r); x *= 1 - w.long * .1 * r; }
        if (w.wide) { x *= 1 + w.wide * .4 * r; y = cy0 + (y - cy0) * (1 - w.wide * .12 * r); }
        // 瘦脸：从颧骨以下向内收，越靠外收得越多。
        if (slimW) { const t = sstep(.15, 1.15, y0) * (1 - sstep(1.9, 2.7, y0)); x -= x0 * slimW * .16 * t * Math.min(1, Math.abs(x0) / .85) * r; }
        // V 脸与下巴：下颌收窄，下巴略微延长。
        if (chinW) { const t = sstep(1.05, chinY, y0); x -= x0 * chinW * .14 * t * r; y += chinW * .1 * sstep(1.3, chinY + .1, y0) * r; }
        if (w.jaw) { const t = sstep(.9, 1.7, y0) * (1 - sstep(2.2, 2.8, y0)); x += x0 * w.jaw * .28 * t * r; }
      }
      // 大眼：以虹膜为中心的平滑放大，半径外为零，不会折叠。
      if (eyesW > .001 && i < topo.count) for (const [ex, ey] of [eR, eL]) {
        const dx = x - ex, dy = (y - ey) * 1.25, d = Math.hypot(dx, dy) / .5;
        if (d < 1) { const f2 = 1 + eyesW * .34 * (1 - d * d) ** 2; x = ex + (x - ex) * f2; y = ey + (y - ey) * f2; }
      }
      if (w.mouth) { const dx = x - mc[0], dy = y - mc[1], d = Math.hypot(dx, dy) / .9; if (d < 1) { const f2 = 1 + w.mouth * .45 * (1 - d * d) ** 2; x = mc[0] + dx * f2; y = mc[1] + dy * f2; } }
      // 瘦鼻：鼻翼向中线收拢。
      if (w.nose && Math.abs(x0) < .45 && y0 > .2 && y0 < noseY + .3) x -= x0 * w.nose * .3 * sstep(.2, .6, y0) * (1 - sstep(noseY, noseY + .3, y0));
      x = x0 + (x - x0) * k; y = y0 + (y - y0) * k;
      // 4. 回到视频像素与裁剪空间。
      const vx = ox + (x * ca - y * sa) * u, vy = oy + (x * sa + y * ca) * u;
      const sx = ox + (x0 * ca - y0 * sa) * u, sy = oy + (x0 * sa + y0 * ca) * u;
      const [cx, cy] = toClip(vx, vy), o = i * STRIDE;
      data[o] = cx; data[o + 1] = cy; data[o + 2] = sx / vw; data[o + 3] = sy / vh;
      data[o + 4] = attrs[i * 3]; data[o + 5] = i >= topo.dup ? 0 : attrs[i * 3 + 1]; data[o + 6] = attrs[i * 3 + 2]; data[o + 7] = 0;
    }
    return data;
  }
  return { update, reset() { attrs = null; nat.n = 0; adaptive.eyes = adaptive.slim = 1; adaptive.ready = false; }, get data() { return data; }, get adaptive() { return adaptive; } };
}

/** 相机增强现实叠加层：
 *  · 三维挂件：王冠、眼镜、面具、发箍等贴纸挂在人脸坐标系上，随偏航、俯仰、翻滚产生正确的透视缩放与倾斜（弱透视投影）。
 *  · 动作特效：张嘴喷火、微笑飘爱心、挑眉冒汗、转头切换造型等，由 live.js 的状态机触发；造型切换带弹性动画。
 *  · 风格边框、抬头显示和氛围粒子：位于顶栏与底部面板之间的取景区内；开启场景背景时只保留信息类界面。 */
import { sticker } from '../core/assets.js';
import { presetById } from '../presets.js';
import { packOf, wearOf, ANCHOR } from './effects.js';
import { createFire, createHearts, FIRE_SPRITES } from './particles.js';

const images = new Map();
function img(/** @type {string} */ name) {
  if (!images.has(name)) {
    const src = sticker(name);
    const i = new Image();
    i.decoding = 'async';
    if (src) { i.src = src; i.decode?.().catch(() => {}); }
    images.set(name, i);
  }
  const i = images.get(name);
  return i && (i.complete && i.naturalWidth) ? i : null;
}
/** 提前解码某个特效包用到的全部贴纸，避免切换时卡顿。 */
export function preloadPack(/** @type {string} */ id) {
  const pack = packOf(id);
  for (const set of [pack.wear || [], ...(pack.variants || [])]) for (const w of set) img(w.s);
  for (const n of ['heart', 'sparkle', 'flame', 'candy', 'paw', 'flower', 'bolt', 'star-freckle', 'heart-pink', 'heart-red', 'heart-gold', 'heart-lilac', 'heart-outline', 'twinkle']) img(n);
  if ((pack.triggers || []).some(t => t.fx === 'fire')) for (const n of FIRE_SPRITES) img(n);
}
/** 信息类叠加（抬头显示、直播界面、日期印记等），开启场景背景时仍保留。 */
const HUD = new Set(['energy', 'hud', 'box', 'fight', 'ccd', 'film', 'stream', 'vhs', 'cinema', 'sparkle', 'flowers', 'pop', 'magic']);

/** @typedef {{ x: number, y: number, vx: number, vy: number, s: number, r: number, vr: number, life: number, kind: string, hue?: number }} Bit */
/** @typedef {{ im: HTMLImageElement | null, draw?: string, x: number, y: number, vx: number, vy: number, g: number, s: number, ds: number, r: number, vr: number, a: number, da: number, t: number }} Sprite */

/** 由人脸状态求画布上的投影工具：pt(i) 取关键点，at(base, dx, dy, dz) 沿人脸三轴偏移（瞳距单位）。 */
function poseOf(/** @type {import('./tracker.js').Track} */ f, /** @type {(x: number, y: number) => number[]} */ toCanvas) {
  const P = f.pts, u = f.iod;
  const v3 = (/** @type {number} */ i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const proj = (/** @type {number[]} */ p) => toCanvas(p[0], p[1]);
  const add = (/** @type {number[]} */ p, /** @type {number[]} */ d, /** @type {number} */ k) => [p[0] + d[0] * k * u, p[1] + d[1] * k * u, p[2] + d[2] * k * u];
  const base = {
    crown: v3(10), brow: v3(9), eyes: f.O, nose: v3(4), mouth: [(P[39] + P[42]) / 2, (P[40] + P[43]) / 2, (P[41] + P[44]) / 2], lip: v3(0), chin: v3(152),
    cheekL: v3(205), cheekR: v3(425),
  };
  const o = proj(f.O), ex = proj(add(f.O, f.X, 1)), scale = Math.hypot(ex[0] - o[0], ex[1] - o[1]);
  return { f, u, v3, proj, add, base, scale, pt: (/** @type {number} */ i) => proj(v3(i)) };
}

export function createOverlay(/** @type {HTMLCanvasElement} */ canvas, /** @type {{ punch?: (k: number) => void, look?: (patch: any) => void }} */ hooks = {}) {
  const x = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  /** @type {Bit[]} */ let bits = [];
  /** @type {Sprite[]} */ let sprites = [];
  /** @type {{ kind: string, t0: number, dur: number, side?: number }[]} */ let fxs = [];
  let preset = '', strength = .8, started = performance.now(), scene = false, insetTop = 0, insetBottom = 0, topF = .1, bottomF = .2;
  let pack = packOf(''), variant = 0, popAt = 0, emitAt = 0;
  // 喷火与爱心雨使用独立的粒子系统（particles.js）。
  const flames = createFire(name => img(name)), hearts = createHearts(name => img(name));
  const stamp = (() => { const d = new Date(); return `'${String(d.getFullYear()).slice(2)} ${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}`; })();

  /** @param {import('./tracker.js').Track | null} track @param {number} t @param {(x: number, y: number) => number[]} toCanvas */
  function draw(track, t, toCanvas) {
    const W = canvas.width, H = canvas.height, p = presetById(preset);
    x.clearRect(0, 0, W, H);
    insetTop = topF * H; insetBottom = bottomF * H;
    if (!p) return;
    const k = W / 400;
    const pose = track ? poseOf(track, toCanvas) : null;
    const f = pose ? compat(pose) : null;
    x.save();
    x.globalAlpha = .35 + .65 * strength;
    const ov = p.live.overlay;
    behind(ov, f, t, W, H, k);
    particles(ov, t, W, H, k);
    if (pose && strength > .05) wearAll(pose, t);
    if (f && pack.whiskers) whiskers(f, k);
    if (!scene || HUD.has(ov)) frame(ov, f, t, W, H, k);
    x.restore();
    runFx(pose, t, W, H, k);
    if (flames.active) flames.draw(x, t, W, H);
    if (hearts.active) hearts.draw(x, t, W, H, k, insetTop);
  }
  /** 旧版边框与粒子使用的人脸几何（画布像素）。 */
  function compat(/** @type {ReturnType<typeof poseOf>} */ q) {
    const pt = (/** @type {number} */ i) => { const c = q.pt(i); return { x: c[0], y: c[1] }; };
    const a = pt(468), b = pt(473), [eL, eR] = a.x <= b.x ? [a, b] : [b, a];
    const top = pt(10), chin = pt(152), l = pt(234), r = pt(454);
    return { center: { x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2 }, eyeL: eL, eyeR: eR, nose: pt(4), top, chin, roll: Math.atan2(eR.y - eL.y, eR.x - eL.x),
      width: Math.hypot(r.x - l.x, r.y - l.y), height: Math.hypot(chin.x - top.x, chin.y - top.y) };
  }

  // ───────────── 三维挂件 ─────────────
  function wearAll(/** @type {ReturnType<typeof poseOf>} */ q, /** @type {number} */ t) {
    const set = wearOf(pack, variant);
    const pop = Math.min(1, (t - popAt) / 420), bounce = pop < 1 ? 1 + Math.sin(pop * Math.PI) * .18 * (1 - pop) - (1 - pop) * .35 * (1 - pop) : 1;
    for (const w of set) {
      if (w.at === 'cheeks') { place(q, w, 'cheekL', -1, bounce); place(q, w, 'cheekR', 1, bounce); }
      else place(q, w, w.at, 0, bounce);
    }
  }
  function place(/** @type {ReturnType<typeof poseOf>} */ q, /** @type {import('./effects.js').Wear} */ w, /** @type {string} */ at, /** @type {number} */ side, /** @type {number} */ bounce) {
    const im = img(w.s); if (!im) return;
    const f = q.f, base = /** @type {any} */ (q.base)[at] || f.O;
    const tilt = (w.tilt || 0) * Math.PI / 180, yawK = side ? side * .5 : 0;
    // 平面基向量：X 绕 Y 轴转动（脸颊贴纸顺着脸型侧转），Y 绕 X 轴后仰。
    const X = side ? [f.X[0] * Math.cos(yawK) + f.Z[0] * Math.sin(yawK) * side, f.X[1] * Math.cos(yawK) + f.Z[1] * Math.sin(yawK) * side, 0] : f.X;
    const Y = [f.Y[0] * Math.cos(tilt) + f.Z[0] * Math.sin(tilt), f.Y[1] * Math.cos(tilt) + f.Z[1] * Math.sin(tilt), f.Y[2] * Math.cos(tilt) + f.Z[2] * Math.sin(tilt)];
    let P = q.add(base, f.X, (w.dx || 0) * (side || 1)); P = q.add(P, f.Y, w.dy || 0); P = q.add(P, f.Z, w.dz || 0);
    const o = q.proj(P), ex0 = q.proj(q.add(P, X, 1)), ey0 = q.proj(q.add(P, Y, 1));
    let ex = [ex0[0] - o[0], ex0[1] - o[1]], ey = [ey0[0] - o[0], ey0[1] - o[1]];
    if (w.spin) { const s = w.spin * Math.PI / 180 * (side || 1), c = Math.cos(s), n = Math.sin(s); [ex, ey] = [[ex[0] * c + ey[0] * n, ex[1] * c + ey[1] * n], [ey[0] * c - ex[0] * n, ey[1] * c - ex[1] * n]]; }
    const nw = im.naturalWidth, nh = im.naturalHeight, kk = w.w / nw * bounce;
    const [ax, ay] = w.anchor || ANCHOR[w.s] || [.5, .97];
    x.save();
    x.setTransform(ex[0] * kk, ex[1] * kk, -ey[0] * kk, -ey[1] * kk, o[0], o[1]);
    x.drawImage(im, -ax * nw, -ay * nh, nw, nh);
    x.restore();
  }
  function whiskers(/** @type {any} */ f, /** @type {number} */ k) {
    x.save();
    x.translate(f.nose.x, f.nose.y); x.rotate(f.roll);
    x.fillStyle = '#ff8fab'; x.beginPath(); x.ellipse(0, -f.height * .01, f.width * .05, f.width * .035, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(80,50,50,.55)'; x.lineWidth = 1.6 * k; x.lineCap = 'round';
    for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) {
      x.beginPath(); x.moveTo(side * f.width * .12, f.height * .05 + i * f.height * .035);
      x.quadraticCurveTo(side * f.width * .3, f.height * .04 + i * f.height * .05, side * f.width * .42, f.height * .02 + i * f.height * .08); x.stroke();
    }
    x.restore();
  }


  // ───────────── 动作特效 ─────────────
  /** 触发一个特效；hold 类（喷火、光束、斗气）在动作持续期间每帧调用。 @param {string} kind @param {import('./tracker.js').Track | null} track @param {(x: number, y: number) => number[]} toCanvas */
  function fire(kind, track, toCanvas, now = performance.now()) {
    const q = track ? poseOf(track, toCanvas) : null;
    const W = canvas.width, H = canvas.height, k = W / 400;
    if (kind === 'variant' || kind === 'random' || kind === 'transform') {
      const n = pack.variants?.length || 1;
      variant = kind === 'random' && n > 2 ? (variant + 1 + Math.floor(Math.random() * (n - 1))) % n : variant + 1;
      popAt = now;
      if (q) burstAt(q.proj(q.base.crown), 'sparkle', 10, q.scale * .6, 1);
      if (kind === 'transform') { fxs.push({ kind: 'flash', t0: now, dur: 380 }); if (q) burstAt(q.proj(q.f.O), 'star', 18, q.scale * 1.2, 1.4); }
      return;
    }
    if (!q) { if (kind === 'flash' || kind === 'glitch' || kind === 'ko') fxs.push({ kind, t0: now, dur: kind === 'ko' ? 1100 : 400 }); return; }
    const mouth = q.proj(q.base.mouth), crown = q.proj(q.add(q.base.crown, q.f.Y, .4)), eyes = q.proj(q.f.O);
    switch (kind) {
      case 'fire': {
        // 喷射方向：人脸朝向（投影到画面）与下巴方向的合成，转头时火焰随之偏转；前置镜像由投影自动处理。
        const m3 = q.base.mouth, u = q.scale || 1;
        const pz = q.proj(q.add(m3, q.f.Z, 1)), py = q.proj(q.add(m3, q.f.Y, -1));
        let dx = (pz[0] - mouth[0]) / u * 1.6 + (py[0] - mouth[0]) / u * .85, dy = (pz[1] - mouth[1]) / u * 1.6 + (py[1] - mouth[1]) / u * .85;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const a = q.pt(61), b = q.pt(291);
        flames.hold({ x: mouth[0], y: mouth[1], dx, dy, u, w: Math.hypot(b[0] - a[0], b[1] - a[1]) }, q.f.expr.mouth, now);
        hooks.punch?.(.012);
        return;
      }
      case 'beam': case 'aura':
        if (now - emitAt < 40) return; emitAt = now;
        for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 3) * k; sprites.push({ im: null, draw: kind === 'beam' ? 'ray' : 'ember', x: kind === 'beam' ? mouth[0] : eyes[0], y: kind === 'beam' ? mouth[1] : eyes[1] + q.scale, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'aura' ? 2 * k : 0), g: 0, s: q.scale * (kind === 'beam' ? .25 : .12), ds: q.scale * .01, r: a, vr: 0, a: 1, da: -.035, t: now }); }
        if (!fxs.some(e => e.kind === kind)) fxs.push({ kind, t0: now, dur: 260 });
        else { const e = fxs.find(e2 => e2.kind === kind); if (e) e.t0 = now; }
        hooks.punch?.(kind === 'beam' ? .025 : .015);
        return;
      case 'hearts': {
        const u = q.scale || 1;
        // 出发点在脸的外缘：头顶向上，两侧沿脸颊向外，避免爱心盖住五官。
        const L = q.pt(234), R = q.pt(454), o = q.proj(q.f.O), side = (/** @type {number[]} */ p) => Math.atan2(p[1] - o[1], p[0] - o[0]);
        const up = Math.atan2(crown[1] - o[1], crown[0] - o[0]);
        hearts.fire([{ x: crown[0], y: crown[1], u, dir: up }, { x: L[0], y: L[1], u, dir: side(L) - .35 * Math.sign(Math.cos(side(L))) }, { x: R[0], y: R[1], u, dir: side(R) - .35 * Math.sign(Math.cos(side(R))) }], now);
        return;
      }
      case 'likes': for (let i = 0; i < 8; i++) sprites.push({ im: img('heart'), x: W - 40 * k - Math.random() * 30 * k, y: H - insetBottom - 20 * k, vx: (Math.random() - .5) * 1.2 * k, vy: -(2.5 + Math.random() * 2) * k, g: 0, s: 16 * k, ds: .05 * k, r: 0, vr: (Math.random() - .5) * .04, a: 1, da: -.012, t: now + i * 90 }); return;
      case 'sparkle': for (const e of [q.pt(468), q.pt(473)]) burstAt(e, 'sparkle', 5, q.scale * .7, .7); return;
      case 'stars': case 'transformStars': burstAt(crown, 'star', 14, q.scale * 1.8, 1.1); return;
      case 'paws': burstAt(crown, 'paw', 8, q.scale * 1.4, .9); return;
      case 'candy': for (let i = 0; i < 14; i++) sprites.push({ im: img('candy'), x: Math.random() * W, y: insetTop - 20 * k - Math.random() * 120 * k, vx: (Math.random() - .5) * k, vy: (2 + Math.random() * 2) * k, g: .12 * k, s: (20 + Math.random() * 16) * k, ds: 0, r: Math.random() * 6, vr: (Math.random() - .5) * .1, a: 1, da: -.006, t: now }); return;
      case 'leaves': case 'blossom': case 'roses':
        for (let i = 0; i < 22; i++) sprites.push({ im: kind === 'blossom' || kind === 'roses' ? img('flower') : null, draw: kind === 'leaves' ? 'leaf' : kind === 'roses' ? 'rose' : '', x: Math.random() * W, y: insetTop - Math.random() * 200 * k, vx: (.8 + Math.random() * 1.6) * k * (Math.random() < .5 ? -1 : 1), vy: (1.2 + Math.random() * 1.6) * k, g: 0, s: (12 + Math.random() * 12) * k, ds: 0, r: Math.random() * 6, vr: (Math.random() - .5) * .08, a: 1, da: -.004, t: now + Math.random() * 600 });
        return;
      case 'wow': case 'ko': case 'sweat': case 'lock': case 'beep': case 'glitch': case 'flash':
        fxs = fxs.filter(e => e.kind !== kind);
        fxs.push({ kind, t0: now, dur: kind === 'wow' ? 1400 : kind === 'ko' ? 1100 : kind === 'sweat' ? 1600 : kind === 'lock' ? 1300 : kind === 'beep' ? 1200 : 400, side: Math.sin(q.f.yaw) > 0 ? -1 : 1 });
        if (kind === 'wow' || kind === 'ko') hooks.punch?.(.09);
        return;
      case 'bolt': for (let i = 0; i < 6; i++) sprites.push({ im: img('bolt'), x: crown[0] + (Math.random() - .5) * q.scale * 3, y: crown[1] + (Math.random() - .3) * q.scale * 2, vx: 0, vy: 0, g: 0, s: q.scale * .6, ds: 0, r: (Math.random() - .5) * .8, vr: 0, a: 1, da: -.05, t: now + i * 60 }); fxs.push({ kind: 'flash', t0: now, dur: 200 }); return;
      case 'glow': hooks.look?.({ look: { bloom: .9 } }); setTimeout(() => hooks.look?.({ look: { bloom: presetById(preset)?.live.bloom || 0 } }), 900); burstAt(eyes, 'sparkle', 8, q.scale * 1.4, .8); return;
    }
  }
  function burstAt(/** @type {number[]} */ c, /** @type {string} */ name, /** @type {number} */ n, /** @type {number} */ r, /** @type {number} */ size) {
    const now = performance.now(), k = canvas.width / 400;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * .4, sp = (2.2 + Math.random() * 2.4) * k * (r / 100 + .6);
      sprites.push({ im: name === 'star' ? null : img(name), draw: name === 'star' ? 'star' : '', x: c[0] + Math.cos(a) * r * .25, y: c[1] + Math.sin(a) * r * .25, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2 * k, g: .05 * k, s: (14 + Math.random() * 14) * k * size, ds: .1 * k, r: (Math.random() - .5) * .8, vr: (Math.random() - .5) * .08, a: 1, da: -.018, t: now });
    }
  }
  function runFx(/** @type {ReturnType<typeof poseOf> | null} */ q, /** @type {number} */ t, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    for (const s of sprites) {
      if (s.t > t) continue;
      s.x += s.vx; s.y += s.vy; s.vy += s.g; s.s += s.ds; s.r += s.vr; s.a += s.da;
      if (s.a <= 0) continue;
      x.save(); x.globalAlpha = Math.max(0, Math.min(1, s.a)); x.translate(s.x, s.y); x.rotate(s.r);
      if (s.im) { const h2 = s.s * s.im.naturalHeight / s.im.naturalWidth; x.drawImage(s.im, -s.s / 2, -h2 / 2, s.s, h2); }
      else if (s.draw === 'star') star(s.s * .5, Math.random() < .5 ? '#fff6a8' : '#ffc2ef');
      else if (s.draw === 'ray') { const g = x.createRadialGradient(0, 0, 0, 0, 0, s.s); g.addColorStop(0, 'rgba(220,250,255,.95)'); g.addColorStop(.4, 'rgba(79,215,255,.6)'); g.addColorStop(1, 'rgba(79,215,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, s.s, 0, 7); x.fill(); }
      else if (s.draw === 'ember') { x.fillStyle = Math.random() < .5 ? 'rgba(255,210,63,.95)' : 'rgba(255,106,26,.9)'; x.beginPath(); x.ellipse(0, 0, s.s * .35, s.s, 0, 0, 7); x.fill(); }
      else if (s.draw === 'leaf') { x.fillStyle = 'rgba(120,180,90,.9)'; x.beginPath(); x.ellipse(0, 0, s.s * .5, s.s * .2, 0, 0, 7); x.fill(); }
      else if (s.draw === 'rose') { x.fillStyle = 'rgba(90,10,40,.85)'; x.beginPath(); x.ellipse(0, 0, s.s * .42, s.s * .24, 0, 0, 7); x.fill(); }
      x.restore();
    }
    sprites = sprites.filter(s => s.a > 0 && s.y < H + 200 && s.y > -400);
    fxs = fxs.filter(e => t - e.t0 < e.dur);
    for (const e of fxs) {
      const p = Math.min(1, (t - e.t0) / e.dur), ease = 1 - Math.pow(1 - Math.min(1, p * 4), 3);
      x.save();
      if (e.kind === 'flash') { x.fillStyle = `rgba(255,255,255,${.85 * (1 - p)})`; x.fillRect(0, 0, W, H); }
      else if (e.kind === 'glitch') { for (let i = 0; i < 7; i++) { const y = Math.random() * H, h2 = (6 + Math.random() * 30) * k; x.fillStyle = i % 2 ? 'rgba(62,240,255,.28)' : 'rgba(255,79,216,.28)'; x.fillRect((Math.random() - .5) * 30 * k, y, W, h2); } }
      else if ((e.kind === 'beam' || e.kind === 'aura') && q) { const c = e.kind === 'beam' ? q.proj(q.base.mouth) : q.proj(q.f.O); const r = q.scale * (e.kind === 'beam' ? 2.2 : 3.4); const g = x.createRadialGradient(c[0], c[1], 0, c[0], c[1], r); g.addColorStop(0, e.kind === 'beam' ? 'rgba(200,245,255,.75)' : 'rgba(255,200,80,.0)'); g.addColorStop(.55, e.kind === 'beam' ? 'rgba(79,215,255,.35)' : 'rgba(255,120,30,.32)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      else if (e.kind === 'wow' || e.kind === 'ko') {
        const c = q ? q.proj(q.add(q.base.crown, q.f.X, (e.side || 1) * 1.6)) : [W * .7, H * .3];
        const s = (e.kind === 'ko' ? 1.4 : 1) * (p < .15 ? ease * 1.15 : 1 + .03 * Math.sin(t / 60)) * (p > .85 ? 1 - (p - .85) / .15 : 1);
        x.translate(e.kind === 'ko' ? W / 2 : c[0], e.kind === 'ko' ? insetTop + (H - insetTop - insetBottom) * .3 : c[1]); x.scale(s, s); x.rotate(-.12);
        if (e.kind === 'wow') { burstStar(58 * k, '#ffe14d'); x.fillStyle = '#111'; x.font = `900 ${30 * k}px "HakiSans", system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('哇！', 0, 2 * k); }
        else { x.font = `${86 * k}px VT323, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 8 * k; x.strokeStyle = '#ff3d6e'; x.strokeText('K.O.!', 0, 0); x.fillStyle = '#ffcc00'; x.fillText('K.O.!', 0, 0); }
        if (e.kind === 'wow' && p < .6) { x.setTransform(1, 0, 0, 1, 0, 0); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2 * k; const cx = q ? q.proj(q.f.O)[0] : W / 2, cy = q ? q.proj(q.f.O)[1] : H / 2; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * W * .45, cy + Math.sin(a) * W * .45); x.lineTo(cx + Math.cos(a) * W, cy + Math.sin(a) * W); x.stroke(); } }
      } else if (e.kind === 'sweat' && q) {
        const c = q.proj(q.add(q.add(q.base.crown, q.f.X, (e.side || 1) * .85), q.f.Y, -.2 - p * .6));
        x.translate(c[0], c[1]); const r = q.scale * .28 * Math.min(1, p * 5);
        const g = x.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#e8f7ff'); g.addColorStop(1, '#6cc6ff');
        x.fillStyle = g; x.strokeStyle = '#2b7fc4'; x.lineWidth = 2 * k; x.beginPath(); x.moveTo(0, -r * 1.6); x.quadraticCurveTo(r, 0, 0, r); x.quadraticCurveTo(-r, 0, 0, -r * 1.6); x.fill(); x.stroke();
      } else if (e.kind === 'lock' && q) {
        const c = q.proj(q.f.O), r = q.scale * (2.2 - ease * .8);
        x.strokeStyle = 'rgba(52,225,255,.95)'; x.lineWidth = 3 * k; x.shadowColor = '#34e1ff'; x.shadowBlur = 10 * k;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.moveTo(c[0] + sx * r, c[1] + sy * r * .7); x.lineTo(c[0] + sx * r, c[1] + sy * r); x.lineTo(c[0] + sx * r * .7, c[1] + sy * r); x.stroke(); }
        if (p > .25) { x.fillStyle = 'rgba(52,225,255,.95)'; x.font = `700 ${16 * k}px "Space Grotesk", "HakiSans", sans-serif`; x.textAlign = 'center'; x.fillText('目标锁定', c[0], c[1] - r - 10 * k); }
      } else if (e.kind === 'beep' && q) {
        const c = q.proj(q.add(q.base.crown, q.f.Y, 1.1));
        x.strokeStyle = 'rgba(56,182,255,.9)'; x.lineWidth = 3 * k;
        for (let i = 0; i < 3; i++) { const rp = ((p * 3 + i / 3) % 1); x.globalAlpha = 1 - rp; x.beginPath(); x.arc(c[0], c[1], rp * q.scale * 2, -Math.PI * .85, -Math.PI * .15); x.stroke(); }
        x.globalAlpha = 1; x.fillStyle = '#38b6ff'; x.font = `800 ${15 * k}px "HakiSans", sans-serif`; x.textAlign = 'center'; x.fillText('哔哔！', c[0], c[1] - q.scale * 1.6);
      }
      x.restore();
    }
  }
  /** 脸部后方的效果，包括漫画放射线和爆发光线。 */
  function behind(/** @type {string} */ ov, /** @type {any} */ f, /** @type {number} */ t, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    if (ov === 'aura') { aura(f, t, W, H, k); return; }
    if (ov === 'wave' || ov === 'deco') {   // 木版画：头后的朱红太阳；热带复古：装饰艺术式光芒。
      const cx = f ? f.center.x : W / 2, cy = f ? f.center.y - f.height * .1 : H * .4, r = f ? f.height * .95 : H * .28;
      x.save();
      if (ov === 'wave') { x.fillStyle = 'rgba(200,70,44,.32)'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
      else { x.strokeStyle = 'rgba(232,196,120,.35)'; x.lineWidth = 2 * k; for (let i = 0; i < 24; i++) { const a = Math.PI + (i / 23) * Math.PI; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * .9, cy + Math.sin(a) * r * .9); x.lineTo(cx + Math.cos(a) * r * 2.2, cy + Math.sin(a) * r * 2.2); x.stroke(); } }
      x.restore();
      return;
    }
    if (ov !== 'speed' && ov !== 'burst') return;
    const cx = f ? f.center.x : W / 2, cy = f ? f.center.y : H * .42, r0 = f ? f.height * .78 : H * .26;
    x.save();
    const n = ov === 'speed' ? 64 : 22, spin = ov === 'burst' ? t / 4000 : 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + spin + (ov === 'speed' ? Math.sin(i * 7.3) * .04 : 0);
      if (ov === 'speed') {
        const len = H * (.35 + .4 * ((Math.sin(i * 12.9 + t / 90) + 1) / 2));
        x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = (1 + (i % 3)) * k;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); x.stroke();
      } else if (i % 2 === 0) {
        x.fillStyle = 'rgba(255,90,54,.28)';
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        x.lineTo(cx + Math.cos(a - .12) * H, cy + Math.sin(a - .12) * H); x.lineTo(cx + Math.cos(a + .12) * H, cy + Math.sin(a + .12) * H); x.closePath(); x.fill();
      }
    }
    x.restore();
  }

  /** 热血动漫：头后的能量气场与速度线。 */
  function aura(/** @type {any} */ f, /** @type {number} */ t, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    const cx = f ? f.center.x : W / 2, cy = f ? f.center.y : H * .42, r = f ? f.height * .75 : H * .25;
    x.save();
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2, wob = Math.sin(t / 120 + i * 1.7) * .5 + .5;
      const len = r * (.5 + .9 * wob);
      const g = x.createLinearGradient(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
      g.addColorStop(0, 'rgba(255,210,63,.75)'); g.addColorStop(.5, 'rgba(255,106,26,.45)'); g.addColorStop(1, 'rgba(255,60,20,0)');
      x.strokeStyle = g; x.lineWidth = (5 + 6 * wob) * k; x.lineCap = 'round';
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r * .95, cy + Math.sin(a) * r * .95);
      x.quadraticCurveTo(cx + Math.cos(a + .12) * (r + len * .5), cy + Math.sin(a + .12) * (r + len * .5) - len * .25, cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len) - len * .4);
      x.stroke();
    }
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1.5 * k;
    for (let i = 0; i < 26; i++) {
      const yy = ((i * 97 + t / 3) % H), xx = (i * 151) % W;
      if (Math.hypot(xx - cx, yy - cy) < r * 1.2) continue;
      x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx, yy + 60 * k); x.stroke();
    }
    x.restore();
  }

  function spawn(/** @type {string} */ kind, /** @type {number} */ W, /** @type {number} */ H) {
    const up = ['hearts', 'bubbles', 'candy', 'paws', 'orbs', 'sparkle', 'stars', 'embers', 'dust', 'glints', 'doodles'].includes(kind);
    bits.push({ kind, x: Math.random() * W, y: up ? H + 20 : -20, vx: (Math.random() - .5) * .4, vy: up ? -(.4 + Math.random() * .9) : (kind === 'rain' ? 9 + Math.random() * 6 : .6 + Math.random()),
      s: kind === 'rain' ? 1 : .6 + Math.random() * .8, r: Math.random() * 6, vr: (Math.random() - .5) * .02, life: 1, hue: Math.random() });
  }
  function particles(/** @type {string} */ ov, /** @type {number} */ t, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    const kind = { hearts: 'hearts', bubbles: 'bubbles', candy: 'candy', paws: 'paws', orbs: 'orbs', sparkle: 'sparkle', rain: 'rain', gothic: 'petals', energy: 'sparkle', magic: 'stars', breeze: 'leaves', stream: 'hearts', aura: 'embers',
      robot: 'bubbles', bamboo: 'bamboo', ink: 'peach', flowers: 'peach', tarot: 'stars', hk: 'dust', deco: 'glints', doodle: 'doodles', wave: 'snow' }[ov];
    if (!kind) { bits = []; return; }
    const want = kind === 'rain' ? 70 : kind === 'orbs' ? 10 : kind === 'snow' || kind === 'dust' ? 36 : 14;
    bits = bits.filter(b => b.kind === kind);
    if (bits.length < want && Math.random() < (kind === 'rain' ? .9 : kind === 'snow' || kind === 'dust' ? .3 : .12)) spawn(kind, W, H);
    for (const b of bits) {
      b.x += b.vx * k; b.y += b.vy * k; b.r += b.vr;
      if (b.y < -60 || b.y > H + 60) b.life = 0;
      x.save(); x.translate(b.x, b.y); x.rotate(kind === 'rain' ? .18 : b.r);
      const s = b.s * 22 * k;
      if (kind === 'hearts') { const im = img('heart'); if (im) { x.globalAlpha *= .85; x.drawImage(im, -s / 2, -s / 2, s, s); } else heart(s, '#ff8fb3'); }
      else if (kind === 'bubbles') { x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.5 * k; x.fillStyle = 'rgba(255,214,90,.18)'; x.beginPath(); x.arc(0, 0, s * .6, 0, 7); x.fill(); x.stroke(); x.fillStyle = 'rgba(255,255,255,.8)'; x.beginPath(); x.arc(-s * .2, -s * .2, s * .12, 0, 7); x.fill(); }
      else if (kind === 'candy' || kind === 'paws' || kind === 'sparkle') { const im = img(kind === 'candy' ? 'candy' : kind === 'paws' ? 'paw' : 'sparkle'); if (im) x.drawImage(im, -s / 2, -s / 2, s, s); }
      else if (kind === 'orbs') { const g = x.createRadialGradient(0, 0, 0, 0, 0, s * 1.6); g.addColorStop(0, 'rgba(255,214,140,.55)'); g.addColorStop(1, 'rgba(255,214,140,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, s * 1.6, 0, 7); x.fill(); }
      else if (kind === 'rain') { x.strokeStyle = (b.hue || 0) > .5 ? 'rgba(34,230,255,.45)' : 'rgba(255,43,214,.4)'; x.lineWidth = 1.2 * k; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 18 * k); x.stroke(); }
      else if (kind === 'petals') { x.fillStyle = 'rgba(70,10,40,.7)'; x.beginPath(); x.ellipse(0, 0, s * .32, s * .18, 0, 0, 7); x.fill(); }
      else if (kind === 'stars') { star(s * .5, (b.hue || 0) > .5 ? '#fff6a8' : '#ffc2ef'); }
      else if (kind === 'leaves') { x.fillStyle = (b.hue || 0) > .6 ? 'rgba(120,180,90,.85)' : (b.hue || 0) > .3 ? 'rgba(230,200,120,.85)' : 'rgba(255,255,255,.8)'; if ((b.hue || 0) > .3) { x.beginPath(); x.ellipse(0, 0, s * .34, s * .14, 0, 0, 7); x.fill(); } else { x.beginPath(); x.arc(0, 0, s * .12, 0, 7); x.fill(); for (let i = 0; i < 6; i++) { x.rotate(1.047); x.fillRect(0, -.5 * k, s * .3, k); } } }
      else if (kind === 'bamboo') { x.rotate(.6); x.fillStyle = (b.hue || 0) > .5 ? 'rgba(74,140,92,.85)' : 'rgba(46,96,64,.8)'; x.beginPath(); x.ellipse(0, 0, s * .55, s * .1, 0, 0, 7); x.fill(); }
      else if (kind === 'peach') { x.fillStyle = (b.hue || 0) > .5 ? 'rgba(255,183,207,.9)' : 'rgba(255,214,228,.9)'; x.beginPath(); x.moveTo(0, -s * .3); x.quadraticCurveTo(s * .3, -s * .1, 0, s * .3); x.quadraticCurveTo(-s * .3, -s * .1, 0, -s * .3); x.fill(); }
      else if (kind === 'dust') { x.fillStyle = `rgba(255,${190 + Math.round((b.hue || 0) * 50)},140,.55)`; x.beginPath(); x.arc(0, 0, s * .09, 0, 7); x.fill(); }
      else if (kind === 'glints') { x.fillStyle = 'rgba(232,196,120,.9)'; x.beginPath(); x.moveTo(0, -s * .3); x.lineTo(s * .1, 0); x.lineTo(0, s * .3); x.lineTo(-s * .1, 0); x.closePath(); x.fill(); }
      else if (kind === 'doodles') { x.strokeStyle = (b.hue || 0) > .5 ? 'rgba(224,122,95,.85)' : 'rgba(61,142,185,.85)'; x.lineWidth = 1.6 * k; x.beginPath(); for (let i = 0; i <= 5; i++) { const a = i * Math.PI * 4 / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * s * .3, Math.sin(a) * s * .3); } x.stroke(); }
      else if (kind === 'snow') { x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(0, 0, s * .08, 0, 7); x.fill(); }
      else if (kind === 'embers') { x.fillStyle = (b.hue || 0) > .5 ? 'rgba(255,210,63,.9)' : 'rgba(255,106,26,.85)'; x.beginPath(); x.arc(0, 0, s * .1, 0, 7); x.fill(); }
      x.restore();
    }
    bits = bits.filter(b => b.life > 0);
  }
  function star(/** @type {number} */ r, /** @type {string} */ col) {
    x.fillStyle = col; x.shadowColor = col; x.shadowBlur = 8; x.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, d = i % 2 ? r * .45 : r; x.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
    x.closePath(); x.fill(); x.shadowBlur = 0;
  }
  function heart(/** @type {number} */ s, /** @type {string} */ col) {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, s * .3);
    x.bezierCurveTo(-s * .6, -s * .1, -s * .25, -s * .6, 0, -s * .25); x.bezierCurveTo(s * .25, -s * .6, s * .6, -s * .1, 0, s * .3); x.fill();
  }

  /** 各个风格的边框与抬头显示。 */
  function frame(/** @type {string} */ ov, /** @type {any} */ f, /** @type {number} */ t, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    const m = 14 * k, top = insetTop + 8 * k, bot = insetBottom + 8 * k;   // 边框位于顶栏与底部面板之间的取景区内。
    x.save();
    if (ov === 'hearts') {   // 梦幻公主：顶部带缎带的玫瑰金拱门。
      x.strokeStyle = 'rgba(201,162,90,.9)'; x.lineWidth = 3 * k; x.shadowColor = 'rgba(255,190,210,.8)'; x.shadowBlur = 10 * k;
      arch(m, top, W - m * 2, H - top - m);
      x.lineWidth = 1.2 * k; arch(m + 8 * k, top + 8 * k, W - m * 2 - 16 * k, H - top - m - 16 * k);
      const bow = img('bow'); if (bow) { const bw = 70 * k; x.shadowBlur = 0; x.drawImage(bow, W / 2 - bw / 2, top - 22 * k, bw, bw * (bow.naturalHeight || bow.height) / (bow.naturalWidth || bow.width)); }
    } else if (ov === 'gothic') {   // 暗夜哥特：尖顶银色拱门。
      x.strokeStyle = 'rgba(207,210,223,.75)'; x.lineWidth = 2.4 * k;
      x.beginPath(); x.moveTo(m, H - m); x.lineTo(m, H * .36); x.quadraticCurveTo(m, top + 10 * k, W / 2, top - 6 * k); x.quadraticCurveTo(W - m, top + 10 * k, W - m, H * .36); x.lineTo(W - m, H - m); x.stroke();
    } else if (ov === 'energy') {   // 银幕英雄：面部能量环与胸部能量核心。
      if (f) {
        const r = f.height * .78;
        x.strokeStyle = 'rgba(79,215,255,.85)'; x.lineWidth = 3 * k; x.shadowColor = '#4fd7ff'; x.shadowBlur = 16 * k;
        x.setLineDash([24 * k, 14 * k]); x.lineDashOffset = -t / 20;
        x.beginPath(); x.arc(f.center.x, f.center.y, r, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
        const cx = f.chin.x - Math.sin(f.roll) * f.height * .95, cy = f.chin.y + Math.cos(f.roll) * f.height * .95;
        const pulse = .6 + .4 * Math.sin(t / 260);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, 26 * k); g.addColorStop(0, `rgba(220,250,255,${pulse})`); g.addColorStop(.5, `rgba(79,215,255,${.8 * pulse})`); g.addColorStop(1, 'rgba(79,215,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 26 * k, 0, 7); x.fill();
      }
      corners('rgba(255,59,71,.9)', 3 * k, 28 * k, m, top);
    } else if (ov === 'hud') {   // 机甲驾驶员：目标框、旋转刻度和数据显示。
      x.strokeStyle = 'rgba(52,225,255,.9)'; x.fillStyle = 'rgba(52,225,255,.9)'; x.lineWidth = 2 * k; x.shadowColor = '#34e1ff'; x.shadowBlur = 8 * k;
      if (f) {
        const r = f.height * .7, cx = f.center.x, cy = f.center.y;
        const b = r * .9, L = r * .28;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.moveTo(cx + sx * b, cy + sy * (b - L)); x.lineTo(cx + sx * b, cy + sy * b); x.lineTo(cx + sx * (b - L), cy + sy * b); x.stroke(); }
        x.lineWidth = 1.2 * k;
        for (let i = 0; i < 3; i++) { const a = t / 900 + i * 2.1; x.beginPath(); x.arc(cx, cy, r * 1.12, a, a + .9); x.stroke(); }
        x.font = `${11 * k}px "Space Grotesk", monospace`; x.fillText('同步 ' + (96 + Math.round(Math.sin(t / 700) * 3)) + '%', cx + b + 6 * k, cy - b + 10 * k); x.fillText('锁定', cx + b + 6 * k, cy - b + 26 * k);
      }
      const sy = (t / 12) % H; x.globalAlpha *= .35; x.fillRect(0, sy, W, 2 * k);
    } else if (ov === 'box') {   // 收藏手办：展示盒窗口。
      x.strokeStyle = 'rgba(123,97,255,.95)'; x.lineWidth = 10 * k; rr(m, top + 34 * k, W - m * 2, H - top - bot - -156 * k - m, 28 * k); x.stroke();
      x.fillStyle = 'rgba(123,97,255,.95)'; rr(W / 2 - 80 * k, top, 160 * k, 36 * k, 14 * k); x.fill();
      x.fillStyle = '#fff'; x.font = `700 ${15 * k}px system-ui, sans-serif`; x.textAlign = 'center'; x.fillText('HakiShow · 稀有版', W / 2, top + 24 * k);
    } else if (ov === 'fight') {   // 街机格斗家：生命条和准备提示。
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(m, top, W - m * 2, 22 * k);
      x.fillStyle = '#ffcc00'; x.fillRect(m + 4 * k, top + 4 * k, (W - m * 2) * .42, 14 * k); x.fillStyle = '#ff3d6e'; x.fillRect(W / 2 + 20 * k, top + 4 * k, (W - m * 2) * .42 - 24 * k, 14 * k);
      x.font = `${22 * k}px VT323, monospace`; x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText('99', W / 2, top + 18 * k);
      x.textAlign = 'left'; x.fillText('玩家一', m, top + 44 * k);
      if (((t - started) / 600 | 0) % 2 === 0 && t - started < 4000) { x.font = `${54 * k}px VT323, monospace`; x.fillStyle = '#ffcc00'; x.textAlign = 'center'; x.shadowColor = '#ff3d6e'; x.shadowBlur = 0; x.fillText('准备好了吗？', W / 2, H * .3); }
    } else if (ov === 'ccd') {   // 复古数码相机：橙色日期印记。
      x.font = `${30 * k}px VT323, monospace`; x.fillStyle = '#ff9a2f'; x.shadowColor = 'rgba(255,120,30,.9)'; x.shadowBlur = 8 * k; x.textAlign = 'right';
      x.fillText(stamp, W - m - 6 * k, H - bot - 14 * k);
    } else if (ov === 'film') {   // 清新胶片：两侧边缘的齿孔。
      x.fillStyle = 'rgba(20,18,14,.55)'; x.fillRect(0, 0, 18 * k, H); x.fillRect(W - 18 * k, 0, 18 * k, H);
      x.fillStyle = 'rgba(255,250,235,.85)';
      for (let y = (t / 40) % (26 * k); y < H; y += 26 * k) { rr(5 * k, y, 8 * k, 12 * k, 2 * k); x.fill(); rr(W - 13 * k, y, 8 * k, 12 * k, 2 * k); x.fill(); }
    } else if (ov === 'rain') {   // 赛博霓虹：霓虹灯管边框。
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff2bd6'); g.addColorStop(1, '#22e6ff');
      x.strokeStyle = g; x.lineWidth = 3 * k; x.shadowColor = '#ff2bd6'; x.shadowBlur = 14 * k; rr(m, top, W - m * 2, H - top - bot , 22 * k); x.stroke();
    } else if (ov === 'robot') {   // 迷你机器人：带四颗螺丝的圆角电视边框。
      x.strokeStyle = 'rgba(56,182,255,.92)'; x.lineWidth = 12 * k; rr(m, top, W - m * 2, H - top - bot , 54 * k); x.stroke();
      for (const [px, py] of [[m + 26 * k, top + 26 * k], [W - m - 26 * k, top + 26 * k], [m + 26 * k, H - bot - 26 * k], [W - m - 26 * k, H - bot - 26 * k]]) {
        x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(px, py, 8 * k, 0, 7); x.fill();
        x.strokeStyle = 'rgba(120,80,0,.7)'; x.lineWidth = 2 * k; x.beginPath(); x.moveTo(px - 4 * k, py - 4 * k); x.lineTo(px + 4 * k, py + 4 * k); x.stroke();
      }
    } else if (ov === 'magic') {   // 魔法女主角：旋转的魔法阵和星月边框。
      const cx = f ? f.center.x : W / 2, cy = f ? f.chin.y + f.height * .55 : H * .7, r = (f ? f.width : W * .4) * 1.1;
      x.save(); x.translate(cx, cy); x.scale(1, .32); x.rotate(t / 1600);
      x.strokeStyle = 'rgba(255,170,230,.85)'; x.shadowColor = '#ff8fe0'; x.shadowBlur = 14 * k; x.lineWidth = 2.5 * k;
      for (const ring of [r, r * .78]) { x.beginPath(); x.arc(0, 0, ring, 0, 7); x.stroke(); }
      x.beginPath(); for (let i = 0; i <= 5; i++) { const a = i * Math.PI * 4 / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * r * .78, Math.sin(a) * r * .78); } x.stroke();
      x.restore();
      x.strokeStyle = 'rgba(123,140,255,.8)'; x.lineWidth = 2 * k; rr(m, top, W - m * 2, H - top - bot , 34 * k); x.stroke();
      x.fillStyle = '#ffd86b'; x.font = `${26 * k}px serif`; x.textAlign = 'center'; x.fillText('☾', m + 22 * k, top + 34 * k); x.fillText('✦', W - m - 22 * k, top + 34 * k);
    } else if (ov === 'aura') {   // 热血动漫：边框周围的斩击痕迹。
      x.strokeStyle = 'rgba(255,240,220,.85)'; x.lineWidth = 3 * k; x.lineCap = 'round';
      for (const [a, b2, c, d2] of [[m, top + 60 * k, m + 70 * k, top], [W - m - 80 * k, H - bot - 10 * k, W - m, H - bot - 70 * k]]) { x.beginPath(); x.moveTo(a, b2); x.lineTo(c, d2); x.stroke(); }
    } else if (ov === 'breeze') {   // 温柔插画：柔和的午后光。
      const g = x.createRadialGradient(W * .85, top, 0, W * .85, top, W * .9); g.addColorStop(0, 'rgba(255,240,190,.35)'); g.addColorStop(1, 'rgba(255,240,190,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    } else if (ov === 'stream') {   // 虚拟主播：直播界面。
      x.fillStyle = '#ff2e63'; rr(m, top, 58 * k, 24 * k, 6 * k); x.fill();
      x.fillStyle = '#fff'; x.font = `800 ${13 * k}px "Space Grotesk", system-ui`; x.textAlign = 'left'; x.fillText('● 直播', m + 7 * k, top + 17 * k);
      x.fillStyle = 'rgba(0,0,0,.4)'; rr(m + 64 * k, top, 86 * k, 24 * k, 6 * k); x.fill();
      x.fillStyle = '#fff'; x.fillText('👁 ' + (12800 + Math.floor((t - started) / 90)).toLocaleString(), m + 72 * k, top + 17 * k);
      x.strokeStyle = 'rgba(41,211,255,.85)'; x.shadowColor = '#29d3ff'; x.shadowBlur = 10 * k; x.lineWidth = 2.5 * k; rr(m, top + 32 * k, W - m * 2, H - top - bot - 32 * k, 24 * k); x.stroke();
    } else if ((ov === 'sparkle' || ov === 'flowers') && f) {   // 动漫主角和恋爱漫画：眼中闪光。
      if (ov === 'flowers') { const g = x.createRadialGradient(W / 2, H * .45, H * .25, W / 2, H * .45, H * .7); g.addColorStop(0, 'rgba(255,200,230,0)'); g.addColorStop(1, 'rgba(255,170,215,.35)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      const s = img('sparkle'); if (s) for (const e of [f.eyeL, f.eyeR]) { const sz = f.width * .16 * (0.8 + .2 * Math.sin(t / 200)); x.drawImage(s, e.x - sz / 2 + f.width * .05, e.y - sz / 2 - f.width * .05, sz, sz); }
    } else if (ov === 'bamboo') {   // 奇幻旅人：水墨笔触边角和低处薄雾。
      inkCorners('rgba(30,40,32,.8)', m, top, W, H, k);
      const g = x.createLinearGradient(0, H * .62, 0, H); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(235,240,232,.45)'); x.fillStyle = g; x.fillRect(0, H * .62, W, H * .38);
    } else if (ov === 'ink') {   // 空灵肖像：金色云纹、朱红字母组合印章与纸张般的水墨晕染。
      cloudSwirl(m + 34 * k, top + 30 * k, 18 * k, k); cloudSwirl(W - m - 34 * k, top + 30 * k, 18 * k, k, -1);
      const g = x.createLinearGradient(0, H * .7, 0, H); g.addColorStop(0, 'rgba(245,239,226,0)'); g.addColorStop(1, 'rgba(245,239,226,.5)'); x.fillStyle = g; x.fillRect(0, H * .7, W, H * .3);
      seal(W - m - 40 * k, H - bot - 46 * k, 30 * k);
    } else if (ov === 'tarot') {   // 塔罗：双重金色卡片边框和顶部月亮。
      x.strokeStyle = 'rgba(217,181,82,.95)'; x.shadowColor = 'rgba(243,217,138,.8)'; x.shadowBlur = 10 * k; x.lineWidth = 2.5 * k;
      rr(m, top, W - m * 2, H - top - bot , 18 * k); x.stroke(); x.lineWidth = 1 * k; rr(m + 7 * k, top + 7 * k, W - m * 2 - 14 * k, H - top - bot - 14 * k, 12 * k); x.stroke();
      x.fillStyle = '#f3d98a'; x.font = `${24 * k}px serif`; x.textAlign = 'center'; x.fillText('☾', W / 2, top + 30 * k);
      x.font = `${14 * k}px serif`; for (const [px, py] of [[m + 20 * k, top + 26 * k], [W - m - 20 * k, top + 26 * k], [m + 20 * k, H - bot - 16 * k], [W - m - 20 * k, H - bot - 16 * k]]) x.fillText('✦', px, py);
    } else if (ov === 'vhs') {   // 复古动漫：VHS（家用录像系统）录像带播放标记、时间码和移动磁迹条带。
      x.fillStyle = '#fff'; x.font = `${26 * k}px VT323, monospace`; x.textAlign = 'left'; x.shadowColor = '#ff4fd8'; x.shadowBlur = 0;
      x.fillText('▶ 播放', m + 4 * k, top + 26 * k);
      const s2 = Math.floor((t - started) / 1000); x.fillText('标准播放 ' + String(Math.floor(s2 / 60)).padStart(2, '0') + ':' + String(s2 % 60).padStart(2, '0'), m + 4 * k, H - bot - 20 * k);
      const band = ((t / 9) % (H + 80 * k)) - 40 * k; const g = x.createLinearGradient(0, band - 30 * k, 0, band + 30 * k);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, band - 30 * k, W, 60 * k);
    } else if (ov === 'cinema') {   // 复古电影：角落暖色漏光与红绿霓虹边缘。
      const pulse = .75 + .25 * Math.sin(t / 900);
      let g = x.createRadialGradient(W, top, 0, W, top, W * .9); g.addColorStop(0, `rgba(255,140,60,${.38 * pulse})`); g.addColorStop(1, 'rgba(255,140,60,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      g = x.createLinearGradient(0, 0, W * .25, 0); g.addColorStop(0, 'rgba(232,67,79,.28)'); g.addColorStop(1, 'rgba(232,67,79,0)'); x.fillStyle = g; x.fillRect(0, 0, W * .25, H);
      g = x.createLinearGradient(W, 0, W * .75, 0); g.addColorStop(0, 'rgba(63,208,160,.22)'); g.addColorStop(1, 'rgba(63,208,160,0)'); x.fillStyle = g; x.fillRect(W * .75, 0, W * .25, H);
    } else if (ov === 'gilt') {   // 古典油画：镀金画框。
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f3d48a'); g.addColorStop(.5, '#a07a2c'); g.addColorStop(1, '#f0cf7e');
      x.strokeStyle = g; x.lineWidth = 14 * k; rr(m, top, W - m * 2, H - top - bot , 4 * k); x.stroke();
      x.strokeStyle = 'rgba(80,55,15,.85)'; x.lineWidth = 2 * k; rr(m + 9 * k, top + 9 * k, W - m * 2 - 18 * k, H - top - bot - 18 * k, 2 * k); x.stroke();
    } else if (ov === 'doodle') {   // 绘本水彩：轻微变化的手绘边框。
      const seed = Math.floor(t / 160); x.strokeStyle = 'rgba(59,49,39,.75)'; x.lineWidth = 2.4 * k; x.lineJoin = 'round';
      wobble(m, top, W - m * 2, H - top - bot , seed, k);
    } else if (ov === 'pop') {   // 波普艺术：网点边角和开场的“砰！”字样。
      for (const [ox, oy, sx, sy] of [[0, top - 20 * k, 1, 1], [W, H - bot , -1, -1]]) for (let i = 0; i < 9; i++) for (let j = 0; j < 9 - i; j++) {
        x.fillStyle = 'rgba(255,45,111,.55)'; x.beginPath(); x.arc(ox + sx * (i * 14 + 8) * k, oy + sy * (j * 14 + 8) * k, (5 - (i + j) * .45) * k, 0, 7); x.fill();
      }
      if (t - started < 2600) { const sc = Math.min(1, (t - started) / 220); x.save(); x.translate(W - m - 70 * k, top + 70 * k); x.rotate(-.2); x.scale(sc, sc); burstStar(46 * k, '#ffe14d'); x.fillStyle = '#111'; x.font = `900 ${26 * k}px system-ui, sans-serif`; x.textAlign = 'center'; x.fillText('砰！', 0, 9 * k); x.restore(); }
    } else if (ov === 'wave') {   // 木版画：底部重复的波浪纹样。
      x.strokeStyle = 'rgba(43,76,126,.55)'; x.lineWidth = 2 * k; const r0 = 22 * k, yb = H - bot ;
      for (let row = 0; row < 3; row++) for (let cx2 = -r0 + (row % 2) * r0; cx2 < W + r0; cx2 += r0 * 2) for (const rr2 of [r0, r0 * .7, r0 * .4]) { x.beginPath(); x.arc(cx2, yb - row * r0 * .6 + r0, rr2, Math.PI, 0); x.stroke(); }
    } else if (ov === 'deco') {   // 热带复古：阶梯形装饰艺术边角。
      x.strokeStyle = 'rgba(184,70,58,.85)'; x.lineWidth = 2.5 * k; rr(m, top, W - m * 2, H - top - bot , 6 * k); x.stroke();
      x.strokeStyle = 'rgba(62,138,126,.85)'; x.lineWidth = 1.5 * k;
      for (const [cx2, cy2, sx, sy] of [[m, top, 1, 1], [W - m, top, -1, 1], [m, H - bot , 1, -1], [W - m, H - bot , -1, -1]]) for (let i = 1; i <= 3; i++) { x.beginPath(); x.moveTo(cx2 + sx * i * 9 * k, cy2 + sy * 40 * k); x.lineTo(cx2 + sx * i * 9 * k, cy2 + sy * i * 9 * k); x.lineTo(cx2 + sx * 40 * k, cy2 + sy * i * 9 * k); x.stroke(); }
    } else if (ov === 'tiles') {   // 传统马赛克：装饰性花卉瓷砖边框。
      const sz = 26 * k, cols = ['#e05a7a', '#2ea39b', '#f2c14e'];
      const tile = (/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ i) => { x.fillStyle = 'rgba(255,255,255,.88)'; x.fillRect(px, py, sz, sz); x.fillStyle = cols[i % 3]; x.beginPath(); x.arc(px + sz / 2, py + sz / 2, sz * .28, 0, 7); x.fill(); x.fillStyle = cols[(i + 1) % 3]; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { x.beginPath(); x.arc(px + dx * sz, py + dy * sz, sz * .22, 0, 7); x.fill(); } };
      let i = 0; for (let px = 0; px < W; px += sz) tile(px, top - 22 * k, i++);
      for (let py = top - 22 * k + sz; py < H - bot ; py += sz) { tile(0, py, i++); tile(W - sz, py, i++); }
    } else if (ov === 'bubbles' || ov === 'candy' || ov === 'paws') {   // 贴纸般的白色镶边，带厚实圆润的轮廓。
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 8 * k; rr(m, top, W - m * 2, H - top - bot , 34 * k); x.stroke();
    }
    x.restore();
  }
  /** 水墨笔触边角由粗起笔渐收为细尖。 */
  function inkCorners(/** @type {string} */ col, /** @type {number} */ m, /** @type {number} */ top, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k) {
    const b = H - insetBottom - 8 * k; x.fillStyle = col;
    for (const [cx, cy, sx, sy] of [[m, top, 1, 1], [W - m, top, -1, 1], [m, b, 1, -1], [W - m, b, -1, -1]]) {
      x.beginPath(); x.moveTo(cx, cy + sy * 70 * k); x.quadraticCurveTo(cx - sx * 3 * k, cy, cx + sx * 70 * k, cy - sy * 2 * k); x.lineTo(cx + sx * 64 * k, cy + sy * 3 * k); x.quadraticCurveTo(cx + sx * 6 * k, cy + sy * 5 * k, cx + sx * 4 * k, cy + sy * 70 * k); x.closePath(); x.fill();
    }
  }
  /** 金色云纹向自身回卷。 */
  function cloudSwirl(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, /** @type {number} */ k, dir = 1) {
    x.save(); x.strokeStyle = 'rgba(184,145,58,.9)'; x.lineWidth = 2.2 * k; x.lineCap = 'round'; x.beginPath();
    for (let a = 0; a < Math.PI * 3.2; a += .15) { const rr3 = r * (1 - a / (Math.PI * 3.6)); x.lineTo(cx + dir * Math.cos(a) * rr3, cy + Math.sin(a) * rr3); }
    x.stroke(); x.beginPath(); x.arc(cx + dir * r * 1.5, cy + r * .4, r * .55, Math.PI, Math.PI * 2.2); x.stroke(); x.restore();
  }
  /** 朱红色 H 字母组合印章。 */
  function seal(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ s) {
    x.save(); x.fillStyle = 'rgba(200,55,45,.92)'; rr(px, py, s, s, s * .12); x.fill();
    x.strokeStyle = 'rgba(255,245,232,.7)'; x.lineWidth = s * .05; rr(px + s * .1, py + s * .1, s * .8, s * .8, s * .08); x.stroke();
    x.fillStyle = '#fff5e8'; x.font = `700 ${s * .62}px Georgia,serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', px + s / 2, py + s * .54); x.restore();
  }
  /** 手绘边框周期性变化，模拟逐帧线条动画。 */
  function wobble(/** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ seed, /** @type {number} */ k) {
    const j = (/** @type {number} */ i) => (Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453 % 1) * 3 * k;
    const pts = []; const n = 14;
    for (let i = 0; i <= n; i++) pts.push([X + w * i / n + j(i), Y + j(i + 50)]);
    for (let i = 1; i <= n; i++) pts.push([X + w + j(i + 100), Y + h * i / n + j(i + 150)]);
    for (let i = 1; i <= n; i++) pts.push([X + w - w * i / n + j(i + 200), Y + h + j(i + 250)]);
    for (let i = 1; i < n; i++) pts.push([X + j(i + 300), Y + h - h * i / n + j(i + 350)]);
    x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.stroke();
  }
  /** 漫画爆发星形。 */
  function burstStar(/** @type {number} */ r, /** @type {string} */ col) {
    x.fillStyle = col; x.strokeStyle = '#111'; x.lineWidth = 3; x.beginPath();
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, d = i % 2 ? r * .62 : r; x.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
    x.closePath(); x.fill(); x.stroke();
  }
  function rr(/** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ r) { x.beginPath(); x.roundRect(X, Y, w, h, r); }
  function arch(/** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ w, /** @type {number} */ h) {
    const r = w / 2; x.beginPath(); x.moveTo(X, Y + h); x.lineTo(X, Y + r); x.arc(X + r, Y + r, r, Math.PI, 0); x.lineTo(X + w, Y + h); x.stroke();
  }
  function corners(/** @type {string} */ col, /** @type {number} */ lw, /** @type {number} */ L, /** @type {number} */ m, /** @type {number} */ top) {
    const W = canvas.width, H = canvas.height, b = H - insetBottom - 8 * (W / 400); x.strokeStyle = col; x.lineWidth = lw;
    for (const [cx, cy, sx, sy] of [[m, top, 1, 1], [W - m, top, -1, 1], [m, b, 1, -1], [W - m, b, -1, -1]]) { x.beginPath(); x.moveTo(cx, cy + sy * L); x.lineTo(cx, cy); x.lineTo(cx + sx * L, cy); x.stroke(); }
  }


  return {
    draw, fire,
    setPreset(/** @type {string} */ id) {
      if (id === preset) return;
      preset = id; bits = []; sprites = []; fxs = []; started = performance.now(); variant = 0; popAt = performance.now(); flames.reset(); hearts.reset();
      pack = packOf(id);
      if (pack.random && pack.variants?.length) variant = Math.floor(Math.random() * pack.variants.length);
      preloadPack(id);
      for (const n of ['heart', 'bow', 'candy', 'paw', 'sparkle']) img(n);
    },
    get variant() { return variant; },
    setStrength(/** @type {number} */ v) { strength = v; },
    /** 是否显示场景背景。 */
    setScene(/** @type {boolean} */ on) { scene = on; },
    /** 顶栏与底部面板各占画面高度的比例。 */
    setInsets(/** @type {number} */ top, /** @type {number} */ bottom) { topF = top; bottomF = bottom; },
    resize(/** @type {number} */ w, /** @type {number} */ h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } },
  };
}

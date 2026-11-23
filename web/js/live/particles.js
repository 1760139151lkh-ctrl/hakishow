/** 动作特效的粒子系统：喷火与爱心雨。
 *  · 喷火：从嘴部持续喷出的火焰束。真实火焰贴图（火舌、火团、火星）以加色混合叠加：火舌从喷口射出并闪烁，
 *    火团沿喷射方向飞出、越飞越大（朝镜头扑来的透视感）并翻滚消散成烟；另有火星、嘴部炽光和打在脸上的暖光。张嘴越大火越旺，转头时火焰跟着扫过去。
 *  · 爱心雨：微笑时先从脸周围弹出一圈爱心，随后整屏不断有大小、远近不同的爱心摇曳上升，部分在高处化作星芒。
 *  全部在二维画布上绘制，粒子数量有上限，保证手机上流畅。 */

const clamp = (/** @type {number} */ v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rand = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);
/** 近似高斯分布（三个均匀数之和），用于喷射角度的自然散布。 */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

/** 预渲染的径向发光贴图，按名称缓存。 @type {Map<string, HTMLCanvasElement>} */
const textures = new Map();
function texture(/** @type {string} */ name, /** @type {[number, string][]} */ stops, size = 128) {
  let c = textures.get(name);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = size;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  textures.set(name, c);
  return c;
}
const HOT = () => texture('fire-hot', [[0, 'rgba(255,255,236,1)'], [.22, 'rgba(255,238,150,.95)'], [.5, 'rgba(255,160,40,.5)'], [.78, 'rgba(255,90,10,.14)'], [1, 'rgba(255,60,0,0)']]);
const WARM = () => texture('fire-warm', [[0, 'rgba(255,196,70,.95)'], [.35, 'rgba(255,118,24,.62)'], [.7, 'rgba(214,40,10,.22)'], [1, 'rgba(160,20,0,0)']]);
const SMOKE = () => texture('fire-smoke', [[0, 'rgba(58,48,46,.42)'], [.55, 'rgba(44,38,36,.18)'], [1, 'rgba(30,26,24,0)']]);
const EMBER = () => texture('fire-ember', [[0, 'rgba(255,255,226,1)'], [.3, 'rgba(255,206,90,.95)'], [.7, 'rgba(255,100,10,.35)'], [1, 'rgba(255,60,0,0)']], 32);
const GLOW = () => texture('fire-glow', [[0, 'rgba(255,214,130,.9)'], [.35, 'rgba(255,140,40,.45)'], [1, 'rgba(255,80,0,0)']], 256);
const PINK = () => texture('heart-glow', [[0, 'rgba(255,170,205,.0)'], [.6, 'rgba(255,150,195,.0)'], [1, 'rgba(255,120,180,.55)']], 256);

/** 喷火所用的真实火焰贴图（黑底拍摄转透明）：火团、火舌（喷口已对齐到图片左侧中点）、火星。 */
export const FIRE_SPRITES = ['fire-puff-1', 'fire-puff-2', 'fire-puff-3', 'fire-puff-4', 'fire-puff-5', 'fire-tongue-1', 'fire-tongue-2', 'fire-tongue-3', 'fire-tongue-4', 'fire-embers'];
const PUFFS = FIRE_SPRITES.slice(0, 5), TONGUES = FIRE_SPRITES.slice(5, 9);

/** 喷火。hold() 在张嘴期间每帧调用；draw() 每帧调用，负责发射、物理与绘制。
 *  画面层次：烟（正常混合）→ 脸上的暖光 → 两层交替闪烁的火舌（从嘴部喷口射出）→ 沿喷射方向飞出、边飞边变大翻滚的火团 → 火星 → 喷口白热核心。
 *  @param {(name: string) => CanvasImageSource | null} sprite 已解码的贴图；没有贴图时退回程序生成的发光圆斑。 */
export function createFire(sprite) {
  /** @typedef {{ x: number, y: number, vx: number, vy: number, age: number, life: number, s0: number, s1: number, rot: number, spin: number, img: number, kind: 0 | 1 | 2, seed: number }} P */
  /** @type {P[]} */ let ps = [];
  let level = 0, want = 0, heldAt = -1e9, carry = 0, last = 0, ang = Math.PI / 2, aimed = false;
  /** 喷口：位置、方向、尺度（瞳距像素）与嘴宽。 */
  let src = { x: 0, y: 0, dx: 0, dy: 1, u: 60, w: 30 };
  const size = (/** @type {any} */ im) => [im.naturalWidth || im.width || 1, im.naturalHeight || im.height || 1];
  return {
    get active() { return level > .01 || ps.length > 0 || performance.now() - heldAt < 150; },
    /** @param {{ x: number, y: number, dx: number, dy: number, u: number, w: number }} at @param {number} open 张嘴程度 0–1 */
    hold(at, open, now = performance.now()) { src = at; heldAt = now; want = clamp((open - .22) / .45, .4, 1); },
    reset() { ps = []; level = want = 0; heldAt = -1e9; aimed = false; },
    /** @param {CanvasRenderingContext2D} x @param {number} now @param {number} W @param {number} H */
    draw(x, now, W, H) {
      const dt = clamp((now - (last || now)) / 1000, 0, .05); last = now;
      const holding = now - heldAt < 90;
      level += ((holding ? want : 0) - level) * clamp(dt * (holding ? 12 : 6));
      if (level < .01 && !ps.length) { aimed = false; return; }
      const u = src.u;
      // 喷射方向平滑跟随头部朝向：转头时火舌跟着扫过去，但不抖动。
      const target = Math.atan2(src.dy, src.dx) + Math.sin(now / 420) * .1;
      if (!aimed) { ang = target; aimed = true; }
      const da = Math.atan2(Math.sin(target - ang), Math.cos(target - ang)); ang += da * clamp(dt * 10);
      const cx = Math.cos(ang), cy = Math.sin(ang);
      // 发射：火团约每秒 50 团（越往外越大、边飞边翻滚），并带出火星。
      carry += dt * 36 * level;
      while (carry >= 1 && ps.length < 160) {
        carry--;
        const a = ang + gauss() * .42, sp = u * rand(6, 9.5) * (.75 + level * .35), st = u * rand(.5, 1.5);
        ps.push({ x: src.x + cx * st, y: src.y + cy * st, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: rand(.45, .8), s0: u * rand(.45, .75), s1: u * rand(2.1, 3.3) * (.75 + level * .35),
          rot: rand(0, 6.283), spin: rand(-1.8, 1.8), img: Math.floor(Math.random() * PUFFS.length), kind: 0, seed: Math.random() });
        if (Math.random() < .5) { const b = ang + gauss() * .75, s2 = u * rand(4.5, 11); ps.push({ x: src.x + cx * st, y: src.y + cy * st, vx: Math.cos(b) * s2, vy: Math.sin(b) * s2, age: 0, life: rand(.5, 1.2), s0: u * rand(.05, .1), s1: 0, rot: 0, spin: 0, img: 0, kind: 2, seed: Math.random() }); }
      }
      // 物理：阻力；火焰受浮力向上卷，烟继续上升扩散，火星飞得更远。
      const next = [];
      for (const p of ps) {
        p.age += dt;
        if (p.age >= p.life) { if (p.kind === 0 && Math.random() < .3 && next.length < 200) next.push({ ...p, age: 0, life: rand(.8, 1.3), s0: p.s1 * .5, s1: p.s1 * 1.2, kind: 1, vx: p.vx * .2, vy: p.vy * .15 - u * .5 }); continue; }
        const drag = p.kind === 2 ? .9 : 1.5;
        p.vx -= p.vx * drag * dt; p.vy -= p.vy * drag * dt;
        p.vy -= u * (p.kind === 1 ? 1.4 : p.kind === 2 ? 1.2 : 2.6) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        next.push(p);
      }
      ps = next;
      const flick = .82 + .18 * Math.sin(now / 37) * Math.sin(now / 91 + 1);
      x.save();
      // 烟在火焰之下，正常混合。
      x.globalCompositeOperation = 'source-over';
      const smoke = SMOKE();
      for (const p of ps) if (p.kind === 1) {
        const k = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * k;
        x.globalAlpha = Math.sin(Math.PI * k) * .4;
        x.drawImage(smoke, p.x - s / 2, p.y - s / 2, s, s);
      }
      // 打在脸上的暖光（范围小、强度低，避免整片发白）。
      x.globalCompositeOperation = 'lighter';
      const gl = GLOW();
      x.globalAlpha = clamp(level * .22 * flick);
      const R = u * 2.4; x.drawImage(gl, src.x - R, src.y - R, R * 2, R * 2);
      // 火团：真实火焰贴图以正常混合叠加，保留橙红本色（加色混合在浅色衣服上会发白）。
      // 新火团在下、老火团在上：越老的火团离镜头越近、越大。
      x.globalCompositeOperation = 'source-over';
      const warm = WARM();
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]; if (p.kind !== 0) continue;
        const k = p.age / p.life, e = 1 - (1 - k) * (1 - k), s = p.s0 + (p.s1 - p.s0) * e;
        x.globalAlpha = clamp(Math.min(1, p.age / .07) * Math.pow(1 - k, 1.7) * .95);
        const im = sprite(PUFFS[p.img]);
        x.save(); x.translate(p.x, p.y); x.rotate(p.rot + p.spin * p.age);
        if (im) x.drawImage(im, -s / 2, -s / 2, s, s); else x.drawImage(warm, -s / 2, -s / 2, s, s);
        x.restore();
      }
      // 火舌：四张火舌贴图两两交替淡入淡出，长度与角度轻微抖动，形成持续喷射的火焰束；
      // 先正常叠一层显出火焰本色，再加色叠一层做出自发光。
      const ph = now / 105, i0 = Math.floor(ph), f = ph - i0;
      const tongue = (/** @type {number} */ boost) => {
        for (const [i, al] of /** @type {[number, number][]} */ ([[i0, 1 - f], [i0 + 1, f]])) {
          const im = sprite(TONGUES[i % TONGUES.length]);
          if (!im) continue;
          const [iw, ih] = size(im);
          const L = u * (3.4 + .4 * Math.sin(now / 83 + i * 1.7)) * (.5 + .5 * level), Wd = L * ih / iw * 1.15;
          x.save(); x.translate(src.x, src.y); x.rotate(ang + Math.sin(now / 130 + i * 2.1) * .05);
          if (i % 2) x.scale(1, -1);
          x.globalAlpha = clamp(al * level * boost);
          x.drawImage(im, -L * .015, -Wd / 2, L, Wd);
          x.restore();
        }
      };
      tongue(1);
      x.globalCompositeOperation = 'lighter';
      tongue(.35);
      // 火星：拖出短短的光痕。
      const em = EMBER();
      for (const p of ps) if (p.kind === 2) {
        const k = p.age / p.life, a = (1 - k) * (.6 + .4 * Math.sin(now / 15 + p.seed * 60));
        x.globalAlpha = clamp(a);
        const s = p.s0 * 4;
        x.drawImage(em, p.x - s / 2, p.y - s / 2, s, s);
        x.strokeStyle = 'rgba(255,214,120,' + (a * .7).toFixed(3) + ')'; x.lineWidth = Math.max(1, p.s0 * .5); x.lineCap = 'round';
        x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * .03, p.y - p.vy * .03); x.stroke();
      }
      // 喷口炽光：嘴部的白热核心。
      const cs = u * (.75 + .2 * flick) * (.55 + level * .5);
      x.globalAlpha = clamp(level * .9); x.drawImage(HOT(), src.x - cs / 2, src.y - cs / 2, cs, cs);
      x.restore();
    },
  };
}

/** 爱心雨。fire() 在微笑时调用（持续微笑则持续延长），draw() 每帧调用。 @param {(name: string) => CanvasImageSource | null} sprite */
export function createHearts(sprite) {
  /** @typedef {{ x: number, y: number, vx: number, vy: number, s: number, depth: number, sway: number, freq: number, ph: number, rot: number, age: number, life: number, img: number, burst: boolean, pop: number }} Heart */
  /** @type {Heart[]} */ let hs = [];
  /** @type {{ x: number, y: number, vx: number, vy: number, age: number, life: number, s: number }[]} */ let tw = [];
  let until = 0, level = 0, carry = 0, last = 0, began = 0, burstDone = true;
  const NAMES = ['heart-pink', 'heart-red', 'heart-gold', 'heart-lilac', 'heart-pink', 'heart-outline'];
  /** 没有贴图时用矢量绘制爱心。 */
  function vector(/** @type {CanvasRenderingContext2D} */ x, /** @type {number} */ s, /** @type {number} */ i) {
    const cols = [['#ffd1e3', '#ff5c9a'], ['#ffb3b3', '#e8203f'], ['#ffe6c7', '#e7a15a'], ['#efe0ff', '#b48cff']][i % 4];
    const g = x.createLinearGradient(0, -s / 2, 0, s / 2); g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
    x.fillStyle = g; x.beginPath();
    x.moveTo(0, s * .32); x.bezierCurveTo(-s * .62, -s * .08, -s * .32, -s * .55, 0, -s * .22); x.bezierCurveTo(s * .32, -s * .55, s * .62, -s * .08, 0, s * .32); x.fill();
  }
  /** 新爱心：大多从画面底部升起；一部分直接在画面中段淡入，让整屏立刻被爱心铺满。
   *  分远、中、近三层：远处小而淡、升得慢；近处约两成，又大又亮、升得快，营造满屏洋溢的纵深感。 */
  function spawnRise(/** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ k, /** @type {number} */ top, mid = false) {
    const r = Math.random(), near = r < .2, depth = near ? rand(1.15, 1.5) : r < .58 ? rand(.8, 1.15) : rand(.5, .8);
    const s = (near ? rand(50, 84) : depth >= .8 ? rand(24, 40) : rand(13, 24)) * k;
    // 近处的大爱心走画面两侧，不挡住脸。
    const fx = near ? (Math.random() < .5 ? rand(-.05, .28) : rand(.72, 1.05)) : rand(-.04, 1.04);
    hs.push({ x: fx * W, y: mid ? rand(top + (H - top) * .2, H * .98) : H + s * .6 + rand(0, 40) * k, vx: 0, vy: -rand(170, 300) * k * (.55 + depth * .45), s, depth, sway: rand(10, 34) * k, freq: rand(.45, 1.15), ph: rand(0, 6.28),
      rot: rand(-.3, .3), age: 0, life: rand(4.5, 7), img: Math.floor(Math.random() * NAMES.length), burst: false, pop: !near && Math.random() < .16 ? rand(.6, .82) : -1 });
  }
  function popAt(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ k) {
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28 + rand(0, .5), sp = rand(60, 140) * k; tw.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: rand(.4, .7), s: rand(10, 20) * k }); }
  }
  return {
    get active() { return level > .01 || hs.length > 0; },
    /** @param {{ x: number, y: number, u: number, dir: number }[]} around 脸周围的出发点与朝外的方向（弧度）：头顶向上、两颊向外，爱心不会挡住脸。 */
    fire(/** @type {{ x: number, y: number, u: number, dir: number }[]} */ around, now = performance.now()) {
      const fresh = now > until;
      until = Math.max(until, now + (fresh ? 2600 : 1200));
      if (!fresh) return;
      began = now; burstDone = false;
      for (const o of around) for (let i = 0; i < 6; i++) {
        const a = o.dir + gauss() * .6, sp = o.u * rand(3.2, 6);
        hs.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: o.u * rand(.34, .6), depth: 1.6, sway: o.u * .12, freq: rand(.8, 1.4), ph: rand(0, 6.28), rot: rand(-.35, .35), age: -i * .035, life: rand(1.5, 2.2), img: Math.floor(Math.random() * 4), burst: true, pop: -1 });
      }
    },
    reset() { hs = []; tw = []; until = 0; level = 0; },
    /** @param {CanvasRenderingContext2D} x @param {number} now @param {number} W @param {number} H @param {number} k @param {number} top 顶栏下沿 */
    draw(x, now, W, H, k, top = 0) {
      const dt = clamp((now - (last || now)) / 1000, 0, .05); last = now;
      const on = now < until;
      level += ((on ? 1 : 0) - level) * clamp(dt * (on ? 6 : 2.5));
      if (level < .01 && !hs.length && !tw.length) return;
      // 整屏爱心：开场时在画面中段直接铺一层，之后持续从底部升起，前两秒更密集。
      if (on && !burstDone) { burstDone = true; for (let i = 0; i < 26; i++) spawnRise(W, H, k, top, true); }
      carry += dt * (on ? (now - began < 2000 ? 34 : 24) : 0);
      while (carry >= 1 && hs.length < 140) { carry--; spawnRise(W, H, k, top); }
      x.save();
      // 柔和的粉色边缘光晕。
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = level * .65;
      x.drawImage(PINK(), -W * .25, -H * .1, W * 1.5, H * 1.2);
      x.globalCompositeOperation = 'source-over';
      const next = [];
      hs.sort((a, b) => a.depth - b.depth);
      for (const h of hs) {
        h.age += dt;
        if (h.age < 0) { next.push(h); continue; }   // 依次弹出，尚未出场
        if (h.burst) { h.vx -= h.vx * 1.6 * dt; h.vy -= h.vy * 1.6 * dt + 60 * k * dt; }
        h.x += (h.vx + Math.cos(h.age * h.freq * 6.28 + h.ph) * h.sway * h.freq * 2.2) * dt; h.y += h.vy * dt;
        const high = 1 - h.y / H;
        if (h.pop > 0 && high > 1 - h.pop) { popAt(h.x, h.y, k); continue; }
        if (h.age > h.life || h.y < top - 60 * k) continue;
        next.push(h);
        const fin = h.burst ? Math.min(1, (h.life - h.age) / .5) : clamp((h.y - top) / (H * .18)) * Math.min(1, (h.life - h.age) / .6);
        // 弹出的爱心用回弹缩放出场（不做淡入，第一帧就清晰饱满）；升起的爱心淡入。
        const inA = h.burst ? 1 : Math.min(1, h.age / .3);
        const g = Math.min(1, h.age / .28), back = 1 + 2.2 * Math.pow(g - 1, 3) + 1.2 * Math.pow(g - 1, 2);
        const s = h.s * (h.burst ? back : 1);
        x.globalAlpha = clamp(inA * fin * (.5 + .5 * clamp((h.depth - .5) / .7)));
        x.save(); x.translate(h.x, h.y); x.rotate(h.rot + Math.sin(h.age * 2.2 + h.ph) * .18);
        const im = sprite(NAMES[h.img]);
        if (im) { const w = s, hh = s * (/** @type {any} */ (im).naturalHeight || 1) / (/** @type {any} */ (im).naturalWidth || 1); x.drawImage(im, -w / 2, -hh / 2, w, hh); }
        else vector(x, s, h.img);
        x.restore();
      }
      hs = next;
      // 星芒：爱心在高处化开。
      const star = sprite('twinkle');
      x.globalCompositeOperation = 'lighter';
      tw = tw.filter(p => (p.age += dt) < p.life);
      for (const p of tw) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
        const kk = p.age / p.life, s = p.s * (1 - kk * .5);
        x.globalAlpha = 1 - kk;
        if (star) x.drawImage(star, p.x - s / 2, p.y - s / 2, s, s);
        else { x.fillStyle = '#fff'; x.beginPath(); x.arc(p.x, p.y, s * .15, 0, 7); x.fill(); }
      }
      x.restore();
    },
  };
}

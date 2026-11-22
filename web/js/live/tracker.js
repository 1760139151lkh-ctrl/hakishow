/** 本地人脸跟踪：MediaPipe 在设备上读取 478 个关键点与表情系数，相机画面不离开设备。
 * 平滑分两层：整体位姿（中心、角度、尺度）使用响应快的 One Euro 滤波，五官形状在人脸局部坐标中使用较强的滤波，
 * 因此贴纸、美型网格和特效既跟手又不抖动。由三维关键点求出人脸坐标系（偏航、俯仰、翻滚），供三维挂件和动作触发使用。 */
import { asset, hushVision } from '../core/dom.js';

const VENDOR = () => new URL(asset('vendor/mediapipe/'), location.href).href;
let kit = /** @type {Promise<{ vision: any, files: any }> | null} */ (null);
/** 共用的视觉运行时（人脸与人像分割共用一份 WebAssembly）。 */
export function visionKit() {
  kit ||= (async () => {
    hushVision();
    const vision = await import(/* @vite-ignore */ VENDOR() + 'vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(VENDOR() + 'wasm');
    return { vision, files };
  })();
  kit.catch(() => { kit = null; });
  return kit;
}
export const vendorUrl = (/** @type {string} */ name) => VENDOR() + name;

let loading = /** @type {Promise<any> | null} */ (null);
/** 视频模式人脸跟踪器：输出关键点和表情系数。优先使用图形处理器，失败时回退到中央处理器。 */
export function loadTracker(/** @type {'VIDEO' | 'IMAGE'} */ mode = 'VIDEO') {
  loading ||= (async () => {
    const { vision, files } = await visionKit();
    const make = (/** @type {string} */ delegate) => vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: VENDOR() + 'face_landmarker.task', delegate }, runningMode: mode, numFaces: 1,
      outputFaceBlendshapes: true, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5 });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
/** 人脸网格三角剖分所需的连线表（478 点模型的规范网格）。 */
export async function tessellation() {
  const { vision } = await visionKit();
  return /** @type {{ start: number, end: number }[]} */ (vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION);
}

// ───────────── One Euro 滤波 ─────────────
const alpha = (/** @type {number} */ cut, /** @type {number} */ dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
/** 向量化 One Euro 滤波：静止时强平滑，快速运动时降低延迟。speed 由调用方以“人脸尺度/秒”给出，保证不同距离下手感一致。 */
class Euro {
  constructor(/** @type {number} */ n, /** @type {number} */ minCut, /** @type {number} */ beta, dCut = 1.2) {
    this.x = new Float32Array(n); this.dx = new Float32Array(n); this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.ready = false;
  }
  /** @param {ArrayLike<number>} v @param {number} dt 秒 @param {number} unit 速度归一化单位 */
  step(v, dt, unit = 1) {
    if (!this.ready || dt <= 0 || dt > .5) { this.x.set(v); this.dx.fill(0); this.ready = true; return this.x; }
    const ad = alpha(this.dCut, dt);
    for (let i = 0; i < this.x.length; i++) {
      const raw = (v[i] - this.x[i]) / dt;
      const d = this.dx[i] = this.dx[i] + (raw - this.dx[i]) * ad;
      const a = alpha(this.minCut + this.beta * Math.abs(d) / unit, dt);
      this.x[i] += (v[i] - this.x[i]) * a;
    }
    return this.x;
  }
}

/** 位姿基准点：眼角、鼻梁、额头、下巴和脸颊外缘，受表情影响小。 */
const RIGID = [33, 133, 263, 362, 168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8, 234, 454, 152, 127, 356, 93, 323];
const N = 478;
/** @typedef {{ mouth: number, smile: number, blinkL: number, blinkR: number, brow: number, pucker: number, cheek: number }} Expr */
/**
 * 平滑后的人脸状态，坐标为视频像素（未镜像，y 向下，z 与 x 同尺度、远离镜头为正）。
 * @typedef {{ pts: Float32Array, O: number[], X: number[], Y: number[], Z: number[], iod: number, yaw: number, pitch: number, roll: number, expr: Expr, seen: number, vw: number, vh: number }} Track
 */

/** 创建一条人脸轨迹。push() 接收每帧检测结果，lost() 处理短暂丢失。 */
export function createTrack() {
  const rigid = [new Euro(2, 1.1, 7), new Euro(1, 1.1, 6), new Euro(1, .9, 4)];   // 中心、角度、尺度
  const shape = new Euro(N * 3, 2.4, 4.5);
  const local = new Float32Array(N * 3), out = new Float32Array(N * 3);
  /** @type {Track | null} */ let state = null;
  let lastT = 0, lostSince = 0;
  /** @type {Expr} */ const expr = { mouth: 0, smile: 0, blinkL: 0, blinkR: 0, brow: 0, pucker: 0, cheek: 0 };

  function push(/** @type {{ x: number, y: number, z: number }[]} */ lm, /** @type {any[]} */ blend, /** @type {number} */ tMs, /** @type {number} */ vw, /** @type {number} */ vh) {
    const dt = lastT ? (tMs - lastT) / 1000 : 0; lastT = tMs; lostSince = 0;
    let cx = 0, cy = 0;
    for (const i of RIGID) { cx += lm[i].x * vw; cy += lm[i].y * vh; }
    cx /= RIGID.length; cy /= RIGID.length;
    let ss = 0;
    for (const i of RIGID) ss += (lm[i].x * vw - cx) ** 2 + (lm[i].y * vh - cy) ** 2;
    const s = Math.sqrt(ss / RIGID.length) || 1;
    const ang = Math.atan2((lm[263].y - lm[33].y) * vh, (lm[263].x - lm[33].x) * vw);
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    for (let i = 0; i < N; i++) {
      const p = lm[i] || lm[0], dx = p.x * vw - cx, dy = p.y * vh - cy;
      local[i * 3] = (dx * cos - dy * sin) / s; local[i * 3 + 1] = (dx * sin + dy * cos) / s; local[i * 3 + 2] = p.z * vw / s;
    }
    // 角度展开，避免在 ±π 处跳变。
    const prevA = rigid[1].ready ? rigid[1].x[0] : ang;
    const a0 = ang + Math.round((prevA - ang) / (2 * Math.PI)) * 2 * Math.PI;
    const c = rigid[0].step([cx, cy], dt, s), A = rigid[1].step([a0], dt, 1)[0], S = rigid[2].step([s], dt, s)[0];
    const q = shape.step(local, dt, 1);
    const ca = Math.cos(A), sa = Math.sin(A);
    for (let i = 0; i < N; i++) {
      const x = q[i * 3] * S, y = q[i * 3 + 1] * S;
      out[i * 3] = c[0] + x * ca - y * sa; out[i * 3 + 1] = c[1] + x * sa + y * ca; out[i * 3 + 2] = q[i * 3 + 2] * S;
    }
    // 表情系数：指数平滑，张嘴与眨眼保持灵敏。
    if (blend?.length) {
      /** @type {Record<string, number>} */ const m = {};
      for (const k of blend) m[k.categoryName] = k.score;
      const ease = (/** @type {keyof Expr} */ key, /** @type {number} */ v, k = .55) => { expr[key] += (v - expr[key]) * k; };
      ease('mouth', m.jawOpen || 0, .6); ease('smile', ((m.mouthSmileLeft || 0) + (m.mouthSmileRight || 0)) / 2);
      ease('blinkL', m.eyeBlinkLeft || 0, .7); ease('blinkR', m.eyeBlinkRight || 0, .7); ease('brow', m.browInnerUp || 0);
      ease('pucker', m.mouthPucker || 0); ease('cheek', m.cheekPuff || 0);
    }
    state = frame(out, tMs, vw, vh, expr);
    return state;
  }
  /** 短暂丢失时保留上一状态，避免贴纸闪烁；超过 280 毫秒后清除。 */
  function lost(/** @type {number} */ tMs) {
    if (!state) return null;
    lostSince ||= tMs;
    if (tMs - lostSince > 280) { state = null; lastT = 0; for (const e of [...rigid, shape]) e.ready = false; }
    return state;
  }
  return { push, lost, get state() { return state; }, reset() { state = null; lastT = 0; for (const e of [...rigid, shape]) e.ready = false; } };
}

const sub = (/** @type {Float32Array} */ p, /** @type {number} */ a, /** @type {number} */ b) => [p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]];
const norm = (/** @type {number[]} */ v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 由关键点求人脸坐标系：X 指向画面右侧的眼睛，Y 指向额头，Z 指向镜头。 */
function frame(/** @type {Float32Array} */ p, /** @type {number} */ t, /** @type {number} */ vw, /** @type {number} */ vh, /** @type {Expr} */ expr) {
  const X = norm(sub(p, 263, 33));
  const up = sub(p, 10, 152), d = dot(up, X);
  const Y = norm([up[0] - d * X[0], up[1] - d * X[1], up[2] - d * X[2]]);
  const Z = cross(X, Y);
  const O = [(p[468 * 3] + p[473 * 3]) / 2, (p[468 * 3 + 1] + p[473 * 3 + 1]) / 2, (p[468 * 3 + 2] + p[473 * 3 + 2]) / 2];
  const e = sub(p, 473, 468), iod = Math.hypot(e[0], e[1], e[2]) || 1;
  return /** @type {Track} */ ({ pts: p, O, X, Y, Z, iod, yaw: Math.atan2(Z[0], -Z[2]), pitch: Math.asin(Math.max(-1, Math.min(1, -Z[1]))), roll: Math.atan2(X[1], X[0]),
    expr: { ...expr }, seen: t, vw, vh });
}

// ───────────── 兼容接口：照片工作室的构图检查 ─────────────
/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {{ pts: Pt[], center: Pt, eyeL: Pt, eyeR: Pt, nose: Pt, top: Pt, chin: Pt, cheekL: Pt, cheekR: Pt, width: number, height: number, roll: number, seen: number }} Face */
/** 选取构图需要的关键点。 @param {Pt[]} lm @param {number} aspect 原图宽度除以高度。 */
export function summarise(lm, aspect) {
  const p = (/** @type {number} */ i) => lm[i];
  const eyeL = lm[468] || mid(p(33), p(133)), eyeR = lm[473] || mid(p(263), p(362));
  const top = p(10), chin = p(152), cheekL = p(234), cheekR = p(454), nose = p(1);
  const dx = (eyeR.x - eyeL.x) * aspect, dy = eyeR.y - eyeL.y;
  return {
    pts: lm, eyeL, eyeR, nose, top, chin, cheekL, cheekR,
    center: { x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2 },
    width: Math.hypot((cheekR.x - cheekL.x) * aspect, cheekR.y - cheekL.y),
    height: Math.hypot((chin.x - top.x) * aspect, chin.y - top.y),
    roll: Math.atan2(dy, dx), seen: performance.now(),
  };
}
const mid = (/** @type {Pt} */ a, /** @type {Pt} */ b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 在静态照片中寻找人脸，为照片工作室提供构图指引。 @param {CanvasImageSource & { width: number, height: number }} img */
export async function findFace(img) {
  const t = await imageTracker();
  const res = t.detect(img);
  const lm = res?.faceLandmarks?.[0];
  return lm?.length ? summarise(lm, img.width / img.height) : null;
}
let imageLoading = /** @type {Promise<any> | null} */ (null);
function imageTracker() {
  imageLoading ||= (async () => {
    const { vision, files } = await visionKit();
    return vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: VENDOR() + 'face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
  })();
  imageLoading.catch(() => { imageLoading = null; });
  return imageLoading;
}

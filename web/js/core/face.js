/** 通过 478 个 MediaPipe 关键点和头发分割模型在本地识别人脸，分析始终留在设备上。推导可编辑蒙版（白色像素）、区域命中测试以及局部编辑预览高亮。涵盖刘海、眉毛、眼妆、嘴唇、胡须和发色，并额外包括腮红、耳饰、头饰与表情区域。对无法识别的人脸（包括夸张卡通形象）返回 null，以便界面提供对话或画笔替代方式。 */
import { asset, hushVision } from './dom.js';
import { canvasOf } from './image.js';

const VENDOR = () => new URL(asset('vendor/mediapipe/'), location.href).href;

/** 人脸轮廓，从额头顶部开始。 */
export const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const BROWS = [[70, 63, 105, 66, 107, 55, 65, 52, 53, 46], [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]];
const EYES = [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]];
export const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];

/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {{ brows: Pt[][], lowerFace: Pt[], samples: [Pt, Pt, Pt] }} HairExclusion */
/** @typedef {{ pts: Pt[], w: number, h: number, box: [number, number, number, number], regions?: Record<string, Pt[][]>, hairExclusion?: HairExclusion }} Face */

let kit = /** @type {Promise<{ vision: any, files: any }> | null} */ (null);
function visionKit() {
  kit ||= import(/* @vite-ignore */ VENDOR() + 'vision_bundle.mjs').then(async vision => ({ vision, files: await vision.FilesetResolver.forVisionTasks(VENDOR() + 'wasm') }));
  kit.catch(() => { kit = null; });
  return kit;
}
/** 抑制 MediaPipe 启动噪声日志。 */
const quiet = hushVision;
let landmarker = /** @type {Promise<any> | null} */ (null);
function stillLandmarker() {
  landmarker ||= (async () => {
    quiet();
    const { vision, files } = await visionKit();
    return vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: VENDOR() + 'face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: .35 });
  })();
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}
let segmenter = /** @type {Promise<any> | null} */ (null);
function hairModel() {
  segmenter ||= (async () => {
    quiet();
    const { vision, files } = await visionKit();
    return vision.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: VENDOR() + 'hair_segmenter.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
  })();
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

export const make = (/** @type {number} */ w, /** @type {number} */ h) => canvasOf(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const at = (/** @type {Face} */ f, /** @type {number[]} */ idx) => idx.map(i => f.pts[i]);

/** 将最长边缩放到 768 像素，以提高人脸检测效率。 @param {CanvasImageSource & { width?: number, height?: number, naturalWidth?: number, naturalHeight?: number }} img */
export function canvasFrom(img, longest = 768) {
  const w0 = /** @type {any} */ (img).naturalWidth || img.width || 1, h0 = /** @type {any} */ (img).naturalHeight || img.height || 1;
  const k = Math.min(1, longest / Math.max(w0, h0));
  const c = make(w0 * k, h0 * k);
  /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true })).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const faces = new WeakMap();
/** 以画布像素坐标表示的人脸，未找到时为 null。 @param {HTMLCanvasElement} c @returns {Promise<Face | null>} */
export function faceOf(c) {
  if (!faces.has(c)) faces.set(c, (async () => {
    try {
      const lm = await stillLandmarker();
      const res = lm.detect(c);
      const raw = res?.faceLandmarks?.[0];
      if (!raw?.length) return null;
      const pts = raw.map((/** @type {any} */ p) => ({ x: p.x * c.width, y: p.y * c.height }));
      const xs = OVAL.map(i => pts[i].x), ys = OVAL.map(i => pts[i].y), x0 = Math.min(...xs), y0 = Math.min(...ys);
      return /** @type {Face} */ ({ pts, w: c.width, h: c.height, box: [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0] });
    } catch { return null; }
  })());
  return faces.get(c);
}

const hairs = new WeakMap();
/** 与分割模型分辨率一致的头发蒙版；白色表示头发，不可用时返回 null。 @param {HTMLCanvasElement} c @returns {Promise<HTMLCanvasElement | null>} */
export function hairOf(c) {
  if (!hairs.has(c)) hairs.set(c, (async () => {
    try {
      const seg = await hairModel();
      return await new Promise(resolve => seg.segment(c, (/** @type {any} */ res) => {
        const masks = res?.confidenceMasks, m = masks?.[masks.length - 1];
        if (!m) { resolve(null); return; }
        resolve(hairMask(m.getAsFloat32Array(), m.width, m.height));
      }));
    } catch { return null; }
  })());
  return hairs.get(c);
}
/** @param {Float32Array} data @param {number} w @param {number} h */
function hairMask(data, w, h) {
  const out = make(w, h), x = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d')), img = x.createImageData(w, h);
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(0, Math.min(1, (data[i] - .28) / .3));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = v * 255;
    if (v > .5) count++;
  }
  if (count / data.length <= .004) return null;
  x.putImageData(img, 0, 0);
  const soft = make(w, h), sx = /** @type {CanvasRenderingContext2D} */ (soft.getContext('2d', { willReadFrequently: true }));
  sx.filter = 'blur(' + Math.max(1, w / 160).toFixed(1) + 'px)'; sx.drawImage(out, 0, 0); sx.filter = 'none';
  const clean = sx.getImageData(0, 0, w, h);
  for (let i = 3; i < clean.data.length; i += 4) clean.data[i] = Math.max(0, Math.min(255, (clean.data[i] - 70) * 1.6));
  sx.putImageData(clean, 0, 0);
  return soft;
}

/** 以中心为基准，按系数 k 放大形状。 @param {Pt[]} s @param {number} k */
function grow(s, k, ky = k) {
  const cx = s.reduce((a, p) => a + p.x, 0) / s.length, cy = s.reduce((a, p) => a + p.y, 0) / s.length;
  return s.map(p => ({ x: cx + (p.x - cx) * (1 + k), y: cy + (p.y - cy) * (1 + ky) }));
}
/** 椭圆的多边形近似。 */
const ellipse = (/** @type {Pt} */ c, /** @type {number} */ rx, /** @type {number} */ ry, n = 28) => Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos(i / n * Math.PI * 2) * rx, y: c.y + Math.sin(i / n * Math.PI * 2) * ry }));

/** 各面部区域的可编辑形状，使用像素坐标。 @param {Face} f @returns {Record<string, Pt[][]>}
 */
export function shapesOf(f) {
  if (f.regions) return f.regions;
  const [bx, by, bw, bh] = f.box, oval = at(f, OVAL), up = bh * .3;
  const brows = BROWS.map(b => at(f, b)), eyes = EYES.map(e => at(f, e));
  // 刘海区域：从头顶到眉毛下缘，两侧从太阳穴延伸到颧骨。
  const top = at(f, [162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389]).map(p => ({ x: p.x + (p.x - (bx + bw / 2)) * .12, y: p.y - up }));
  const browLow = (/** @type {Pt[]} */ b) => b.slice(5).map(p => ({ x: p.x, y: p.y + bh * .025 }));
  const right = at(f, [389, 356, 454]).map(p => ({ x: p.x + bw * .06, y: p.y })), left = at(f, [234, 127, 162]).map(p => ({ x: p.x - bw * .06, y: p.y }));
  const bangs = [...top, ...right, { x: f.pts[263].x + bw * .04, y: f.pts[263].y }, ...browLow(brows[1]).reverse(), ...browLow(brows[0]), { x: f.pts[33].x - bw * .04, y: f.pts[33].y }, ...left];
  // 胡须：鼻子以下的面部，以及下巴下方的颈部。
  const jaw = at(f, [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454]);
  const beard = [...jaw.slice(0, 10), ...jaw.slice(10, 11).map(p => ({ x: p.x, y: p.y + bh * .22 })), ...jaw.slice(11), ...at(f, [322, 2, 92]).map(p => ({ x: p.x, y: p.y - bh * .01 }))];
  // 腮红：颧骨下方的两个区域。
  const cheeks = [ellipse(f.pts[50], bw * .14, bh * .085), ellipse(f.pts[280], bw * .14, bh * .085)];
  // 耳饰：耳垂下方、人脸轮廓之外。
  const earL = { x: f.pts[234].x - bw * .06, y: f.pts[234].y + bh * .16 }, earR = { x: f.pts[454].x + bw * .06, y: f.pts[454].y + bh * .16 };
  const ears = [ellipse(earL, bw * .13, bh * .2), ellipse(earR, bw * .13, bh * .2)];
  // 头饰：额头与头顶上方的宽阔区域。
  const crown = at(f, [234, 127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 356, 454]);
  const head = [...crown.map(p => ({ x: bx + bw / 2 + (p.x - (bx + bw / 2)) * 1.35, y: p.y - bh * .02 })).reverse(), ...crown.map(p => ({ x: bx + bw / 2 + (p.x - (bx + bw / 2)) * 1.45, y: p.y - bh * .62 }))];
  // 眼镜：横跨眼睛和眉毛的带状区域。
  const glasses = [grow([...at(f, [70, 63, 105, 66, 107, 9, 336, 296, 334, 293, 300]), ...at(f, [446, 261, 448, 449, 450, 451, 452, 453, 464, 413, 168, 189, 244, 233, 232, 231, 230, 229, 228, 31, 226])], .12, .25)];
  return {
    bangs: [bangs], brows: brows.map(b => grow(b, .45, 1.1)), eyes: eyes.map(e => grow(e, .55, 1.4)), lips: [grow(at(f, LIPS), .18, .3)], beard: [beard],
    blush: cheeks, ears, head: [head], glasses, face: [grow(oval, .04, .04)],
  };
}

/** 从头发蒙版中去除眉毛和下半脸（包括存在的胡须），避免错误识别区域被染色。 @param {CanvasRenderingContext2D} x @param {Face} f @param {boolean} beard @param {number} [k] 蒙版相对于检测人脸图片的缩放比例。
 */
function clearNotHair(x, f, beard, k = 1) {
  const s = shapesOf(f), path = (/** @type {Pt[]} */ pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x * k, p.y * k) : x.moveTo(p.x * k, p.y * k))); x.closePath(); };
  x.save(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = x.strokeStyle = '#fff'; x.lineJoin = 'round';
  for (const b of s.beard) {
    path(beard ? b : (f.hairExclusion?.lowerFace || [...b.slice(2, 19), ...b.slice(21)]));
    x.fill();
    if (beard) { x.lineWidth = f.box[2] * k * .36; x.stroke(); }
  }
  for (const b of f.hairExclusion?.brows || BROWS.map(i => grow(at(f, i), .12, .55))) { path(b); x.fill(); }
  x.restore();
}
/** 依据下巴明显深于颧骨的程度，估计是否存在胡须。 @param {HTMLCanvasElement} pic @param {Face} f */
function bearded(pic, f) {
  const x = /** @type {CanvasRenderingContext2D} */ (pic.getContext('2d', { willReadFrequently: true })), kx = pic.width / f.w, ky = pic.height / f.h, r = Math.max(1, Math.round(f.box[2] * kx * .025));
  const lum = (/** @type {Pt} */ p) => {
    const d = x.getImageData(Math.round(p.x * kx) - r, Math.round(p.y * ky) - r, 2 * r + 1, 2 * r + 1).data; let s = 0;
    for (let k = 0; k < d.length; k += 4) s += .2126 * d[k] + .7152 * d[k + 1] + .0722 * d[k + 2];
    return s / (d.length / 4);
  };
  const mid = (/** @type {number} */ a, /** @type {number} */ b) => ({ x: (f.pts[a].x + f.pts[b].x) / 2, y: (f.pts[a].y + f.pts[b].y) / 2 });
  try {
    const [chin, left, right] = f.hairExclusion?.samples || [mid(17, 152), f.pts[50], f.pts[280]];
    return lum(chin) < (lum(left) + lum(right)) / 2 * .6;
  } catch { return false; }
}

/** 区域形状映射：发色与发型使用头发分割，其他部位使用面部几何形状。 */
const SHAPE = /** @type {Record<string, string>} */ ({ bangs: 'bangs', brows: 'brows', eyes: 'eyes', lips: 'lips', beard: 'beard', blush: 'blush', colour: 'hair', cut: 'hair', earrings: 'ears', glasses: 'glasses', headwear: 'head', expression: 'face' });
export const regionOf = (/** @type {string} */ part) => SHAPE[part] || '';

/** 返回与画布分辨率一致的羽化编辑蒙版，白色表示可编辑。头发使用分割结果，或返回 null。 @param {HTMLCanvasElement} picture @param {Face} f @param {string} part
 * @returns {Promise<HTMLCanvasElement | null>}
 */
export async function maskOf(picture, f, part) {
  const w = picture.width, h = picture.height, c = make(w, h), x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const kind = regionOf(part);
  if (kind === 'hair') {
    const hair = await hairOf(picture); if (!hair) return null;
    x.drawImage(hair, 0, 0, w, h);
    x.globalCompositeOperation = 'destination-out'; x.filter = 'blur(' + Math.max(1.5, w / 200).toFixed(1) + 'px)'; x.fillStyle = '#fff';
    clearNotHair(x, f, bearded(picture, f));
    x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    if (part === 'cut') {   // 在头发周围预留空间，以支持更长或更蓬松的发型。
      const grown = make(w, h), gx = /** @type {CanvasRenderingContext2D} */ (grown.getContext('2d'));
      gx.filter = 'blur(' + Math.max(4, w / 30).toFixed(1) + 'px)'; for (let i = 0; i < 3; i++) gx.drawImage(c, 0, 0); gx.filter = 'none';
      const [bx, by, bw, bh] = f.box;   // 包括肩膀上方头部的两侧，以允许生成更长的头发。
      gx.fillStyle = '#fff'; gx.beginPath(); gx.ellipse(bx + bw / 2, by + bh * .55, bw * 1.15, bh * 1.25, 0, 0, Math.PI * 2); gx.fill();
      gx.globalCompositeOperation = 'destination-out'; gx.beginPath(); gx.ellipse(bx + bw / 2, by + bh * .62, bw * .42, bh * .44, 0, 0, Math.PI * 2); gx.fill();
      return grown;
    }
    return c;
  }
  const shapes = shapesOf(f)[kind]; if (!shapes) return null;
  x.filter = 'blur(' + Math.max(1.5, w / 260).toFixed(1) + 'px)'; x.fillStyle = '#fff';
  for (const s of shapes) { x.beginPath(); s.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill(); }
  return c;
}

/** @param {Pt[]} s @param {number} px @param {number} py */
function inside(s, px, py) {
  let on = false;
  for (let i = 0, j = s.length - 1; i < s.length; j = i++) { const a = s[i], b = s[j]; if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) on = !on; }
  return on;
}
/** 使用画布像素进行命中测试，优先匹配眉毛等小区域；脸部上方会选中头发。 @param {Face} f @param {number} px @param {number} py @returns {string | null}
 */
export function partAt(f, px, py) {
  const s = shapesOf(f);
  const order = /** @type {[string, string][]} */ ([['eyes', 'eyes'], ['brows', 'brows'], ['lips', 'lips'], ['blush', 'blush'], ['bangs', 'bangs'], ['beard', 'beard'], ['ears', 'earrings'], ['face', 'expression']]);
  for (const [shape, part] of order) if (s[shape]?.some(sh => inside(sh, px, py))) return part;
  const [bx, by, bw, bh] = f.box;
  if (py < by + bh * .2 && px > bx - bw * .45 && px < bx + bw * 1.45) return 'colour';
  return null;
}

/** 高亮区域轮廓，将检测画布坐标转换为显示坐标。 @param {CanvasRenderingContext2D} x @param {Face} f @param {string} part @param {number} sx @param {number} sy @param {number} t
 */
export function outline(x, f, part, sx, sy, t) {
  const kind = regionOf(part);
  if (!kind || kind === 'hair') return false;
  const shapes = shapesOf(f)[kind] || [];
  x.save();
  x.lineWidth = 2; x.setLineDash([7, 6]); x.lineDashOffset = -t / 40;
  x.strokeStyle = 'rgba(255,255,255,.95)'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 4;
  x.fillStyle = 'rgba(255,255,255,.12)';
  for (const s of shapes) {
    x.beginPath(); s.forEach((p, i) => (i ? x.lineTo(p.x * sx, p.y * sy) : x.moveTo(p.x * sx, p.y * sy))); x.closePath();
    x.fill(); x.stroke();
  }
  x.restore();
  return true;
}

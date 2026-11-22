/** 通过 MediaPipe 在本地跟踪 478 个人脸关键点；跟踪过程中相机画面留在设备上。优先使用图形处理器，并可回退到中央处理器。模型和运行时文件位于 vendor/；平滑处理使贴纸保持稳定。 */
import { asset, hushVision } from '../core/dom.js';

const VENDOR = () => new URL(asset('vendor/mediapipe/'), location.href).href;
let loading = /** @type {Promise<any> | null} */ (null);

/** 抑制 MediaPipe 启动噪声日志。 */
const quiet = hushVision;

export function loadTracker(/** @type {'VIDEO' | 'IMAGE'} */ mode = 'VIDEO') {
  loading ||= (async () => {
    quiet();
    const base = VENDOR();
    const vision = await import(/* @vite-ignore */ base + 'vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(base + 'wasm');
    const make = (/** @type {string} */ delegate) => vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate }, runningMode: mode, numFaces: 1,
      minFaceDetectionConfidence: .45, minTrackingConfidence: .45 });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** @typedef {{ x: number, y: number }} Pt */
/** 使用归一化原图坐标表示的关键面部几何信息，y 轴向下。 @typedef {{ pts: Pt[], center: Pt, eyeL: Pt, eyeR: Pt, nose: Pt, top: Pt, chin: Pt, cheekL: Pt, cheekR: Pt, width: number, height: number, roll: number, seen: number }} Face
 */

/** 选取贴纸与人脸形变需要的关键点。 @param {Pt[]} lm @param {number} aspect 原图宽度除以高度。 */
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

/** 混合连续帧，在动作更快时提高响应速度。 @param {Face | null} prev @param {Face} next */
export function smoothFace(prev, next) {
  if (!prev || next.seen - prev.seen > 400) return next;
  const move = Math.hypot(next.center.x - prev.center.x, next.center.y - prev.center.y) / Math.max(.05, next.width);
  const k = Math.min(1, .35 + move * 2.5);
  const lerp = (/** @type {Pt} */ a, /** @type {Pt} */ b) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  return { ...next, center: lerp(prev.center, next.center), eyeL: lerp(prev.eyeL, next.eyeL), eyeR: lerp(prev.eyeR, next.eyeR), nose: lerp(prev.nose, next.nose),
    top: lerp(prev.top, next.top), chin: lerp(prev.chin, next.chin), cheekL: lerp(prev.cheekL, next.cheekL), cheekR: lerp(prev.cheekR, next.cheekR),
    width: prev.width + (next.width - prev.width) * k, height: prev.height + (next.height - prev.height) * k, roll: prev.roll + (next.roll - prev.roll) * k };
}

/** 在静态照片中寻找人脸，为照片工作室提供构图指引。 @param {CanvasImageSource & { width: number, height: number }} img */
export async function findFace(img) {
  const { loadImageTracker } = { loadImageTracker: imageTracker };
  const t = await loadImageTracker();
  const res = t.detect(img);
  const lm = res?.faceLandmarks?.[0];
  return lm?.length ? summarise(lm, img.width / img.height) : null;
}
let imageLoading = /** @type {Promise<any> | null} */ (null);
function imageTracker() {
  imageLoading ||= (async () => {
    quiet();
    const base = VENDOR();
    const vision = await import(/* @vite-ignore */ base + 'vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(base + 'wasm');
    return vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
  })();
  imageLoading.catch(() => { imageLoading = null; });
  return imageLoading;
}

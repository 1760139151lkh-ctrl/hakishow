/** 实时人像分割：在设备本地把人物与背景分开，用于背景虚化与风格场景替换。
 * 结果做时间平滑后作为灰度纹理交给渲染器；分割失败或不可用时自动回退为原始背景。 */
import { visionKit, vendorUrl } from './tracker.js';

let loading = /** @type {Promise<any> | null} */ (null);
export function loadSegmenter() {
  loading ||= (async () => {
    const { vision, files } = await visionKit();
    const make = (/** @type {string} */ delegate) => vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: vendorUrl('selfie_segmenter.tflite'), delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** 平滑后的人像蒙版（0–255）。 */
export function createMask() {
  let px = /** @type {Uint8Array | null} */ (null), w = 0, h = 0;
  return {
    /** @param {any} seg @param {HTMLVideoElement} video @param {number} t */
    update(seg, video, t) {
      let ok = false;
      seg.segmentForVideo(video, t, (/** @type {any} */ res) => {
        const masks = res?.confidenceMasks, m = masks?.[0];
        if (!m) return;
        const f = m.getAsFloat32Array();
        if (!px || m.width !== w || m.height !== h) { w = m.width; h = m.height; px = new Uint8Array(w * h); for (let i = 0; i < f.length; i++) px[i] = f[i] * 255; }
        else for (let i = 0; i < f.length; i++) px[i] = px[i] * .35 + f[i] * 255 * .65;
        ok = true;
      });
      return ok ? { px: /** @type {Uint8Array} */ (px), w, h } : null;
    },
  };
}

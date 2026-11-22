/** 按下快门后，立即在结果页显示拍摄画面，同时继续进行压缩、存储、上传和生成。作品记录创建后，结果页改为跟踪其实际进度。 */
/** @type {Map<string, { canvas: HTMLCanvasElement, work: Promise<string> }>} */
const shots = new Map();
export function holdShot(/** @type {string} */ token, /** @type {HTMLCanvasElement} */ canvas, /** @type {Promise<string>} */ work) {
  shots.set(token, { canvas, work });
  work.finally(() => setTimeout(() => shots.delete(token), 60000)).catch(() => {});
}
export const shotOf = (/** @type {string} */ token) => shots.get(token) || null;

/** 每件作品的快门预览仅存在于内存中：Blob 地址在刷新后失效，不得放入 sessionStorage。 */
const previews = new Map();
export const setPreview = (/** @type {string} */ id, /** @type {string} */ url) => previews.set(id, url);
export const previewOf = (/** @type {string} */ id) => previews.get(id) || '';

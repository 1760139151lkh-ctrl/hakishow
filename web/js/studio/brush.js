/** 画笔选区：涂抹可编辑区域、调整画笔大小、擦除、撤销一笔或清空全部。显示半透明的选区高亮，并提交以白色像素标记可编辑区域的蒙版。 */
import { themeAccent } from '../core/dom.js';
import { canvasOf } from '../core/image.js';

/** @typedef {{ pts: { x: number, y: number }[], size: number, erase: boolean }} Stroke 相对于图片、范围为 0 到 1 的坐标。 */

/** @param {HTMLCanvasElement} canvas Overlay above the image. @param {{ onChange?: () => void, target?: HTMLElement }} [o] */
export function createBrush(canvas, o = {}) {
  /** @type {Stroke[]} */ let strokes = [];
  let size = .06, erase = false, on = false;
  /** @type {Stroke | null} */ let live = null;
  const x = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const target = o.target || canvas;

  function fit() {
    const r = target.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    draw();
  }
  /** 将所有笔画渲染到二维上下文，用于显示或导出蒙版。 */
  function render(/** @type {CanvasRenderingContext2D} */ c, /** @type {number} */ W, /** @type {number} */ H, /** @type {string} */ ink) {
    c.clearRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of [...strokes, ...(live ? [live] : [])]) {
      c.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      c.strokeStyle = ink; c.fillStyle = ink;
      c.lineWidth = s.size * Math.min(W, H);
      if (s.pts.length === 1) { c.beginPath(); c.arc(s.pts[0].x * W, s.pts[0].y * H, c.lineWidth / 2, 0, Math.PI * 2); c.fill(); continue; }
      c.beginPath();
      s.pts.forEach((p, i) => (i ? c.lineTo(p.x * W, p.y * H) : c.moveTo(p.x * W, p.y * H)));
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }
  function draw() {
    const accent = themeAccent(canvas);
    x.save();
    render(x, canvas.width, canvas.height, accent);
    // 半透明效果让下方图片保持可见。
    x.globalCompositeOperation = 'source-in'; x.fillStyle = accent; x.globalAlpha = .5; x.fillRect(0, 0, canvas.width, canvas.height);
    x.restore();
  }
  const at = (/** @type {PointerEvent} */ e) => { const r = target.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))), y: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))) }; };
  target.addEventListener('pointerdown', e => {
    if (!on) return;
    e.preventDefault(); target.setPointerCapture(e.pointerId);
    live = { pts: [at(e)], size, erase };
    draw();
  });
  target.addEventListener('pointermove', e => {
    if (!on || !live) return;
    const p = at(e), last = live.pts[live.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > .004) { live.pts.push(p); draw(); }
  });
  const end = () => { if (!live) return; strokes.push(live); live = null; draw(); o.onChange?.(); };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);

  return {
    fit,
    /** 启用或禁用绘画；已有笔画在清空前持续可见。 */
    enable(/** @type {boolean} */ v) { on = v; canvas.classList.toggle('is-painting', v); fit(); },
    setSize(/** @type {number} */ v) { size = v; },
    setErase(/** @type {boolean} */ v) { erase = v; },
    get erase() { return erase; },
    undo() { strokes.pop(); draw(); o.onChange?.(); },
    clear() { strokes = []; draw(); o.onChange?.(); },
    get empty() { return !strokes.some(s => !s.erase); },
    get count() { return strokes.length; },
    /** 按原图分辨率导出：白色像素可编辑，透明像素保持不变。map 描述 object-fit: cover 的摆放方式。 @param {number} W @param {number} H @param {{ s: number, ox: number, oy: number, bw: number, bh: number }} map
     * @returns {Promise<Blob>}
     */
    mask(W, H, map) {
      const box = canvasOf(Math.max(1, Math.round(map.bw)), Math.max(1, Math.round(map.bh)));
      render(/** @type {CanvasRenderingContext2D} */ (box.getContext('2d')), box.width, box.height, '#fff');
      const c = canvasOf(W, H);
      const mx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      mx.filter = 'blur(' + Math.max(2, Math.round(Math.min(W, H) / 160)) + 'px)';
      mx.drawImage(box, -map.ox / map.s, -map.oy / map.s, map.bw / map.s, map.bh / map.s);
      return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('蒙版导出失败。'))), 'image/png'));
    },
  };
}

/** object-fit: cover 摆放方式，包含缩放系数 s 和相框内的像素偏移 ox/oy。 */
export function coverMap(/** @type {number} */ bw, /** @type {number} */ bh, /** @type {number} */ iw, /** @type {number} */ ih) {
  const s = Math.max(bw / Math.max(1, iw), bh / Math.max(1, ih));
  return { s, ox: (bw - iw * s) / 2, oy: (bh - ih * s) / 2, bw, bh };
}


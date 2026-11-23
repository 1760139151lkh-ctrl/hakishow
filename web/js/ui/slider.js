/** 跟手滑杆：手指按在哪里，圆点就在哪里。
 *  - 按在圆点上拖动时保留按下的相对位置，圆点不会跳；按在轨道其他位置，圆点直接移到手指下方。
 *  - 填充条终点与圆点中心严格对齐：轨道两端各留出半个圆点的余量。
 *  - 拖动时圆点连续跟随手指，数值按档位取整；松手后圆点平滑吸附到所在档位。
 *  - 拖动时在圆点上方显示数值气泡；经过默认值时轻微吸附并振动提示，轨道上的小点标出默认值。
 *  - 键盘：方向键 ±1 档，PageUp / PageDown ±10%，Home / End 到两端。
 */
import { h, clamp } from '../core/dom.js';
import { buzz } from './fx.js';

/**
 * @typedef {{ el: HTMLElement, readonly value: number, set: (v: number) => void, setMark: (m: number | null) => void }} Slider
 * @param {{ value: number, label: string, min?: number, max?: number, step?: number, mark?: number | null, tone?: 'light' | 'dark',
 *   format?: (v: number) => string, onInput?: (v: number) => void, onChange?: (v: number, from: number) => void }} o
 * @returns {Slider}
 */
export function slider(o) {
  const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1, span = max - min || 1;
  let value = snap(o.value), mark = o.mark ?? null, from = value, pid = -1, grab = 0, R = 12;
  /** @type {DOMRect | null} */ let box = null;
  const fmt = o.format || ((/** @type {number} */ v) => String(Math.round(v)));
  const fill = h('span.sl__fill'), dot = h('span.sl__mark'), thumb = h('span.sl__thumb'), tip = h('span.sl__tip');
  const el = h('div.sl', { role: 'slider', tabindex: '0', 'aria-label': o.label, 'aria-valuemin': String(min), 'aria-valuemax': String(max), class: o.tone === 'dark' ? 'sl--dark' : '' },
    h('span.sl__track', null, fill, dot), thumb, tip);

  function snap(/** @type {number} */ v) { return clamp(Math.round((v - min) / step) * step + min, min, max); }
  /** 画到连续位置 v（拖动中）；数值文字与无障碍属性始终使用取整后的值。 */
  function paint(/** @type {number} */ v) {
    el.style.setProperty('--k', ((clamp(v, min, max) - min) / span).toFixed(4));
    const s = fmt(value);
    if (tip.textContent !== s) tip.textContent = s;
    el.setAttribute('aria-valuenow', String(value)); el.setAttribute('aria-valuetext', s);
  }
  function paintMark() { dot.hidden = mark == null; if (mark != null) el.style.setProperty('--m', ((mark - min) / span).toFixed(4)); }
  function emit(/** @type {number} */ v) { if (v === value) return; value = v; o.onInput?.(value); }
  function move(/** @type {number} */ x) {
    if (!box) return;
    let v = min + clamp((x - grab - box.left - R) / Math.max(1, box.width - 2 * R)) * span;
    if (mark != null && Math.abs(v - mark) < span * .02) { if (snap(v) !== mark && value !== mark) buzz(6); v = mark; }   // 默认值附近轻吸附
    emit(snap(v)); paint(v);
  }
  el.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
    if (e.button > 0 || pid !== -1) return;
    box = el.getBoundingClientRect();
    R = thumb.offsetWidth / 2 || R;
    const tx = box.left + R + ((value - min) / span) * (box.width - 2 * R);
    grab = Math.abs(e.clientX - tx) <= R + 8 ? e.clientX - tx : 0;   // 按在圆点上：保持相对位置，不跳动
    pid = e.pointerId; from = value;
    try { el.setPointerCapture(pid); } catch { /* 指针已释放。 */ }
    el.classList.add('is-drag');
    move(e.clientX);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => { if (e.pointerId === pid) move(e.clientX); });
  const end = (/** @type {PointerEvent} */ e) => {
    if (e.pointerId !== pid) return;
    pid = -1; el.classList.remove('is-drag'); paint(value);
    if (value !== from) o.onChange?.(value, from);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const big = Math.max(step, Math.round(span / 10 / step) * step);
    const d = /** @type {Record<string, number>} */ ({ ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big })[e.key];
    const v = d != null ? value + d : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (v == null) return;
    e.preventDefault(); e.stopPropagation();
    const f = value; emit(snap(v)); paint(value);
    if (value !== f) o.onChange?.(value, f);
  });
  paintMark(); paint(value);
  return {
    el,
    get value() { return value; },
    /** 程序设置数值，不触发回调；拖动中忽略，避免和手指抢位置。 */
    set(v) { if (pid !== -1) return; value = snap(v); paint(value); },
    setMark(m) { mark = m; paintMark(); },
  };
}

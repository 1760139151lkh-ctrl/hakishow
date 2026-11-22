/** 屏幕键盘出现时保持应用布局稳定。--app-h：键盘出现前的舞台高度，输入期间锁定，避免被压缩。--kb：舞台被键盘遮挡的像素数。--vv-top：iOS 与 Android 可能平移可视视口来显示输入框，舞台应向相反方向偏移。输入行使用 .kb-lift 上移到键盘上方，其他内容留在原位并位于键盘之后。interactive-widget=resizes-visual 仅缩放可视视口，保持布局尺寸不变。 */
const subs = new Set();
/** 键盘高度变化时通知监听器，例如将对话滚动到可见区域。 @param {(kb: number) => void} fn */
export function onKeyboard(fn) { subs.add(fn); return () => subs.delete(fn); }
let current = 0;
export const keyboardHeight = () => current;

const FIELD = 'input:not([type="range"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable="true"]';

export function watchKeyboard(/** @type {HTMLElement} */ stage) {
  const root = document.documentElement;
  let tall = 0, wide = 0, raf = 0;
  const typing = () => { const el = /** @type {HTMLElement | null} */ (document.activeElement); return !!el && el.matches(FIELD); };
  const measure = () => {
    raf = 0;
    const vv = window.visualViewport, h = window.innerHeight, w = window.innerWidth, t = typing();
    if (w !== wide) { wide = w; tall = 0; }                       // 屏幕方向或窗口变化后重新测量。
    if (!t || !tall) tall = h; else tall = Math.max(tall, h);     // 输入时保留键盘打开前测得的最大高度。
    let kb = 0, top = 0;
    if (t && vv && Math.abs(vv.scale - 1) < .01) {
      kb = Math.max(0, Math.round(tall - vv.height));
      top = Math.max(0, Math.round(vv.offsetTop));
      if (kb < 60) { kb = 0; top = 0; }                            // 硬件键盘或桌面端：没有屏幕键盘。
    }
    root.style.setProperty('--app-h', tall + 'px');
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vv-top', top + 'px');
    stage.classList.toggle('is-typing', kb > 0);
    // 将每个活动输入行抬高至恰好避开键盘。
    const box = stage.getBoundingClientRect();
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.kb-lift'))) {
      if (!kb || !el.offsetParent || !el.contains(document.activeElement)) { el.style.removeProperty('--lift'); continue; }
      const transform = getComputedStyle(el).transform;
      const offset = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
      const bottom = el.getBoundingClientRect().bottom - offset - box.top;
      el.style.setProperty('--lift', Math.max(0, Math.round(bottom - (tall - kb))) + 'px');
    }
    // 确保获得焦点的输入框在其滚动区域内完全可见。
    // 浏览器可能在面板抬升前过度滚动，应纠正输入框相对于面板的位置。
    // 仅在抬升区域内调整滚动；外部位置由 --lift 和 --vv-top 处理。
    const f = /** @type {HTMLElement | null} */ (document.activeElement), liftBox = f?.closest('.kb-lift');
    if (kb && t && f && liftBox) {
      for (let p = f.parentElement; p && liftBox.contains(p); p = p.parentElement) {
        if (!/auto|scroll/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
        const pr = p.getBoundingClientRect(), fr = f.getBoundingClientRect(), pad = 10;
        if (fr.top < pr.top + pad) p.scrollTop -= pr.top + pad - fr.top;
        else if (fr.bottom > pr.bottom - pad) p.scrollTop += fr.bottom - (pr.bottom - pad);
        break;
      }
    }
    if (kb !== current) { current = kb; for (const fn of subs) { try { fn(kb); } catch { /* 隔离各个监听器发生的错误。 */ } } }
    // 撤销旧版浏览器导致的文档滚动，由 --vv-top 处理视口偏移。
    if (t && (window.scrollY || document.scrollingElement?.scrollTop)) window.scrollTo(0, 0);
    // 撤销浏览器对 overflow-hidden 容器的滚动；输入框可见性由 --lift 处理。
    // body 和 html 是固定舞台，仅在屏幕键盘可见时应用这些修正。
    if (t && kb) {
      const inLift = /** @type {HTMLElement | null} */ (document.activeElement)?.closest('.kb-lift');
      for (let p = /** @type {HTMLElement | null} */ (document.activeElement)?.parentElement; p; p = p.parentElement) {
        if (!p.scrollTop && !p.scrollLeft) continue;
        if (inLift?.contains(p) && p !== inLift) continue;   // 允许在抬升面板内部正常滚动。
        const s = getComputedStyle(p), page = p === document.body || p === document.documentElement;
        if (page || (/hidden|clip/.test(s.overflowY) && /hidden|clip/.test(s.overflowX))) { p.scrollTop = 0; p.scrollLeft = 0; }
      }
    }
  };
  const soon = () => { if (!raf) raf = requestAnimationFrame(measure); };
  measure();
  addEventListener('resize', soon);
  window.visualViewport?.addEventListener('resize', soon);
  window.visualViewport?.addEventListener('scroll', soon);
  addEventListener('scroll', () => { if (typing()) soon(); }, true);   // 输入期间发生滚动时重新测量，包括文档滚动。
  document.addEventListener('focusin', () => { soon(); setTimeout(soon, 120); setTimeout(soon, 360); setTimeout(soon, 700); });
  document.addEventListener('focusout', () => { setTimeout(soon, 60); setTimeout(soon, 400); });
  // 真正的旋转会改变宽度并触发重新测量；键盘导致视口变矮时不解除高度锁定。
  addEventListener('orientationchange', () => setTimeout(soon, 300));
}

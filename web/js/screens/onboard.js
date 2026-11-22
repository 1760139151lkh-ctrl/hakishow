/** 欢迎页：全屏故事式轮播。每一页由同一张原图被一道柔光扫过，变成一种风格的艺术肖像，配合缓慢推近的镜头；
 *  顶部进度条显示轮播位置，点击左右半屏可切换上一页／下一页，按住画面显示原图，左右拖动可自由对比。
 *  文字克制：品牌字标、一行衬线标题与一句说明；主操作为白色“开始拍摄”，次操作为“试用示例”，右上角可跳过。 */
import { h, icon, stageEl, reduced, clamp } from '../core/dom.js';
import { setPref } from '../core/data.js';
import { styleArt, personArt, hasArt } from '../core/assets.js';
import { presetById } from '../presets.js';
import { applyTheme } from '../core/theme.js';
import { T } from '../copy.js';

const TOUR = ['princess', 'ethereal', 'tarot', 'neon', 'hero', 'shoujo', 'dragon', 'retrocinema', 'heritage', 'figure'];
const SLIDE = 3200;

/** @param {{ onShoot: () => void, onSample: () => void, onSkip: () => void }} o */
export function onboard(o) {
  const who = 'mei';
  const list = TOUR.filter(id => hasArt(id, who));
  let k = 0, raf = 0, timer = 0, held = false, dragging = false, t0 = 0;
  const photo = h('img.ob__photo', { src: personArt(who), alt: '一张原始人像照片' });
  const back = /** @type {HTMLImageElement} */ (h('img.ob__back', { alt: '' }));
  const art = /** @type {HTMLImageElement} */ (h('img.ob__art', { alt: '' }));
  const beam = h('span.ob__beam', { 'aria-hidden': 'true' });
  const bars = h('div.ob__bars', { 'aria-hidden': 'true' }, ...list.map(() => h('span.ob__bar', null, h('i'))));
  const name = h('b.ob__name'), line = h('span.ob__line');
  const caption = h('p.ob__caption', { 'aria-live': 'polite' }, name, h('span.ob__dot', { 'aria-hidden': 'true' }), line);
  const was = h('span.ob__was', { 'aria-hidden': 'true' }, '原图');
  const view = h('div.ob__view', null, photo, back, art, beam, was);
  const close = (/** @type {() => void} */ then) => { setPref('onboarded', true); clearTimeout(timer); cancelAnimationFrame(raf); el.classList.add('is-out'); setTimeout(() => el.remove(), reduced ? 0 : 420); then(); };
  const el = h('div.ob', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '欢迎来到 HakiShow' }, view,
    h('div.ob__top', null, bars, h('div.ob__head', null, h('span.ob__mark', null, T.brand), h('button.ob__skip', { type: 'button', onclick: () => close(o.onSkip) }, '跳过'))),
    h('div.ob__words', null,
      caption,
      h('h1.ob__title', null, '一张自拍，', h('br'), '遇见三十三种自己。'),
      h('p.ob__sub', null, '实时特效拍摄 · 艺术肖像生成 · 局部精修'),
      h('div.ob__acts', null,
        h('button.ob__go', { type: 'button', onclick: () => close(o.onShoot) }, h('span', { html: icon('camera') }), h('span', null, '开始拍摄')),
        h('button.ob__alt', { type: 'button', onclick: () => close(o.onSample) }, h('span', null, T.sample)))));

  const setX = (/** @type {number} */ v) => view.style.setProperty('--x', (clamp(v) * 100).toFixed(2) + '%');
  /** 切换到第 i 页：旧作品留在底层，新作品由柔光从左向右扫出。 */
  function show(/** @type {number} */ i) {
    k = (i + list.length) % list.length;
    const id = list[k]; if (!id) return;
    const p = presetById(id);
    if (art.getAttribute('src')) back.src = /** @type {string} */ (art.getAttribute('src'));
    else back.src = personArt(who);
    const want = k;
    setX(0);
    art.src = styleArt(id, who);
    clearTimeout(timer); cancelAnimationFrame(raf);
    // 等新作品解码完成再开始扫光，避免文字先于画面切换。
    art.decode().catch(() => {}).then(() => { if (want === k) start(id, p); });
  }
  function start(/** @type {string} */ id, /** @type {any} */ p) {
    art.classList.remove('is-kb'); void art.offsetWidth; art.classList.add('is-kb');
    const next = list[(k + 1) % list.length]; if (next) { const pre = new Image(); pre.src = styleArt(next, who); }
    name.textContent = p?.name || ''; line.textContent = p?.hook || p?.line || '';
    bars.querySelectorAll('.ob__bar').forEach((b, j) => { b.classList.toggle('is-done', j < k); b.classList.toggle('is-now', j === k); });
    applyTheme(id);
    cancelAnimationFrame(raf);
    t0 = performance.now();
    if (reduced) { setX(1); schedule(); return; }
    const run = (/** @type {number} */ t) => {
      const e = Math.min(1, Math.max(0, (t - t0) / 1100));
      setX(1 - Math.pow(1 - e, 3));
      if (e < 1) raf = requestAnimationFrame(run);
    };
    setX(0); raf = requestAnimationFrame(run);
    schedule();
  }
  function schedule() { clearTimeout(timer); el.style.setProperty('--slide', SLIDE + 'ms'); timer = window.setTimeout(() => { if (!held && !dragging) show(k + 1); else schedule(); }, SLIDE); }

  // 按住显示原图；横向拖动自由对比；轻点左右半屏切换。
  view.addEventListener('pointerdown', e => {
    const r = view.getBoundingClientRect(), x0 = e.clientX, at = Date.now();
    held = true; el.classList.add('is-held'); clearTimeout(timer);
    const move = (/** @type {PointerEvent} */ ev) => {
      if (!dragging && Math.abs(ev.clientX - x0) > 10) { dragging = true; el.classList.remove('is-held'); cancelAnimationFrame(raf); view.setPointerCapture(ev.pointerId); }
      if (dragging) setX((ev.clientX - r.left) / r.width);
    };
    const up = (/** @type {PointerEvent} */ ev) => {
      view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); view.removeEventListener('pointercancel', up);
      el.classList.remove('is-held'); held = false;
      if (dragging) { dragging = false; schedule(); return; }
      if (Date.now() - at < 250) show(k + ((ev.clientX - r.left) < r.width * .35 ? -1 : 1)); else schedule();
    };
    view.addEventListener('pointermove', move); view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  });
  for (const id of list.slice(0, 3)) { const i = new Image(); i.src = styleArt(id, who); }
  stageEl().append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  show(0);
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(o.onSkip); if (e.key === 'ArrowRight') show(k + 1); if (e.key === 'ArrowLeft') show(k - 1); });
  // 焦点移入对话框本身（不显示按钮焦点环），键盘用户按 Tab 即可到达各个操作。
  el.tabIndex = -1;
  setTimeout(() => el.focus({ preventScroll: true }), 300);
}

/** 手把手新手引导：一步一步高亮界面上的真实按钮，配一句大白话说明。
 *  · 每步只讲一件事，带步骤进度；点“下一步”或直接点高亮的按钮都能继续，随时可以跳过。
 *  · 目标元素不存在或不可见时自动跳过该步；窗口尺寸变化、元素移动时高亮框实时跟随。
 *  · 每个引导只自动出现一次（记在偏好里），在“个人中心 → 新手教程”可以重新查看。 */
import { h, reduced } from '../core/dom.js';
import { pref, setPref } from '../core/data.js';

/** @typedef {{ at: () => Element | null | undefined, title: string, text: string, pad?: number, round?: boolean }} Step */

let running = /** @type {(() => void) | null} */ (null);
export const touring = () => !!running;

/** 地址带 ?skipintro（自动化测试和演示录制使用）时，不自动弹出新手引导。 */
const NO_AUTO = /(?:[?&])skipintro(?:[=&]|$)/.test(location.search);
/** 欢迎页、底部面板等模态层还开着时先不开始，等它们关闭，避免两层同时挡住操作。 */
const modalOpen = () => [...document.querySelectorAll('[aria-modal="true"]')].some(m => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !m.closest('[hidden]'); });

/** 是否已经看过某个引导。 */
export const toured = (/** @type {string} */ id) => !!pref('tour.' + id, false);
/** 清除全部引导记录（个人中心“新手教程”使用）。 */
export function resetTours() { for (const id of ['live', 'studio', 'edit']) setPref('tour.' + id, false); }

/**
 * 运行一个引导。once：只在第一次自动出现。
 * @param {string} id @param {Step[]} steps @param {{ once?: boolean, onDone?: () => void }} [o]
 */
export function tour(id, steps, o = {}) {
  if (o.once && (toured(id) || NO_AUTO)) return;
  if (modalOpen()) {
    // 每 0.4 秒看一次；两分钟内弹层一直没关就放弃，下次进入页面再自动出现。
    const t0 = performance.now();
    const wait = () => { if (modalOpen()) { if (performance.now() - t0 < 120000) setTimeout(wait, 400); return; } if (!running) tour(id, steps, o); };
    setTimeout(wait, 400);
    return;
  }
  running?.();
  const visible = (/** @type {Element | null | undefined} */ el) => { if (!el || !(el instanceof HTMLElement) || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && el.offsetParent !== null; };
  const list = steps.filter(s => visible(s.at()));
  if (!list.length) return;
  let i = 0, raf = 0, lostAt = 0;
  const ring = h('div.tour__ring', { 'aria-hidden': 'true' });
  const count = h('span.tour__count');
  const title = h('b.tour__title'), text = h('p.tour__text');
  const next = h('button.btn.btn--main.btn--sm.tour__next', { type: 'button', onclick: () => go(1) });
  const skip = h('button.tour__skip', { type: 'button', onclick: () => end(true) }, '跳过');
  const tip = h('div.tour__tip', { role: 'dialog', 'aria-live': 'polite', 'aria-label': '新手引导' }, h('div.tour__head', null, count, skip), title, text, h('div.tour__acts', null, next));
  const veil = h('div.tour', null, ring, tip);
  // 点高亮区域：执行真实点击并进入下一步；点其他地方不做事，避免误触。
  veil.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    if (tip.contains(/** @type {Node} */ (e.target))) return;
    const r = ring.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { const el = list[i]?.at(); go(1); if (el instanceof HTMLElement) el.click(); }
  });
  document.body.append(veil);
  function place() {
    const s = list[i], el = s?.at();
    // 目标消失（例如切换了页面）超过 1.2 秒就收起引导，下次再自动出现。
    if (!el || !visible(el)) { if (!lostAt) lostAt = performance.now(); else if (performance.now() - lostAt > 1200) { end(false); return; } raf = requestAnimationFrame(place); return; }
    lostAt = 0;
    const r = el.getBoundingClientRect(), pad = s.pad ?? 6, W = innerWidth, H = innerHeight;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', borderRadius: s.round ? '999px' : '16px' });
    // 提示气泡放在目标上方或下方空间更大的一侧，水平方向不超出屏幕。
    const below = r.top < H / 2, tw = Math.min(320, W - 24), left = Math.max(12, Math.min(W - tw - 12, r.left + r.width / 2 - tw / 2));
    tip.style.width = tw + 'px'; tip.style.left = left + 'px';
    if (below) { tip.style.top = Math.min(H - 12 - tip.offsetHeight, r.bottom + pad + 12) + 'px'; tip.style.bottom = ''; }
    else { tip.style.top = ''; tip.style.bottom = Math.min(H - 12 - tip.offsetHeight, H - r.top + pad + 12) + 'px'; }
    tip.dataset.side = below ? 'below' : 'above';
    raf = requestAnimationFrame(place);
  }
  function paint() {
    const s = list[i];
    count.textContent = '第 ' + (i + 1) + ' 步 / 共 ' + list.length + ' 步';
    title.textContent = s.title; text.textContent = s.text;
    next.textContent = i === list.length - 1 ? '我学会了' : '下一步';
    if (!reduced) tip.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function go(/** @type {number} */ d) {
    i += d;
    while (i < list.length && !visible(list[i].at())) i++;
    if (i >= list.length) { end(); return; }
    paint();
  }
  function end(finished = true) {
    cancelAnimationFrame(raf); veil.remove(); running = null;
    if (!finished) return;
    setPref('tour.' + id, true);
    o.onDone?.();
  }
  running = () => end(false);
  paint(); place();
  return end;
}

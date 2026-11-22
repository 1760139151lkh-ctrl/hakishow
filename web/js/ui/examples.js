/** 示例查看器：比较同一风格在不同肖像中的效果，下方提供两项操作。“试试这个风格”打开实时相机并选中该风格；“使用这张”在照片工作室中选择该风格。 */
import { h, icon, clamp } from '../core/dom.js';
import { go } from '../core/nav.js';
import { presetById } from '../presets.js';
import { styleArt, personArt, examplesOf, cover } from '../core/assets.js';
import { setPref, saveDraft, draft } from '../core/data.js';
import { applyTheme } from '../core/theme.js';
import { sheet } from './sheet.js';
import { T } from '../copy.js';

/** @param {string} id @param {{ onUse?: (id: string) => void }} [o] */
export function openExamples(id, o = {}) {
  const p = presetById(id); if (!p) return;
  const people = examplesOf(id);
  if (!people.length) return;
  applyTheme(id);
  const featured = cover(id).who;
  let who = people.includes(featured) ? featured : people[0];
  const before = /** @type {HTMLImageElement} */ (h('img.ex__before', { alt: '原图' }));
  const after = /** @type {HTMLImageElement} */ (h('img.ex__after', { alt: p.name + '示例' }));
  const handle = h('div.cmp__handle', { 'aria-hidden': 'true' }, h('span.cmp__knob', { html: icon('compare') }));
  const view = h('div.ex__view', { data: { frame: p.theme.frame } }, before, after, handle);
  const set = (/** @type {number} */ v) => { const k = clamp(v); view.style.setProperty('--cmp', (k * 100) + '%'); handle.style.left = (100 - k * 100) + '%'; };
  view.addEventListener('pointerdown', e => {
    const r = view.getBoundingClientRect();
    const move = (/** @type {PointerEvent} */ ev) => set(1 - (ev.clientX - r.left) / r.width);
    move(e); view.setPointerCapture(e.pointerId);
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', () => view.removeEventListener('pointermove', move), { once: true });
  });
  const pick = h('div.ex__who', { role: 'group', 'aria-label': '选择示例人物' });
  const show = (/** @type {string} */ w) => {
    who = w;
    before.src = personArt(w); after.src = styleArt(id, w);
    pick.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.who === w)));
    set(.5);
  };
  pick.append(...people.map(w => h('button.ex__person', { type: 'button', data: { who: w }, 'aria-label': '查看' + w, onclick: () => show(w) }, h('img', { src: personArt(w, 't'), alt: '' }))));
  sheet(close => [
    h('div.ex', null,
      view,
      h('p.ex__line', null, p.line + ' · 拖动对比前后效果'),
      pick,
      h('div.ex__acts', null,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { close(); setPref('preset', id); if (o.onUse) o.onUse(id); else { saveDraft('studio', { ...(draft('studio') || {}), preset: id, tab: 'style' }); go('studio'); } } }, h('span', { html: icon('upload') }), '使用这张'),
        h('button.btn.btn--main', { type: 'button', onclick: () => { close(); setPref('preset', id); go('live'); } }, h('span', { html: icon('camera') }), T.same))),
  ], { title: p.name + ' · 示例', tall: true });
  show(who);
}

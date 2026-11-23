/** 共用界面组件：分类胶囊按钮、风格卡片、对比、进度、保存／分享操作和标题栏。 */
import { h, icon, iconBtn, holdable, toast, clamp, reduced } from '../core/dom.js';
import { CATEGORIES, PRESETS, inCategory, presetById } from '../presets.js';
import { cover, icon as styleIcon } from '../core/assets.js';
import { isFav, toggleFav, note, saveWork, pref } from '../core/data.js';
import { download } from '../core/image.js';
import { back } from '../core/nav.js';
import { studio } from '../core/api.js';
import { T } from '../copy.js';

/** 页面标题栏：左侧返回、居中标题及可选的右侧操作。 */
export function topBar(/** @type {string} */ title, /** @type {any[]} */ right = [], onBack = () => back()) {
  return h('header.bar', null,
    h('button.bar__back', { type: 'button', 'aria-label': T.back, onclick: onBack }, h('span', { html: icon('back') }), h('span.bar__backtext', null, T.back)),
    h('h1.bar__title', null, title),
    h('div.bar__right', null, ...right));
}

/** 可横向滚动的分类胶囊按钮。 @param {string} active @param {(id: string) => void} pick
 */
export function pills(active, pick, cls = '') {
  const el = h('nav.pills' + (cls ? '.' + cls : ''), { 'aria-label': '风格分类', role: 'tablist' },
    ...CATEGORIES.map(c => h('button.pill', { type: 'button', role: 'tab', data: { cat: c.id }, 'aria-selected': String(c.id === active), onclick: () => { set(c.id); pick(c.id); } }, c.label)));
  function set(/** @type {string} */ id) {
    for (const b of el.querySelectorAll('.pill')) b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.cat === id));
    const on = /** @type {HTMLElement | null} */ (el.querySelector(`[data-cat="${id}"]`));
    on?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
  return Object.assign(el, { set });
}

/** 带示例作品、独立边框和收藏爱心的风格卡片。 @param {string} id @param {{ selected?: boolean, onPick: (id: string) => void, size?: 'm' | '' }} o
 */
export function styleCard(id, o) {
  const p = /** @type {import('../presets.js').Preset} */ (presetById(id));
  const c = cover(id, o.size ?? 'm');
  const fav = h('span.card__fav', { role: 'button', tabindex: '0', 'aria-label': isFav(id) ? '取消收藏' : T.fav, 'aria-pressed': String(isFav(id)), html: icon(isFav(id) ? 'heartFill' : 'heart'),
    onclick: async (/** @type {Event} */ e) => { e.stopPropagation(); const on = await toggleFav(id); fav.innerHTML = icon(on ? 'heartFill' : 'heart'); fav.setAttribute('aria-pressed', String(on)); toast(on ? '已收藏：' + p.name + '' : '已取消收藏'); } });
  return h('button.card', { type: 'button', data: { style: id, frame: p.theme.frame, dark: String(p.theme.dark) }, 'aria-pressed': String(!!o.selected), 'aria-label': p.name + '：' + p.line,
    style: { '--c-accent': p.theme.accent, '--c-accent2': p.theme.accent2, '--c-bg': p.theme.bg, '--c-ink': p.theme.ink }, onclick: () => o.onPick(id) },
    h('span.card__art', null, h('img', { src: c.art, alt: '', loading: 'lazy', decoding: 'async' })),
    h('span.card__name', null, p.name),
    h('span.card__hook', null, p.hook),
    p.hot >= 3 ? h('span.card__hot', null, '热门') : null,
    o.selected ? h('span.card__on', null, h('span', { html: icon('check') }), '已选择') : null,
    fav);
}

/** 按分类筛选、可横向滚动的一行风格卡片。 @param {string} cat @param {string} selected @param {(id: string) => void} onPick */
export function styleRow(cat, selected, onPick) {
  const list = inCategory(cat);
  return h('div.cards', { role: 'listbox', 'aria-label': '选择风格' }, ...list.map(p => styleCard(p.id, { selected: p.id === selected, onPick })));
}

/** 实时相机轮播使用的圆形风格缩略图。 */
export const styleDot = (/** @type {string} */ id) => {
  const p = /** @type {any} */ (presetById(id));
  return h('button.dot', { type: 'button', data: { style: id }, 'aria-label': p.name, style: { '--c-accent': p.theme.accent, '--c-accent2': p.theme.accent2 } },
    h('img', { src: styleIcon(id), alt: '', decoding: 'async', loading: 'lazy' }), h('span.dot__name', null, p.name));
};

/** 拖动对比分隔线，或按住图片查看原图；方向键也可移动分隔线。 @param {HTMLElement} box 采用相对定位的图片容器。 @param {HTMLImageElement} before @param {HTMLImageElement} after
 * @param {{ enabled?: () => boolean }} [o] enabled：是否启用对比；区域选择和画笔编辑需要使用指针。
 */
export function compare(box, before, after, o = {}) {
  const can = () => !o.enabled || o.enabled();
  let pos = 1;   // 1 = 完整显示结果。
  const handle = h('div.cmp__handle', { 'aria-hidden': 'true' }, h('span.cmp__knob', { html: icon('compare') }));
  const range = /** @type {HTMLInputElement} */ (h('input.cmp__range', { type: 'range', min: '0', max: '100', value: '100', 'aria-label': '前后对比：向左拖动查看原图' }));
  const hint = h('span.cmp__hint', null, T.hold);
  box.append(handle, range, hint);
  box.classList.add('cmp');
  const set = (/** @type {number} */ v) => { pos = clamp(v); box.style.setProperty('--cmp', (pos * 100).toFixed(2) + '%'); range.value = String(Math.round(pos * 100)); box.classList.toggle('is-split', pos < .995); };
  range.addEventListener('input', () => set(Number(range.value) / 100));
  // 分隔线画在 1 - pos 处（左侧原图、右侧作品）：手指在哪里，分隔线就在哪里。
  // 在分隔线附近（或已分屏时任意位置）开始拖动；按住其他位置则显示原图。
  let drag = false;
  const at = (/** @type {PointerEvent} */ e) => { const r = box.getBoundingClientRect(); return 1 - (e.clientX - r.left) / r.width; };
  box.addEventListener('pointerdown', e => {
    if (!can()) return;
    const v = at(e);
    if (Math.abs(v - pos) < .08 || box.classList.contains('is-split')) { drag = true; box.setPointerCapture(e.pointerId); set(v); e.preventDefault(); }
  });
  box.addEventListener('pointermove', e => { if (drag) set(at(e)); });
  const stop = () => { drag = false; };
  box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop);
  holdable(box, on => { if (!drag) box.classList.toggle('is-before', on && can()); }, 160);
  range.addEventListener('focus', () => { if (!can()) range.blur(); });
  void before; void after;
  set(1);
  return {
    set,
    /** 从原图向作品扫过，展示完成结果。 */
    sweep() {
      if (reduced) { set(1); return; }
      const t0 = performance.now();
      const run = (/** @type {number} */ t) => { const k = Math.min(1, (t - t0) / 1100); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; set(e); if (k < 1) requestAnimationFrame(run); };
      set(0); requestAnimationFrame(run);
    },
  };
}

/** 创作进度：三个阶段、进度条、轮换状态文字和取消。 */
export function progressBox(/** @type {() => void} */ onCancel) {
  const steps = h('ol.prog__steps', null, ...T.stages.map((s, i) => h('li', { data: { i } }, h('i', { 'aria-hidden': 'true' }), h('span', null, s))));
  const bar = h('div.prog__bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': '创作进度' }, h('i'));
  const line = h('p.prog__line', { 'aria-live': 'polite' });
  const eta = h('p.prog__eta');
  const stop = h('button.btn.btn--ghost.btn--sm.prog__stop', { type: 'button', onclick: onCancel }, h('span', { html: icon('stop') }), T.cancel);
  const el = h('div.prog', { role: 'status' }, steps, bar, line, eta, stop);
  let waitAt = 0, lastLine = '';
  return Object.assign(el, {
    /** @param {import('../core/generate.js').Progress} p */
    update(p) {
      steps.querySelectorAll('li').forEach((li, i) => { li.classList.toggle('is-done', i < p.stage || p.value >= 1); li.classList.toggle('is-on', i === p.stage && p.value < 1); });
      bar.style.setProperty('--v', String(p.value)); bar.setAttribute('aria-valuenow', String(Math.round(p.value * 100)));
      // 每隔几秒轮换等待消息。
      const since = performance.now() - p.started;
      const text = p.text === T.sending || p.text === T.queued ? p.text : since > 2500 ? T.waits[Math.min(T.waits.length - 1, Math.floor(since / 3500))] : p.text;
      if (text !== lastLine) { line.textContent = text; lastLine = text; waitAt = performance.now(); }
      const left = Math.max(0, p.eta - since);
      eta.textContent = p.value >= 1 ? '' : left > 1500 ? '大约' + Math.ceil(left / 1000) + ' 秒' : '即将完成';
      void waitAt;
    },
  });
}

const fileName = (/** @type {any} */ w) => `hakishow-${presetById(w.preset)?.id || 'art'}-${new Date(w.createdAt).toISOString().slice(0, 10)}.jpg`;
/** 在支持的手机上使用系统分享面板，否则下载图片。 */
export async function saveImage(/** @type {any} */ w, /** @type {string} */ url) {
  const blob = await fetch(url).then(r => r.blob());
  const file = new File([blob], fileName(w), { type: blob.type || 'image/jpeg' });
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); toast(T.saved, { tone: 'ok' }); }
    catch (e) { if (/** @type {any} */ (e)?.name !== 'AbortError') { download(url, file.name); toast(T.savedDl, { tone: 'ok' }); } else return; }
  } else { download(url, file.name); toast(T.savedDl, { tone: 'ok' }); }
  note(w, 'save', '已保存图片'); saveWork(w);
}
/** 通过系统面板分享到选中的应用；否则保存图片，并建议从 TikTok 分享。 */
export async function shareTikTok(/** @type {any} */ w, /** @type {string} */ url) {
  const blob = await fetch(url).then(r => r.blob());
  const p = presetById(w.preset);
  const file = new File([blob], fileName(w), { type: blob.type || 'image/jpeg' });
  const text = `我的${p?.name || 'new'}形象，使用 HakiShow 创作 ✨ #HakiShow #艺术肖像 #${p?.name?.replace(/\s+/g, '') || '智能艺术'}`;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); note(w, 'share', '已分享图片'); saveWork(w); return; }
    catch (e) { if (/** @type {any} */ (e)?.name === 'AbortError') return; }
  }
  download(url, file.name);
  try { await navigator.clipboard?.writeText(text); } catch { /* 剪贴板不可用。 */ }
  toast(T.shareTip, { ms: 4200, tone: 'ok' });
  note(w, 'share', '已为 TikTok 准备图片'); saveWork(w);
}

/** 来源标签用于区分本地预览、示例、模拟结果和生成作品。 */
export function kindBadge(/** @type {any} */ w, short = false) {
  const long = w.kind === 'preview' ? T.preview : w.kind === 'example' ? T.example : w.kind === 'simulated' ? T.simulated : '';
  if (!long) return null;
  return h('span.badge', { title: long }, short ? long.split(' · ')[0] : long);
}

/** 生成此版本的操作简短标签。 @param {any} w */
export function opLabel(w) {
  if (!w) return '原图';
  return ({ region: '局部编辑', edit: '对话编辑', vary: '变体', angles: '角度' })[/** @type {string} */ (w.op)] || presetById(w.preset)?.name || '作品';
}
/** 版本缩略图角标；完整风格变换没有操作图标。 @param {any} w */
export function opBadge(w) {
  const name = ({ region: 'face', edit: 'chat', vary: 'layers', angles: 'rotate' })[/** @type {string} */ (w?.op)];
  return name ? h('i.opb', { 'aria-hidden': 'true', html: icon(/** @type {any} */ (name)) }) : null;
}

/** 显示在操作按钮下方的画质和预计时长。 */
export function etaText() {
  const pace = pref('pace', 'fine');
  return studio.live ? `大约 ${Math.round(studio.eta(pace) / 1000)} 秒 · ${T.pace[pace]}` : '演示 · 本地预览';
}
export { PRESETS };

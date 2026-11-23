/** 照片工作室的三个基础面板：风格——分类胶囊按钮与三列示例网格，加上通过简短描述创建的自定义风格；调整——风格强度、相似度、细节、美颜、格式和画质，并提供重置；细节——配饰、灯光、氛围、边框和额外文字要求，输入框保持在键盘上方。每次改动都使用 ctx.commit，确保可以撤销。 */
import { h, icon, toast, chooseFile } from '../core/dom.js';
import { presetById, inCategory, categories, toggleDetail, DETAIL_GROUPS, KNOBS, defaultsOf } from '../presets.js';
import { cover } from '../core/assets.js';
import { isFav, toggleFav, pref, setPref, saveStyle, addSource, ensureUploaded } from '../core/data.js';
import { studio, inventStyle } from '../core/api.js';
import { prepare } from '../core/image.js';
import { applyTheme } from '../core/theme.js';
import { sheet, focusSoon } from '../ui/sheet.js';
import { etaText } from '../ui/parts.js';
import { slider } from '../ui/slider.js';
import { T, level } from '../copy.js';

/** 面板的“开始创作”操作，与收起状态下的主操作一致。 */
function makeCta(/** @type {any} */ ctx) {
  const b = ctx.cta(T.go, '', () => ctx.make());
  const paint = () => {
    const p = presetById(ctx.S.preset), w = ctx.shownWork();
    const busy = !!w && w.op === 'restyle' && w.state === 'working';
    b.toggleAttribute('disabled', busy);
    b.querySelector('.cta__label').textContent = !ctx.sourceObj() ? T.upload : busy ? '正在创作……' : T.go;
    b.querySelector('.cta__sub').textContent = !ctx.sourceObj() ? '先选一张照片' : (p?.name || '') + ' · ' + etaText();
  };
  return Object.assign(b, { paint });
}

// ───────────── 风格 ─────────────
export function stylePanel(/** @type {any} */ ctx) {
  const pills = h('nav.pills', { role: 'tablist', 'aria-label': '风格分类' });
  const grid = h('div.sgrid', { role: 'listbox', 'aria-label': '风格' });
  const foot = makeCta(ctx);
  const body = h('div.tp.tp--split', null, pills, grid);
  function paintPills() {
    pills.replaceChildren(...[...categories(), { id: 'mine', label: '自定义' }].filter((c, i, a) => a.findIndex(x => x.id === c.id) === i).map(c =>
      h('button.pill', { type: 'button', role: 'tab', data: { cat: c.id }, 'aria-selected': String(c.id === ctx.cat), onclick: () => { ctx.cat = c.id; paintPills(); paintGrid(true); } }, c.id === 'mine' ? '自定义 +' : c.label)));
    requestAnimationFrame(() => pills.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  function card(/** @type {any} */ p) {
    const on = p.id === ctx.S.preset;
    const fav = h('span.scard__fav', { role: 'button', tabindex: '0', 'aria-label': isFav(p.id) ? '取消收藏' : T.fav, 'aria-pressed': String(isFav(p.id)), html: icon(isFav(p.id) ? 'heartFill' : 'heart'),
      onclick: async (/** @type {Event} */ e) => { e.stopPropagation(); const f = await toggleFav(p.id); fav.innerHTML = icon(f ? 'heartFill' : 'heart'); fav.setAttribute('aria-pressed', String(f)); toast(f ? '已收藏：' + p.name + '' : '已取消收藏'); } });
    const marks = [p.isNew ? h('span.scard__tag', null, '新品') : p.hot >= 3 ? h('span.scard__tag.is-hot', null, '热门') : null,
      on ? h('span.scard__on', null, h('span', { html: icon('eye') }), '查看示例') : null];
    const art = p.custom
      ? h('span.scard__art.scard__art--custom', { style: { background: `linear-gradient(150deg, ${p.theme.bg}, ${p.theme.bg2})`, color: p.theme.ink } }, h('b', null, p.name.slice(0, 2)), ...marks)
      : h('span.scard__art', null, h('img', { src: cover(p.id, 'm').art, alt: '', loading: 'lazy', decoding: 'async' }), ...marks);
    return h('button.scard', { type: 'button', role: 'option', data: { style: p.id, frame: p.theme.frame }, 'aria-selected': String(on), 'aria-label': p.name + '：' + p.line,
      style: { '--c-accent': p.theme.accent }, onclick: () => { ctx.pickStyle(p.id); paintGrid(); } },
      art, h('span.scard__name', null, p.name), h('span.scard__hook', null, p.hook || p.line), fav);
  }
  function paintGrid(scrollTop = false) {
    const list = inCategory(ctx.cat);
    const kids = list.map(card);
    if (ctx.cat === 'mine') kids.unshift(h('button.scard.scard--new', { type: 'button', onclick: () => invent() }, h('span.scard__art', null, h('span', { html: icon('wand') })), h('span.scard__name', null, '新风格'), h('span.scard__hook', null, '从几句话开始')));
    grid.replaceChildren(...kids);
    if (scrollTop) grid.scrollTop = 0;
    else requestAnimationFrame(() => grid.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  /** 根据描述和可选参考图创造风格：名称、标语、色板、实时滤镜、生成提示词及八项细节。 */
  function invent() {
    if (!studio.live) { toast('连接工作室，即可创建自己的风格。'); return; }
    const field = /** @type {HTMLTextAreaElement} */ (h('textarea.say__field', { rows: 2, maxlength: 120, placeholder: '试试雨中的东京爵士酒吧、新加坡传统厨房，或蒸汽波泳池……', 'aria-label': '描述你的风格', enterkeyhint: 'go' }));
    let ref = /** @type {Blob | null} */ (null);
    const refBtn = h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: async () => {
      const f = await chooseFile(); if (!f) return;
      ref = (await prepare(f, 1024)).blob; refBtn.replaceChildren(h('span', { html: icon('check') }), '参考图已添加');
    } }, h('span', { html: icon('image') }), '添加参考图');
    const ideas = h('div.chips', null, ...['蒸汽波泳池', '雨夜爵士酒吧', '星空奇幻舞者', '新加坡咖啡店', '生物训练师冒险'].map(t => h('button.chip2', { type: 'button', onclick: () => { field.value = t; field.focus({ preventScroll: true }); } }, t)));
    const status = h('p.sheet__text', { 'aria-live': 'polite' });
    const goBtn = h('button.btn.btn--main', { type: 'button', onclick: async () => {
      const text = field.value.trim();
      if (!text && !ref) { status.textContent = '描述风格，或添加一张参考图片。'; return; }
      goBtn.setAttribute('disabled', ''); status.textContent = '正在创建全新的艺术世界……可能需要一点时间。';
      try {
        let asset = '';
        if (ref) { const s = await addSource(ref, {}); asset = await ensureUploaded(s); }
        const r = await inventStyle({ text, ...(asset ? { asset } : {}) });
        const p = { ...r.style, id: 'my-' + Date.now().toString(36), custom: true, cat: 'mine', hot: 0 };
        await saveStyle(p);
        close();
        ctx.cat = 'mine'; paintPills(); ctx.pickStyle(p.id); paintGrid();
        toast('你的新风格' + p.name + '已完成，选择“开始创作”即可体验。', { tone: 'ok', ms: 3600 });
      } catch (e) { status.textContent = /** @type {any} */ (e)?.message || '这个风格未能完成，请换一种方式描述。'; }
      finally { goBtn.removeAttribute('disabled'); }
    } }, h('span', { html: icon('wand') }), '创建风格');
    const { close } = sheet(() => [field, ideas, status, h('div.sheet__acts', null, refBtn, goBtn)], { title: '创建一种风格', cls: 'sheet--top' });
    focusSoon(field);
  }
  return {
    body, foot,
    shown() { paintPills(); paintGrid(); foot.paint(); },
    repaint() { paintGrid(); foot.paint(); },
    paintCta() { foot.paint(); },
  };
}

// ───────────── 调整 ─────────────
export function tunePanel(/** @type {any} */ ctx) {
  const foot = makeCta(ctx);
  const body = h('div.tp.tp--pad');
  function paint() {
    const P = ctx.S.params;
    const knob = (/** @type {any} */ k) => {
      const val = h('b.knob__val', null, level(P[k.id]) + ' · ' + P[k.id]);
      const base = defaultsOf(/** @type {any} */ (presetById(ctx.S.preset)))?.[k.id];
      const r = slider({ value: P[k.id], step: 5, label: k.label, mark: typeof base === 'number' ? base : null,
        onInput: v => { val.textContent = level(v) + ' · ' + v; P[k.id] = v; },
        onChange: (v, from) => ctx.setParams({ [k.id]: v }, k.label + ' ' + from + '→' + v) });
      return h('div.knob', null, h('span.knob__head', null, h('span.knob__name', null, k.label), val), r.el, h('span.knob__ends', null, h('span', null, k.low), h('span', null, k.high)));
    };
    const segOf = (/** @type {string} */ label, /** @type {[string, string][]} */ opts, /** @type {string} */ now, /** @type {(v: string) => void} */ set) => h('div.opt', null, h('span.opt__name', null, label),
      h('div.seg.seg--sm', { role: 'radiogroup', 'aria-label': label }, ...opts.map(([v, t]) => h('button.seg__opt', { type: 'button', role: 'radio', 'aria-checked': String(v === now), onclick: () => { set(v); paint(); } }, t))));
    body.replaceChildren(
      h('div.knobs', null, ...KNOBS.map(knob)),
      segOf('格式', [['avatar', T.format.avatar], ['portrait', T.format.portrait]], ctx.S.format, v => ctx.setFormat(v)),
      studio.live ? segOf('画质', [['quick', T.pace.quick], ['fine', T.pace.fine], ['deep', T.pace.deep]], pref('pace', 'fine'), v => { setPref('pace', v); ctx.paintCta(); foot.paint(); toast(T.pace[/** @type {'fine'} */ (v)] + ' · ' + T.paceLine[/** @type {'fine'} */ (v)]); }) : null,
      h('div.opt', null, h('span.opt__name', null, '重新开始？'), h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { ctx.resetParams(); paint(); } }, h('span', { html: icon('refresh') }), '恢复默认设置')));
  }
  return { body, foot, shown() { paint(); foot.paint(); }, repaint() { paint(); foot.paint(); }, paintCta() { foot.paint(); } };
}

// ───────────── 细节 ─────────────
export function detailPanel(/** @type {any} */ ctx) {
  const foot = makeCta(ctx);
  const body = h('div.tp.tp--pad');
  function paint() {
    const p = /** @type {any} */ (presetById(ctx.S.preset)), P = ctx.S.params;
    const groups = DETAIL_GROUPS.map(g => h('div.dgroup', null, h('span.dgroup__name', null, g.label),
      h('div.chips', { role: 'group', 'aria-label': g.label }, ...p.details.filter((/** @type {any} */ x) => x.group === g.id).map((/** @type {any} */ x) =>
        h('button.chip2', { type: 'button', data: { id: x.id }, 'aria-pressed': String(P.details.includes(x.id)), onclick: () => {
          const had = P.details.includes(x.id);
          ctx.setParams({ details: toggleDetail(p, P.details, x.id) }, (had ? '已移除' : '已添加') + x.label + '');
          paint();
        } }, x.label)))));
    const field = /** @type {HTMLTextAreaElement} */ (h('textarea.say__field.say__field--inline', { rows: 2, maxlength: 200, placeholder: T.wordsHint, 'aria-label': T.words, enterkeyhint: 'done' }));
    field.value = P.words || '';
    const save = () => { const v = field.value.trim(); if (v !== (P.words || '')) ctx.setParams({ words: v }, v ? '已补充细节：' + v : '已清空补充要求'); };
    field.addEventListener('change', save);
    field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); field.blur(); } });
    field.addEventListener('blur', save);
    body.replaceChildren(...groups, h('div.dgroup', null, h('span.dgroup__name', null, T.words + '——描述你想要的细节'), field));
  }
  return { body, foot, shown() { paint(); foot.paint(); }, repaint() { if (!body.contains(document.activeElement)) paint(); foot.paint(); }, paintCta() { foot.paint(); } };
}

void applyTheme;

/** 精修工作室：打开即可体验——没有照片时自动载入示例肖像，随时可换成自己的照片。
 *  三个入口：风格（选风格，画布立即显示本地预览，所见即所得）、修改（点选脸部区域或涂抹，再用一句话描述想改什么；快捷操作包括变体、角度、换背景与清理）、微调（风格强度、相似度、细节配饰、格式与画质）。
 *  版本：每张照片各自的时间顺序链，选择任意版本即可继续编辑；撤销和重做覆盖全部操作，刷新后依然有效。 */
import { h, icon, toast, chooseFile, reduced } from '../core/dom.js';
import { go, overlay } from '../core/nav.js';
import { on } from '../core/bus.js';
import { presetById, defaultsOf, captionOf, KNOBS } from '../presets.js';
import { applyTheme } from '../core/theme.js';
import { draft, saveDraft, pref, setPref, addSource, source as sourceById, sourceUrl, sourceBlob, resultUrl, work as workById, chainOf } from '../core/data.js';
import { create, watch, stop, retry, isRunning } from '../core/generate.js';
import { prepare, decode, lightOf } from '../core/image.js';
import { personArt, samples, cover, hasArt, styleArt } from '../core/assets.js';
import { compare, progressBox, saveImage, shareTikTok, kindBadge, etaText, opBadge } from '../ui/parts.js';
import { sheet, sheetOpen } from '../ui/sheet.js';
import { reveal, burst, buzz, firstLook } from '../ui/fx.js';
import { openExamples } from '../ui/examples.js';
import { createUndo } from '../core/undo.js';
import { stylePanel, tunePanel, detailPanel } from '../studio/panels.js';
import { partsPanel } from '../studio/parts.js';
import { chatPanel } from '../studio/chat.js';
import { T } from '../copy.js';

/** @typedef {import('../core/data.js').Work} Work */
const TOOLS = /** @type {const} */ ([
  { id: 'style', label: '风格', ico: 'palette' }, { id: 'edit', label: '修改', ico: 'wand' }, { id: 'tune', label: '微调', ico: 'sliders' },
]);
/** 旧版草稿中的面板编号映射到新的三个入口。 */
const OLD_TOOL = /** @type {Record<string, string>} */ ({ detail: 'tune', parts: 'edit', chat: 'edit' });

export function studioScreen() {
  // ── 状态：S 中的每个值都支持撤销。──
  const d0 = draft('studio') || {};
  const S = {
    source: d0.source && sourceById(d0.source) ? String(d0.source) : '',
    shown: '',
    preset: presetById(d0.preset) ? String(d0.preset) : pref('preset', 'princess'),
    params: /** @type {any} */ (null),
    format: /** @type {'avatar' | 'portrait'} */ (d0.format === 'portrait' ? 'portrait' : d0.format === 'avatar' ? 'avatar' : pref('format', 'avatar')),
    picks: /** @type {import('../parts.js').Pick[]} */ (Array.isArray(d0.picks) ? d0.picks : []),
  };
  S.shown = d0.shown && workById(d0.shown)?.source === S.source ? String(d0.shown) : '';
  S.params = loadParams(S.preset, d0.preset === S.preset ? d0.params : null);
  let tool = /** @type {string} */ (OLD_TOOL[d0.panel] || d0.panel || ''), cat = d0.cat || 'hot', unwatch = () => {}, closeOverlay = /** @type {(() => void) | null} */ (null);

  function loadParams(/** @type {string} */ id, /** @type {any} */ given) {
    const p = /** @type {any} */ (presetById(id)), saved = given || pref('params.' + id, {});
    return { ...defaultsOf(p), ...saved, details: [...(saved.details || p.defaults.details)] };
  }
  const undo = createUndo({
    snapshot: () => ({ source: S.source, shown: S.shown, preset: S.preset, params: S.params, format: S.format, picks: S.picks }),
    restore: s => { Object.assign(S, s); if (S.source && !sourceById(S.source)) S.source = ''; if (S.shown && !workById(S.shown)) S.shown = ''; afterChange(); },
    onChange: () => paintUndo(),
  });
  const keep = () => {
    setPref('params.' + S.preset, S.params); setPref('preset', S.preset); setPref('format', S.format);
    saveDraft('studio', { ...S, panel: tool, cat, undo: undo.dump() });
  };
  /** 记录一个可撤销步骤，并保存草稿。 @param {string} label */
  const commit = (label) => { undo.commit(label); keep(); };

  // ── 标题栏 ──
  const bar = h('header.bar.bar--root', null,
    h('button.avatar', { type: 'button', onclick: () => go('gallery'), 'aria-label': T.gallery, title: T.gallery }, h('span', { html: icon('gallery') })),
    h('nav.modes.modes--solid', { 'aria-label': '模式' },
      h('button.modes__opt', { type: 'button', onclick: () => go('live') }, h('span', null, '拍摄')),
      h('button.modes__opt', { type: 'button', 'aria-current': 'page' }, h('span', null, '精修'))),
    h('button.avatar', { type: 'button', onclick: () => go('me'), 'aria-label': T.me }, h('span', { html: icon('user') })));

  // ── 画布 ──
  const before = /** @type {HTMLImageElement} */ (h('img.frame__before', { alt: '原图' }));
  const pre = /** @type {HTMLImageElement} */ (h('img.frame__pre', { alt: '' }));
  const after = /** @type {HTMLImageElement} */ (h('img.frame__after', { alt: '作品' }));
  const tintC = /** @type {HTMLCanvasElement} */ (h('canvas.frame__tint', { 'aria-hidden': 'true' }));
  const markC = /** @type {HTMLCanvasElement} */ (h('canvas.frame__mark', { 'aria-hidden': 'true' }));
  const brushC = /** @type {HTMLCanvasElement} */ (h('canvas.frame__brush', { 'aria-label': '涂抹要编辑的区域' }));
  const prog = progressBox(() => S.shown && stop(S.shown));
  const failBox = h('div.frame__fail', { hidden: true });
  const frameBox = h('div.frame__img', null, before, pre, after, tintC, markC, brushC, prog, failBox);
  const cmp = compare(frameBox, before, after, { enabled: () => tool !== 'edit' && !!S.shown && workById(S.shown)?.state === 'done' });
  const styleChip = h('button.hud__chip', { type: 'button', 'aria-label': '查看此风格示例', onclick: () => openExamples(S.preset, { onUse: id => ctx.pickStyle(id) }) });
  const changeLabel = h('span', null, '更换');
  const changeBtn = h('button.hud__btn', { type: 'button', onclick: () => changePhoto(), 'aria-label': T.change }, h('span', { html: icon('image') }), changeLabel);
  const undoBtn = h('button.hud__ub', { type: 'button', 'aria-label': T.undo, title: T.undo, onclick: () => doUndo(), html: icon('undo') });
  const redoBtn = h('button.hud__ub', { type: 'button', 'aria-label': T.redo, title: T.redo, onclick: () => doRedo(), html: icon('redo') });
  const saveMini = h('button.hud__btn', { type: 'button', onclick: () => withShown(async w => saveImage(w, await resultUrl(w))) }, h('span', { html: icon('download') }), h('span', null, '保存'));
  const shareMini = h('button.hud__btn.hud__btn--main', { type: 'button', onclick: () => withShown(async w => shareTikTok(w, await resultUrl(w))) }, h('span', { html: icon('send') }), h('span', null, '分享'));
  const tip = h('p.hud__tip', { 'aria-live': 'polite' });
  const badges = h('div.hud__badges');
  const hud = h('div.frame__hud', null,
    h('div.hud__row', null, styleChip, h('span.hud__gap'), changeBtn),
    h('div.hud__mid', null, badges, tip),
    h('div.hud__row', null, h('div.hud__undo', null, undoBtn, redoBtn), h('span.hud__gap'), saveMini, shareMini));
  const frame = h('div.frame', null, h('div.frame__fit', null, frameBox), hud);
  const versions = h('div.versions', { role: 'listbox', 'aria-label': '版本' });
  const empty = emptyState();
  const canvas = h('div.studio__canvas', null, empty, frame, versions);

  // ── 工具栏与面板 ──
  const toolBtns = /** @type {Record<string, HTMLElement>} */ ({});
  const toolRow = h('div.tools', { role: 'tablist', 'aria-label': '创作工具' },
    ...TOOLS.map(t => (toolBtns[t.id] = h('button.tool2', { type: 'button', role: 'tab', data: { tool: t.id }, onclick: () => (tool === t.id ? closePanel() : openPanel(t.id)) },
      h('span.tool2__ico', { html: icon(/** @type {any} */ (t.ico)) }), h('span.tool2__label', null, t.label)))),
    h('button.tools__fold', { type: 'button', onclick: () => closePanel(), 'aria-label': '收起面板' }, h('span', { html: icon('chevronDown') }), h('span', null, '收起')));
  const panelBody = h('div.tpanel__body');
  const panelFoot = h('div.tpanel__foot');
  const tpanel = h('section.tpanel.kb-lift', null, panelBody, panelFoot);
  const goLabel = h('b.cta__label'), goSub = h('span.cta__sub');
  const goBtn = h('button.cta', { type: 'button', onclick: () => ctx.make() }, h('span.cta__ico', { html: icon('sparkle') }), h('span.cta__text', null, goLabel, goSub));
  const dock = h('div.studio__dock', null, toolRow, tpanel, h('div.dock__cta', null, goBtn));
  const el = h('section.screen.studio', { 'aria-label': T.studio }, bar, canvas, dock);

  // ── 共用面板上下文 ──
  const ctx = {
    S, el, frame, frameBox, before, after, tintC, markC, brushC, tip,
    get cat() { return cat; }, set cat(v) { cat = v; keep(); },
    commit, keep,
    /** 当前显示的版本；不存在时使用原始照片。 */
    shownWork: () => (S.shown ? workById(S.shown) : null),
    sourceObj: () => (S.source ? sourceById(S.source) : null),
    /** 用作局部与画笔编辑基础的当前显示图片。 */
    shownImage: () => (S.shown && workById(S.shown)?.state === 'done' ? after : before),
    pickStyle(/** @type {string} */ id) {
      if (id === S.preset) { openExamples(id, { onUse: x => ctx.pickStyle(x) }); return; }   // 再次点击已选风格可查看示例。
      const was = presetById(S.preset)?.name;
      S.preset = id; S.params = loadParams(id, null);
      applyTheme(id);
      if (S.shown && workById(S.shown)?.state === 'done' && workById(S.shown)?.op === 'restyle') S.shown = '';   // 换风格时回到原图，直接看到新风格的预览
      commit('已切换为' + presetById(id)?.name + '' + (was ? '（之前为' + was + '）' : ''));
      paintAll();
    },
    /** 滑块手势结束时更新设置。 @param {Record<string, any>} patch @param {string} label */
    setParams(patch, label) { Object.assign(S.params, patch); commit(label); paintCta(); paintChip(); },
    setFormat(/** @type {'avatar' | 'portrait'} */ v) { S.format = v; commit('格式：' + T.format[v]); paintCanvas(); paintCta(); },
    resetParams() { S.params = { ...defaultsOf(/** @type {any} */ (presetById(S.preset))), words: '' }; commit('重置为' + presetById(S.preset)?.name + '的默认设置'); paintAll(); },
    setPicks(/** @type {import('../parts.js').Pick[]} */ picks, /** @type {string} */ label) { S.picks = picks; commit(label); panels.edit?.sync?.(); },
    /** 创建完整的风格变换。 */
    make,
    /** 局部编辑、对话、变体和角度均使用当前显示的版本。 @param {Partial<import('../core/generate.js').Ask> & { label: string }} o */
    async ask(o) {
      const src = ctx.sourceObj(); if (!src) { pickPhoto(); return null; }
      // 使用可见图片：此版本已完成时使用它，否则使用此前显示的版本。
      const shown = ctx.shownWork();
      const base = shown ? (shown.state === 'done' ? shown : shown.base ? workById(shown.base) : null) : null;
      const usable = base && base.state === 'done' ? base : null;
      const w = await create({ source: src.id, preset: usable?.preset || S.preset, params: usable?.params || S.params, format: usable ? usable.format : 'photo', mode: 'studio',
        base: usable?.id || '', parent: shown?.id || chainOf(src.id).at(-1)?.id, why: o.label, ...o });
      S.shown = w.id; S.picks = o.op === 'region' ? [] : S.picks;
      commit(o.label);
      paintVersions(); paintCanvas(); paintCta();
      return w;
    },
    showVersion(/** @type {string} */ id) { showVersion(id); },
    paintCanvas: () => paintCanvas(), paintCta: () => paintCta(), paintVersions: () => paintVersions(),
    closePanel: () => closePanel(),
    pickPhoto: () => pickPhoto(),
    /** 面板底部操作，与收起状态下的主操作保持一致。 */
    cta(/** @type {string} */ label, /** @type {string} */ sub, /** @type {() => void} */ run, ico = 'sparkle') {
      const b = h('button.cta', { type: 'button', onclick: run }, h('span.cta__ico', { html: icon(/** @type {any} */ (ico)) }), h('span.cta__text', null, h('b.cta__label', null, label), h('span.cta__sub', null, sub)));
      return b;
    },
  };
  const P = { style: stylePanel(ctx), tune: tunePanel(ctx), detail: detailPanel(ctx), parts: partsPanel(ctx), chat: chatPanel(ctx) };
  const panels = /** @type {Record<string, any>} */ ({ style: P.style, edit: editPanel(), tune: tunePanel2() });
  /** 微调：滑块、格式与画质在上，细节配饰与补充要求在下，共用一个“开始创作”。 */
  function tunePanel2() {
    const both = [P.tune, P.detail];
    return {
      body: h('div.tp.tp--stack', null, P.tune.body, h('h3.tp__sub', null, '细节与配饰'), P.detail.body), foot: P.tune.foot,
      shown() { for (const p of both) p.shown(); }, repaint() { for (const p of both) p.repaint(); }, paintCta() { for (const p of both) p.paintCta(); },
    };
  }
  /** 修改：区域与画笔（局部编辑）+ 一句话描述（对话编辑）合为一处。
   *  选中区域或涂抹后，底部为“应用编辑”；否则为对话输入框。 */
  function editPanel() {
    const partsFoot = /** @type {HTMLElement} */ (P.parts.foot);
    const partsCta = /** @type {HTMLElement} */ (partsFoot.querySelector('.cta'));
    const foot = h('div.ed__foot', null, partsFoot, P.chat.foot);
    // 选中区域或进入画笔模式时显示“应用编辑”，否则显示一句话输入框。
    const sync = () => { foot.dataset.mode = ctx.S.picks.length > 0 || frame.dataset.mode === 'paint' ? 'parts' : 'chat'; };
    new MutationObserver(sync).observe(frame, { attributes: true, attributeFilter: ['data-mode'] });
    void partsCta;
    return {
      body: h('div.tp.tp--edit', null, P.parts.body, P.chat.body), foot,
      shown() { P.parts.shown?.(); P.chat.shown?.(); sync(); },
      hidden() { P.parts.hidden?.(); P.chat.hidden?.(); },
      repaint() { P.parts.repaint?.(); P.chat.repaint?.(); sync(); },
      paintCta() { P.parts.paintCta?.(); P.chat.paintCta?.(); sync(); },
      sync,
    };
  }

  function withShown(/** @type {(w: Work) => Promise<void>} */ fn) {
    const w = ctx.shownWork(); if (!w || w.state !== 'done') return;
    fn(w).catch(e => toast(e?.message || '未能完成，请重试。'));
  }

  // ── 打开与关闭面板 ──
  function openPanel(/** @type {string} */ id, instant = false) {
    id = OLD_TOOL[id] || id;
    if (!panels[id]) return;
    const was = tool;
    if (was && was !== id) panels[was]?.hidden?.();
    tool = id; keep();
    if (!closeOverlay) closeOverlay = overlay(() => { closeOverlay = null; collapse(); });
    const p = panels[id];
    panelBody.replaceChildren(p.body);
    panelFoot.replaceChildren(...(p.foot ? [p.foot] : []));
    el.dataset.panel = id;
    for (const [k, b] of Object.entries(toolBtns)) { b.setAttribute('aria-selected', String(k === id)); }
    p.shown?.();
    if (!instant && !reduced && !was) tpanel.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    requestAnimationFrame(() => { brushFit(); paintCanvasOverlays(); });
  }
  function closePanel() { if (closeOverlay) closeOverlay(); else collapse(); }
  function collapse() {
    if (!tool) return;
    panels[tool]?.hidden?.();
    tool = ''; keep();
    delete el.dataset.panel;
    for (const b of Object.values(toolBtns)) b.setAttribute('aria-selected', 'false');
    panelBody.replaceChildren(); panelFoot.replaceChildren();
    if (/** @type {HTMLElement | null} */ (document.activeElement)?.closest('.tpanel')) /** @type {HTMLElement} */ (document.activeElement).blur();
    paintCta();
    requestAnimationFrame(() => { brushFit(); paintCanvasOverlays(); });
  }
  const brushFit = () => P.parts?.fit?.();
  const paintCanvasOverlays = () => P.parts?.overlay?.();

  // ── 无照片状态 ──
  function emptyState() {
    const demoB = /** @type {HTMLImageElement} */ (h('img.drop__b', { alt: '' }));
    const demo = h('div.drop__demo', { 'aria-hidden': 'true' }, h('img.drop__a', { src: personArt('mei', 'm'), alt: '' }), h('span.drop__arrow', { html: icon('sparkle') }), demoB);
    return h('div.drop', null, demo,
      h('h2.drop__title', null, T.noPhoto), h('p.drop__line', null, '上传一次，探索所有风格，并精细调整各个区域。'),
      h('div.drop__acts', null,
        h('button.btn.btn--main.btn--lg', { type: 'button', onclick: () => pickPhoto() }, h('span', { html: icon('upload') }), T.upload),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => pickSample() }, h('span', { html: icon('user') }), T.sample)),
      h('ul.drop__tips', null, h('li', null, '正面朝向相机'), h('li', null, '使用均匀光线'), h('li', null, '照片保存在你的私人空间')));
  }

  // ── 选择照片：没有照片时自动使用示例肖像，不再要求先上传 ──
  async function useSample(/** @type {string} */ who = 'mei', quiet = true) {
    try {
      const blob = await fetch(personArt(who)).then(r => r.blob());
      const s = await addSource(blob, { sample: who });
      if (quiet) { S.source = s.id; S.shown = ''; S.picks = []; keep(); paintAll(); }
      else useSource(s, '正在使用示例肖像');
    } catch { paintCanvas(); }
  }
  /** 更换照片：上传、示例或返回相机拍一张。 */
  function changePhoto() {
    const { close } = sheet(() => [
      h('div.pick3', null,
        h('button.pick3__opt', { type: 'button', onclick: () => { close(); pickPhoto(); } }, h('span.pick3__ico', { html: icon('upload') }), h('b', null, '上传照片'), h('span', null, '正面、光线均匀效果最好')),
        h('button.pick3__opt', { type: 'button', onclick: () => { close(); go('live'); } }, h('span.pick3__ico', { html: icon('camera') }), h('b', null, '现在拍一张'), h('span', null, '打开实时相机'))),
      h('p.sheet__label', null, '或使用示例肖像'),
      h('div.samples', null, ...samples().map(who => h('button.sample', { type: 'button', 'aria-label': '示例' + who, onclick: () => { close(); useSample(who, false); } }, h('img', { src: personArt(who, 'm'), alt: '', loading: 'lazy' })))),
    ], { title: '更换照片' });
  }
  async function pickPhoto() {
    const f = await chooseFile();
    if (!f) return;
    try {
      const { blob, w, h: hh } = await prepare(f);
      useSource(await addSource(blob, { w, h: hh }), '已更换照片');
    } catch (e) { toast(/** @type {any} */ (e)?.message || '无法打开这张图片，请换一张照片。'); }
  }
  function pickSample() {
    sheet(close => [
      h('p.sheet__text', null, '手边没有自拍？可以使用示例肖像体验。'),
      h('div.samples', null, ...samples().map(who => h('button.sample', { type: 'button', 'aria-label': '示例' + who, onclick: async () => {
        close();
        const blob = await fetch(personArt(who)).then(r => r.blob());
        useSource(await addSource(blob, { sample: who }), '正在使用示例肖像');
      } }, h('img', { src: personArt(who, 'm'), alt: '', loading: 'lazy' })))),
    ], { title: T.sample });
  }
  /** @param {import('../core/data.js').Source} s @param {string} label */
  function useSource(s, label) {
    S.source = s.id; S.shown = ''; S.picks = [];
    commit(label);
    paintAll();
    if (!reduced) frame.animate([{ opacity: .4, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    checkPhoto(s);
  }
  /** 根据亮度和本地人脸检测给出构图指引，无需上传。 */
  async function checkPhoto(/** @type {import('../core/data.js').Source} */ s) {
    tip.textContent = ''; delete tip.dataset.tone;
    try {
      const blob = await sourceBlob(s); if (!blob) return;
      const bmp = await decode(blob);
      const { mean } = lightOf(/** @type {any} */ (bmp));
      if (S.source !== s.id || S.shown) return;
      if (mean < .22) { tip.textContent = T.tipLight; tip.dataset.tone = 'warn'; return; }
      const c = document.createElement('canvas'), k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(/** @type {any} */ (bmp), 0, 0, c.width, c.height);
      const { findFace } = await import('../live/tracker.js');
      const faceWidth = (await findFace(c))?.width ?? null;
      if (S.source !== s.id || S.shown) return;
      if (faceWidth == null) { tip.textContent = T.tipNoFace; tip.dataset.tone = 'warn'; }
      else if (faceWidth < .18) { tip.textContent = '画面中的人脸较小，请靠近一些或裁剪照片，以获得更好效果。'; tip.dataset.tone = 'warn'; }
      else { tip.textContent = T.tipGood; tip.dataset.tone = 'ok'; setTimeout(() => { if (tip.dataset.tone === 'ok') { tip.textContent = ''; delete tip.dataset.tone; } }, 3500); }
    } catch { /* 检测不可用时跳过指引。 */ }
  }

  // ── 撤销／重做 ──
  function doUndo() {
    const label = undo.undo();
    if (label) toast(T.undone + '：' + label, { action: { label: T.redo, run: () => doRedo() } });
    else toast('没有可撤销的操作。');
  }
  function doRedo() {
    const label = undo.redo();
    if (label) toast(T.redone + '：' + label, { action: { label: T.undo, run: () => doUndo() } });
  }
  function paintUndo() {
    undoBtn.toggleAttribute('disabled', !undo.canUndo); redoBtn.toggleAttribute('disabled', !undo.canRedo);
    undoBtn.title = undo.canUndo ? T.undo + '：' + undo.nextUndo : T.undo;
    redoBtn.title = undo.canRedo ? T.redo + '：' + undo.nextRedo : T.redo;
  }
  /** 撤销或重做后，同步画布、面板与主题。 */
  function afterChange() {
    applyTheme(S.preset); keep();
    paintAll();
    if (tool) panels[tool]?.shown?.();
  }

  // ── 画布状态 ──
  function paintAll() { paintChip(); paintVersions(); paintCanvas(); paintCta(); if (tool) panels[tool]?.repaint?.(); }
  function paintChip() {
    const p = /** @type {any} */ (presetById(S.preset)), w = ctx.shownWork(), q = presetById(w?.preset || S.preset) || p;
    styleChip.replaceChildren(h('img', { src: cover(q.id, 't').art, alt: '' }), h('span', null, h('b', null, q.name), h('span', null, q.line)), h('i.hud__more', null, '示例'));
  }
  async function setImg(/** @type {HTMLImageElement} */ img, /** @type {string} */ url) {
    if (!url) { img.removeAttribute('src'); return; }
    if (img.getAttribute('src') === url) return;
    await new Promise(r => { img.onload = r; img.onerror = r; img.src = url; });
  }
  const ratio = (/** @type {number} */ r) => frame.style.setProperty('--ar', String(Math.max(.56, Math.min(1.6, r || 1))));
  async function paintCanvas() {
    const src = ctx.sourceObj();
    el.dataset.has = src ? 'photo' : 'none';
    empty.hidden = !!src; frame.hidden = !src; versions.hidden = !src;
    const demoA = /** @type {HTMLImageElement} */ (empty.querySelector('.drop__a'));
    const demoB = /** @type {HTMLImageElement} */ (empty.querySelector('.drop__b'));
    const example = hasArt(S.preset, 'mei')
      ? { before: personArt('mei'), art: styleArt(S.preset, 'mei') }
      : cover(S.preset, '');
    demoA.src = example.before;
    demoB.src = example.art;
    unwatch(); unwatch = () => {};
    if (!src) return;
    const w = ctx.shownWork(), baseW = w?.base ? workById(w.base) : null;
    frame.dataset.frame = /** @type {any} */ (presetById(w?.preset || S.preset))?.theme.frame || '';
    failBox.hidden = true; prog.hidden = true;
    after.classList.remove('is-in'); pre.classList.remove('is-in');
    badges.replaceChildren();
    const beforeUrl = baseW ? await resultUrl(baseW) : await sourceUrl(src);
    await setImg(before, beforeUrl);
    if (!w) {
      frame.dataset.state = 'photo';
      ratio(before.naturalWidth / before.naturalHeight);
      cmp.set(1); after.removeAttribute('src');
      changeLabel.textContent = src.sample ? '换成我的照片' : '更换';
      paintHud(); paintCanvasOverlays();
      previewStyle();
      return;
    }
    if (tip.dataset.tone !== 'warn') { tip.textContent = ''; delete tip.dataset.tone; }
    frame.dataset.state = w.state === 'working' || isRunning(w.id) ? 'working' : w.state;
    if (w.state === 'done') await showDone(w, firstLook(w));
    else if (w.state === 'working' || isRunning(w.id)) {
      ratio(w.op === 'restyle' ? (w.format === 'portrait' ? 2 / 3 : 1) : before.naturalWidth / before.naturalHeight);
      prog.hidden = false; cmp.set(1);
      quickLook(w);
      unwatch = watch(w.id, (pr, ww) => {
        prog.update(pr);
        if (pr.partial && pre.dataset.src !== pr.partial) { pre.dataset.src = pr.partial; const im = new Image(); im.onload = () => { pre.src = pr.partial || ''; pre.classList.add('is-in'); }; im.src = pr.partial; }
        if (ww.state !== 'working' && ww.id === S.shown) { paintCta(); paintVersions(); if (ww.state === 'done') { frame.dataset.state = 'done'; showDone(ww, firstLook(ww)); } else showFail(ww); }
      });
    } else showFail(w);
    paintHud(); paintCanvasOverlays();
  }
  /** 查看原图时，立即在画布上用本地渲染预览所选风格（所见即所得）；按住画面查看原图。 */
  let previewKey = '';
  async function previewStyle() {
    const src = ctx.sourceObj();
    if (!src || S.shown || reduced) return;
    const key = src.id + '|' + S.preset + '|' + S.params.strength;
    if (previewKey === key && pre.classList.contains('is-in')) return;
    previewKey = key;
    try {
      const blob = await sourceBlob(src); if (!blob) return;
      const { stylizeStill } = await import('../live/renderer.js');
      const out = await stylizeStill(blob, S.preset, Math.max(.55, (S.params.strength || 70) / 100), 'photo');
      if (previewKey !== key || S.shown) return;
      if (pre.dataset.local) URL.revokeObjectURL(pre.dataset.local);
      const url = URL.createObjectURL(out);
      pre.dataset.local = url; pre.src = url; pre.classList.remove('is-quick'); pre.classList.add('is-in');
      badges.replaceChildren(h('span.badge.badge--live', null, '色调预览 · 生成后为完整艺术肖像'));
    } catch { /* 渲染不可用时跳过本地预览。 */ }
  }
  /** 完整图片生成期间显示本地风格预览。 */
  async function quickLook(/** @type {Work} */ w) {
    pre.removeAttribute('src'); delete pre.dataset.src;
    if (w.op !== 'restyle' || reduced) return;
    try {
      const s = sourceById(w.source); const blob = s && await sourceBlob(s); if (!blob) return;
      const { stylizeStill } = await import('../live/renderer.js');
      const out = await stylizeStill(blob, w.preset, Math.max(.6, (w.params?.strength || 70) / 100), w.format === 'portrait' ? 'portrait' : 'avatar');
      if (S.shown !== w.id || pre.dataset.src) return;
      pre.src = URL.createObjectURL(out); pre.classList.add('is-in', 'is-quick');
    } catch { /* 渲染不可用时跳过本地预览。 */ }
  }
  async function showDone(/** @type {Work} */ w, /** @type {boolean} */ fresh) {
    prog.hidden = true; frame.dataset.state = 'done';
    pre.classList.remove('is-in', 'is-quick');
    const url = await resultUrl(w);
    await setImg(after, url);
    ratio(after.naturalWidth / after.naturalHeight || (w.w && w.h ? w.w / w.h : 1));
    after.classList.add('is-in');
    badges.replaceChildren(...[kindBadge(w, true)].filter(Boolean));
    if (fresh) { reveal(frameBox, after, 1000); burst(frame, w.preset); buzz([16, 60, 24]); toast(T.doneSaved, { action: { label: T.seeIt, run: () => go('work', { id: w.id }) }, tone: 'ok', ms: 3600 }); }
    cmp.set(1);
    paintHud(); paintCanvasOverlays();
    if (tool) panels[tool]?.repaint?.();
  }
  function showFail(/** @type {Work} */ w) {
    prog.hidden = true; failBox.hidden = false; frame.dataset.state = w.state;
    failBox.replaceChildren(h('b', null, w.state === 'stopped' ? '已取消' : T.failed), h('p', null, w.error || ''),
      h('div.frame__failacts', null,
        h('button.btn.btn--main.btn--sm', { type: 'button', onclick: () => { retry(w); paintCanvas(); paintVersions(); paintCta(); } }, h('span', { html: icon('refresh') }), T.retry),
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => doUndo() }, h('span', { html: icon('undo') }), '撤销')));
    paintHud();
  }
  function paintHud() {
    const w = ctx.shownWork(), done = !!w && w.state === 'done', busy = !!w && (w.state === 'working' || isRunning(w.id));
    saveMini.hidden = !done; shareMini.hidden = !done;
    changeBtn.hidden = busy;
    styleChip.hidden = busy;
    frame.classList.toggle('is-photo', !w);
  }
  function showVersion(/** @type {string} */ id) {
    if (id === S.shown) return;
    const w = id ? workById(id) : null;
    S.shown = id;
    commit(id ? '正在查看' + (opName(w)) + '版本' : '正在查看原图');
    paintVersions(); paintCanvas(); paintCta();
    if (tool) panels[tool]?.repaint?.();
  }
  const opName = (/** @type {Work | null} */ w) => !w ? '原图' : w.op === 'region' ? '局部编辑' : w.op === 'edit' ? '对话编辑' : w.op === 'vary' ? '变体' : w.op === 'angles' ? '角度' : presetById(w.preset)?.name || '';
  function paintVersions() {
    const src = ctx.sourceObj(); if (!src) return;
    const list = chainOf(src.id).slice(-40);
    const srcBtn = h('button.ver.ver--src', { type: 'button', 'aria-pressed': String(!S.shown), 'aria-label': '原图', onclick: () => showVersion('') }, h('img', { alt: '' }), h('span', null, '原图'));
    sourceUrl(src).then(u => { /** @type {HTMLImageElement} */ (srcBtn.querySelector('img')).src = u; });
    versions.replaceChildren(srcBtn, ...list.map(w => {
      const b = h('button.ver', { type: 'button', 'aria-pressed': String(w.id === S.shown), data: { state: isRunning(w.id) ? 'working' : w.state, op: w.op || 'restyle' }, 'aria-label': opName(w) + '版本', onclick: () => showVersion(w.id) },
        h('img', { alt: '' }), opBadge(w), h('span', null, opName(w)));
      resultUrl(w).then(async u => { const im = /** @type {HTMLImageElement} */ (b.querySelector('img')); im.src = u || await sourceUrl(src); });
      return b;
    }));
    requestAnimationFrame(() => versions.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
  }
  function paintCta() {
    const p = /** @type {any} */ (presetById(S.preset)), src = ctx.sourceObj(), w = ctx.shownWork();
    const busy = !!w && (w.state === 'working' || isRunning(w.id));
    const same = !!w && w.op === 'restyle' && w.state === 'done' && w.preset === S.preset && JSON.stringify(w.params) === JSON.stringify(S.params) && w.format === S.format;
    goBtn.toggleAttribute('disabled', busy && w?.op === 'restyle');
    goBtn.dataset.state = !src ? 'upload' : busy ? 'busy' : 'go';
    goLabel.textContent = !src ? T.upload : busy && w?.op === 'restyle' ? '正在创作……' : same ? T.again : T.go;
    goSub.textContent = !src ? '请使用光线均匀的正面照片。' : p.name + ' · ' + etaText();
    /** @type {HTMLElement} */ (goBtn.querySelector('.cta__ico')).innerHTML = icon(!src ? 'upload' : 'sparkle');
    for (const pnl of Object.values(panels)) pnl.paintCta?.();
  }

  // ── 创作：完整重新风格化始终从干净的原始照片开始。──
  async function make() {
    const src = ctx.sourceObj();
    if (!src) { pickPhoto(); return; }
    const p = /** @type {any} */ (presetById(S.preset));
    const last = chainOf(src.id).filter(w => w.op === 'restyle' || !w.op).at(-1);
    const w = await create({ source: src.id, preset: S.preset, params: S.params, format: S.format, mode: 'studio', parent: ctx.shownWork()?.id || last?.id, why: describeChange(last) });
    S.shown = w.id;
    commit('已创作：' + p.name);
    paintVersions(); paintCanvas(); paintCta();
    if (tool === 'style' || tool === 'tune') panels[tool]?.repaint?.();
  }
  /** 为活动记录描述相对于上一版本的变化。 */
  function describeChange(/** @type {Work | undefined} */ prev) {
    const p = /** @type {any} */ (presetById(S.preset));
    if (!prev) return '照片工作室 · ' + captionOf(p, S.params);
    const bits = [];
    if (prev.preset !== S.preset) bits.push('已切换为' + p.name + '');
    else {
      for (const k of KNOBS) if (prev.params?.[k.id] !== S.params[k.id]) bits.push(k.label + ' ' + prev.params?.[k.id] + '→' + S.params[k.id]);
      const was = new Set(prev.params?.details || []);
      for (const x of S.params.details) if (!was.has(x)) bits.push('+' + p.details.find((/** @type {any} */ d) => d.id === x)?.label);
      for (const x of was) if (!S.params.details.includes(x)) bits.push('−' + p.details.find((/** @type {any} */ d) => d.id === x)?.label);
    }
    if ((S.params.words || '') !== (prev.params?.words || '') && S.params.words) bits.push('已补充细节：' + S.params.words);
    return bits.length ? bits.join(' · ') : '又创作了一张 · ' + p.name;
  }

  const offs = [
    on('finished', (/** @type {any} */ w) => { if (!el.hidden && w?.source === S.source) { paintVersions(); paintCta(); if (w?.id === S.shown && frame.dataset.state === 'working') paintCanvas(); if (tool) panels[tool]?.repaint?.(); } }),
    on('works', () => { if (!el.hidden && S.source) { paintVersions(); if (tool === 'edit') panels.edit.repaint(); } }),
  ];
  void offs;
  new ResizeObserver(() => { brushFit(); paintCanvasOverlays(); }).observe(frameBox);
  // 桌面快捷键：Escape 优先关闭弹层，再关闭面板；在文本框以外，Ctrl/Command+Z 撤销，Ctrl/Command+Shift+Z 重做。
  document.addEventListener('keydown', e => {
    if (el.hidden || sheetOpen()) return;
    const typing = /** @type {HTMLElement | null} */ (document.activeElement)?.matches?.('input, textarea, [contenteditable="true"]');
    if (e.key === 'Escape' && tool) { e.preventDefault(); if (typing) /** @type {HTMLElement} */ (document.activeElement).blur(); else closePanel(); return; }
    if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
  });

  undo.load(d0.undo);   // 刷新后恢复撤销历史。
  paintUndo();
  return {
    el, keep: true,
    shown() {
      // 从结果页或作品详情进入时，从草稿恢复照片、版本和指定工具。
      const d = draft('studio');
      if (d?.from) {
        const w = workById(d.from);
        if (w) {
          S.source = w.source; S.shown = w.id; S.preset = w.preset; S.params = loadParams(w.preset, w.params);
          if (w.format === 'avatar' || w.format === 'portrait') S.format = w.format;
          commit('继续编辑' + opName(w) + '');
        }
        saveDraft('studio', { ...d, from: '' });
        const tab = d.tab && (OLD_TOOL[d.tab] || d.tab);
        if (tab && panels[tab]) { applyTheme(S.preset); paintAll(); openPanel(tab); return; }
      } else if (d?.preset && d.preset !== S.preset && presetById(d.preset)) {
        S.preset = d.preset; S.params = loadParams(d.preset, null); commit('已选择' + presetById(d.preset)?.name + '');
      }
      applyTheme(S.preset);
      paintAll();
      if (!S.source) useSample();
      if (tool && panels[tool] && !el.dataset.panel) openPanel(tool, true);
    },
    hidden() { if (tool) panels[tool]?.hidden?.(); },
  };
}

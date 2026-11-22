/** 拍摄后的全屏结果页。创作过程中：显示拍摄帧，随后显示中间预览和完成图片，并提供进度与取消。创作完成后：按住对比，无需重拍即可切换风格，并提供调整、更多工具、保存、分享和重拍。更多工具：按画质重新生成、变体、角度、局部编辑、对话编辑和分享卡片。撤销返回上一版本，并支持重做。 */
import { h, icon, toast, holdable } from '../core/dom.js';
import { go, back } from '../core/nav.js';
import { presetById, inCategory, captionOf } from '../presets.js';
import { applyTheme } from '../core/theme.js';
import { work as workById, works, resultUrl, source as sourceById, sourceUrl, saveDraft, saveWork, note, setPref, pref } from '../core/data.js';
import { create, watch, stop, retry, isRunning } from '../core/generate.js';
import { on } from '../core/bus.js';
import { progressBox, saveImage, shareTikTok, kindBadge, styleDot, topBar, opLabel } from '../ui/parts.js';
import { openCard } from '../ui/card.js';
import { openExamples } from '../ui/examples.js';
import { sheet } from '../ui/sheet.js';
import { shotOf, previewOf } from '../core/shots.js';
import { reveal, burst, buzz, firstLook } from '../ui/fx.js';
import { studio } from '../core/api.js';
import { T } from '../copy.js';

/** @typedef {import('../core/data.js').Work} Work */

/** 将已撤销版本保存在页面之外，因为结果之间导航会重新创建页面。 */
let redo = /** @type {string[]} */ ([]);

export function resultScreen(/** @type {Record<string, string>} */ params) {
  let id = params.id || '';
  let unwatch = () => {};
  const before = /** @type {HTMLImageElement} */ (h('img.res__before', { alt: '原图' }));
  const pre = /** @type {HTMLImageElement} */ (h('img.res__pre', { alt: '' }));
  const art = /** @type {HTMLImageElement} */ (h('img.res__art', { alt: '' }));
  const prog = progressBox(() => stop(id));
  const fail = h('div.res__fail', { hidden: true });
  const badge = h('div.res__badges');
  const holdHint = h('span.res__hint', null, h('span', { html: icon('eye') }), T.hold);
  const sibs = h('div.res__sibs', { role: 'listbox', 'aria-label': '本组图片', hidden: true });
  const stageEl = h('div.res__stage', { tabindex: '0', 'aria-label': '作品：按住查看原图' }, before, pre, art, prog, fail, badge, holdHint, sibs);
  holdable(stageEl, onHold => stageEl.classList.toggle('is-before', onHold && el.dataset.state === 'done'), 120);

  const styles = h('div.res__styles', { role: 'listbox', 'aria-label': T.another });
  const acts = h('div.res__acts', null,
    act('camera', T.retake, () => go('live')),
    act('sliders', T.tweak, () => toStudio('tune')),
    act('more', '更多', () => more()),
    act('download', T.save, () => withDone(async w => saveImage(w, await resultUrl(w)))),
    act('send', T.tiktok, () => withDone(async w => shareTikTok(w, await resultUrl(w))), true));
  const titleEl = h('span');
  const undoBtn = h('button.ibtn', { type: 'button', 'aria-label': T.undo, title: T.undo, html: icon('undo'), onclick: () => undo() });
  const redoBtn = h('button.ibtn', { type: 'button', 'aria-label': T.redo, title: T.redo, html: icon('redo'), onclick: () => redoStep() });
  const bar = topBar('', [undoBtn, redoBtn, h('button.bar__link', { type: 'button', onclick: () => go('gallery') }, T.gallery)], () => back('live'));
  bar.querySelector('.bar__title')?.append(titleEl);
  const el = h('section.screen.result', { 'aria-label': '创作结果' }, bar, stageEl,
    h('div.res__dock', null, h('p.res__label', null, T.another, h('span', null, '同一张照片，尝试不同形象。')), styles, acts));

  function act(/** @type {any} */ ic, /** @type {string} */ label, /** @type {() => void} */ run, main = false) {
    return h('button.act' + (main ? '.act--main' : ''), { type: 'button', onclick: run }, h('span.act__ico', { html: icon(ic) }), h('span.act__label', null, label));
  }
  function withDone(/** @type {(w: Work) => Promise<void>} */ fn) {
    const w = workById(id);
    if (!w || w.state !== 'done') { toast('图片仍在创作中，请稍等。'); return; }
    fn(w).catch(e => toast(e?.message || '未能完成，请重试。'));
  }
  /** 在照片工作室中打开此版本，并使用指定工具。 */
  function toStudio(/** @type {string} */ tab) {
    const w = workById(id); if (!w) return;
    if (w.state !== 'done' && tab !== 'tune') { toast('请等待图片完成后再进行编辑。'); return; }
    saveDraft('studio', { source: w.source, preset: w.preset, params: w.params, format: w.format === 'portrait' ? 'portrait' : 'avatar', tab, from: w.id });
    go('studio');
  }
  /** 每项“更多”操作都从此版本继续。 */
  function more() {
    const w = workById(id); if (!w) return;
    const ready = w.state === 'done';
    const tile = (/** @type {any} */ ic, /** @type {string} */ name, /** @type {string} */ line, /** @type {() => void} */ run, off = false) =>
      h('button.mitem', { type: 'button', disabled: off, onclick: () => { close(); run(); } }, h('span.mitem__ico', { html: icon(ic) }), h('b.mitem__name', null, name), h('span.mitem__line', null, line));
    const { close } = sheet(() => [h('div.morelist', null,
      tile('hd', '以超精细画质重新生成', '以最高画质再创作一张', () => hd(), !studio.live),
      tile('layers', '变体', '生成三个方案供你选择', () => batch('vary'), !ready),
      tile('rotate', '角度', '侧面与四分之三侧面视角', () => batch('angles'), !ready),
      tile('face', '局部编辑', '选择面部区域进行编辑', () => toStudio('parts'), !ready),
      tile('chat', '对话编辑', '描述你想做的更改', () => toStudio('chat'), !ready),
      tile('card', '分享卡片', '带原始照片的人像海报', () => openCard(w), !ready)),
      ready ? null : h('p.sheet__text', null, '图片完成后即可使用这些工具。')], { title: '更多创作工具' });
  }
  async function hd() {
    const w = workById(id); if (!w) return;
    const pace = pref('pace', 'fine') === 'deep' ? 'deep' : 'fine';
    const next = await create({ source: w.source, preset: w.preset, params: w.params, format: w.format, mode: w.mode, op: /** @type {any} */ (w.op || 'restyle'), base: w.base, text: w.prompt, pace, parent: w.id, why: '超精细重新生成 · ' + (presetById(w.preset)?.name || '') });
    jump(next.id, '以超精细画质重新生成');
  }
  async function batch(/** @type {'vary' | 'angles'} */ op) {
    const w = workById(id); if (!w || w.state !== 'done') return;
    const next = await create({ source: w.source, preset: w.preset, params: w.params, format: w.format, mode: w.mode, op, base: w.id, n: 3, text: '', parent: w.id, say: op === 'vary' ? '变体' : '展示几个不同角度', why: op === 'vary' ? '变体' : '角度' });
    jump(next.id, op === 'vary' ? '变体' : '角度');
  }
  /** 切换版本，并记录步骤以便撤销。 */
  function jump(/** @type {string} */ to, /** @type {string} */ what) {
    redo = [];
    go('result', { id: to }, { replace: true });
    void what;
  }
  function undo() {
    const w = workById(id), parent = w?.parent ? workById(w.parent) : null;
    if (!w || !parent) { toast('当前已是第一个版本。'); return; }
    redo.push(w.id);
    go('result', { id: parent.id }, { replace: true });
    toast(T.undone + '：返回至' + opLabel(parent) + '', { action: { label: T.redo, run: () => redoStep() } });
  }
  function redoStep() {
    const to = redo.pop();
    if (!to || !workById(to)) { toast('没有可重做的操作。'); return; }
    go('result', { id: to }, { replace: true });
    toast(T.redone);
  }
  function paintUndo(/** @type {Work} */ w) {
    undoBtn.toggleAttribute('disabled', !(w.parent && workById(w.parent)));
    redoBtn.hidden = !redo.length;
  }

  async function show() {
    unwatch();
    // 立即显示拍摄帧和初始进度，随后连接到创建出的作品记录。
    const shot = id.startsWith('shot') ? shotOf(id) : null;
    if (shot) {
      el.dataset.state = 'working'; prog.hidden = false; fail.hidden = true; sibs.hidden = true;
      pre.src = shot.canvas.toDataURL('image/jpeg', .7);
      prog.update({ stage: 0, value: .04, text: T.sending, eta: 10000, started: performance.now(), got: 0, of: 1 });
      try {
        const real = await shot.work;
        if (!el.isConnected) return;
        id = real;
        history.replaceState(history.state, '', '#/result/' + real);
      } catch (e) {
        failed({ state: 'failed', error: /** @type {any} */ (e)?.message || '拍照失败，请重试。' });
        return;
      }
    }
    const w = workById(id);
    if (!w) { fail.hidden = false; fail.replaceChildren(h('p', null, '未找到这件作品。'), h('button.btn.btn--main', { type: 'button', onclick: () => go('gallery') }, '打开' + T.gallery)); prog.hidden = true; return; }
    const p = presetById(w.preset);
    applyTheme(w.preset); setPref('preset', w.preset);
    titleEl.textContent = w.op && w.op !== 'restyle' ? opLabel(w) : p?.name || '';
    el.dataset.style = w.preset;
    paintUndo(w);
    const base = w.base ? workById(w.base) : null;
    before.src = base ? await resultUrl(base) : await sourceUrl(sourceById(w.source));
    const quick = previewOf(w.id);
    if (!shot) { pre.onerror = () => { pre.onerror = null; pre.src = before.src; }; pre.src = quick || before.src; }
    art.classList.remove('is-in'); art.removeAttribute('src');
    paintStyles(w.preset);
    paintSibs(w);
    if (w.state === 'done') await done(w, firstLook(w));
    else if (w.state === 'working' || isRunning(w.id)) {
      el.dataset.state = 'working'; prog.hidden = false; fail.hidden = true;
      unwatch = watch(w.id, (pr, ww) => {
        prog.update(pr);
        if (pr.partial && pre.dataset.src !== pr.partial && ww.op !== 'vary' && ww.op !== 'angles') { pre.dataset.src = pr.partial; const im = new Image(); im.onload = () => { pre.src = pr.partial || ''; pre.classList.add('is-partial'); }; im.src = pr.partial; }
        if (ww.state !== 'working') { if (ww.state === 'done') done(ww, firstLook(ww)); else failed(ww); }
        paintSibs(ww);
      });
    } else failed(w);
  }
  async function done(/** @type {Work} */ w, fresh = false) {
    el.dataset.state = 'done'; prog.hidden = true; fail.hidden = true;
    const url = await resultUrl(w);
    const im = new Image();
    im.onload = () => {
      art.src = url;
      if (fresh) { art.classList.add('is-in'); reveal(stageEl, art, 1100); burst(stageEl, w.preset); buzz([16, 60, 24]); }
      else requestAnimationFrame(() => art.classList.add('is-in'));
    };
    im.src = url;
    badge.replaceChildren(...[kindBadge(w), w.ms ? h('span.badge', null, '用时' + Math.max(1, Math.round(w.ms / 1000)) + 's') : null].filter(Boolean));
    if (!sessionStorage.getItem('hakishow.toasted.' + w.id)) { sessionStorage.setItem('hakishow.toasted.' + w.id, '1'); toast(T.doneSaved, { action: { label: T.seeIt, run: () => go('gallery') }, tone: 'ok', ms: 3200 }); }
  }
  function failed(/** @type {any} */ w) {
    el.dataset.state = 'failed'; prog.hidden = true; fail.hidden = false;
    fail.replaceChildren(h('b', null, w.state === 'stopped' ? '已取消' : T.failed), h('p', null, w.error || ''),
      h('div.res__failacts', null, w.id ? h('button.btn.btn--main', { type: 'button', onclick: () => { retry(w); show(); } }, h('span', { html: icon('refresh') }), T.retry) : null,
        w.parent ? h('button.btn.btn--ghost', { type: 'button', onclick: () => undo() }, h('span', { html: icon('undo') }), T.undo) : h('button.btn.btn--ghost', { type: 'button', onclick: () => go('live') }, T.retake)));
  }
  /** 对变体和角度批次，在主图下方显示可选择的缩略图。 */
  function paintSibs(/** @type {Work} */ w) {
    if (!w.batch) { sibs.hidden = true; sibs.replaceChildren(); return; }
    const group = works().filter(x => x.batch === w.batch).sort((a, b) => (a.index || 0) - (b.index || 0));
    sibs.hidden = group.length < 2;
    sibs.replaceChildren(...group.map(x => {
      const b = h('button.res__sib', { type: 'button', role: 'option', 'aria-selected': String(x.id === id), data: { state: x.state === 'done' ? 'done' : isRunning(x.id) ? 'working' : x.state }, 'aria-label': '图片' + ((x.index || 0) + 1), onclick: () => { if (x.id !== id) go('result', { id: x.id }, { replace: true }); } }, h('img', { alt: '' }));
      if (x.state === 'done') resultUrl(x).then(u => { /** @type {HTMLImageElement} */ (b.querySelector('img')).src = u; });
      return b;
    }));
  }
  /** 将相关风格排在底部条带前面；点击风格会复用原始照片。 */
  function paintStyles(/** @type {string} */ now) {
    const p = presetById(now);
    const near = p ? inCategory(p.cat).map(x => x.id) : [];
    const order = [...new Set([now, ...near, ...inCategory('hot').map(x => x.id)])].slice(0, 12);
    styles.replaceChildren(...order.map(sid => {
      const d = styleDot(sid);
      d.setAttribute('aria-selected', String(sid === now));
      d.addEventListener('click', () => switchTo(sid));
      return d;
    }));
    requestAnimationFrame(() => styles.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  async function switchTo(/** @type {string} */ sid) {
    const w = workById(id);
    if (!w) return;
    if (sid === w.preset) { openExamples(sid); return; }   // 点击选中的风格查看示例。
    const p = presetById(sid); if (!p) return;
    const params = { ...p.defaults, details: [...p.defaults.details], strength: w.params.strength };
    // 重新风格化始终从原始照片开始，避免叠加之前的风格处理。
    const next = await create({ source: w.source, preset: sid, params, format: w.format === 'photo' ? 'portrait' : w.format, mode: w.mode, parent: w.id, pace: w.mode === 'live' ? pref('livePace', 'quick') : undefined, why: '另一个风格 · ' + captionOf(p, params) });
    note(w, 'style', '已切换为' + p.name + ''); saveWork(w);
    jump(next.id, '已切换为' + p.name + '');
  }
  // 如果错过进度订阅，则刷新已完成作品，同时不中断正在进行的展示动画。
  const off = on('finished', (/** @type {any} */ w) => { if (!el.hidden && w?.batch && workById(id)?.batch === w.batch) paintSibs(/** @type {Work} */ (workById(id))); if (w?.id === id && !el.hidden && el.dataset.state !== 'done') show(); });

  return {
    el,
    shown(/** @type {Record<string, string>} */ p) { id = p.id || id; show(); },
    hidden() { unwatch(); off(); },
  };
}

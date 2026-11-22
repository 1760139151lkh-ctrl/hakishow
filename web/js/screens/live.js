/** 实时相机：竖幅取景器 + 三层创作能力。
 *  1 全局基础层（右侧工具栏“美颜”）：磨皮、美白、红润、瘦脸、大眼、V 脸、瘦鼻与基础滤镜，任何特效下都生效。
 *  2 实时特效层（底部轮播）：33 个特效包，接管美型、妆容、背景、三维挂件、动作触发与音效；左右滑动即时预览，停稳后应用主题。
 *  3 云端创作层：按下快门后，原始照片发往工作室生成艺术肖像；结果页同时保留本地实拍效果。
 * 取景时自动构图，让人脸落在顶栏与底部面板之间的视觉中心；按住画面对比原图，点击画面触发特效的互动。 */
import { h, icon, toast, clamp, reduced, uid } from '../core/dom.js';
import { holdShot, setPreview } from '../core/shots.js';
import { go } from '../core/nav.js';
import { on } from '../core/bus.js';
import { inCategory, presetById, defaultsOf, CATEGORIES, allPresets } from '../presets.js';
import { applyTheme } from '../core/theme.js';
import { pref, setPref, addSource, isFav, toggleFav, works, resultUrl } from '../core/data.js';
import { create } from '../core/generate.js';
import { prepare, canvasOf, blobOf } from '../core/image.js';
import { bgArt, icon as styleIcon } from '../core/assets.js';
import { createCamera, cameraPermission } from '../live/camera.js';
import { createRenderer, BEAUTY0 } from '../live/renderer.js';
import { createOverlay, preloadPack } from '../live/overlay.js';
import { loadTracker, createTrack, tessellation } from '../live/tracker.js';
import { loadSegmenter, createMask } from '../live/segment.js';
import { buildTopology } from '../live/mesh.js';
import { packOf, TRIGGER_WORDS } from '../live/effects.js';
import { LOOKS, LOOK_ORDER } from '../live/looks.js';
import { play, unlock, isMuted, setMuted } from '../live/sound.js';
import { styleDot } from '../ui/parts.js';
import { buzz } from '../ui/fx.js';
import { openExamples } from '../ui/examples.js';
import { sheet, focusSoon } from '../ui/sheet.js';
import { T } from '../copy.js';

/** 美颜与美型项目：默认值偏自然。 */
const BEAUTY_ITEMS = [
  { id: 'smooth', label: '磨皮', ico: 'drop', tab: 'skin', def: .45 }, { id: 'whiten', label: '美白', ico: 'sun', tab: 'skin', def: .25 }, { id: 'rosy', label: '红润', ico: 'heart', tab: 'skin', def: .2 },
  { id: 'slim', label: '瘦脸', ico: 'faceSlim', tab: 'shape', def: .3 }, { id: 'eyes', label: '大眼', ico: 'eye', tab: 'shape', def: .25 }, { id: 'chin', label: 'V 脸', ico: 'chin', tab: 'shape', def: .15 }, { id: 'nose', label: '瘦鼻', ico: 'nose', tab: 'shape', def: .15 },
];
const BG_MODES = [['auto', '跟随特效'], ['none', '原景'], ['blur', '虚化'], ['scene', '场景']];
/** 搜索用的特效关键词。 */
const FX_WORDS = /** @type {Record<string, string>} */ ({ fire: '喷火 火焰', hearts: '爱心 心动', beam: '光束 能量', stars: '星星', sparkle: '闪光 闪亮', wow: '惊讶 哇', sweat: '流汗 尴尬', candy: '糖果', paws: '猫爪 萌宠', bolt: '闪电', lock: '锁定 瞄准', ko: '格斗 KO', leaves: '落叶', roses: '玫瑰', blossom: '樱花 桃花', transform: '变身', aura: '斗气 气场', likes: '点赞 直播', glitch: '故障', flash: '闪光灯', glow: '发光', variant: '换装 切换', random: '随机 盲盒' });

export function liveScreen() {
  let cat = pref('liveCat', 'hot');
  let current = pref('preset', 'princess');
  let strength = pref('liveStrength', .85);
  /** @type {Record<string, number>} */
  let beauty = { ...Object.fromEntries(BEAUTY_ITEMS.map(b => [b.id, b.def])), ...pref('beauty', {}) };
  let lookId = pref('look', 'none'), bgPref = pref('liveBg', 'auto');
  let running = false, raf = 0, stopTimer = 0, splitOn = false;
  let tracker = /** @type {any} */ (null), segmenter = /** @type {any} */ (null), engineReady = false;
  const track = createTrack(), mask = createMask();

  // ── 取景器 ──
  const video = /** @type {HTMLVideoElement} */ (h('video.live__video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' }));
  const gl = /** @type {HTMLCanvasElement} */ (h('canvas.live__gl', { 'aria-label': '实时取景器' }));
  const fxc = /** @type {HTMLCanvasElement} */ (h('canvas.live__fx', { 'aria-hidden': 'true' }));
  const flash = h('div.live__flash', { 'aria-hidden': 'true' });
  const guide = h('div.live__guide', { 'aria-hidden': 'true' }, h('span.live__oval'), h('span.live__guidetext', null, T.faceLost));
  const holdTag = h('span.live__hold', { 'aria-hidden': 'true' }, '原图');
  const gateText = h('p.gate__text', null, T.camAsk);
  const gateBtn = h('button.btn.btn--main', { type: 'button', onclick: () => startCam(true) }, h('span', { html: icon('camera') }), h('span', null, T.camOn));
  const gate = h('div.gate', null,
    h('div.gate__art', { 'aria-hidden': 'true' }, h('span', { html: icon('camera') })),
    gateText, gateBtn,
    h('button.btn.btn--glass', { type: 'button', onclick: () => go('studio') }, h('span', { html: icon('upload') }), h('span', null, '用照片创作')));
  const view = h('div.live__view', null, video, gl, fxc, guide, holdTag, flash, gate);
  const camera = createCamera(video);
  let punch = 0;
  const renderer = createRenderer(gl);
  const overlay = createOverlay(fxc, { punch: k => { punch = Math.max(punch, k); }, look: patch => renderer?.patchLook(patch) });

  // ── 顶栏：作品库、模式切换、个人中心 ──
  const galleryBtn = h('button.live__gal', { type: 'button', onclick: () => go('gallery'), 'aria-label': T.gallery }, h('span.live__galthumb'));
  const meBtn = h('button.live__me', { type: 'button', onclick: () => go('me'), 'aria-label': T.me, html: icon('user') });
  const modes = h('nav.modes', { 'aria-label': '模式' },
    h('button.modes__opt', { type: 'button', 'aria-current': 'page' }, h('span', null, '拍摄')),
    h('button.modes__opt', { type: 'button', onclick: () => go('studio') }, h('span', null, '精修')));
  const top = h('header.live__top', null, galleryBtn, modes, meBtn);

  // ── 右侧工具栏 ──
  const tool = (/** @type {any} */ ic, /** @type {string} */ label, /** @type {() => void} */ run, key = '') => h('button.tool', { type: 'button', onclick: run, 'aria-label': label, data: { tool: key } },
    h('span.tool__ico', { html: icon(ic) }), h('span.tool__label', null, label));
  const soundBtn = tool(isMuted() ? 'soundOff' : 'sound', '声音', () => { setMuted(!isMuted()); paintTools(); toast(isMuted() ? '已静音特效音效' : '已开启特效音效'); if (!isMuted()) play('pop'); }, 'sound');
  const tools = h('aside.live__tools', { 'aria-label': '工具' },
    tool('flip', T.flip, () => flipCam(), 'flip'),
    tool('beauty', '美颜', () => togglePanel(), 'beauty'),
    tool('backdrop', '背景', () => toggleBgPop(), 'bg'),
    tool('compare', T.compare, () => toggleSplit(), 'compare'),
    soundBtn);
  function paintTools() {
    tools.querySelector('[data-tool="beauty"]')?.setAttribute('aria-pressed', String(!panel.hidden));
    tools.querySelector('[data-tool="bg"]')?.setAttribute('aria-pressed', String(!bgPop.hidden));
    tools.querySelector('[data-tool="compare"]')?.setAttribute('aria-pressed', String(splitOn));
    /** @type {HTMLElement} */ (soundBtn.querySelector('.tool__ico')).innerHTML = icon(isMuted() ? 'soundOff' : 'sound');
    soundBtn.setAttribute('aria-pressed', String(!isMuted()));
  }

  // ── 背景选择 ──
  const bgPop = h('div.bgpop', { hidden: true, role: 'radiogroup', 'aria-label': '背景' });
  function paintBgPop() {
    bgPop.replaceChildren(...BG_MODES.map(([id, label]) => h('button.bgpop__opt', { type: 'button', role: 'radio', 'aria-checked': String(bgPref === id), onclick: () => { bgPref = id; setPref('liveBg', id); applyBg(); paintBgPop(); } }, h('span', null, label))));
  }
  function toggleBgPop() { bgPop.hidden = !bgPop.hidden; if (!bgPop.hidden) { panel.hidden = true; paintBgPop(); } paintTools(); }
  function bgMode() { const want = bgPref === 'auto' ? (packOf(current).bg || 'none') : bgPref; return want === 'scene' ? 2 : want === 'blur' ? 1 : 0; }
  function applyBg() {
    const m = bgMode();
    renderer?.setBackground(m, bgArt(current));
    overlay.setScene(m === 2);
    if (m > 0) warmSegmenter();
  }

  // ── 美颜面板：美颜 / 美型 / 滤镜 / 特效 ──
  let ptab = 'skin', pitem = 'smooth';
  const ptabs = h('div.bp__tabs', { role: 'tablist' });
  const pitems = h('div.bp__items');
  const pval = h('b.bp__val');
  const prange = /** @type {HTMLInputElement} */ (h('input.bp__range', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': '强度' }));
  const pslider = h('label.bp__slider', null, prange, pval);
  const panel = h('section.bp', { hidden: true, 'aria-label': '美颜与滤镜' }, pslider, pitems, ptabs);
  prange.addEventListener('input', () => {
    const v = Number(prange.value) / 100;
    prange.style.setProperty('--v', prange.value + '%'); pval.textContent = prange.value;
    if (ptab === 'look') { renderer?.setLook(lookId, v); setPref('lookAmt', v); }
    else if (ptab === 'fx') { strength = v; renderer?.setStrength(v); overlay.setStrength(v); }
    else { beauty[pitem] = v; renderer?.setBeauty({ [pitem]: v }); }
    paintItems(true);
  });
  prange.addEventListener('change', () => { setPref('beauty', beauty); setPref('liveStrength', strength); });
  function paintPanel() {
    const tabs = [['skin', '美颜'], ['shape', '美型'], ['look', '滤镜'], ['fx', '特效']];
    ptabs.replaceChildren(...tabs.map(([id, label]) => h('button.bp__tab', { type: 'button', role: 'tab', 'aria-selected': String(ptab === id), onclick: () => { ptab = id; pitem = id === 'skin' ? 'smooth' : id === 'shape' ? 'slim' : pitem; paintPanel(); } }, h('span', null, label))));
    paintItems();
  }
  function paintItems(valuesOnly = false) {
    if (ptab === 'look' || ptab === 'fx') {
      const amt = ptab === 'look' ? pref('lookAmt', 1) : strength;
      prange.value = String(Math.round(amt * 100)); prange.style.setProperty('--v', prange.value + '%'); pval.textContent = prange.value;
      pslider.hidden = ptab === 'look' && lookId === 'none';
      if (valuesOnly) return;
      if (ptab === 'look') pitems.replaceChildren(...LOOK_ORDER.map(id => h('button.bp__look', { type: 'button', 'aria-pressed': String(lookId === id), data: { look: id }, onclick: () => { lookId = id; setPref('look', id); renderer?.setLook(id, pref('lookAmt', 1)); paintItems(); } }, h('span.bp__swatch'), h('span.bp__name', null, LOOKS[id].name))));
      else pitems.replaceChildren(h('p.bp__note', null, '特效强度同时控制美型、妆容、挂件与风格色调。'),
        h('button.bp__reset', { type: 'button', onclick: () => { strength = .85; renderer?.setStrength(strength); overlay.setStrength(strength); setPref('liveStrength', strength); paintItems(); } }, h('span', { html: icon('refresh') }), h('span', null, '恢复默认')));
      return;
    }
    const items = BEAUTY_ITEMS.filter(b => b.tab === ptab);
    if (!items.some(b => b.id === pitem)) pitem = items[0].id;
    const v = Math.round((beauty[pitem] || 0) * 100);
    prange.value = String(v); prange.style.setProperty('--v', v + '%'); pval.textContent = String(v); pslider.hidden = false;
    if (valuesOnly) { pitems.querySelectorAll('.bp__item').forEach(b => b.classList.toggle('is-on', (beauty[/** @type {HTMLElement} */ (b).dataset.item || ''] || 0) > .005)); return; }
    pitems.replaceChildren(...items.map(b => h('button.bp__item', { type: 'button', 'aria-pressed': String(pitem === b.id), class: (beauty[b.id] || 0) > .005 ? 'is-on' : '', data: { item: b.id }, onclick: () => { pitem = b.id; paintItems(); } },
      h('span.bp__ico', { html: icon(/** @type {any} */ (b.ico)) }), h('span.bp__name', null, b.label))),
      h('button.bp__item.bp__item--reset', { type: 'button', onclick: () => { for (const b of items) beauty[b.id] = b.def; renderer?.setBeauty(beauty); setPref('beauty', beauty); paintItems(); toast('已恢复自然美颜'); } },
        h('span.bp__ico', { html: icon('refresh') }), h('span.bp__name', null, '重置')));
  }
  function togglePanel(force = !panel.hidden ? false : true) {
    panel.hidden = !force; bgPop.hidden = true;
    el.classList.toggle('is-panel', force);
    if (force) paintPanel();
    paintTools(); layout();
  }

  // ── 底部：特效名称、分类、轮播与快门 ──
  const nameEl = h('b.live__name'), hintEl = h('span.live__hint');
  const label = h('button.live__label', { type: 'button', 'aria-label': '查看此风格的示例作品', onclick: () => openExamples(current) }, nameEl, hintEl);
  const catBtns = h('nav.live__cats.pills', { role: 'tablist', 'aria-label': '特效分类' });
  const browseBtn = h('button.live__browse', { type: 'button', 'aria-label': '全部特效', onclick: () => browse(), html: icon('grid') });
  const track2 = h('div.carousel__track', { role: 'listbox', 'aria-label': '特效' });
  const rail = h('div.carousel__rail'); track2.append(rail);
  const shutterImg = /** @type {HTMLImageElement} */ (h('img', { alt: '' }));
  const shutter = h('button.shutter', { type: 'button', 'aria-label': T.go + '（拍照）' }, h('span.shutter__ring'), h('span.shutter__face', null, shutterImg));
  const coach = h('div.coach', { hidden: true, role: 'note' }, h('span', null, '左右滑动换特效，点击拍照'), h('button.coach__x', { type: 'button', 'aria-label': T.close, html: icon('close'), onclick: () => dismissCoach() }));
  const carousel = h('div.carousel', null, track2, shutter, coach);
  const bottom = h('footer.live__bottom', null, label, h('div.live__catrow', null, browseBtn, catBtns), carousel);
  const el = h('section.screen.live', { 'aria-label': T.live }, view, top, tools, bgPop, panel, bottom);

  function paintCats() {
    catBtns.replaceChildren(...CATEGORIES.map(c => h('button.pill', { type: 'button', role: 'tab', data: { cat: c.id }, 'aria-selected': String(c.id === cat), onclick: () => { if (cat !== c.id) { cat = c.id; setPref('liveCat', c.id); paintCats(); fill(true); } } }, h('span', null, c.label))));
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (catBtns.querySelector('[aria-selected="true"]'))?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
  }

  // ── 轮播：原生滚动吸附 + 拾取器式缩放 ──
  /** @type {HTMLElement[]} */ let dots = [];
  let previewIdx = -1, settleTimer = 0, scrollRaf = 0, settledId = '';
  const centerOf = (/** @type {HTMLElement} */ d) => d.offsetLeft + d.offsetWidth / 2 - track2.clientWidth / 2;
  function fill(animate = false) {
    const list = inCategory(cat);
    dots = list.map(p => styleDot(p.id));
    rail.replaceChildren(...dots);
    dots.forEach((d, i) => d.addEventListener('click', () => {
      if (d.dataset.style === current && Math.abs(track2.scrollLeft - centerOf(d)) < 4) shoot();
      else scrollToIdx(i, true);
    }));
    if (!list.some(p => p.id === current)) current = list[0].id;
    if (animate && !reduced) rail.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    requestAnimationFrame(() => { scrollToIdx(dots.findIndex(d => d.dataset.style === current), false); commit(current, animate); });
  }
  function scrollToIdx(/** @type {number} */ i, /** @type {boolean} */ smooth) {
    const d = dots[Math.max(0, i)]; if (!d) return;
    track2.scrollTo({ left: centerOf(d), behavior: smooth && !reduced ? 'smooth' : 'auto' });
    if (!smooth) shape();
  }
  /** 每帧根据离中心的距离缩放圆点，并即时预览中心的特效。 */
  function shape() {
    const mid = track2.scrollLeft + track2.clientWidth / 2;
    let best = 0, bestD = Infinity;
    dots.forEach((d, i) => {
      const c = d.offsetLeft + d.offsetWidth / 2, dist = Math.abs(c - mid);
      if (dist < bestD) { bestD = dist; best = i; }
      const k = Math.min(1, dist / 160);
      d.style.transform = `scale(${(1 - .2 * k).toFixed(3)})`;
      d.style.opacity = dist < 20 ? '0' : String(1 - .35 * k);
    });
    if (best !== previewIdx) {
      const first = previewIdx < 0;
      previewIdx = best;
      const id = dots[best]?.dataset.style || current;
      if (!first) { play('tick'); buzz(4); }
      preview(id);
    }
  }
  track2.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollRaf); scrollRaf = requestAnimationFrame(shape);
    clearTimeout(settleTimer); settleTimer = window.setTimeout(settle, 140);
  }, { passive: true });
  track2.addEventListener('scrollend', () => { clearTimeout(settleTimer); settle(); });
  function settle() { cancelAnimationFrame(scrollRaf); shape(); const id = dots[previewIdx]?.dataset.style; if (id) commit(id, true); }
  /** 带头顶挂件（王冠、发箍、帽子、耳朵）的特效包需要更多头顶空间，避免挂件被顶栏遮挡或超出画面。 */
  const headroomOf = (/** @type {string} */ id) => { const pk = packOf(id); return [...(pk.wear || []), ...(pk.variants || []).flat()].some(w => w.at === 'crown') ? .6 : 0; };
  /** 滑动中：只切换渲染参数与名称，不改主题，保证跟手。 */
  function preview(/** @type {string} */ id) {
    const p = presetById(id); if (!p) return;
    current = id;
    renderer?.setPreset(id); renderer?.setHeadroom(headroomOf(id)); overlay.setPreset(id); applyBg();
    shutterImg.src = styleIcon(id);
    nameEl.textContent = p.name; hintEl.textContent = packOf(id).hint || p.line;
  }
  /** 停稳后：保存选择、应用主题、提示互动玩法。 */
  function commit(/** @type {string} */ id, /** @type {boolean} */ announce) {
    preview(id);
    dots.forEach(d => d.setAttribute('aria-selected', String(d.dataset.style === id)));
    setPref('preset', id);
    applyTheme(id);
    if (announce && settledId && settledId !== id) showLabel();
    settledId = id;
    // 预取左右相邻特效的贴纸与背景。
    const i = dots.findIndex(d => d.dataset.style === id);
    for (const j of [i - 1, i + 1]) { const n = dots[j]?.dataset.style; if (n) { preloadPack(n); const b = bgArt(n); if (b) { const im = new Image(); im.src = b; } } }
  }
  let labelTimer = 0;
  function showLabel() { label.classList.add('is-on'); clearTimeout(labelTimer); labelTimer = window.setTimeout(() => label.classList.remove('is-on'), 2600); }

  // 从快门开始横向拖动也能切换特效：手指松开时按速度预测落点，再平滑吸附。
  let drag = /** @type {{ x: number, y: number, left: number, active: boolean, vx: number, lx: number, lt: number } | null} */ (null), suppressTap = 0;
  shutter.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { drag = { x: e.clientX, y: e.clientY, left: track2.scrollLeft, active: false, vx: 0, lx: e.clientX, lt: performance.now() }; });
  shutter.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active) { if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) return; drag.active = true; shutter.setPointerCapture(e.pointerId); track2.style.scrollSnapType = 'none'; }
    const now = performance.now(); drag.vx = (e.clientX - drag.lx) / Math.max(1, now - drag.lt); drag.lx = e.clientX; drag.lt = now;
    track2.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.active) return;
    suppressTap = Date.now() + 250;
    const aim = track2.scrollLeft - d.vx * 180;
    let best = 0, bestD = Infinity;
    dots.forEach((x, i) => { const dist = Math.abs(centerOf(x) - aim); if (dist < bestD) { bestD = dist; best = i; } });
    track2.style.scrollSnapType = '';
    scrollToIdx(best, true);
  };
  shutter.addEventListener('pointerup', endDrag);
  shutter.addEventListener('pointercancel', endDrag);
  shutter.addEventListener('click', () => { if (Date.now() >= suppressTap) shoot(); });

  // ── 全部特效：搜索、收藏与分类 ──
  function browse() {
    let q = '', tab = 'all';
    const field = /** @type {HTMLInputElement} */ (h('input.fxs__search', { type: 'search', placeholder: '搜索特效，例如：公主、霓虹、喷火', 'aria-label': '搜索特效', enterkeyhint: 'search' }));
    const tabs = h('div.fxs__tabs.pills', { role: 'tablist' });
    const grid = h('div.fxs__grid', { role: 'listbox', 'aria-label': '全部特效' });
    const paint = () => {
      tabs.replaceChildren(...[['all', '全部'], ['fav', '收藏'], ['play', '互动'], ...CATEGORIES.filter(c => c.id !== 'hot').map(c => [c.id, c.label])].map(([id, l]) =>
        h('button.pill', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; paint(); } }, h('span', null, l))));
      const words = q.trim();
      const interactive = (/** @type {string} */ id) => (packOf(id).triggers || []).some(t => t.on !== 'tap');
      const list = allPresets().filter(p => !p.custom && (tab === 'all' || (tab === 'fav' ? isFav(p.id) : tab === 'play' ? interactive(p.id) : p.cat === tab)) &&
        (!words || [p.name, p.line, p.hook, packOf(p.id).hint || '', ...(packOf(p.id).triggers || []).map(t => FX_WORDS[t.fx] || '')].some(s => (s || '').includes(words))));
      grid.replaceChildren(...(list.length ? list.map(p => {
        const fav = h('span.fxs__fav', { role: 'button', tabindex: '0', 'aria-label': isFav(p.id) ? '取消收藏' : T.fav, 'aria-pressed': String(isFav(p.id)), html: icon(isFav(p.id) ? 'heartFill' : 'heart'),
          onclick: async (/** @type {Event} */ e) => { e.stopPropagation(); await toggleFav(p.id); paint(); } });
        return h('button.fxs__item', { type: 'button', role: 'option', 'aria-selected': String(p.id === current), onclick: () => { close(); pick(p.id); } },
          h('span.fxs__art', null, h('img', { src: styleIcon(p.id), alt: '', loading: 'lazy' })), h('span.fxs__name', null, p.name), interactive(p.id) ? h('span.fxs__play', null, (packOf(p.id).triggers || []).filter(t => t.on !== 'tap').map(t => TRIGGER_WORDS[t.on]).filter((w, i, a) => a.indexOf(w) === i).join(' · ')) : null, fav);
      }) : [h('p.fxs__empty', null, tab === 'fav' ? '还没有收藏的特效，点击爱心即可收藏。' : '没有找到相关特效，换个关键词试试。')]));
    };
    field.addEventListener('input', () => { q = field.value; paint(); });
    const { close } = sheet(() => [field, tabs, grid], { title: '全部特效', cls: 'sheet--tall sheet--fx' });
    paint();
    void focusSoon;
  }
  function pick(/** @type {string} */ id) {
    const p = presetById(id); if (!p) return;
    if (!inCategory(cat).some(x => x.id === id)) { cat = p.cat; setPref('liveCat', cat); paintCats(); }
    current = id; fill(false); showLabel();
  }

  // ── 画面手势：按住对比原图、点击触发互动 ──
  let holdTimer = 0, held = false, downAt = 0;
  view.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
    downAt = Date.now(); held = false;
    if (splitOn) { dragSplit(e); return; }
    holdTimer = window.setTimeout(() => { held = true; renderer?.setBypass(true); fxc.style.opacity = '0'; holdTag.classList.add('is-on'); buzz(6); }, 260);
  });
  const release = () => {
    clearTimeout(holdTimer);
    if (held) { held = false; renderer?.setBypass(false); fxc.style.opacity = ''; holdTag.classList.remove('is-on'); return; }
    if (Date.now() - downAt > 400 || splitOn) return;
    if (!panel.hidden || !bgPop.hidden) { togglePanel(false); return; }
    unlock(); fireTrigger('tap');
  };
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (held) { held = false; renderer?.setBypass(false); fxc.style.opacity = ''; holdTag.classList.remove('is-on'); } });
  let split = .5;
  function toggleSplit() { splitOn = !splitOn; split = .5; renderer?.setSplit(splitOn ? split : -1); view.classList.toggle('is-split', splitOn); paintTools(); if (splitOn) toast('左侧为原图，拖动分隔线对比效果。'); }
  function dragSplit(/** @type {PointerEvent} */ e) {
    const r = view.getBoundingClientRect();
    const move = (/** @type {PointerEvent} */ ev) => { split = clamp((ev.clientX - r.left) / r.width, .05, .95); renderer?.setSplit(split); };
    move(e); view.setPointerCapture(e.pointerId);
    const up = () => { view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); };
    view.addEventListener('pointermove', move); view.addEventListener('pointerup', up);
  }

  // ── 相机 ──
  async function startCam(asked = false) {
    clearTimeout(stopTimer);
    if (camera.on) { el.dataset.cam = 'on'; gate.hidden = true; loop(); return; }
    const perm = await cameraPermission();
    if (perm === 'denied') { gateFor('denied'); return; }
    if (perm !== 'granted' && !asked && !pref('camAsked', false)) { gateFor('ask'); return; }
    el.dataset.cam = 'starting'; gate.hidden = false; gateBtn.hidden = true; gateText.textContent = T.camStarting;
    try {
      await camera.start();
      setPref('camAsked', true);
      el.dataset.cam = 'on'; gate.hidden = true; gateBtn.hidden = false; gateText.textContent = '';
      renderer?.setMirror(camera.facing === 'user');
      loop(); warmEngine(); showCoach();
    } catch (e) { gateFor(/** @type {any} */ (e).reason || 'busy'); }
  }
  /** @param {'ask' | 'denied' | 'none' | 'busy'} why */
  function gateFor(why) {
    el.dataset.cam = why;
    gate.hidden = false;
    gateText.textContent = why === 'ask' ? T.camAsk : why === 'denied' ? T.camDenied : why === 'none' ? T.camNone : '相机正被其他应用使用，请关闭该应用后重试。';
    gateBtn.hidden = why === 'denied' || why === 'none';
    if (why === 'denied' || why === 'none') toast(why === 'denied' ? T.camDenied : T.camNone, { ms: 4200, action: { label: '用照片创作', run: () => go('studio') } });
  }
  async function flipCam() {
    try { await camera.flip(); renderer?.setMirror(camera.facing === 'user'); track.reset(); }
    catch { toast('此设备没有其他可用相机。'); }
  }
  async function warmEngine() {
    if (engineReady) return;
    try {
      const [t, edges] = await Promise.all([loadTracker('VIDEO'), tessellation()]);
      tracker = t; renderer?.setTopology(buildTopology(edges)); engineReady = true;
    } catch { tracker = null; }
  }
  async function warmSegmenter() { if (segmenter) return; try { segmenter = await loadSegmenter(); } catch { segmenter = null; } }

  // ── 渲染循环：同一帧内完成检测、分割、触发与绘制，保证特效与人脸严格同步 ──
  /** @type {Record<string, { armed: boolean, at: number }>} */ const trig = {};
  let lastVideoTime = -1, detectCost = 0, skip = 0, frames = 0, drawCost = 0, scale = 1;
  function loop() {
    if (running) return;
    running = true;
    const frame = (/** @type {number} */ t) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (!camera.ready) return;
      if (++frames % 30 === 0) scale = drawCost > 24 ? Math.max(.55, scale * .88) : drawCost < 10 && scale < 1 ? Math.min(1, scale / .88) : scale;
      const dpr = Math.min(devicePixelRatio || 1, 2) * scale;
      const W = Math.min(2048, Math.round(view.clientWidth * dpr)), H = Math.min(2048, Math.round(view.clientHeight * dpr));
      if (W < 2 || H < 2) return;
      renderer?.resize(W, H); overlay.resize(W, H);
      const fresh = video.currentTime !== lastVideoTime;
      const d0 = performance.now();
      if (fresh) {
        lastVideoTime = video.currentTime;
        if (tracker && (skip++ % (detectCost > 28 ? 2 : 1) === 0)) {
          const s0 = performance.now();
          try {
            const res = tracker.detectForVideo(video, s0);
            const lm = res?.faceLandmarks?.[0];
            if (lm?.length) track.push(lm, res.faceBlendshapes?.[0]?.categories || [], s0, video.videoWidth, video.videoHeight);
            else track.lost(s0);
          } catch { /* 丢失的一帧 */ }
          detectCost = detectCost * .85 + (performance.now() - s0) * .15;
        }
        if (segmenter && renderer && renderer.background > 0) {
          try { const m = mask.update(segmenter, video, performance.now()); if (m) renderer.setSegMask(m.px, m.w, m.h); } catch { /* 跳过 */ }
        }
      }
      const f = track.state;
      renderer?.setFace(f);
      punch *= .86; renderer?.setPunch(punch);
      if (fresh || punch > .001) renderer?.draw(video, video.videoWidth, video.videoHeight, t);
      const toCanvas = renderer ? renderer.toCanvas : (/** @type {number} */ x, /** @type {number} */ y) => [x, y];
      if (f) triggers(f, toCanvas);
      overlay.draw(f, t, toCanvas);
      drawCost = drawCost * .9 + (performance.now() - d0) * .1;
      el.classList.toggle('has-face', !!f);
    };
    raf = requestAnimationFrame(frame);
  }
  /** 动作状态机：上升沿触发、迟滞重置、冷却时间，避免连续误触。 */
  function triggers(/** @type {import('../live/tracker.js').Track} */ f, /** @type {any} */ toCanvas) {
    const pack = packOf(current), now = performance.now();
    for (const tg of pack.triggers || []) {
      if (tg.on === 'tap') continue;
      const v = tg.on === 'mouth' ? f.expr.mouth : tg.on === 'smile' ? f.expr.smile : tg.on === 'brow' ? f.expr.brow : Math.abs(f.yaw);
      const [hi, lo] = tg.on === 'mouth' ? [.42, .22] : tg.on === 'smile' ? [.6, .35] : tg.on === 'brow' ? [.55, .3] : [.38, .15];
      const s = trig[tg.on + tg.fx] ||= { armed: true, at: 0 };
      if (tg.hold && v > hi) { overlay.fire(tg.fx, f, toCanvas); if (s.armed && now - s.at > 650) { play(tg.sfx || ''); s.at = now; s.armed = false; } continue; }
      if (s.armed && v > hi && now - s.at > 700) { s.armed = false; s.at = now; overlay.fire(tg.fx, f, toCanvas); play(tg.sfx || ''); buzz(10); }
      else if (!s.armed && v < lo) s.armed = true;
    }
  }
  function fireTrigger(/** @type {string} */ on) {
    const tg = packOf(current).triggers?.find(x => x.on === on); if (!tg) return;
    overlay.fire(tg.fx, track.state, renderer ? renderer.toCanvas : (/** @type {number} */ x, /** @type {number} */ y) => [x, y]);
    play(tg.sfx || ''); buzz(10);
  }
  function pause() { running = false; cancelAnimationFrame(raf); }

  /** 取景区：顶栏下沿到底部面板上沿，传给自动构图与叠加层。 */
  function layout() {
    const vr = view.getBoundingClientRect(); if (!vr.height) return;
    const tb = top.getBoundingClientRect().bottom - vr.top;
    const bt = (panel.hidden ? bottom : panel).getBoundingClientRect().top - vr.top;
    renderer?.setFraming(true, clamp(tb / vr.height), clamp(bt / vr.height));
    overlay.setInsets(clamp(tb / vr.height), clamp(1 - bt / vr.height));
  }
  new ResizeObserver(() => layout()).observe(el);

  // ── 从拍摄到创作 ──
  let shooting = false;
  async function shoot() {
    if (shooting) return;
    dismissCoach(); unlock();
    if (!camera.ready) { if (el.dataset.cam === 'ask') startCam(true); else toast(T.camAsk, { action: { label: '用照片创作', run: () => go('studio') } }); return; }
    shooting = true;
    try {
      if (!reduced) { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); }
      play('shutter'); buzz(18);
      shutter.classList.add('is-busy');
      // 发给模型的原始照片：取当前可见区域的竖幅 2:3 裁剪，前置摄像头镜像以与取景一致。
      const vw = video.videoWidth, vh = video.videoHeight, c = renderer ? renderer.crop : [0, 0, 1, 1];
      const visW = c[2] * vw, visH = c[3] * vh, cw = Math.min(visW, visH * 2 / 3), ch = cw * 3 / 2;
      const cx = (c[0] + c[2] / 2) * vw, cy = (c[1] + c[3] / 2) * vh;
      const raw = canvasOf(Math.round(cw), Math.round(ch)), rx = /** @type {CanvasRenderingContext2D} */ (raw.getContext('2d'));
      if (camera.facing === 'user') { rx.translate(raw.width, 0); rx.scale(-1, 1); }
      rx.drawImage(video, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, raw.width, raw.height);
      // 本地实拍效果（含美颜、背景与挂件）立即显示，同时开始生成艺术肖像。
      const pv = canvasOf(gl.width, gl.height);
      const px = /** @type {CanvasRenderingContext2D} */ (pv.getContext('2d'));
      px.drawImage(gl, 0, 0); px.drawImage(fxc, 0, 0);
      const presetNow = current, p = /** @type {any} */ (presetById(presetNow));
      const params = { ...defaultsOf(p), ...(pref('params.' + presetNow, {})), strength: Math.round(strength * 100) };
      const token = uid('shot');
      const work = (async () => {
        const { blob, w, h: hh } = await prepare(await blobOf(raw, 'image/jpeg', .92));
        const src = await addSource(blob, { w, h: hh });
        const w0 = await create({ source: src.id, preset: presetNow, params, format: 'portrait', mode: 'live', pace: pref('livePace', 'quick') });
        blobOf(pv, 'image/jpeg', .9).then(b => setPreview(w0.id, URL.createObjectURL(b))).catch(() => {});
        return w0.id;
      })();
      holdShot(token, pv, work);
      go('result', { id: token });
      await work;
    } catch (e) { toast('拍照失败：' + (/** @type {any} */ (e)?.message || '请重试。')); }
    finally { shooting = false; shutter.classList.remove('is-busy'); }
  }

  function showCoach() { if (!pref('coached', false)) { coach.hidden = false; setTimeout(dismissCoach, 7000); } }
  function dismissCoach() { if (!coach.hidden) { coach.hidden = true; setPref('coached', true); } }

  async function paintGalleryThumb() {
    const last = works().find(w => w.state === 'done');
    const thumb = /** @type {HTMLElement} */ (galleryBtn.querySelector('.live__galthumb'));
    const url = last ? await resultUrl(last) : '';
    thumb.style.backgroundImage = url ? `url("${url}")` : '';
    thumb.innerHTML = url ? '' : icon('gallery');
  }
  on('works', () => { if (!el.hidden) paintGalleryThumb(); });
  on('cam:start', () => startCam(true));

  renderer?.setBeauty(beauty); renderer?.setLook(lookId, pref('lookAmt', 1)); renderer?.setStrength(strength); overlay.setStrength(strength);
  void BEAUTY0;
  paintCats(); fill();
  return {
    el, keep: true,
    shown() {
      el.hidden = false;
      const want = pref('preset', current);
      if (want !== current && presetById(want)) {
        if (!inCategory(cat).some(p => p.id === want)) { cat = presetById(want)?.cat || 'hot'; paintCats(); }
        current = want; fill();
      } else requestAnimationFrame(() => scrollToIdx(dots.findIndex(d => d.dataset.style === current), false));
      applyTheme(current); applyBg();
      paintGalleryThumb(); paintTools();
      requestAnimationFrame(layout);
      startCam();
    },
    hidden() {
      pause();
      togglePanel(false); bgPop.hidden = true;
      clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => { camera.stop(); el.dataset.cam = 'off'; }, 15000);
    },
  };
}

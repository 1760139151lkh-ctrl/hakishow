/** 实时相机打开后进入竖幅取景器，并立即显示本地风格预览。顶部：作品库、分类胶囊按钮和个人中心。右侧：翻转、强度、对比和编辑，配图标与简短标签。底部：肖像风格轮播与中央快门，下方是实时相机／照片工作室切换。本地预览使用 WebGL 风格渲染和跟随人脸的贴纸；按下快门会将原始照片发往工作室进行人工智能生成。相机不可用时显示原因，并提供直接进入照片工作室的路径。 */
import { h, icon, toast, clamp, reduced, uid } from '../core/dom.js';
import { holdShot, setPreview } from '../core/shots.js';
import { go } from '../core/nav.js';
import { on } from '../core/bus.js';
import { inCategory, presetById, defaultsOf } from '../presets.js';
import { applyTheme } from '../core/theme.js';
import { pref, setPref, addSource, isFav, toggleFav, works, resultUrl } from '../core/data.js';
import { create } from '../core/generate.js';
import { prepare, canvasOf, blobOf } from '../core/image.js';
import { createCamera, cameraPermission } from '../live/camera.js';
import { createRenderer } from '../live/renderer.js';
import { createOverlay } from '../live/overlay.js';
import { loadTracker, summarise, smoothFace } from '../live/tracker.js';
import { pills, styleDot } from '../ui/parts.js';
import { warp, buzz } from '../ui/fx.js';
import { openExamples } from '../ui/examples.js';
import { T } from '../copy.js';

export function liveScreen() {
  let cat = pref('liveCat', 'hot');
  let current = pref('preset', 'princess');
  let strength = pref('liveStrength', .85);
  let splitOn = false, split = .5, running = false, raf = 0, tracker = /** @type {any} */ (null), face = /** @type {any} */ (null), lastDetect = 0, detecting = false;
  let stopTimer = 0;

  // ── 取景器 ──
  const video = /** @type {HTMLVideoElement} */ (h('video.live__video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' }));
  const gl = /** @type {HTMLCanvasElement} */ (h('canvas.live__gl', { 'aria-label': '实时取景器' }));
  const fx = /** @type {HTMLCanvasElement} */ (h('canvas.live__fx', { 'aria-hidden': 'true' }));
  const flash = h('div.live__flash', { 'aria-hidden': 'true' });
  const guide = h('div.live__guide', { 'aria-hidden': 'true' }, h('span.live__oval'), h('span.live__guidetext', null, T.faceLost));
  const splitBar = h('div.live__split', { 'aria-hidden': 'true' }, h('span.live__splitlabel.is-l', null, '原图'), h('span.live__splitlabel.is-r', null, '风格化效果'));
  const gateText = h('p.gate__text', null, T.camAsk);
  const gateBtn = h('button.btn.btn--main', { type: 'button', onclick: () => startCam(true) }, h('span', { html: icon('camera') }), T.camOn);
  const gate = h('div.gate', null,
    h('div.gate__art', { 'aria-hidden': 'true' }, h('span', { html: icon('camera') })),
    gateText, gateBtn,
    h('button.btn.btn--ghost', { type: 'button', onclick: () => go('studio') }, h('span', { html: icon('upload') }), '打开' + T.studio));
  const view = h('div.live__view', null, video, gl, fx, guide, splitBar, flash, gate);
  const camera = createCamera(video);
  const renderer = createRenderer(gl);
  const overlay = createOverlay(fx);

  // ── 标题栏 ──
  const galleryBtn = h('button.chip.chip--glass', { type: 'button', onclick: () => go('gallery'), 'aria-label': T.gallery }, h('span.chip__thumb'), h('span', null, T.gallery));
  const meBtn = h('button.avatar', { type: 'button', onclick: () => go('me'), 'aria-label': T.me }, h('span', { html: icon('user') }));
  const catPills = pills(cat, id => { cat = id; setPref('liveCat', id); fill(); }, 'pills--glass');
  let warpTimer = 0, settled = '';
  const top = h('header.live__top', null, h('div.live__row', null, galleryBtn, h('span.live__brand', null, T.brand), meBtn), catPills);

  // ── 右侧工具栏 ──
  const tool = (/** @type {any} */ ic, /** @type {string} */ label, /** @type {() => void} */ run, key = '') => h('button.tool', { type: 'button', onclick: run, 'aria-label': label, data: { tool: key } }, h('span.tool__ico', { html: icon(ic) }), h('span.tool__label', null, label));
  const strengthRange = /** @type {HTMLInputElement} */ (h('input.vrange', { type: 'range', min: '0', max: '100', value: String(Math.round(strength * 100)), 'aria-label': T.knobs.strength }));
  const strengthVal = h('b.pop__val', null, Math.round(strength * 100) + '');
  const strengthPop = h('div.pop', { hidden: true, role: 'dialog', 'aria-label': T.knobs.strength }, h('span.pop__title', null, T.knobs.strength), strengthVal, strengthRange);
  strengthRange.addEventListener('input', () => { strength = Number(strengthRange.value) / 100; strengthVal.textContent = strengthRange.value; renderer?.setStrength(strength); overlay.setStrength(strength); });
  strengthRange.addEventListener('change', () => setPref('liveStrength', strength));
  const tools = h('aside.live__tools', { 'aria-label': '工具' },
    tool('flip', T.flip, () => flipCam(), 'flip'),
    tool('bolt', T.strength, () => { strengthPop.hidden = !strengthPop.hidden; toolState(); }, 'strength'),
    tool('compare', T.compare, () => { splitOn = !splitOn; split = .5; renderer?.setSplit(splitOn ? split : -1); view.classList.toggle('is-split', splitOn); toolState(); if (splitOn) toast('左侧为原图，右侧为风格效果。拖动分隔线进行对比。'); }, 'compare'),
    tool('sliders', T.toStudio, () => go('studio'), 'studio'));
  function toolState() {
    tools.querySelector('[data-tool="strength"]')?.setAttribute('aria-pressed', String(!strengthPop.hidden));
    tools.querySelector('[data-tool="compare"]')?.setAttribute('aria-pressed', String(splitOn));
  }
  // 拖动分隔线
  view.addEventListener('pointerdown', e => {
    if (!splitOn) return;
    const r = view.getBoundingClientRect();
    const move = (/** @type {PointerEvent} */ ev) => { split = clamp((ev.clientX - r.left) / r.width, .05, .95); renderer?.setSplit(split); splitBar.style.left = split * 100 + '%'; };
    move(e); view.setPointerCapture(e.pointerId);
    const up = () => { view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); };
    view.addEventListener('pointermove', move); view.addEventListener('pointerup', up);
  });

  // ── 底栏：风格轮播与快门 ──
  const name = h('b.live__name'), hook = h('span.live__hook');
  const favBtn = h('button.live__fav', { type: 'button', onclick: async () => { const on = await toggleFav(current); syncFav(); toast(on ? '已收藏：' + presetById(current)?.name + '' : '已取消收藏'); } });
  const track = h('div.carousel__track', { role: 'listbox', 'aria-label': '风格' });
  const rail = h('div.carousel__rail');
  track.append(rail);
  const shutterImg = /** @type {HTMLImageElement} */ (h('img', { alt: '' }));
  let suppressTapUntil = 0;
  const shutter = h('button.shutter', { type: 'button', 'aria-label': T.go + '（拍照）', onclick: () => { if (Date.now() >= suppressTapUntil) shoot(); } }, h('span.shutter__ring'), h('span.shutter__face', null, shutterImg));
  const coach = h('div.coach', { hidden: true, role: 'note' }, '选择风格，然后点击这里开始创作。', h('button.coach__x', { type: 'button', 'aria-label': T.close, html: icon('close'), onclick: () => dismissCoach() }));
  const carousel = h('div.carousel', null, track, shutter, coach);
  const modes = h('nav.modes', { 'aria-label': '模式' },
    h('button.modes__opt', { type: 'button', 'aria-current': 'page' }, T.live),
    h('button.modes__opt', { type: 'button', onclick: () => go('studio') }, T.studio));
  const bottom = h('footer.live__bottom', null, h('div.live__caption', null, h('button.live__label', { type: 'button', 'aria-label': '查看示例', onclick: () => openExamples(current) }, name, hook), favBtn), carousel, modes);

  const el = h('section.screen.live', { 'aria-label': T.live }, view, top, tools, strengthPop, bottom);

  // ── 轮播 ──
  const PITCH = 70; // 56 像素圆点 + 14 像素间距
  /** @type {HTMLElement[]} */ let dots = [];
  let scrollPos = 0, targetPos = 0, lastScrollWidth = 0;
  let touching = false, snapTimer = 0, lockUntil = 0;
  const trackWidth = () => (track.clientWidth || Math.min(window.innerWidth, 450) || 390);
  function syncPad() {
    const w = trackWidth();
    carousel.style.setProperty('--carousel-pad', Math.max(0, Math.round(w / 2 - 42)) + 'px');
    return w;
  }
  function stepPx() {
    if (dots.length <= 1) return PITCH;
    const w = trackWidth();
    if (lastScrollWidth > w + 20) {
      const p = (lastScrollWidth - w) / (dots.length - 1);
      if (p > 60 && p < 80) return p;
    }
    return PITCH;
  }
  function indexAt(/** @type {number} */ left) {
    if (!dots.length) return 0;
    return Math.max(0, Math.min(dots.length - 1, Math.round(left / stepPx())));
  }
  function previewSelect(/** @type {string} */ id) {
    const p = presetById(id); if (!p) return;
    current = id;
    name.textContent = p.name; hook.textContent = p.line;
    renderer?.setPreset(id); overlay.setPreset(id);
  }
  function fill() {
    syncPad();
    const list = inCategory(cat);
    dots = list.map(p => styleDot(p.id));
    rail.replaceChildren(
      h('div.carousel__pad', { 'aria-hidden': 'true' }, '\u00a0'),
      ...dots,
      h('div.carousel__pad.carousel__pad--tail', { 'aria-hidden': 'true' }, '\u00a0')
    );
    dots.forEach((d, idx) => d.addEventListener('click', () => {
      if (Date.now() < suppressTapUntil) return;
      if (d.dataset.style === current) shoot();
      else center(d.dataset.style || '', true, idx);
    }));
    if (!list.some(p => p.id === current)) current = list[0].id;
    requestAnimationFrame(() => center(current, false));
  }
  function center(/** @type {string} */ id, /** @type {boolean} */ smooth, idxHint = -1) {
    syncPad();
    const idx = idxHint >= 0 ? idxHint : dots.findIndex(x => x.dataset.style === id);
    if (idx < 0) return;
    clearTimeout(snapTimer);
    lockUntil = Date.now() + (smooth && !reduced ? 850 : 200);
    const d = dots[idx];
    const w = syncPad();
    const left = Math.max(0, d.offsetWidth ? (d.offsetLeft + d.offsetWidth / 2 - w / 2) : Math.round(idx * stepPx()));
    scrollPos = targetPos = left;
    track.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    select(dots[idx].dataset.style || id, smooth);
  }
  function snapNearest(force = false) {
    if (touching && !force) return;
    const idx = indexAt(scrollPos);
    const d = dots[idx]; if (!d) return;
    const id = d.dataset.style || current;
    const w = trackWidth();
    const target = Math.max(0, d.offsetWidth ? (d.offsetLeft + d.offsetWidth / 2 - w / 2) : Math.round(idx * stepPx()));
    if (Math.abs(track.scrollLeft - target) > 1.5) {
      scrollPos = targetPos = target;
      lockUntil = Date.now() + 500;
      track.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' });
    }
    select(id, true);
  }
  track.addEventListener('touchstart', () => { touching = true; clearTimeout(snapTimer); lockUntil = 0; }, { passive: true });
  const finishTouch = () => {
    touching = false;
    clearTimeout(snapTimer);
    if (Date.now() > lockUntil) snapTimer = window.setTimeout(() => snapNearest(), 95);
  };
  track.addEventListener('touchend', finishTouch, { passive: true });
  track.addEventListener('touchcancel', finishTouch, { passive: true });
  track.addEventListener('scroll', () => {
    scrollPos = track.scrollLeft;
    lastScrollWidth = track.scrollWidth;
    if (Date.now() < lockUntil) {
      if (Math.abs(scrollPos - targetPos) <= 1.5) lockUntil = 0;
      return;
    }
    const id = dots[indexAt(scrollPos)]?.dataset.style;
    if (id && id !== current) previewSelect(id);
    clearTimeout(snapTimer);
    if (!touching) snapTimer = window.setTimeout(() => snapNearest(), 95);
  }, { passive: true });
  // 允许直接从中央快门按钮开始横向滑动风格。
  let shutterDrag = /** @type {{ x: number, y: number, left: number, active: boolean } | null} */ (null);
  shutter.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
    shutterDrag = { x: e.clientX, y: e.clientY, left: scrollPos, active: false };
  });
  shutter.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
    if (!shutterDrag) return;
    const dx = e.clientX - shutterDrag.x, dy = e.clientY - shutterDrag.y;
    if (!shutterDrag.active) {
      if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) return;
      shutterDrag.active = true;
      touching = true;
      clearTimeout(snapTimer);
      lockUntil = 0;
      suppressTapUntil = Date.now() + 500;
    }
    const maxL = Math.max(0, (dots.length - 1) * stepPx());
    const nextL = clamp(shutterDrag.left - dx, 0, maxL);
    scrollPos = nextL;
    track.scrollTo({ left: nextL, behavior: 'auto' });
    const id = dots[indexAt(nextL)]?.dataset.style;
    if (id && id !== current) previewSelect(id);
  });
  const endShutterDrag = () => {
    if (!shutterDrag) return;
    const active = shutterDrag.active;
    shutterDrag = null;
    if (active) {
      touching = false;
      suppressTapUntil = Date.now() + 260;
      snapNearest(true);
    }
  };
  shutter.addEventListener('pointerup', endShutterDrag);
  shutter.addEventListener('pointercancel', endShutterDrag);
  function select(/** @type {string} */ id, withWarp = true) {
    const p = presetById(id); if (!p) return;
    current = id; setPref('preset', id);
    // 停留在一个风格后，从快门位置展开其标题卡片，不打断滑动。
    clearTimeout(warpTimer);
    if (withWarp) {
      warpTimer = window.setTimeout(() => { if (current === id && settled && settled !== id && !el.hidden) { warp(view, id); buzz(8); } settled = id; }, 240);
    } else {
      settled = id;
    }
    dots.forEach(d => d.setAttribute('aria-selected', String(d.dataset.style === id)));
    name.textContent = p.name; hook.textContent = p.line;
    shutterImg.src = /** @type {HTMLImageElement} */ (dots.find(d => d.dataset.style === id)?.querySelector('img'))?.src || '';
    renderer?.setPreset(id); overlay.setPreset(id);
    applyTheme(id);
    syncFav();
  }
  function syncFav() { const f = isFav(current); favBtn.innerHTML = icon(f ? 'heartFill' : 'heart'); favBtn.setAttribute('aria-label', f ? '取消收藏' : T.fav); favBtn.setAttribute('aria-pressed', String(f)); }

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
      el.dataset.cam = 'on';
      gate.hidden = true;
      gateBtn.hidden = false;
      gateText.textContent = '';
      renderer?.setMirror(camera.facing === 'user');
      loop();
      warmTracker();
      showCoach();
    } catch (e) { gateFor(/** @type {any} */ (e).reason || 'busy'); }
  }
  /** @param {'ask' | 'denied' | 'none' | 'busy'} why */
  function gateFor(why) {
    el.dataset.cam = why;
    gate.hidden = false;
    gateText.textContent = why === 'ask' ? T.camAsk : why === 'denied' ? T.camDenied : why === 'none' ? T.camNone : '相机正被其他应用使用，请关闭该应用后重试。';
    gateBtn.hidden = why === 'denied' || why === 'none';
    if (why === 'denied' || why === 'none') toast(why === 'denied' ? T.camDenied : T.camNone, { ms: 4200, action: { label: '打开' + T.studio, run: () => go('studio') } });
  }
  async function flipCam() {
    try { await camera.flip(); renderer?.setMirror(camera.facing === 'user'); face = null; }
    catch { toast('此设备没有其他可用相机。'); }
  }
  async function warmTracker() {
    if (tracker) return;
    try { tracker = await loadTracker('VIDEO'); } catch { tracker = null; }
  }

  // ── 渲染循环 ──
  function loop() {
    if (running) return;
    running = true;
    // 适配较慢的设备：降低检测频率和渲染分辨率，保持交互响应。
    let detectCost = 0, every = 30, drawCost = 0, scale = 1, frames = 0;
    const frame = (/** @type {number} */ t) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (!camera.ready) return;
      if (++frames % 30 === 0) scale = drawCost > 22 ? Math.max(.5, scale * .85) : drawCost < 8 && scale < 1 ? Math.min(1, scale / .85) : scale;
      const r = gl.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.75) * scale;
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      renderer?.resize(W, H); overlay.resize(W, H);
      // 人脸：每秒最多读取约 30 次，绝不同时运行两次
      if (tracker && !detecting && t - lastDetect > every) {
        // 延后检测，让渲染与用户输入优先执行。
        detecting = true; lastDetect = t;
        setTimeout(async () => {
          if (!running || !camera.ready) { detecting = false; return; }
          const s0 = performance.now();
          try {
            const lm = tracker.detectForVideo(video, s0)?.faceLandmarks?.[0];
            const found = lm?.length ? summarise(lm, video.videoWidth / video.videoHeight) : null;
            if (!running || !camera.ready) return;
            face = found ? smoothFace(face, found) : (face && s0 - face.seen < 300 ? face : null);
          } catch { /* 丢失的一帧 */ }
          finally {
            detecting = false;
            detectCost = detectCost * .8 + (performance.now() - s0) * .2;
            every = Math.max(30, Math.min(300, detectCost * 3));
          }
        }, 0);
      }
      const d0 = performance.now();
      const f = face && toCanvas(face, W, H);
      renderer?.setFace(f ? { cx: f.center.x / W, cy: 1 - f.center.y / H, r: f.height / H, el: [f.eyeL.x / W, 1 - f.eyeL.y / H], er: [f.eyeR.x / W, 1 - f.eyeR.y / H] } : null);
      renderer?.draw(video, video.videoWidth, video.videoHeight, t);
      overlay.draw(f, t);
      drawCost = drawCost * .9 + (performance.now() - d0) * .1;
      el.classList.toggle('has-face', !!f);
    };
    raf = requestAnimationFrame(frame);
  }
  /** 将归一化原图坐标转换为画布像素，包括覆盖裁剪和镜像处理。 */
  function toCanvas(/** @type {any} */ fc, /** @type {number} */ W, /** @type {number} */ H) {
    const crop = renderer ? renderer.crop : [0, 0, 1, 1], mir = renderer ? renderer.mirror : true;
    const pt = (/** @type {{ x: number, y: number }} */ p) => ({ x: ((mir ? 1 - p.x : p.x) - crop[0]) / crop[2] * W, y: (p.y - crop[1]) / crop[3] * H });
    const eL = pt(fc.eyeL), eR = pt(fc.eyeR);
    const [a, b] = eL.x <= eR.x ? [eL, eR] : [eR, eL];
    const top = pt(fc.top), chin = pt(fc.chin);
    return { center: pt(fc.center), eyeL: a, eyeR: b, nose: pt(fc.nose), top, chin, roll: Math.atan2(b.y - a.y, b.x - a.x),
      width: Math.hypot(pt(fc.cheekR).x - pt(fc.cheekL).x, pt(fc.cheekR).y - pt(fc.cheekL).y), height: Math.hypot(chin.x - top.x, chin.y - top.y) };
  }
  function pause() { running = false; cancelAnimationFrame(raf); }

  // ── 从拍摄到创作 ──
  let shooting = false;
  async function shoot() {
    if (shooting) return;
    dismissCoach();
    if (!camera.ready) { if (el.dataset.cam === 'ask') startCam(true); else toast(T.camAsk, { action: { label: '打开' + T.studio, run: () => go('studio') } }); return; }
    shooting = true;
    try {
      if (!reduced) { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); }
      buzz(18);
      shutter.classList.add('is-busy');
      // 为模型拍摄干净的竖幅裁剪图，并镜像前置摄像头图像，使其与取景器一致。
      const vw = video.videoWidth, vh = video.videoHeight, aspect = 2 / 3;
      const cw = Math.min(vw, vh * aspect), ch = cw / aspect;
      const raw = canvasOf(Math.round(cw), Math.round(ch)), rx = /** @type {CanvasRenderingContext2D} */ (raw.getContext('2d'));
      if (camera.facing === 'user') { rx.translate(raw.width, 0); rx.scale(-1, 1); }
      rx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, raw.width, raw.height);
      // 立即显示包含贴纸的拍摄本地预览，同时准备工作室生成结果。
      const pv = canvasOf(gl.width, gl.height);
      const px = /** @type {CanvasRenderingContext2D} */ (pv.getContext('2d'));
      px.drawImage(gl, 0, 0); px.drawImage(fx, 0, 0);
      const presetNow = current, p = /** @type {any} */ (presetById(presetNow));
      const params = { ...defaultsOf(p), ...(pref('params.' + presetNow, {})), strength: Math.round(strength * 100) };
      const token = uid('shot');
      const work = (async () => {
        const { blob, w, h: hh } = await prepare(await blobOf(raw, 'image/jpeg', .92));
        const src = await addSource(blob, { w, h: hh });
        const w0 = await create({ source: src.id, preset: presetNow, params, format: 'portrait', mode: 'live', pace: pref('livePace', 'quick') });
        blobOf(pv, 'image/jpeg', .8).then(b => setPreview(w0.id, URL.createObjectURL(b))).catch(() => {});
        return w0.id;
      })();
      holdShot(token, pv, work);
      go('result', { id: token });
      await work;
    } catch (e) { toast('拍照失败：' + (/** @type {any} */ (e)?.message || '请重试。')); }
    finally { shooting = false; shutter.classList.remove('is-busy'); }
  }

  // ── 首次访问时指向快门的引导提示 ──
  function showCoach() { if (!pref('coached', false)) { coach.hidden = false; setTimeout(dismissCoach, 7000); } }
  function dismissCoach() { if (!coach.hidden) { coach.hidden = true; setPref('coached', true); } }

  async function paintGalleryThumb() {
    const last = works().find(w => w.state === 'done');
    const thumb = /** @type {HTMLElement} */ (galleryBtn.querySelector('.chip__thumb'));
    const url = last ? await resultUrl(last) : '';
    thumb.style.backgroundImage = url ? `url("${url}")` : '';
    thumb.innerHTML = url ? '' : icon('gallery');
  }
  on('works', () => { if (!el.hidden) paintGalleryThumb(); });
  on('cam:start', () => startCam(true));

  fill();
  return {
    el, keep: true,
    shown() {
      el.hidden = false;
      syncPad();
      // 从“试试这个风格”或其他页面进入时，将选中风格居中。
      const want = pref('preset', current);
      if (want !== current && presetById(want)) {
        if (!inCategory(cat).some(p => p.id === want)) { cat = presetById(want)?.cat || 'hot'; catPills.set(cat); fill(); }
        current = want;
      }
      requestAnimationFrame(() => center(current, false));
      settled = settled || current;
      applyTheme(current);
      syncFav(); paintGalleryThumb(); toolState();
      startCam();
    },
    hidden() {
      pause();
      strengthPop.hidden = true;
      // 短暂离开后停止相机以节省电量，同时保持快速返回的就绪状态。
      clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => { camera.stop(); el.dataset.cam = 'off'; }, 15000);
    },
  };
}

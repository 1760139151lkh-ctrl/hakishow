/** 局部编辑修改当前显示版本或原图中的选定部位，保留编辑蒙版以外的像素。点击脸部或区域胶囊按钮选择区域；检测在设备本地运行。选择选项或色块，调整长度、浓度或妆效，也可补充文字细节。立即预览发色、嘴唇和腮红；形状变化用虚线区域轮廓表示。可在面部区域以外任意涂抹，并描述替换内容。参考图片中的发型和妆容，同时保留原人物。每个区域使用独立蒙版，一次应用所有选中区域，创建可撤销的新版本。结合区域蒙版、本地试妆预览、手绘选区和外观参考。 */
import { h, icon, toast, chooseFile, themeAccent } from '../core/dom.js';
import { PARTS, partById, optionOf, labelOf, togglePick, regionText, noteOf } from '../parts.js';
import { canvasFrom, faceOf, maskOf, partAt, outline, shapesOf, regionOf } from '../core/face.js';
import { prepare, canvasOf } from '../core/image.js';
import { paintTint } from './tint.js';
import { createBrush, coverMap } from './brush.js';
import { etaText } from '../ui/parts.js';
import { T } from '../copy.js';

const toBlob = (/** @type {HTMLCanvasElement} */ c) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('蒙版导出失败。'))), 'image/png'));

export function partsPanel(/** @type {any} */ ctx) {
  let active = '', open = false, raf = 0, paintWords = '', scrolledTo = '';
  /** 为当前显示图片缓存的人脸分析结果。 @type {{ key: string, canvas: HTMLCanvasElement, face: any, masks: Map<string, HTMLCanvasElement | null> } | null} */
  let read = null;
  let reading = /** @type {Promise<void> | null} */ (null);
  /** @type {{ blob: Blob, url: string } | null} */ let ref = null;
  const brush = createBrush(ctx.brushC, { onChange: () => paintFoot() });

  // ── 界面 ──
  const hint = h('p.pp__hint', { 'aria-live': 'polite' });
  const pills = h('div.pp__parts', { role: 'tablist', 'aria-label': '区域' });
  const opts = h('div.pp__opts');
  const extra = h('div.pp__extra');
  const picked = h('div.pp__picked', { 'aria-label': '已选区域' });
  const refRow = h('div.pp__ref');
  const body = h('div.tp.tp--pad.pp', null, hint, pills, opts, extra, picked, refRow);
  const cta = ctx.cta('应用编辑', '', () => apply(), 'wand');
  const foot = h('div.pp__foot', null, cta);

  const map = () => {
    const img = ctx.shownImage(), r = ctx.frameBox.getBoundingClientRect();
    return coverMap(r.width, r.height, img.naturalWidth || 1, img.naturalHeight || 1);
  };

  // ── 人脸分析，每张图片缓存一次 ──
  function readImage() {
    const img = ctx.shownImage(), key = img.currentSrc || img.src || '';
    if (!key || !img.naturalWidth) { read = null; return Promise.resolve(); }
    if (read?.key === key) return Promise.resolve();
    if (reading && /** @type {any} */ (reading).key === key) return reading;
    hint.textContent = '正在设备本地查找人脸……';
    const job = (async () => {
      let canvas;
      try {
        canvas = canvasFrom(img, 768);
      } catch {
        if ((img.currentSrc || img.src) === key && open) paintHint();
        return;
      }
      const face = await faceOf(canvas);
      if ((img.currentSrc || img.src) !== key) return;
      read = { key, canvas, face, masks: new Map() };
      if (open) { paintHint(); paintOverlay(); await warmMasks(); paintOverlay(); }
    })();
    reading = Object.assign(job, { key });
    job.then(() => { if (reading === job) { reading = null; if (open) paintHint(); } },
      () => { if (reading === job) { reading = null; if (open) paintHint(); } });
    return job;
  }
  async function maskFor(/** @type {string} */ part) {
    if (!read?.face) return null;
    if (!read.masks.has(part)) read.masks.set(part, await maskOf(read.canvas, read.face, part).catch(() => null));
    return read.masks.get(part) || null;
  }
  async function warmMasks() { for (const k of ctx.S.picks) await maskFor(k.part); }

  // ── 画布叠加层：区域虚线轮廓、选择标签与实时着色预览 ──
  function fitCanvas(/** @type {HTMLCanvasElement} */ c) {
    const r = ctx.frameBox.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    return dpr;
  }
  function paintOverlay() {
    const mk = /** @type {CanvasRenderingContext2D} */ (ctx.markC.getContext('2d'));
    if (!open) { mk.clearRect(0, 0, ctx.markC.width, ctx.markC.height); ctx.tintC.hidden = true; return; }
    const dpr = fitCanvas(ctx.markC); fitCanvas(ctx.tintC);
    mk.clearRect(0, 0, ctx.markC.width, ctx.markC.height);
    // 即时颜色预览。
    const img = ctx.shownImage();
    const m = map();
    const shown = read?.face ? paintTintFit(img, m, dpr) : false;
    ctx.tintC.hidden = !shown;
    if (!read?.face || active === 'paint') return;
    const kx = (m.s * dpr) * (img.naturalWidth / read.canvas.width);
    mk.save(); mk.translate(m.ox * dpr, m.oy * dpr);
    const t = performance.now();
    const parts = new Set([...(active ? [active] : []), ...ctx.S.picks.map((/** @type {any} */ k) => k.part)]);
    for (const part of parts) {
      if (regionOf(part) === 'hair') { hairGlow(mk, part, kx, part === active); continue; }
      outline(mk, read.face, part, kx, kx, part === active ? t : 0);
    }
    // 用小标签标明所选选项。
    mk.font = `700 ${12 * dpr}px system-ui, sans-serif`; mk.textAlign = 'center'; mk.textBaseline = 'middle';
    const shapes = shapesOf(read.face);
    for (const k of ctx.S.picks) {
      const kind = regionOf(k.part), sh = kind === 'hair' ? shapes.bangs : shapes[kind];
      if (!sh?.length) continue;
      const pts = sh.flat(); let cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = Math.min(...pts.map(p => p.y));
      if (kind === 'hair') cy -= read.face.box[3] * .25;
      const text = optionOf(k)?.label || '';
      const x = cx * kx, y = cy * kx - 14 * dpr, w = mk.measureText(text).width + 16 * dpr;
      mk.fillStyle = 'rgba(20,14,28,.78)'; mk.beginPath();
      if (mk.roundRect) mk.roundRect(x - w / 2, y - 11 * dpr, w, 22 * dpr, 11 * dpr);
      else mk.rect(x - w / 2, y - 11 * dpr, w, 22 * dpr);
      mk.fill();
      mk.fillStyle = '#fff'; mk.fillText(text, x, y + 1);
    }
    mk.restore();
  }
  /** 头发区域使用淡淡的蒙版高亮，而不是硬轮廓。 */
  function hairGlow(/** @type {CanvasRenderingContext2D} */ mk, /** @type {string} */ part, /** @type {number} */ kx, /** @type {boolean} */ on) {
    // 已选染色本身已能标识区域；省略强调色叠加层，以保留其颜色。
    if (ctx.S.picks.some((/** @type {any} */ k) => k.part === part && partById(part)?.kind === 'swatch')) return;
    const m = read?.masks.get(part);
    if (!m) { if (!read?.masks.has(part)) maskFor(part).then(() => open && paintOverlay()); return; }
    mk.save(); mk.globalAlpha = on ? .3 : .16;
    const tint = canvasOf(m.width, m.height);
    const tx = /** @type {CanvasRenderingContext2D} */ (tint.getContext('2d'));
    tx.drawImage(m, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = themeAccent(ctx.frame); tx.fillRect(0, 0, m.width, m.height);
    mk.drawImage(tint, 0, 0, m.width * kx * (read?.canvas.width || 1) / m.width, m.height * kx * (read?.canvas.height || 1) / m.height);
    mk.restore();
  }
  /** 缓存开销较大的逐像素着色，直到图片、选项或蒙版发生变化；动画帧只合成缓存结果。 */
  let tinted = /** @type {{ key: string, read: any, canvas: HTMLCanvasElement, ok: boolean } | null} */ (null);
  /** 使用与原图一致的摆放方式定位着色预览。 */
  function paintTintFit(/** @type {HTMLImageElement} */ img, /** @type {any} */ m, /** @type {number} */ dpr) {
    const masks = /** @type {Map<string, HTMLCanvasElement | null>} */ (read?.masks || new Map());
    const key = [img.currentSrc || img.src, img.naturalWidth, JSON.stringify(ctx.S.picks), [...masks].map(([k, v]) => k + (v ? '+' : '-')).join(',')].join('|');
    if (!tinted || tinted.key !== key || tinted.read !== read) {
      const full = canvasOf(read?.canvas.width || 1, read?.canvas.height || 1);
      tinted = { key, read, canvas: full, ok: paintTint(full, img, ctx.S.picks, masks) };
    }
    const tx = /** @type {CanvasRenderingContext2D} */ (ctx.tintC.getContext('2d'));
    tx.clearRect(0, 0, ctx.tintC.width, ctx.tintC.height);
    if (!tinted.ok) return false;
    tx.drawImage(tinted.canvas, m.ox * dpr, m.oy * dpr, img.naturalWidth * m.s * dpr, img.naturalHeight * m.s * dpr);
    return true;
  }
  function loop() {
    cancelAnimationFrame(raf);
    const step = () => { if (!open) return; paintOverlay(); raf = requestAnimationFrame(step); };
    // 只有形状轮廓需要动画以移动虚线；其他预览绘制一次即可。
    if (active && active !== 'paint' && regionOf(active) !== 'hair') raf = requestAnimationFrame(step); else paintOverlay();
  }

  // ── 点击图片选择区域 ──
  function onTap(/** @type {MouseEvent} */ e) {
    if (!open || active === 'paint') return;
    if (!read?.face) { if (!reading) toast('未找到清晰的人脸，请用画笔涂抹要编辑的区域。', { action: { label: '画笔', run: () => setActive('paint') } }); return; }
    const r = ctx.frameBox.getBoundingClientRect(), m = map(), img = ctx.shownImage();
    const k = read.canvas.width / img.naturalWidth;
    const x = (e.clientX - r.left - m.ox) / m.s * k, y = (e.clientY - r.top - m.oy) / m.s * k;
    const part = partAt(read.face, x, y);
    if (part) { setActive(part); toast('已选择' + partById(part)?.label + '。请在下方选择造型。'); }
    else toast('此处超出面部区域，请用画笔选择。', { action: { label: '画笔', run: () => setActive('paint') } });
  }

  // ── 面板内容 ──
  function setActive(/** @type {string} */ id) {
    active = active === id && id !== 'paint' ? '' : id;
    brush.enable(active === 'paint');
    ctx.frame.dataset.mode = active === 'paint' ? 'paint' : 'parts';
    paint(); loop();
    if (active && active !== 'paint') maskFor(active).then(() => open && paintOverlay());
  }
  function paintHint() {
    if (active === 'paint') hint.textContent = '涂抹要编辑的区域，再描述想做的更改。';
    else if (!read && reading) hint.textContent = '正在设备本地查找人脸……';
    else if (read && !read.face) hint.textContent = '此风格中未找到清晰人脸，请用画笔标记要编辑的区域。';
    else if (!active) hint.textContent = ctx.S.picks.length ? '你可以继续添加区域，然后在下方应用编辑。' : '点击脸部，或在下方选择区域。';
    else hint.textContent = partById(active)?.hint || '';
  }
  function paint() {
    paintHint();
    const picks = ctx.S.picks;
    pills.replaceChildren(...PARTS.map(p => h('button.pp__part', { type: 'button', role: 'tab', 'aria-selected': String(active === p.id), data: { has: String(picks.some((/** @type {any} */ k) => k.part === p.id)) }, onclick: () => setActive(p.id) }, p.label)),
      h('button.pp__part.pp__part--paint', { type: 'button', role: 'tab', 'aria-selected': String(active === 'paint'), onclick: () => setActive('paint') }, h('span', { html: icon('brush') }), '画笔'));
    if (scrolledTo !== active) { scrolledTo = active; requestAnimationFrame(() => pills.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })); }
    opts.replaceChildren(); extra.replaceChildren();
    if (active === 'paint') paintBrushTools();
    else if (active) {
      const p = /** @type {import('../parts.js').Part} */ (partById(active)), mine = picks.find((/** @type {any} */ k) => k.part === active);
      opts.append(h('div.pp__optrow' + (p.kind === 'swatch' ? '.is-swatch' : ''), { role: 'group', 'aria-label': p.label },
        ...p.options.map(o => h('button.pp__opt', { type: 'button', 'aria-pressed': String(mine?.option === o.id), onclick: () => choose(o.id) },
          o.hex ? h('i.pp__sw', { style: { background: o.hex } }) : null, h('span', null, o.label)))));
      if (p.tune) {
        const now = mine?.tune ?? p.tune.start;
        extra.append(h('div.opt.opt--tight', null, h('span.opt__name', null, p.tune.label),
          h('div.seg.seg--sm', { role: 'radiogroup', 'aria-label': p.tune.label }, ...p.tune.steps.map((s, i) => h('button.seg__opt', { type: 'button', role: 'radio', 'aria-checked': String(i === now), disabled: !mine, onclick: () => tuneTo(i) }, s.label)))));
      }
      if (mine) {
        const say = /** @type {HTMLInputElement} */ (h('input.pp__say', { type: 'text', maxlength: 80, placeholder: '可选细节，例如：效果更自然一些', 'aria-label': '补充细节', enterkeyhint: 'done', value: mine.say || '' }));
        say.addEventListener('change', () => { const v = say.value.trim(); if (v !== (mine.say || '')) ctx.setPicks(picks.map((/** @type {any} */ k) => (k.part === active ? { ...k, say: v } : k)), labelOf(mine) + ' · 已补充细节'); });
        say.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); say.blur(); } });
        extra.append(say);
      }
    }
    picked.replaceChildren(...(picks.length ? [h('span.pp__pickedname', null, '已选择')] : []), ...picks.map((/** @type {any} */ k) => h('button.pp__tok', { type: 'button', 'aria-label': '移除' + labelOf(k), onclick: () => { ctx.setPicks(picks.filter((/** @type {any} */ x) => x.part !== k.part), '已移除' + labelOf(k) + ''); paint(); loop(); } },
      h('span', null, labelOf(k)), h('span', { html: icon('close') }))));
    refRow.replaceChildren(ref
      ? h('div.pp__refon', null, h('img', { src: ref.url, alt: '参考图片' }), h('span', null, '参考这张图的发型和妆容，同时保留你自己的脸。'), h('button.ibtn', { type: 'button', 'aria-label': '移除参考图', html: icon('close'), onclick: () => { URL.revokeObjectURL(ref?.url || ''); ref = null; paint(); } }))
      : h('button.pp__refadd', { type: 'button', onclick: () => addRef() }, h('span', { html: icon('image') }), '添加参考图（选填）'));
    paintFoot();
  }
  function paintBrushTools() {
    const sizes = [['小', .035], ['中等', .06], ['大', .1]];
    const say = /** @type {HTMLInputElement} */ (h('input.pp__say', { type: 'text', maxlength: 120, placeholder: '描述选中区域，例如：替换成玫瑰', 'aria-label': '描述选中区域', enterkeyhint: 'done', value: paintWords }));
    say.addEventListener('input', () => { paintWords = say.value; paintFoot(); });
    say.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); say.blur(); } });
    opts.append(h('div.pp__brush', null,
      h('div.seg.seg--sm', { role: 'radiogroup', 'aria-label': '画笔大小' }, ...sizes.map(([label, v]) => h('button.seg__opt', { type: 'button', role: 'radio', 'aria-checked': String(Math.abs(/** @type {number} */ (v) - (/** @type {any} */ (brush)).size) < .001 || (label === '中等' && !(/** @type {any} */ (brush)).size)), onclick: (/** @type {Event} */ e) => { brush.setSize(/** @type {number} */ (v)); (/** @type {any} */ (brush)).size = v; /** @type {HTMLElement} */ (e.currentTarget).parentElement?.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); } }, label))),
      h('button.pp__tool', { type: 'button', 'aria-pressed': String(brush.erase), onclick: (/** @type {Event} */ e) => { brush.setErase(!brush.erase); /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-pressed', String(brush.erase)); } }, h('span', { html: icon('eraser') }), '擦除'),
      h('button.pp__tool', { type: 'button', onclick: () => brush.undo() }, h('span', { html: icon('undo') }), '撤销笔画'),
      h('button.pp__tool', { type: 'button', onclick: () => brush.clear() }, h('span', { html: icon('trash') }), '清空')));
    extra.append(say);
  }
  function choose(/** @type {string} */ option) {
    const k = { part: active, option };
    const had = ctx.S.picks.find((/** @type {any} */ x) => x.part === active && x.option === option);
    const next = togglePick(ctx.S.picks, k);
    const now = next.find(x => x.part === active);
    ctx.setPicks(next, had ? '已移除' + labelOf(had) + '' : labelOf(/** @type {any} */ (now)));
    maskFor(active).then(() => { paint(); loop(); });
  }
  function tuneTo(/** @type {number} */ i) {
    const picks = ctx.S.picks.map((/** @type {any} */ k) => (k.part === active ? { ...k, tune: i } : k));
    const now = picks.find((/** @type {any} */ k) => k.part === active);
    ctx.setPicks(picks, labelOf(now));
    paint(); loop();
  }
  async function addRef() {
    const f = await chooseFile(); if (!f) return;
    try { const { blob } = await prepare(f, 1024); ref = { blob, url: URL.createObjectURL(blob) }; paint(); toast('参考图已添加，其发型和妆容将为编辑提供参考。'); }
    catch { toast('无法打开这张图片，请换一张照片。'); }
  }
  function paintFoot() {
    const picks = ctx.S.picks, w = ctx.shownWork(), busy = !!w && w.state === 'working';
    const label = /** @type {HTMLElement} */ (cta.querySelector('.cta__label')), sub = /** @type {HTMLElement} */ (cta.querySelector('.cta__sub'));
    if (active === 'paint') {
      cta.toggleAttribute('disabled', brush.empty);
      label.textContent = brush.empty ? '请先涂抹一个区域' : '编辑此区域';
      sub.textContent = (paintWords.trim() ? '' + paintWords.trim().slice(0, 14) + '」 · ' : '') + etaText();
    } else {
      cta.toggleAttribute('disabled', !picks.length);
      label.textContent = picks.length ? `编辑 ${picks.length} ${picks.length === 1 ? '区域' : '区域'}` : '请先选择区域';
      sub.textContent = picks.length ? '其余部分保持不变 · ' + etaText() : (w ? '编辑当前版本' : '编辑原始照片');
    }
    if (busy) sub.textContent = '图片仍在创作中，你可以先规划下一次编辑。';
  }

  // ── 创建编辑后的版本 ──
  async function apply() {
    const w = ctx.shownWork(), styled = !!w && w.state === 'done';
    const img = ctx.shownImage();
    if (active === 'paint') {
      if (brush.empty) return;
      const blob = await brush.mask(img.naturalWidth, img.naturalHeight, map());
      const words = paintWords.trim();
      const text = [
        '只修改涂抹区域' + (words ? ': ' + words : '，使其更好地融入画面') + '.',
        '区域外的一切必须完全保持原样：同一个人、同一张脸、姿势、服装、光线和背景。',
        styled ? "精确匹配图片现有的艺术风格、色板和照明，让改动看起来像原本就绘制在画中。" : '保持自然、照片写实的效果。',
      ].join(' ');
      cta.setAttribute('disabled', '');
      const made = await ctx.ask({ op: 'region', pins: [{ note: words || '改善这个区域', mask: blob }], text, parts: ['画笔' + (words ? ': ' + words : '')], label: '画笔编辑' + (words ? ': ' + words : ''), ...(ref ? { refs: [{ blob: ref.blob, role: 'look', label: '参考图片' }] } : {}) });
      if (made) { brush.clear(); paintWords = ''; paint(); }
      return;
    }
    const picks = ctx.S.picks;
    if (!picks.length) return;
    await readImage();
    if (!read?.face) { toast('未找到适合局部编辑的清晰人脸，请改用画笔选择区域。', { action: { label: '画笔', run: () => setActive('paint') } }); return; }
    cta.setAttribute('disabled', '');
    const pins = [];
    const applied = [];
    for (const k of picks) {
      const m = await maskFor(k.part);
      if (!m) { toast('' + partById(k.part)?.label + '未能检测到，因此已跳过。'); continue; }
      pins.push({ note: noteOf(k), mask: await toBlob(m) });
      applied.push(k);
    }
    if (!pins.length) { paintFoot(); return; }
    const labels = applied.map(k => labelOf(k));
    const text = regionText(applied, { styled }) + (ref ? '从参考图片中提取这些部位的造型（剪裁、颜色、妆容），绝不采用参考图的人脸或人物身份。' : '');
    await ctx.ask({ op: 'region', pins, text, parts: labels, label: '局部编辑：' + labels.join(', '), ...(ref ? { refs: [{ blob: ref.blob, role: 'look', label: '参考图片' }] } : {}) });
    active = ''; paint(); loop();
  }

  return {
    body, foot,
    shown() {
      open = true;
      ctx.frame.dataset.mode = active === 'paint' ? 'paint' : 'parts';
      ctx.frameBox.addEventListener('click', onTap);
      brush.enable(active === 'paint');
      paint();
      readImage().then(() => { paint(); loop(); });
      loop();
    },
    hidden() {
      open = false; cancelAnimationFrame(raf);
      delete ctx.frame.dataset.mode;
      ctx.frameBox.removeEventListener('click', onTap);
      brush.enable(false);
      paintOverlay();
    },
    repaint() { if (!open) return; paint(); readImage().then(() => { paint(); loop(); }); },
    paintCta() { if (open) paintFoot(); },
    fit() { brush.fit(); },
    overlay() { if (open) paintOverlay(); },
  };
}

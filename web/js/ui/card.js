/** 分享卡片：1080×1920 竖幅海报，包含作品、原始照片嵌图、风格名称、标语和品牌。以适合 TikTok 等社交应用的竖屏格式保存或分享卡片。 */
import { h, icon, toast } from '../core/dom.js';
import { presetById } from '../presets.js';
import { resultUrl, sourceUrl, source as sourceById, work as workById } from '../core/data.js';
import { opLabel, saveImage, shareTikTok } from './parts.js';
import { sheet } from './sheet.js';
import { T } from '../copy.js';

const load = (/** @type {string} */ src) => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('图片加载失败。')); im.src = src; });
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** 渲染分享卡片。 @param {import('../core/data.js').Work} w @returns {Promise<Blob>} */
export async function makeCard(w) {
  const p = /** @type {any} */ (presetById(w.preset)), t = p?.theme || { bg: '#0d0a1a', bg2: '#2a1048', accent: '#ff3d8b', accent2: '#2fe0ff', ink: '#fff', soft: '#ccc' };
  const base = w.base ? workById(w.base) : null;
  const [art, before] = await Promise.all([
    load(await resultUrl(w)),
    (base ? resultUrl(base) : sourceUrl(sourceById(w.source))).then(u => (u ? load(u) : null)).catch(() => null),
  ]);
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  /** 适配完整英语标题，避免截断单词。 */
  const textFit = (/** @type {string} */ text, /** @type {number} */ size, /** @type {number} */ weight, /** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ maxWidth) => {
    x.font = `${weight} ${size}px ${FONT}`;
    while (size > 22 && x.measureText(text).width > maxWidth) { size -= 1; x.font = `${weight} ${size}px ${FONT}`; }
    x.fillText(text, px, py, maxWidth);
  };
  // 使用风格中的两种颜色生成背景渐变。
  const g = x.createLinearGradient(0, 0, W * .4, H); g.addColorStop(0, t.bg2); g.addColorStop(1, t.bg);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 760, 80, W / 2, 760, 900); glow.addColorStop(0, t.accent + '55'); glow.addColorStop(1, 'transparent');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  // 将作品等比例放入宽 936 像素的圆角框内。
  const im = /** @type {HTMLImageElement} */ (art);
  const boxW = 936, boxH = 1180, k = Math.min(boxW / im.width, boxH / im.height), aw = im.width * k, ah = im.height * k;
  const ax = (W - aw) / 2, ay = 170 + (boxH - ah) / 2;
  x.save(); x.shadowColor = t.accent + 'aa'; x.shadowBlur = 80; x.fillStyle = t.accent; x.beginPath(); x.roundRect(ax, ay, aw, ah, 44); x.fill(); x.restore();
  x.save(); x.beginPath(); x.roundRect(ax, ay, aw, ah, 44); x.clip(); x.drawImage(im, ax, ay, aw, ah); x.restore();
  x.lineWidth = 6; x.strokeStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.roundRect(ax, ay, aw, ah, 44); x.stroke();
  // 原始照片嵌图。
  if (before) {
    const b = /** @type {HTMLImageElement} */ (before), s = 250, bx = ax + 28, by = ay + ah - s * 1.25 + 60;
    const kb = Math.max(s / b.width, s * 1.25 / b.height);
    x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 30; x.fillStyle = '#fff'; x.beginPath(); x.roundRect(bx - 8, by - 8, s + 16, s * 1.25 + 16, 30); x.fill(); x.restore();
    x.save(); x.beginPath(); x.roundRect(bx, by, s, s * 1.25, 24); x.clip(); x.drawImage(b, bx + (s - b.width * kb) / 2, by + (s * 1.25 - b.height * kb) / 2, b.width * kb, b.height * kb); x.restore();
    x.fillStyle = 'rgba(0,0,0,.6)'; x.beginPath(); x.roundRect(bx + 14, by + 14, 132, 46, 23); x.fill();
    x.fillStyle = '#fff'; x.font = `700 28px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('原图', bx + 80, by + 38);
  }
  // 标题。
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = t.accent; x.font = `800 40px ${FONT}`; x.fillText(w.op && w.op !== 'restyle' ? opLabel(w) : '风格化效果', 72, 112);
  const name = p?.name || 'HakiShow';
  x.fillStyle = t.ink; textFit(name, 96, 900, 72, 1500, W - 144);
  x.fillStyle = t.soft || t.ink; textFit(String(p?.line || T.slogan), 40, 500, 72, 1572, W - 144);
  // 品牌底栏。
  x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(72, 1660, W - 144, 2);
  x.fillStyle = t.ink; x.font = `900 54px ${FONT}`; x.fillText(T.brand, 72, 1760);
  x.fillStyle = t.soft || t.ink; x.font = `500 34px ${FONT}`; x.fillText(T.slogan, 72, 1816);
  x.textAlign = 'right'; x.fillStyle = t.accent2 || t.accent; textFit('#HakiShow #艺术肖像', 30, 700, W - 72, 1760, 540);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('分享卡片渲染失败。'))), 'image/jpeg', .92));
}

/** 渲染分享卡片预览，然后提供保存或分享。 @param {import('../core/data.js').Work} w */
export function openCard(w) {
  const img = /** @type {HTMLImageElement} */ (h('img.card2__img', { alt: '分享卡片预览' }));
  const status = h('p.card2__status', null, '正在制作卡片……');
  let url = '';
  const save = h('button.btn.btn--ghost', { type: 'button', disabled: true, onclick: () => url && saveImage({ ...w, id: w.id + '-card' }, url).catch(() => toast('图片保存失败，请重试。')) }, h('span', { html: icon('download') }), T.save);
  const share = h('button.btn.btn--main', { type: 'button', disabled: true, onclick: () => url && shareTikTok({ ...w, id: w.id + '-card' }, url).catch(() => toast('分享未完成，请重试。')) }, h('span', { html: icon('send') }), T.tiktok);
  sheet(() => [h('div.card2', null, img, status), h('div.sheet__acts', null, save, share)], { title: '分享卡片', tall: true, onClose: () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); } });
  makeCard(w).then(b => { url = URL.createObjectURL(b); img.src = url; status.textContent = '1080×1920 · 适合发布为 TikTok 竖屏内容'; save.removeAttribute('disabled'); share.removeAttribute('disabled'); })
    .catch(e => { status.textContent = e?.message || '分享卡片渲染失败。'; });
}

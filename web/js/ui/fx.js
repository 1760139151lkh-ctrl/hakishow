/** 遵循减少动态效果偏好的沉浸动画：warp——切换风格时，从快门处展开风格标题卡片和标记；reveal——光线扫过完成图片，在预览上展示最终结果；burst——完成时迸发风格专属物件，例如缎带、爱心、能量闪电和灯笼；buzz——在支持的手机上轻微振动。 */
import { h, reduced } from '../core/dom.js';
import { sticker, decorArt } from '../core/assets.js';
import { presetById } from '../presets.js';

/** presets.js 中的风格标记显示在标题卡片和完成时的爆发动画中。 */
const emblem = (/** @type {string} */ id, i = 0) => sticker(presetById(id)?.emblem?.[i] || 'sparkle') || sticker('sparkle');

let warpEl = /** @type {HTMLElement | null} */ (null);
/** 风格变化时的标题卡片。 @param {HTMLElement} host @param {string} id */
export function warp(host, id) {
  const p = presetById(id); if (!p) return;
  warpEl?.remove();
  if (reduced) return;
  // 有主题顶饰（公主花冠、霓虹灯管、英雄徽章……）时用顶饰代替小贴纸，标题卡更有仪式感。
  const crest = decorArt('crest-' + id), src = crest || emblem(id, 0);
  warpEl = h('div.warp', { 'aria-hidden': 'true' },
    h('span.warp__wash'),
    h('div.warp__card', null, src ? h(crest ? 'img.warp__crest' : 'img.warp__deco', { src, alt: '' }) : null, h('b.warp__name', null, p.name), h('span.warp__hook', null, p.hook)));
  host.append(warpEl);
  const mine = warpEl;
  setTimeout(() => mine.remove(), 1300);
}

/** 通过从左向右扫过的光线展示图片。 @param {HTMLElement} box 采用相对定位的容器。 @param {HTMLElement} img 要展示的作品。
 */
export function reveal(box, img, ms = 1000) {
  if (reduced) return Promise.resolve();
  const line = h('span.reveal-line');
  box.append(line);
  img.classList.add('reveal-sweep');
  const t0 = performance.now();
  return new Promise(done => {
    const step = (/** @type {number} */ t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      img.style.setProperty('--rv', (e * 100).toFixed(2) + '%');
      line.style.left = (e * 100) + '%';
      if (k < 1) requestAnimationFrame(step);
      else { line.remove(); img.classList.remove('reveal-sweep'); img.style.removeProperty('--rv'); done(undefined); }
    };
    requestAnimationFrame(step);
  });
}

/** 在完成动画中散射该风格的物件。 @param {HTMLElement} host @param {string} id */
export function burst(host, id, n = 16) {
  if (reduced) return;
  const box = h('div.burst', { 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * .3, d = 120 + Math.random() * 140;
    const src = emblem(id, i % 3 === 0 ? 0 : 1);
    if (!src) continue;
    box.append(h('img.burst__bit', { src, alt: '', style: { '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d + 'px', '--rot': (Math.random() * 120 - 60) + 'deg', width: 22 + Math.random() * 22 + 'px', animationDelay: Math.random() * 120 + 'ms' } }));
  }
  host.append(box);
  setTimeout(() => box.remove(), 1500);
}

const unveiled = new Set();
/** 新完成作品只播放一次展示动画；旧作品立即显示。 */
export function firstLook(/** @type {{ id: string, updatedAt: number }} */ w) {
  if (unveiled.has(w.id) || Date.now() - w.updatedAt > 6000) return false;
  unveiled.add(w.id);
  return true;
}

/** 在支持的设备上轻微振动；不支持振动的浏览器忽略此操作。 */
export const buzz = (/** @type {number | number[]} */ pattern = 12) => { try { navigator.vibrate?.(pattern); } catch { /* 不支持。 */ } };

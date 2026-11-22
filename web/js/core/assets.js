/** 风格示例的大图、卡片和缩略图尺寸，以及原始示例肖像、氛围背景与贴纸的资源地址。tools/process_assets.py 生成清单；服务器将其内联，静态应用则获取 img/manifest.json。 */
import { asset } from './dom.js';
import { presetById } from '../presets.js';

/** @type {{ people: string[], styles: Record<string, string[]>, bg: string[], stickers: Record<string, { w: number, h: number }> }} */
let manifest = { people: [], styles: {}, bg: [], stickers: {} };

export async function loadManifest() {
  try {
    const inline = document.getElementById('asset-manifest');
    manifest = inline ? JSON.parse(inline.textContent || '{}') : await fetch(asset('img/manifest.json')).then(r => r.json());
  } catch { /* 清单不可用时退回约定路径。 */ }
  manifest.people ||= []; manifest.styles ||= {}; manifest.bg ||= []; manifest.stickers ||= {};
}

/** 某个风格的示例肖像。尺寸：'' 为完整图片，'m' 为卡片，'t' 为缩略图。 */
// 同一位人物的其他原始照片共用她的风格化示例肖像。
const sitter = (/** @type {string} */ who) => ['priya', 'nur', 'kai'].includes(who) ? 'mei' : who;
export const styleArt = (/** @type {string} */ preset, /** @type {string} */ who, size = '') => asset(`img/styles/${preset}/${sitter(who)}${size ? '-' + size : ''}.webp`);
export const personArt = (/** @type {string} */ who, size = '') => asset(`img/people/${who}${size ? '-' + size : ''}.webp`);
export const bgArt = (/** @type {string} */ id) => (manifest.bg.includes(id) ? asset(`img/bg/${id}.webp`) : '');
export const sticker = (/** @type {string} */ name) => (manifest.stickers[name] ? asset(`img/stickers/${name}.webp`) : '');
export const stickerSize = (/** @type {string} */ name) => manifest.stickers[name] || { w: 1, h: 1 };
export const hasArt = (/** @type {string} */ preset, /** @type {string} */ who) => (manifest.styles[preset] || []).includes(sitter(who));

/** 风格封面：优先使用主推肖像，回退时使用美。 */
export function cover(/** @type {string} */ preset, size = 'm') {
  const p = presetById(preset);
  const who = p && hasArt(preset, p.hero) ? p.hero : 'mei';
  return { art: styleArt(preset, who, size), before: personArt(who, 'm'), who };
}
/** 引导页与轮播图标统一使用美，展示同一个人在三十多种艺术世界中的形象。 */
export const icon = (/** @type {string} */ preset) => styleArt(preset, hasArt(preset, 'mei') ? 'mei' : (presetById(preset)?.hero || 'mei'), 't');
export const samples = () => manifest.people.length ? manifest.people : ['mei', 'aiman', 'priya', 'jun', 'nur', 'kai'];
/** 列出此风格具有示例作品的人物。 */
export const examplesOf = (/** @type {string} */ preset) => manifest.people.filter(who => hasArt(preset, who));

/** 即时本地预览通过区域蒙版为头发、嘴唇和腮红着色，无需等待生成。刘海、发型和眉毛等形状变化需要生成；虚线轮廓和标签用于预览请求区域。 */
import { partById, optionOf } from '../parts.js';
import { canvasOf } from '../core/image.js';

const make = (/** @type {number} */ w, /** @type {number} */ h) => canvasOf(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

const ctx2d = (/** @type {HTMLCanvasElement} */ c) => /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));

/** 为头发着色时保留逐像素发丝纹理与亮度变化；目标亮度让浅色在深色头发上仍然鲜明。how：0 全头染色，1 挑染，2 保留自然发根的渐变染，3 内层染。 */
function dyeHair(/** @type {CanvasRenderingContext2D} */ x, /** @type {HTMLCanvasElement} */ mask, /** @type {string} */ hex, /** @type {number} */ how) {
  const W = x.canvas.width, H = x.canvas.height;
  const work = make(W, H), bufferContext = ctx2d(work);
  bufferContext.drawImage(x.canvas, 0, 0);
  const px = bufferContext.getImageData(0, 0, W, H), d = px.data;
  const mk = make(W, H), mx = ctx2d(mk);
  mx.drawImage(mask, 0, 0, W, H);
  const md = mx.getImageData(0, 0, W, H).data;
  const weight = (/** @type {number} */ i) => md[i + 3] * Math.max(md[i], md[i + 1], md[i + 2]) / 65025;
  // 测量头发平均亮度及边界，用于渐变染和内层染。
  let sum = 0, wsum = 0, top = H, bottom = 0, left = W, right = 0;
  for (let i = 0, p = 0; p < W * H; p++, i += 4) {
    const a = weight(i);
    if (a < .02) continue;
    const y = (p / W) | 0, xx = p % W;
    sum += a * (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); wsum += a;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if (xx < left) left = xx;
    if (xx > right) right = xx;
  }
  if (!wsum) return;
  const mean = Math.max(10, sum / wsum), span = Math.max(1, bottom - top), wide = Math.max(1, right - left);
  const n = parseInt(hex.slice(1), 16), tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
  for (let i = 0, p = 0; p < W * H; p++, i += 4) {
    let a = weight(i);
    if (a < .02) continue;
    const X = p % W, Y = (p / W) | 0, t = (Y - top) / span;
    if (how === 1) {   // 挑染：六到七束略微倾斜、宽度不等的发束。
      const u = (X - left) / wide;
      const s = Math.sin(u * 44 + 2.6 * Math.sin(u * 11.7) + t * 2.4) + .45 * Math.sin(u * 97 + t * 6.1);
      a *= s > 1.05 ? .88 : s > .7 ? (s - .7) / .35 * .88 : .04;
    }
    else if (how === 2) a *= Math.min(1, Math.max(.06, (t - .28) / .42));
    else if (how === 3) a *= t > .5 ? .92 : .14;
    // 缩放阴影，并将高光向白色提亮；直接相乘各颜色通道会截断红色并改变色相。
    const k = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / mean;
    const dark = Math.max(.32, Math.min(1, k)), lift = Math.min(.42, Math.max(0, k - 1) * .3);
    a *= .9;
    d[i] += (tr * dark + (255 - tr) * lift - d[i]) * a;
    d[i + 1] += (tg * dark + (255 - tg) * lift - d[i + 1]) * a;
    d[i + 2] += (tb * dark + (255 - tb) * lift - d[i + 2]) * a;
  }
  x.putImageData(px, 0, 0);
}

/** 将原图和选中的颜色调整渲染到 out；无需着色预览时返回 false。 @param {HTMLCanvasElement} out 与显示图片尺寸一致的预览画布。
 * @param {CanvasImageSource} image 当前版本的原始图像。
 * @param {import('../parts.js').Pick[]} picks
 * @param {Map<string, HTMLCanvasElement | null>} masks 区域到蒙版的映射；白色表示该区域。
 */
export function paintTint(out, image, picks, masks) {
  const swatches = picks.filter(k => partById(k.part)?.kind === 'swatch' && optionOf(k)?.hex && masks.get(k.part));
  const x = ctx2d(out);
  const W = out.width, H = out.height;
  x.clearRect(0, 0, W, H);
  if (!swatches.length) return false;
  x.drawImage(image, 0, 0, W, H);
  for (const k of swatches) {
    const hex = /** @type {string} */ (optionOf(k)?.hex), m = /** @type {HTMLCanvasElement} */ (masks.get(k.part));
    if (k.part === 'colour') { dyeHair(x, m, hex, k.tune ?? 0); continue; }
    const layer = make(W, H), lx = /** @type {CanvasRenderingContext2D} */ (layer.getContext('2d'));
    lx.drawImage(m, 0, 0, W, H);
    lx.globalCompositeOperation = 'source-in';
    lx.fillStyle = hex; lx.fillRect(0, 0, W, H);
    x.save();
    if (k.part === 'lips') {
      const finish = k.tune ?? 1;
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = .5; x.drawImage(layer, 0, 0);
      x.globalCompositeOperation = 'color'; x.globalAlpha = .55; x.drawImage(layer, 0, 0);
      if (finish === 1) { x.globalCompositeOperation = 'screen'; x.globalAlpha = .12; x.drawImage(layer, 0, 0); }   // 水亮妆效。
    } else {
      const amount = [.22, .34, .48][k.tune ?? 1] || .34;
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = amount; x.drawImage(layer, 0, 0);
      x.globalCompositeOperation = 'color'; x.globalAlpha = amount * .7; x.drawImage(layer, 0, 0);
    }
    x.restore();
  }
  return true;
}

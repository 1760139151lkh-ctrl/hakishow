/** 浏览器测试的共用步骤。 */
import { expect } from '@playwright/test';

/** 使用全新用户状态打开应用；`intro` 保留首次使用引导。 */
export async function open(page, { intro = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(intro ? '/' : '/?skipintro');
  await expect(page.locator('html')).toHaveAttribute('data-screen', /.+/);
  return errors;
}

/** 所有标签均保留横向边界检查，包括刻意排成多行的文字。 */
const LABELS = '.pill, .seg__opt, .chip2, .act__label, .tool__label, .tool2__label, .tools__fold, .scard__name, .card__name, .bar__title, .cta__label, .hud__btn, .btn, .modes__opt, .pp__part, .pp__opt, .chat__q, .mitem__name';
// 这些选择器对应 app.css 中明确的多行规则，不会放过所有采用普通空白处理的标签。
const MULTILINE_LABELS = '.act__label, .scard__name, .card__name, .mitem__name, .chips .chip2';
const SCROLLERS = '.cards, .pills, .carousel__track, .res__styles, .versions, .sgrid, .tpanel__body, .pp__parts, .chat__quick, .chat__ideas, .chat__roles, .gal__scroll, .me__scroll, .work__scroll, .work__chain';

/** 要求标签不越界、单行控件保持单行，且页面没有横向滚动。 */
export async function tidy(page) {
  const issues = await page.evaluate(([labels, scrollers, multilineLabels]) => {
    const stage = document.getElementById('stage').getBoundingClientRect(), out = [];
    for (const el of document.querySelectorAll(labels)) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('[hidden]')) continue;
      // 仅豁免单行断言。下方边界检查仍适用于所有标签。
      // 主要操作按钮的标签仅在匹配的窄屏 CSS 规则中变为多行。
      const mayWrap = el.matches(multilineLabels) || (el.matches('.cta__label') && matchMedia('(max-width: 380px)').matches);
      if (!mayWrap) {
        const tops = new Set();
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!n.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(n); for (const x of range.getClientRects()) if (x.width > 1) tops.add(Math.round(x.top / 4)); }
        if (tops.size > 1) out.push('wraps: ' + el.textContent.trim());
      }
      if (!el.closest(scrollers) && (r.right > stage.right + 1 || r.left < stage.left - 1)) out.push('outside: ' + el.textContent.trim());
    }
    if (document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1) out.push('页面出现横向滚动');
    return out;
  }, [LABELS, SCROLLERS, MULTILINE_LABELS]);
  expect(issues).toEqual([]);
}

/** 启动相机：仅在尚未授予权限时显示该按钮。 */
export async function camera(page) {
  const ask = page.getByRole('button', { name: '开启相机' });
  await page.waitForFunction(() => document.querySelector('.live')?.dataset.cam && document.querySelector('.live')?.dataset.cam !== 'starting', null, { timeout: 15000 }).catch(() => {});
  if (await ask.isVisible()) await ask.click();
}

/** 将一位虚构示例人物放入精修工作室：工作室会自动载入默认示例，再通过“更换照片”选择第 nth 位。 */
export async function useSample(page, nth = 0) {
  await page.goto('/?skipintro#/studio');
  await expect(page.locator('.studio')).toHaveAttribute('data-has', 'photo', { timeout: 15000 });
  await page.locator('.frame__hud .hud__btn').first().click();
  await page.locator('.sheet .sample').nth(nth).click();
  await expect(page.locator('.sheet')).toHaveCount(0);   // 更换照片抽屉已关闭。
  await expect(page.locator('.versions .ver--src img')).toHaveAttribute('src', /.+/);
}

/** 旧工具名到新入口的对应：调整、细节并入“微调”，区域、对话并入“修改”。 */
const TOOL = { 调整: '微调', 细节: '微调', 区域: '修改', 对话: '修改' };
/** 在图像下方面板中打开精修工作室的一个入口（风格、修改、微调）。 */
export async function tool(page, label) {
  const b = page.locator('.tool2', { hasText: TOOL[label] || label });
  if ((await b.getAttribute('aria-selected')) !== 'true') await b.click();
  await expect(b).toHaveAttribute('aria-selected', 'true');
}

/** 照片工作室当前界面的主要按钮（开始创作、编辑N个区域等）。 */
export const cta = (page) => page.locator('.studio .cta:visible');

/** 开始创作并等待图像。 */
export async function make(page, timeout = 30000) {
  await cta(page).click();
  await expect(page.locator('.frame')).toHaveAttribute('data-state', 'done', { timeout });
}

/** 模拟屏幕键盘已弹出（从视觉视口底部占用 `kb` 像素）。 */
export async function keyboardUp(page, kb = 320) {
  await page.evaluate((k) => {
    const vv = window.visualViewport, h = innerHeight - k;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    vv.dispatchEvent(new Event('resize'));
  }, kb);
  await page.waitForTimeout(450);
}
export async function keyboardDown(page) {
  await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(300);
}

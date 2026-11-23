/** 静态演示：所有界面无需服务器即可工作；示例结果标记为示例，自有照片标记为本地预览。 */
import { test, expect } from '@playwright/test';
import { open, tidy, useSample, camera, tool, cta, make, keyboardUp, keyboardDown, slide } from './kit.mjs';
import { PRESETS } from '../../web/js/presets.js';

test('首次打开时几秒内说明用法，点击一次即可体验示例', async ({ page }) => {
  const errors = await open(page, { intro: true });
  await expect(page.getByRole('heading', { name: /一张自拍/ })).toBeVisible();
  expect(await page.locator('.ob__bar').count()).toBeGreaterThan(3);
  await expect(page.getByRole('button', { name: '开始拍摄' })).toBeVisible();
  await tidy(page);
  await page.getByRole('button', { name: '试用示例', exact: true }).click();
  await expect(page.locator('.result')).toHaveAttribute('data-state', 'done', { timeout: 15000 });
  await expect(page.locator('.res__badges')).toContainText('示例作品');
  await expect(page.locator('.res__art')).toHaveClass(/is-in/);
  expect(errors).toEqual([]);
});

test('新手引导在欢迎页关闭后才出现：一步一步前进、可以跳过，之后不再自动出现', async ({ page }) => {
  const errors = await open(page, { intro: true });
  await expect(page.getByRole('button', { name: '开始拍摄' })).toBeVisible();
  // 欢迎页还开着时，引导不能盖在它上面。
  await page.waitForTimeout(1500);
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.getByRole('button', { name: '开始拍摄' }).click();
  await camera(page);
  await expect(page.locator('.tour__tip')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.tour__count')).toHaveText(/^第 1 步 \/ 共 \d 步$/);
  await expect(page.locator('.tour__title')).toHaveText('换特效：左右滑动转盘');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('.tour__count')).toHaveText(/^第 2 步/);
  await expect(page.locator('.tour__title')).toHaveText('照着提示做动作');
  await tidy(page);
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.locator('.tour')).toHaveCount(0);
  // 看过（或跳过）以后，重新打开不再自动出现。
  await page.reload();
  await camera(page);
  await page.waitForTimeout(2000);
  await expect(page.locator('.tour')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('实时相机跟踪面部并应用风格', async ({ page }) => {
  await open(page);
  await camera(page);
  await expect(page.locator('.live')).toHaveAttribute('data-cam', 'on');
  await expect(page.locator('.live')).toHaveClass(/has-face/, { timeout: 30000 });
  await page.locator('.live .pill', { hasText: '氛围' }).click();
  await expect(page.locator('.live__name')).toHaveText('复古数码相机');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ccd');
  await page.locator('.tool[data-tool="compare"]').click();
  await expect(page.locator('.tool[data-tool="compare"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.tool[data-tool="compare"]').click();
  await expect(page.locator('.tool[data-tool="compare"]')).toHaveAttribute('aria-pressed', 'false');
  // 美颜面板：美颜、美型、滤镜、特效四组，滑块即时生效。
  await page.locator('.tool[data-tool="beauty"]').click();
  await expect(page.locator('.bp')).toBeVisible();
  await page.locator('.bp__tab', { hasText: '美型' }).click();
  await page.locator('.bp__item', { hasText: '大眼' }).click();
  await slide(page, '.bp__slider .sl', 60);
  await expect(page.locator('.bp__val')).toHaveText('60');
  await page.locator('.bp__tab', { hasText: '滤镜' }).click();
  await page.locator('.bp__look[data-look="film"]').click();
  await expect(page.locator('.bp__look[data-look="film"]')).toHaveAttribute('aria-pressed', 'true');
  await tidy(page);
  await page.locator('.live__view').click({ position: { x: 40, y: 200 } });
  await expect(page.locator('.bp')).toBeHidden();
  // 背景：跟随特效／原景／虚化／场景。
  await page.locator('.tool[data-tool="bg"]').click();
  await page.locator('.bgpop__opt', { hasText: '虚化' }).click();
  await expect(page.locator('.bgpop__opt', { hasText: '虚化' })).toHaveAttribute('aria-checked', 'true');
  // 全部特效：搜索与互动筛选。
  await page.locator('.live__browse').click();
  await page.locator('.fxs__search').fill('喷火');
  await expect(page.locator('.fxs__item')).toHaveCount(1);
  await page.locator('.fxs__item').click();
  await expect(page.locator('.live__name')).toHaveText('小小龙');
  await tidy(page);
});

test('相机权限被拒绝时平顺引导至照片工作室', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })); });
  await open(page);
  await camera(page);
  await expect(page.locator('.live')).toHaveAttribute('data-cam', 'denied');
  await expect(page.locator('.gate__text')).toContainText('照片');
  await page.getByRole('button', { name: '用照片创作' }).first().click();
  await expect(page).toHaveURL(/#\/studio/);
});

test('上传一次即可尝试任意风格；每项修改均可撤销与重做，重新加载后仍可操作', async ({ page }) => {
  const errors = await open(page);
  await useSample(page, 2);
  const theme = await page.locator('html').getAttribute('data-theme');
  await tool(page, '风格');
  await page.locator('.tpanel .pill', { hasText: '氛围' }).click();
  await page.locator('.scard[data-style="neon"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  await tool(page, '微调');
  // 微调滑杆是跟手滑杆：像手指一样按住圆点拖到 95。
  await slide(page, page.locator('.knob', { hasText: '风格强度' }).locator('.sl'), 95);
  await expect(page.locator('.knob', { hasText: '风格强度' }).locator('.knob__val')).toContainText('95');
  // 先撤销滑块修改，再撤销风格修改，同时恢复主题。
  const undo = page.getByRole('button', { name: '撤销' }).first(), redo = page.getByRole('button', { name: '重做' }).first();
  await undo.click();
  await expect(page.locator('.knob', { hasText: '风格强度' }).locator('.knob__val')).not.toContainText('95');
  await undo.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme || '');
  await redo.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  await page.reload();
  await expect(page.locator('.studio')).toHaveAttribute('data-has', 'photo');
  await expect(page.getByRole('button', { name: '撤销' }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: '重做' }).first()).toBeEnabled();
  await page.locator('.tools__fold').click();
  await make(page, 15000);
  await expect(page.locator('.hud__btn--main')).toBeVisible();
  await tidy(page);
  await page.locator('.studio .bar .avatar').first().click();
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.locator('.tile').click();
  await expect(page.locator('.trail__item')).toHaveCount(1);
  await page.locator('.work .bar__back').click();
  await page.locator('.gallery .bar__back').click();
  await expect(page).toHaveURL(/#\/studio/);
  expect(errors).toEqual([]);
});

test('返回手势先收起已打开面板，且不会离开照片工作室', async ({ page }) => {
  await useSample(page, 0);
  await tool(page, '微调');
  await expect(page.locator('.studio')).toHaveAttribute('data-panel', 'tune');
  await page.goBack();
  await expect(page.locator('.studio')).not.toHaveAttribute('data-panel', /.+/);
  await expect(page).toHaveURL(/#\/studio/);
  await tool(page, '风格');
  await page.locator('.tools__fold').click();
  await expect(page.locator('.studio')).not.toHaveAttribute('data-panel', /.+/);
  await expect(page.locator('.dock__cta .cta')).toBeVisible();
});

test('每种动画风格均应用其主题，示例会打开对应风格的相机', async ({ page }) => {
  const acg = PRESETS.filter(p => p.cat === 'acg');
  await open(page);
  await camera(page);
  await page.locator('.live .pill', { hasText: '动漫' }).click();
  await expect(page.locator('.live .dot')).toHaveCount(acg.length);
  // 切换分类后自动选中第一个风格；居中的圆点位于快门下方（点击即拍照），因此只点击其余风格。
  const first = await page.locator('.live .dot[aria-selected="true"]').getAttribute('data-style');
  await expect(page.locator('html')).toHaveAttribute('data-theme', first || '');
  const others = acg.filter(p => p.id !== first);
  for (const p of others.slice(0, 3)) {
    await page.locator(`.live .dot[data-style="${p.id}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', p.id);
  }
  const last = others[2];
  await page.locator('.live__label').click();
  await expect(page.locator('.ex__person').first()).toBeVisible();
  await page.locator('.ex__acts .btn--main').click();
  await expect(page).toHaveURL(/#\/live/);
  await expect(page.locator('.live__name')).toHaveText(last.name);
  await tidy(page);
});

test('生成结果后切换风格会重新显示开始创作按钮，风格标签显示相应示例', async ({ page }) => {
  await useSample(page, 1);
  await make(page, 15000);
  await expect(page.locator('.dock__cta .cta__label')).toHaveText('再创作一张');
  await tool(page, '风格');
  await page.locator('.tpanel .pill', { hasText: '角色' }).click();
  await page.locator('.scard[data-style="robot"]').click();
  await expect(page.locator('.tpanel__foot .cta__label')).toHaveText('开始创作');
  await page.locator('.hud__chip').click();
  await expect(page.locator('.ex__view')).toBeVisible();
});

test('区域编辑预览选定颜色、创建新版本并支持撤销', async ({ page }) => {
  const errors = await open(page);
  await useSample(page, 0);
  await make(page, 15000);
  await tool(page, '区域');
  await expect(page.locator('.pp__hint')).not.toContainText('正在寻找面部', { timeout: 30000 });
  await page.locator('.pp__part', { hasText: '发色' }).click();
  await page.locator('.pp__opt', { hasText: '樱花粉' }).click();
  await expect(page.locator('.pp__tok')).toHaveCount(1);
  await expect(page.locator('.frame__tint')).toBeVisible({ timeout: 20000 });
  await page.locator('.pp__part', { hasText: '刘海' }).click();
  await page.locator('.pp__opt', { hasText: '八字刘海' }).click();
  await expect(page.locator('.pp__tok')).toHaveCount(2);
  await expect(cta(page).locator('.cta__label')).toHaveText('编辑 2 区域');
  await tidy(page);
  await cta(page).click();
  await expect(page.locator('.ver[data-op="region"]')).toHaveCount(1);
  await expect(page.locator('.frame')).toHaveAttribute('data-state', 'done', { timeout: 15000 });
  await expect(page.locator('.pp__tok')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).first().click();
  await expect(page.locator('.pp__tok')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('画笔选区绘制蒙版，并支持撤销笔画', async ({ page }) => {
  await useSample(page, 3);
  await tool(page, '区域');
  await page.locator('.pp__part--paint').click();
  const b = await page.locator('.frame__brush').boundingBox();
  await page.mouse.move(b.x + b.width * .3, b.y + b.height * .3); await page.mouse.down();
  await page.mouse.move(b.x + b.width * .5, b.y + b.height * .35, { steps: 6 }); await page.mouse.up();
  await expect(cta(page).locator('.cta__label')).toHaveText('编辑此区域');
  await page.locator('.pp__tool', { hasText: '撤销笔画' }).click();
  await expect(cta(page)).toBeDisabled();
});

test('对话输入框保持在键盘上方，页面高度不变', async ({ page }) => {
  await useSample(page, 4);
  await make(page, 15000);
  await tool(page, '对话');
  const stageH = await page.locator('#stage').evaluate(el => el.getBoundingClientRect().height);
  await page.locator('.chat__field').click();
  await page.locator('.chat__field').fill('使用日落海滩背景');
  await keyboardUp(page, 320);
  const vvH = await page.evaluate(() => window.visualViewport.height);
  const field = await page.locator('.chat__field').evaluate(el => el.getBoundingClientRect().toJSON());
  const panel = await page.locator('.tpanel').evaluate(el => el.getBoundingClientRect().toJSON());
  expect(field.bottom, 'The input 保持在键盘上方.').toBeLessThanOrEqual(vvH + 1);
  expect(panel.bottom, '面板贴合键盘边缘。').toBeGreaterThan(vvH - 40);
  expect(await page.locator('#stage').evaluate(el => el.getBoundingClientRect().height), '页面保持完整高度。').toBeGreaterThanOrEqual(stageH - 1);
  await expect(page.locator('.bar')).toBeInViewport();
  await keyboardDown(page);
  await expect(page.locator('.chat__send')).toHaveClass(/is-ready/);
});

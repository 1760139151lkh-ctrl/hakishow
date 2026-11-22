/** 实际服务器（模拟器引擎）：完整流程、每种修改图像的方式、账户，以及重新加载后内容不丢失。 */
import { test, expect } from '@playwright/test';
import { open, tidy, useSample, camera, tool, cta, make } from './kit.mjs';

test('快门 → 即时结果 → 无需重拍即可切换风格 → 更多版本 → 在照片工作室中调整', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', '拍照使用 Chromium 测试相机；WebKit 覆盖相机权限被拒后改用上传的备用流程。');
  const errors = await open(page);
  await camera(page);
  await expect(page.locator('.live')).toHaveAttribute('data-cam', 'on');
  await page.locator('.shutter').click();
  await expect(page.locator('.result')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.prog__steps li')).toHaveCount(3);
  await expect(page.locator('.result')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
  await expect(page.locator('.res__badges')).toContainText('模拟结果');
  await page.locator('.res__styles .dot').nth(1).click();
  await expect(page.locator('.result')).toHaveAttribute('data-state', 'working');
  await expect(page.locator('.result')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
  // 撤销恢复风格修改前的版本，重做恢复该修改。
  await page.locator('.result .bar__right .ibtn').first().click();
  await expect(page.locator('.toast')).toContainText('已撤销');
  await page.locator('.result .bar__right .ibtn').nth(1).click();
  // 更多 → 变体会创建三个选项，均可在同组版本条中选择。
  await page.locator('.act', { hasText: '更多' }).click();
  await page.locator('.mitem', { hasText: '变体' }).click();
  await expect(page.locator('.res__sib')).toHaveCount(3);
  await expect(page.locator('.result')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
  await page.locator('.res__sib').nth(2).click();
  await expect(page.locator('.res__sib').nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '调整细节' }).click();
  await expect(page).toHaveURL(/#\/studio/);
  await expect(page.locator('.tool2[aria-selected="true"]')).toHaveText('调整');
  await expect(page.locator('.versions .ver')).toHaveCount(6);
  await tidy(page);
  expect(errors).toEqual([]);
});

test('生成任务可以取消并重试', async ({ page }) => {
  await useSample(page, 1);
  // 将请求延迟2.5秒，使较慢浏览器中仍有机会点击取消。
  await page.route('**/api/turns', async r => { await new Promise(res => setTimeout(res, 2500)); await r.continue().catch(() => {}); });
  await cta(page).click();
  await page.locator('.frame .prog__stop').click();
  await expect(page.locator('.frame')).toHaveAttribute('data-state', 'stopped', { timeout: 15000 });
  await page.locator('.frame__fail .btn--main').click();
  await expect(page.locator('.frame')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
});

test('区域编辑为每个部分发送一个蒙版，且仅修改这些部分；工作室回复三个创意', async ({ page }) => {
  const errors = await open(page);
  await useSample(page, 0);
  await make(page);
  await tool(page, '区域');
  await expect(page.locator('.pp__hint')).not.toContainText('正在寻找面部', { timeout: 30000 });
  await page.locator('.pp__part', { hasText: '刘海' }).click();
  await page.locator('.pp__opt', { hasText: '八字刘海' }).click();
  await page.locator('.pp__part', { hasText: '嘴唇' }).click();
  await page.locator('.pp__opt', { hasText: '灰玫瑰色' }).click();
  await expect(cta(page).locator('.cta__label')).toHaveText('编辑 2 区域');
  const sent = page.waitForRequest(r => r.url().endsWith('/api/turns') && r.method() === 'POST');
  await cta(page).click();
  const region = (await sent).postDataJSON();
  await expect(page.locator('.ver[data-op="region"]')).toHaveCount(1);
  await expect(page.locator('.frame')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
  expect(region.intent.op).toBe('region');
  expect(region.pins).toHaveLength(2);
  expect(region.pins.every(p => p.mask)).toBe(true);
  expect(region.say).toContain('八字刘海');
  await tool(page, '对话');
  await expect(page.locator('.chat__ideas .chip2--idea')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('对话编辑创建新版本，并包含回复、建议及可选择的历史缩略图', async ({ page }) => {
  const errors = await open(page);
  await useSample(page, 2);
  await make(page);
  await tool(page, '对话');
  await page.locator('.chat__field').fill('使用日落海滩背景');
  await page.locator('.chat__send').click();
  await expect(page.locator('.msg--me').last()).toHaveText('使用日落海滩背景');
  await expect(page.locator('.msg--ai').last().locator('.msg__thumb[data-state="done"]')).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('.chat__ideas .chip2--idea')).toHaveCount(3);
  await page.locator('.chat__ideas .chip2--idea').first().click();
  await expect(page.locator('.chat__field')).not.toHaveValue('');
  await page.locator('.msg__thumb').first().click();
  await expect(page.locator('.msg__thumb').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.chat__q', { hasText: '变体' }).click();
  await expect(page.locator('.msg--ai').last().locator('.msg__thumb')).toHaveCount(3);
  await expect(page.locator('.msg--ai').last().locator('.msg__thumb[data-state="done"]')).toHaveCount(3, { timeout: 30000 });
  await tidy(page);
  expect(errors).toEqual([]);
});

test('重新加载后作品、收藏、草稿与撤销历史均保留，注册也保留这些内容', async ({ page }) => {
  await useSample(page, 3);
  await tool(page, '细节');
  await page.locator('.dgroup .chip2').first().click();
  await make(page);
  await tool(page, '风格');
  await page.locator('.scard .scard__fav').first().click();
  await page.reload();
  await expect(page.locator('.studio')).toHaveAttribute('data-has', 'photo');
  await expect(page.locator('.studio')).toHaveAttribute('data-panel', 'style');
  await expect(page.locator('.versions .ver:not(.ver--src)')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '撤销' }).first()).toBeEnabled();
  await page.evaluate(() => { location.hash = '#/me'; });
  await page.locator('.me__row', { hasText: '我的偏好' }).click();
  await page.locator('.sheet textarea').fill('保留我的痣');
  await page.locator('.sheet .btn--main').click();
  await expect(page.locator('.me__row', { hasText: '我的偏好' })).toContainText('保留我的痣');
  await page.getByRole('button', { name: '注册账户', exact: true }).click();
  await page.locator('.auth input').nth(0).fill('tester' + Date.now() % 100000);
  await page.locator('.auth input').nth(1).fill('secret123');
  await page.locator('.auth button[type=submit]').click();
  await expect(page.locator('.me__handle')).toContainText('@tester');
  await expect(page.locator('.me__stats li').first()).toContainText('1');
  await page.evaluate(() => indexedDB.deleteDatabase('hakishow'));
  await page.reload();
  await page.evaluate(() => { location.hash = '#/gallery'; });
  await expect(page.locator('.tile')).toHaveCount(1, { timeout: 15000 });
});

for (const [w, h] of [[360, 640], [430, 932], [1280, 800]]) {
  test(`每个界面在以下尺寸均布局整齐： ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await useSample(page, 0);
    await tidy(page);
    for (const t of ['风格', '调整', '细节', '区域', '对话']) { await tool(page, t); await tidy(page); }
    for (const route of ['#/gallery', '#/me', '#/live']) { await page.evaluate(r => { location.hash = r; }, route); await page.waitForTimeout(400); await tidy(page); }
  });
}

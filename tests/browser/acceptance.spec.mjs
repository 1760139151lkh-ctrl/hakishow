/**
 * 浏览器验收检查：
 *   · 每个滑块都会改变结果，且刷新后保持设置。
 *   · 切换工具时，图像与面板高度保持稳定。
 *   · 在改变布局视口或视觉视口大小的两类浏览器中，键盘弹出后输入框仍然可见。
 *   · 交互控件避开刘海与主屏幕指示条的安全区域。
 *   · 每种风格、细节与抽屉均能响应，包含全部四种关闭抽屉的方式。
 *   · 每个可见按钮均提供反馈，且无脚本错误。
 *   · 首次加载与界面切换保持流畅
 */
import { test, expect } from '@playwright/test';
import { open, useSample, camera, tool, cta, make, keyboardUp, keyboardDown } from './kit.mjs';
import { PRESETS } from '../../web/js/presets.js';

test('首次加载与界面切换保持流畅', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/?skipintro#/studio');
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'studio');
  const first = Date.now() - t0;
  const times = [];
  for (const route of ['#/gallery', '#/me', '#/studio', '#/live']) {
    const t = Date.now();
    await page.evaluate(r => { location.hash = r; }, route);
    await expect(page.locator('html')).toHaveAttribute('data-screen', route.slice(2));
    times.push(Date.now() - t);
  }
  console.log('首次加载', first, '毫秒 · 界面切换', times.join(' / '), 'ms');
  expect(first).toBeLessThan(4000);
  for (const t of times) expect(t).toBeLessThan(800);
});

test('实时相机强度会改变图像，并在重新加载后保留', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '测试相机仅在 Chromium 中可用。');
  await open(page);
  await camera(page);
  await expect(page.locator('.live')).toHaveAttribute('data-cam', 'on');
  await page.waitForTimeout(1500);
  const frame = () => page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.live__gl'));
    const t = document.createElement('canvas'); t.width = 48; t.height = 80;
    t.getContext('2d').drawImage(c, 0, 0, 48, 80);
    return Array.from(t.getContext('2d').getImageData(0, 0, 48, 80).data);
  });
  await page.locator('.tool[data-tool="strength"]').click();
  await expect(page.locator('.pop')).toBeVisible();
  await page.locator('.vrange').fill('0');
  await expect(page.locator('.pop__val')).toHaveText('0');
  await page.waitForTimeout(600);
  const plain = await frame();
  await page.locator('.vrange').fill('100');
  await expect(page.locator('.pop__val')).toHaveText('100');
  await page.waitForTimeout(600);
  const styled = await frame();
  const diff = plain.reduce((s, v, i) => s + Math.abs(v - styled[i]), 0) / plain.length;
  expect(diff, '强度为0和100时应产生明显不同的画面。').toBeGreaterThan(4);
  await page.locator('.vrange').fill('35');
  await page.locator('.vrange').dispatchEvent('change');
  await page.reload();
  await camera(page);
  await page.locator('.tool[data-tool="strength"]').click();
  await expect(page.locator('.pop__val')).toHaveText('35');
});

test('工作室的四个滑块设置均会保留，并出现在创作历史中', async ({ page }) => {
  await useSample(page, 0);
  await tool(page, '调整');
  const want = { '风格强度': '95', '相似度保留': '40', '细节程度': '20', Beauty: '70' };
  for (const [name, v] of Object.entries(want)) {
    const knob = page.locator('.knob', { hasText: name });
    await knob.locator('input').fill(v);
    await knob.locator('input').dispatchEvent('change');
    await expect(knob.locator('.knob__val')).toContainText(v);
  }
  await make(page);
  await page.reload();
  await tool(page, '调整');
  for (const [name, v] of Object.entries(want)) await expect(page.locator('.knob', { hasText: name }).locator('.knob__val')).toContainText(v);
  // 修改一个滑块并创建第二个版本；历史轨迹应描述差异。
  const k = page.locator('.knob', { hasText: '风格强度' }).locator('input');
  await k.fill('60'); await k.dispatchEvent('change');
  await make(page);
  await page.locator('.hud__btn', { hasText: '保存' }).waitFor();
  await page.evaluate(() => { location.hash = '#/gallery'; });
  await page.locator('.tile').first().click();
  await expect(page.locator('.trail')).toContainText('风格强度 95→60');
});

test('修改前后对比能够响应键盘输入', async ({ page }) => {
  await useSample(page, 2);
  await make(page);
  await page.waitForTimeout(1300);
  const box = page.locator('.frame__img');
  await page.locator('.cmp__range').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(box).toHaveClass(/is-split/);
  const cmp = await box.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--cmp')));
  expect(cmp).toBeLessThan(100);
});

for (const [w, h] of [[390, 844], [360, 640], [1280, 800]]) {
  test(`切换工具时图像与面板几何位置保持稳定 · ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await useSample(page, 3);
    const measure = () => page.evaluate(() => {
      const base = /** @type {HTMLElement} */ (document.querySelector('.studio')).getBoundingClientRect().top;
      const r = (/** @type {string} */ s) => document.querySelector(s)?.getBoundingClientRect();
      return [r('.tpanel')?.height, r('.frame__fit')?.height, (r('.frame__fit')?.top || 0) - base, (r('.tpanel')?.top || 0) - base].map(v => Math.round(v || 0));
    });
    /** 等待过渡动画结束，并连续两次读取到相同几何位置。 */
    const settled = async () => {
      await page.waitForFunction(() => !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running'), null, { timeout: 10000 }).catch(() => {});
      let last = await measure();
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(200);
        const now = await measure();
        if (JSON.stringify(now) === JSON.stringify(last)) return now;
        last = now;
      }
      return last;
    };
    await tool(page, '风格');
    const base = await settled();
    for (const t of ['调整', '细节', '区域', '对话', '风格']) {
      await tool(page, t);
      expect(await measure(), `Switching to ${t}: image and panel geometry stays fixed immediately.`).toEqual(base);
      expect(await settled(), `After switching to ${t}: image and panel geometry stays fixed.`).toEqual(base);
    }
  });
}

test('软键盘保持布局稳定，并使输入框可见', async ({ page }) => {
  await useSample(page, 1);
  const stageH = await page.locator('#stage').evaluate(el => el.getBoundingClientRect().height);
  const screen = /** @type {{ width: number, height: number }} */ (page.viewportSize()), KB = 320, top = screen.height - KB;
  /** 覆盖布局视口调整与 interactive-widget=resizes-visual 两种行为。 */
  const check = async (/** @type {string} */ field, /** @type {'layout' | 'visual'} */ how) => {
    await page.locator(field).focus();
    await page.waitForTimeout(200);
    if (how === 'layout') await page.setViewportSize({ width: screen.width, height: top });
    else await keyboardUp(page, KB);
    await page.waitForTimeout(600);
    const after = await page.locator('#stage').evaluate(el => el.getBoundingClientRect().height);
    expect(after, '键盘覆盖底部时，舞台区域保持原有高度。').toBeGreaterThanOrEqual(stageH - 1);
    const rect = () => page.locator(field).evaluate(el => el.getBoundingClientRect().toJSON());
    await expect.poll(async () => (await rect()).bottom, { message: field + ' 保持在键盘上方', timeout: 4000 }).toBeLessThanOrEqual(top + 1);
    expect((await rect()).top, field + ' 保持在屏幕范围内').toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.screen:not([hidden]) .bar').first(), '顶部栏保持原位。').toBeInViewport();
    if (how === 'layout') await page.setViewportSize(screen);
    else await keyboardDown(page);
    await page.locator(field).blur();
    await page.waitForTimeout(400);
  };
  for (const how of /** @type {const} */ (['layout', 'visual'])) {
    await tool(page, '细节');
    await check('.say__field', how);
    await tool(page, '对话');
    await check('.chat__field', how);
  }
  await tool(page, '细节');
  await page.locator('.say__field').fill('把蝴蝶结改成红色');
  await page.locator('.say__field').press('Enter');
  await expect(page.locator('.say__field')).toHaveValue('把蝴蝶结改成红色');
  await page.evaluate(() => { location.hash = '#/me'; });
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await check('.auth input >> nth=1', 'layout');
  await page.keyboard.press('Escape');
  const final = await page.locator('#stage').evaluate(el => el.getBoundingClientRect().height);
  expect(final).toBeGreaterThanOrEqual(stageH - 1);
});

test('交互控件避开刘海与主屏幕指示条安全区域', async ({ page }) => {
  const SAT = 47, SAB = 34, H = 844;
  await page.addInitScript(([t, b]) => {
    const s = document.createElement('style');
    s.textContent = `:root:root { --sat: ${t}px; --sab: ${b}px; }`;
    document.addEventListener('DOMContentLoaded', () => document.head.append(s));
  }, [SAT, SAB]);
  const clear = async (/** @type {string} */ where) => {
    const bad = await page.evaluate(([t, b, h]) => {
      const out = [];
      for (const el of document.querySelectorAll('button, [role="button"], input, .toast')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('[hidden], .scrim') || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).opacity === '0') continue;
        if (el.closest('.cards, .pills, .carousel__track, .res__styles, .versions, .sgrid, .tpanel__body, .pp__parts, .chat__quick, .chat__ideas, .gal__scroll, .me__scroll, .work__scroll, .work__chain')) continue;   // 可滚动内容可以移到系统栏后方。
        if (el.closest('.studio, .ob__view') && !el.closest('.bar, .tools, .tpanel__foot, .dock__cta, .modes, .frame__hud')) continue;
        if (r.top < t - 1 || r.bottom > h - b + 1) out.push((el.className || el.tagName) + ' ' + Math.round(r.top) + '–' + Math.round(r.bottom));
      }
      return out;
    }, [SAT, SAB, H]);
    if (bad.length) console.log(where, bad);
    expect(bad, where + ' 安全区域').toEqual([]);
  };
  await page.goto('/');
  await expect(page.locator('.ob')).toBeVisible();
  await clear('Onboarding');
  await page.getByRole('button', { name: '跳过' }).click();
  await clear('实时相机');
  await useSample(page, 0);
  await clear('照片工作室');
  await make(page);
  await page.waitForTimeout(400);
  await clear('生成后的照片工作室');
  for (const t of ['风格', '区域', '对话']) { await tool(page, t); await page.waitForTimeout(300); await clear('照片工作室·' + t); }
  for (const r of ['#/gallery', '#/me']) { await page.evaluate(x => { location.hash = x; }, r); await page.waitForTimeout(400); await clear(r); }
  await page.evaluate(() => { location.hash = '#/gallery'; }); await page.locator('.tile').first().click(); await page.waitForTimeout(500);
  await clear('作品详情');
});

test('每种风格均应用其主题，每个细节选项均可切换', async ({ page, browserName }) => {
  test.setTimeout(browserName === 'webkit' ? 1_200_000 : 300_000);
  await useSample(page, 4);
  await tool(page, '风格');
  for (const cat of ['趣味', '角色', '奇幻', '动漫', '氛围', '艺术']) {
    await page.locator('.tpanel .pill', { hasText: cat }).click();
    for (const p of PRESETS.filter(x => x.cat === { Playful: 'fun', Characters: 'role', Fantasy: 'dream', Anime: 'acg', Mood: 'mood', Art: 'art' }[cat])) {
      const card = page.locator(`.scard[data-style="${p.id}"]`);
      if ((await card.getAttribute('aria-selected')) !== 'true') await card.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', p.id);
      await expect(card).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.hud__chip b')).toHaveText(p.name);
      // 每个细节均可切换；互斥组还会清除先前选择。
      await tool(page, '细节');
      const chips = page.locator('.dgroup .chip2');
      const n = await chips.count();
      expect(n).toBe(8);
      for (let i = 0; i < n; i++) {
        const c = chips.nth(i), was = await c.getAttribute('aria-pressed');
        await c.click();
        await expect(c).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');
        await c.click();
      }
      await tool(page, '风格');
    }
  }
});

test('每个抽屉均可通过按钮、遮罩、Escape 或返回关闭，且不离开当前界面', async ({ page }) => {
  await useSample(page, 5);
  const drawers = {
    Examples: { at: '#/studio', open: () => page.locator('.hud__chip').click() },
    '我的偏好': { at: '#/me', open: () => page.locator('.me__row', { hasText: '我的偏好' }).click() },
    '登录': { at: '#/me', open: () => page.getByRole('button', { name: '登录', exact: true }).click() },
    Privacy: { at: '#/me', open: () => page.locator('.me__row', { hasText: '隐私' }).click() },
  };
  for (const [name, d] of Object.entries(drawers)) {
    for (const how of ['✕', 'scrim', 'Esc', '返回']) {
      await page.evaluate(r => { location.hash = r; }, d.at); await page.waitForTimeout(300);
      await d.open();
      await expect(page.locator('.sheet.is-in'), name + ' opens').toBeVisible();
      if (how === '✕') await page.locator('.sheet .sheet__close').click();
      if (how === 'scrim') await page.locator('.scrim').click({ position: { x: 8, y: 8 } });
      if (how === 'Esc') await page.keyboard.press('Escape');
      if (how === '返回') await page.goBack();
      await expect(page.locator('.sheet'), `${name} closes with ${how}`).toHaveCount(0);
      await expect(page, `Closing ${name} preserves the current screen`).toHaveURL(new RegExp(d.at.replace('/', '\\/') + '$'));
    }
  }
});

/**
 * 从可重复的状态逐一检查每个可见按钮，核验导航、界面变化、
 * 文件选择器或下载行为，且无脚本错误。
 */
/**
 * 每个可见按钮都必须无错误地触发导航、抽屉、其他界面更新或文件选择器。
 * 按无障碍名称及出现次序识别按钮；导航或打开浮层后重置界面。
 */
const CRAWL = /** @type {Record<string, { hash: (work: string) => string, open?: (page: import('@playwright/test').Page) => Promise<unknown>, chromiumOnly?: boolean }>} */ ({
  result: { hash: w => `#/result/${w}` },
  // 每次遍历前重置已保存的风格分类与作品库分组。
  'studio·Styles': { hash: () => '#/studio', open: async p => { await tool(p, '风格'); await p.locator('.tpanel .pill', { hasText: '精选' }).click(); } },
  'studio·Adjust': { hash: () => '#/studio', open: p => tool(p, '调整') },
  'studio·Details': { hash: () => '#/studio', open: p => tool(p, '细节') },
  'studio·Regions': { hash: () => '#/studio', open: async p => { await tool(p, '区域'); await p.waitForTimeout(1500); } },
  'studio·Chat': { hash: () => '#/studio', open: p => tool(p, '对话') },
  gallery: { hash: () => '#/gallery', open: async p => { await p.locator('.gal__seg .seg__opt[data-k="works"]').click(); await p.locator('.tile').first().waitFor({ timeout: 15000 }); } },
  work: { hash: w => `#/work/${w}` },
  me: { hash: () => '#/me' },
  live: { hash: () => '#/live', open: async p => { await camera(p); await p.locator('.live .pill', { hasText: '精选' }).click({ timeout: 15000 }); await p.waitForTimeout(800); }, chromiumOnly: true },
});
for (const [name, spec] of Object.entries(CRAWL)) {
  test(`每个按钮都能响应且无脚本错误 · ${name}`, async ({ page, browserName }) => {
    test.skip(!!spec.chromiumOnly && browserName !== 'chromium', '仅 Chromium 支持测试相机。');
    test.setTimeout(browserName === 'webkit' ? 1_200_000 : 600_000);
    const errors = /** @type {string[]} */ ([]);
    page.on('pageerror', e => errors.push(e.message));
    page.on('filechooser', fc => fc.setFiles('web/img/people/jun.webp').catch(() => {}));
    page.on('download', () => {});
    page.on('dialog', d => d.dismiss());
    await page.addInitScript(() => {
      /**
       * 按无障碍名称查找可见且启用的按钮；未命名时按 CSS 类与出现次序查找。
       * 按钮文字可能随选定风格、预计时间或新生成建议变化。
       */
      /** @type {any} */ (window).__buttons = () => {
        const seen = /** @type {Record<string, number>} */ ({});
        return [...document.querySelectorAll('.screen:not([hidden]) button:not([aria-current="page"])')].filter(b => {
          const r = b.getBoundingClientRect(), s = getComputedStyle(b);
          return r.width && r.height && !b.closest('[hidden], .prog') && s.visibility !== 'hidden' && s.opacity !== '0' && !(/** @type {HTMLButtonElement} */ (b).disabled) && r.bottom > 0 && r.top < innerHeight;
        }).map(b => {
          const aria = b.getAttribute('aria-label'), cls = String(b.className).split(' ')[0] || 'button';
          const base = aria ? 'a:' + aria : 'c:' + cls;
          const n = seen[base] = (seen[base] || 0) + 1;
          return { b, key: base + '#' + n, label: (aria || b.textContent || '').trim().slice(0, 14) || cls };
        });
      };
    });
    await useSample(page, 1);
    await make(page);
    const workId = await page.evaluate(async () => (await new Promise(r => { const q = indexedDB.open('hakishow'); q.onsuccess = () => { const t = q.result.transaction('records').objectStore('records').getAll(); t.onsuccess = () => r(t.result); }; })).find((/** @type {any} */ x) => x.coll === 'works' && !x.deleted).id);
    let loads = 0;
    const setup = async () => {
      const hash = spec.hash(workId);
      await page.goto(`/?skipintro&crawl=${++loads}${hash}`);
      await expect(page.locator('html')).toHaveAttribute('data-screen', hash.slice(2).split('/')[0]);
      await spec.open?.(page);
      await page.waitForTimeout(400);
    };
    const mark = (/** @type {string} */ key) => page.evaluate(k => {
      const x = /** @type {any} */ (window).__buttons().find((/** @type {any} */ x) => x.key === k);
      if (x) x.b.dataset.qa = 'next';
      return !!x;
    }, key);
    await setup();
    const found = await page.evaluate(() => /** @type {any} */ (window).__buttons().map((/** @type {any} */ x) => [x.key, x.label]));
    const keys = found.map((/** @type {string[]} */ x) => x[0]), labels = new Map(found);
    const report = /** @type {string[]} */ ([]);
    let ok = 0, dirty = false;
    // 与可能重绘的控件交互前，等待当前生成任务完成。
    const settle = () => page.waitForFunction(() => !document.querySelector('.screen:not([hidden]) [data-state="working"]'), null, { timeout: 30000 }).catch(() => {});
    for (const key of keys) {
      const label = labels.get(key) || key;
      if (dirty) { await setup(); dirty = false; }
      await settle();
      if (!(await mark(key))) { await setup(); if (!(await mark(key))) { report.push(`${name} · ${label}: missing after reopening`); continue; } }
      const before = await page.evaluate(() => { const w = /** @type {any} */ (window); w.__mut = 0; new MutationObserver(m => { w.__mut += m.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); return location.href; });
      let chooser = false;
      const fc = page.waitForEvent('filechooser', { timeout: 900 }).then(() => { chooser = true; }).catch(() => {});
      const tap = () => page.locator('[data-qa="next"]').click({ timeout: name === 'live' ? 15000 : 4000 });
      // 如果重绘替换了按钮，点击前重新定位它。
      await tap().catch(async () => { await settle(); if (await mark(key)) await tap(); else throw new Error('该按钮已不可用。'); }).catch(e => report.push(`${name} · ${label}: could not click (${e.message.split('\n')[0]})`));
      await fc;
      await page.waitForTimeout(name === 'live' ? 1500 : 250);
      const after = await page.evaluate(() => ({ href: location.href, mut: /** @type {any} */ (window).__mut, layer: !!document.querySelector('.sheet, .scrim') }));
      await page.evaluate(() => document.querySelector('[data-qa="next"]')?.removeAttribute('data-qa')).catch(() => {});
      if (after.href !== before || after.mut > 0 || chooser) ok++;
      else report.push(`${name} · ${label}: no feedback after clicking`);
      dirty = after.href !== before || after.layer || chooser;
    }
    console.log(`${name}: ${ok}/${keys.length} buttons responded (${loads} screen resets)`);
    expect(report).toEqual([]);
    expect(errors).toEqual([]);
  });
}

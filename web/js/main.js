/** HakiShow 启动顺序：1. 并行识别工作室与账户、加载资源清单、打开本地存储。2. 恢复作品、草稿和偏好，再应用上次的风格主题。3. 打开地址中的路由，保持刷新位置；首次访问时显示引导。4. 恢复页面关闭时仍在生成的作品。 */
import { connect, studio } from './core/api.js';
import { loadManifest } from './core/assets.js';
import { ready } from './core/db.js';
import { boot, pref, setPref, addSource, sources } from './core/data.js';
import { define, start, go, setRootPref } from './core/nav.js';
import { emit } from './core/bus.js';
import { applyTheme } from './core/theme.js';
import { resumeAll, create } from './core/generate.js';
import { personArt } from './core/assets.js';
import { presetById, defaultsOf } from './presets.js';
import { liveScreen } from './screens/live.js';
import { studioScreen } from './screens/studio.js';
import { resultScreen } from './screens/result.js';
import { galleryScreen } from './screens/gallery.js';
import { workScreen } from './screens/work.js';
import { meScreen } from './screens/me.js';
import { onboard } from './screens/onboard.js';
import { watchKeyboard } from './core/keyboard.js';

// 离开页面时，浏览器会取消人脸模型等未完成下载；Safari 会将这些取消操作报告为错误。
// 抑制导航导致的取消错误；如果页面仍保持打开，三秒后恢复正常错误报告。
let leaving = false;
const leave = () => { leaving = true; setTimeout(() => { leaving = false; }, 3000); };
addEventListener('pagehide', leave);
addEventListener('beforeunload', leave);
addEventListener('pageshow', () => { leaving = false; });
addEventListener('unhandledrejection', e => { if (leaving) e.preventDefault(); });
addEventListener('error', e => { if (leaving) e.preventDefault(); });
// 导航中断人脸模型下载时，加载器可能通过另一条路径重试，而页面卸载同样会阻止这次重试。
// 卸载期间，页面即将关闭，因此让模型下载失败保持待处理状态，不记录日志也不重试。
{
  const realFetch = window.fetch.bind(window);
  const hang = () => new Promise(() => {});
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/vendor/mediapipe/')) return realFetch(input, init);
    let res;
    try { res = await realFetch(input, init); } catch (err) { if (leaving) return hang(); throw err; }
    if (!res.body) return res;
    const reader = res.body.getReader();
    return new Response(new ReadableStream({
      async pull(ctrl) {
        try { const { done, value } = await reader.read(); if (done) ctrl.close(); else ctrl.enqueue(value); }
        catch (err) { if (leaving) return hang(); ctrl.error(err); }
      },
      cancel: reason => reader.cancel(reason),
    }), { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export async function startApplication() {
await Promise.all([connect(), loadManifest(), ready()]);
await boot();
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
watchKeyboard(stage);
applyTheme(pref('preset', 'princess'));

define('live', liveScreen);
define('studio', studioScreen);
define('result', resultScreen);
define('gallery', galleryScreen);
define('work', workScreen);
define('me', meScreen);
setRootPref(pref('root', 'live'));
addEventListener('hashchange', () => { const r = location.hash.replace(/^#\/?/, '').split('/')[0]; if (r === 'live' || r === 'studio') setPref('root', r); });

const first = !pref('onboarded', false) && !/(?:[?&])skipintro(?:[=&]|$)/.test(location.search);
start(first ? 'live' : pref('root', 'live'));
  if (first) {
  onboard({
    onShoot: () => { setPref('camAsked', true); go('live', {}, { replace: true }); emit('cam:start'); },
    onSample: async () => {
      // 一键示例：使用美和当前选中的风格创作肖像。
      const id = pref('preset', 'princess');
      const have = sources().find(s => s.sample === 'mei');
      const src = have || await addSource(await fetch(personArt('mei')).then(r => r.blob()), { sample: 'mei' });
      const p = /** @type {any} */ (presetById(id));
      const w = await create({ source: src.id, preset: id, params: defaultsOf(p), format: 'portrait', mode: 'live', why: '示例预览 · ' + p.name });
      go('result', { id: w.id });
    },
    onSkip: () => {},
  });
}
resumeAll().catch(() => {});

/** 缓存静态资源，加快再次访问。 */
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !navigator.webdriver) navigator.serviceWorker.register('sw.js').catch(() => {});

Object.assign(window, { hakishow: { studio, go } });
}

void startApplication();

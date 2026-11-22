/** 每个页面都有地址（#/studio、#/work/xxx 等），刷新后会恢复。手机手势、浏览器返回和应用内返回遵循相同历史。抽屉和对话框添加历史项，让返回优先关闭顶层。根页面共有两个：实时相机与照片工作室；二者之间切换会替换当前历史项。 */
import { stageEl, reduced } from './dom.js';
import { emit } from './bus.js';

/** @typedef {{ el: HTMLElement, shown?: (params: Record<string, string>) => void, hidden?: () => void, keep?: boolean }} Screen */
/** @type {Map<string, (params: Record<string, string>) => Screen>} */
const factories = new Map();
/** @type {Map<string, Screen>} */
const kept = new Map();
/** @type {{ name: string, params: Record<string, string>, screen: Screen } | null} */
let current = null;
/** @type {{ id: number, close: () => void }[]} */
const overlays = [];
let depth = 0;   // 本次会话压入的历史项数量，使返回操作不会离开应用
let overlaySeq = 0;
let swallow = 0;   // 通过弹层自身按钮关闭它时主动执行的后退步数；相应 popstate 不视为页面导航
/** @type {[string, Record<string, string>, { replace: boolean }] | null} */
let queued = null;   // 上述后退仍在进行时收到的 go() 请求，后退完成后立即执行

export const ROOTS = ['live', 'studio'];

export function define(/** @type {string} */ name, /** @type {(params: Record<string, string>) => Screen} */ make) { factories.set(name, make); }
export const here = () => current?.name || '';
export const params = () => current?.params || {};

/** #/work/abc → { name: 'work', params: { id: 'abc' } } */
function parse(hash = location.hash) {
  const [name, id] = hash.replace(/^#\/?/, '').split('/');
  const known = factories.has(name) ? name : '';
  return { name: known, params: id ? { id: decodeURIComponent(id) } : {} };
}
const hashOf = (/** @type {string} */ name, /** @type {Record<string, string>} */ p = {}) => '#/' + name + (p.id ? '/' + encodeURIComponent(p.id) : '');

/** 打开页面。replace 替换当前历史项，例如在两个根页面之间切换时。 */
export function go(/** @type {string} */ name, /** @type {Record<string, string>} */ p = {}, o = { replace: false }) {
  if (swallow > 0) { queued = [name, p, o]; return; }
  // 已打开弹层的历史项转为新页面的历史项，因此一次返回手势就能回到打开弹层的位置
  const fromOverlay = overlays.length > 0;
  closeOverlays();
  const swap = o.replace || (ROOTS.includes(name) && ROOTS.includes(here()));
  if (fromOverlay && !swap) { depth++; history.replaceState({ app: true, depth }, '', hashOf(name, p)); }
  else if (swap) history.replaceState({ app: true, depth }, '', hashOf(name, p));
  else { depth++; history.pushState({ app: true, depth }, '', hashOf(name, p)); }
  show(name, p);
}

/** 返回上一个页面；位于首个历史项时，返回根页面而不离开应用。 */
export function back(/** @type {string} */ fallback = '') {
  if (overlays.length) { history.back(); return; }
  if (depth > 0) { history.back(); return; }
  const root = fallback || lastRoot();
  history.replaceState({ app: true, depth: 0 }, '', hashOf(root));
  show(root, {});
}
let rootPref = 'live';
export const lastRoot = () => rootPref;
export function setRootPref(/** @type {string} */ r) { if (ROOTS.includes(r)) rootPref = r; }

function show(/** @type {string} */ name, /** @type {Record<string, string>} */ p) {
  const make = factories.get(name);
  if (!make) return;
  const prev = current;
  if (prev && prev.name === name && JSON.stringify(prev.params) === JSON.stringify(p)) { prev.screen.shown?.(p); return; }
  let screen = kept.get(name);
  if (!screen) {
    screen = make(p);
    if (screen.keep) kept.set(name, screen);
    stageEl().querySelector('.screens')?.append(screen.el);
  }
  if (ROOTS.includes(name)) rootPref = name;
  current = { name, params: p, screen };
  screen.el.hidden = false;
  screen.el.removeAttribute('inert');
  const forward = !prev || rank(name) >= rank(prev.name);
  if (!reduced) screen.el.animate(forward
    ? [{ opacity: 0, transform: 'translateY(14px) scale(.985)' }, { opacity: 1, transform: 'none' }]
    : [{ opacity: 0, transform: 'scale(1.015)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  screen.shown?.(p);
  if (prev && prev.screen !== screen) {
    prev.screen.hidden?.();
    if (prev.screen.keep) { prev.screen.el.hidden = true; prev.screen.el.setAttribute('inert', ''); }
    else prev.screen.el.remove();
  }
  document.documentElement.dataset.screen = name;
  emit('screen', name);
}
const rank = (/** @type {string} */ n) => ({ live: 0, studio: 0, gallery: 1, me: 1, result: 2, work: 2 })[n] ?? 1;

/** 抽屉或对话框占用一个历史项，让返回先关闭它，再进行页面导航。返回 dismiss()，用户按下关闭时调用。 @param {() => void} close 只关闭弹层一次。
 */
export function overlay(close) {
  const id = ++overlaySeq;
  overlays.push({ id, close });
  history.pushState({ app: true, depth, overlay: id }, '');
  // 立即关闭弹层，再移除其历史项，不等待界面更新。
  return () => {
    const i = overlays.findIndex(o => o.id === id);
    if (i < 0) return;
    overlays.splice(i, 1);
    close();
    swallow++;
    history.back();
  };
}
function closeOverlays() { while (overlays.length) overlays.pop()?.close(); }

window.addEventListener('popstate', () => {
  if (swallow > 0) {
    swallow--;
    if (!swallow && queued) { const q = queued; queued = null; go(...q); }
    return;
  }
  // 返回到同一页面会关闭顶层；地址变化则关闭所有弹层并导航。
  const to = parse();
  const same = !to.name || (current && to.name === current.name && JSON.stringify(to.params) === JSON.stringify(current.params));
  if (overlays.length && same) {
    const top = overlays.pop();
    top?.close();
    return;
  }
  if (overlays.length) closeOverlays();
  depth = Math.max(0, (history.state?.depth ?? depth - 1));
  const { name, params: p } = parse();
  show(name || rootPref, p);
});

/** 启动时恢复地址，或回退到根页面。 */
export function start(/** @type {string} */ fallback) {
  const { name, params: p } = parse();
  const first = name || fallback;
  history.replaceState({ app: true, depth: 0 }, '', hashOf(first, p));
  // 直接进入详情链接时，在其下方加入根历史项，让返回有可去的位置。
  if (!ROOTS.includes(first)) {
    history.replaceState({ app: true, depth: 0 }, '', hashOf(rootPref));
    history.pushState({ app: true, depth: 1 }, '', hashOf(first, p));
    depth = 1;
  }
  show(first, p);
}

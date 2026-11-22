/** 底部弹层带标题和固定关闭操作；可通过背景、Escape 或返回手势关闭。 */
import { h, iconBtn, stageEl, reduced } from '../core/dom.js';
import { overlay } from '../core/nav.js';

/** 弹层打开时，将焦点移到第一个输入框，除非内部已有其他输入框获得焦点。绝不重定向用户已经开始输入的文字。 */
export function focusSoon(/** @type {HTMLElement} */ el, ms = 120) {
  setTimeout(() => {
    const a = /** @type {HTMLElement | null} */ (document.activeElement), box = el.closest('.sheet');
    if (!el.isConnected || a === el) return;
    if (a && box?.contains(a) && !a.classList.contains('sheet__close')) return;
    el.focus({ preventScroll: true });
  }, ms);
}

/** 是否有弹层打开；Escape 优先关闭弹层。 */
export const sheetOpen = () => open.length > 0;
/**
 * @param {(close: () => void) => any[]} build
 * @param {{ title: string, cls?: string, onClose?: () => void, tall?: boolean }} o
 */
const open = /** @type {HTMLElement[]} */ ([]);
export function sheet(build, o) {
  let gone = false;
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape' && open.at(-1) === panel) { e.preventDefault(); dismiss(); } };
  const remove = () => {
    if (gone) return; gone = true;
    document.removeEventListener('keydown', onKey);
    open.splice(open.indexOf(panel), 1);
    panel.classList.remove('is-in'); scrim.classList.remove('is-in');
    setTimeout(() => { panel.remove(); scrim.remove(); }, reduced ? 0 : 260);
    o.onClose?.();
  };
  const dismiss = overlay(remove);
  const scrim = h('div.scrim', { onclick: () => dismiss() });
  const panel = h('section.sheet' + (o.cls ? '.' + o.cls : '') + (o.tall ? '.sheet--tall' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h('div.sheet__grip', { 'aria-hidden': 'true' }),
    h('header.sheet__head', null, h('h2.sheet__title', null, o.title), iconBtn('close', '关闭', () => dismiss(), 'sheet__close')),
    h('div.sheet__body', null, ...build(() => dismiss())));
  stageEl().append(scrim, panel);
  open.push(panel);
  requestAnimationFrame(() => { scrim.classList.add('is-in'); panel.classList.add('is-in'); });
  document.addEventListener('keydown', onKey);
  // 对键盘和屏幕阅读器用户，初始焦点设在关闭按钮，除非弹层内已有元素获得焦点。
  setTimeout(() => { if (!panel.contains(document.activeElement)) /** @type {HTMLElement | null} */ (panel.querySelector('.sheet__close'))?.focus({ preventScroll: true }); }, 60);
  return { close: () => dismiss(), panel };
}

/** 解释操作结果的双操作确认对话框。 @returns {Promise<boolean>} */
export function confirmBox(/** @type {string} */ title, /** @type {string} */ text, ok = '确认', cancel = '取消') {
  return new Promise(resolve => {
    let answered = false;
    const { close } = sheet(c => [
      h('p.sheet__text', null, text),
      h('div.sheet__acts', null,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { answered = true; resolve(false); c(); } }, cancel),
        h('button.btn.btn--main', { type: 'button', onclick: () => { answered = true; resolve(true); c(); } }, ok)),
    ], { title, cls: 'sheet--confirm', onClose: () => { if (!answered) resolve(false); } });
    void close;
  });
}

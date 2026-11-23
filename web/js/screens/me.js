/** 个人中心：账户与私人空间。访客可以在设备上保存，也可同步到访客空间；注册会升级该空间。登录已有账户时合并访客作品。还包括画质、引导和隐私控制。 */
import { h, icon, toast, chooseFile } from '../core/dom.js';
import { go } from '../core/nav.js';
import { on } from '../core/bus.js';
import { studio, signup, login, logout, rename, me as fetchMe } from '../core/api.js';
import { works, favs, pref, setPref, resultUrl, switchAccount, sync, exportBackup, importBackup } from '../core/data.js';
import { download } from '../core/image.js';
import { persisted, durable } from '../core/db.js';
import { topBar } from '../ui/parts.js';
import { resetTours } from '../ui/tour.js';
import { sheet, focusSoon } from '../ui/sheet.js';
import { T } from '../copy.js';

export function meScreen() {
  const body = h('div.me__scroll');
  const el = h('section.screen.me', { 'aria-label': T.me }, topBar(T.me), body);

  async function paint() {
    const a = studio.account;
    const member = a?.kind === 'member';
    const all = works(), done = all.filter(w => w.state === 'done');
    const face = h('span.me__face', { html: icon('user') });
    if (done[0]) resultUrl(done[0]).then(u => { if (u) face.replaceChildren(h('img', { src: u, alt: '' })); });
    const safe = await persisted();
    const card = h('div.me__card', null, face,
      h('div.me__who', null,
        h('b.me__name', null, member ? (a.nickname || a.handle) : T.guest),
        h('span.me__handle', null, member ? '@' + a.handle : studio.live ? '访客空间' : '本地演示'),
        h('p.me__line', null, !studio.live ? T.offlineAccount : member ? T.memberLine : T.guestLine)));
    const authActs = !studio.live ? null : member
      ? h('div.me__acts', null, h('button.btn.btn--ghost', { type: 'button', onclick: () => renameBox() }, '修改显示名称'), h('button.btn.btn--ghost', { type: 'button', onclick: () => doLogout() }, h('span', { html: icon('logout') }), T.signOut))
      : h('div.me__acts', null, h('button.btn.btn--main', { type: 'button', onclick: () => authBox('signup') }, T.signUp), h('button.btn.btn--ghost', { type: 'button', onclick: () => authBox('login') }, T.signIn));
    const stats = h('ul.me__stats', null,
      stat(all.length, '作品', () => go('gallery')), stat(favs().length, '收藏的风格', () => { sessionStorage.setItem('hakishow.galleryTab', 'favs'); go('gallery'); }),
      stat(all.reduce((n, w) => n + (w.trail?.length || 0), 0), '活动记录', () => go('gallery')));
    const paceNow = pref('pace', 'fine');
    const paceSeg = h('div.seg.seg--sm', { role: 'radiogroup', 'aria-label': '画质' }, ...['quick', 'fine', 'deep'].map(k => h('button.seg__opt', { type: 'button', role: 'radio', 'aria-checked': String(k === paceNow), onclick: () => { setPref('pace', k); toast(T.pace[/** @type {'fine'} */ (k)] + ' · ' + T.paceLine[/** @type {'fine'} */ (k)]); paint(); } }, T.pace[/** @type {'fine'} */ (k)])));
    const taste = String(pref('taste', '') || '');
    const rows = h('div.me__rows', null,
      studio.live ? row('bolt', '图片画质', paceSeg) : null,
      h('button.me__row', { type: 'button', onclick: () => tasteBox() }, h('span.me__rowico', { html: icon('heart') }), h('span.me__rowname', null, '我的偏好'), h('span.me__val', null, taste || '未设置'), h('span', { html: icon('chevron') })),
      row('file', '备份', h('span.me__pair', null,
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => backupNow() }, '导出'),
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => restore() }, '导入'))),
      row('shield', '存储', h('span.me__note', null, !durable ? '本地存储不可用，请在关闭此页面前导出作品。' : safe ? '已启用持久存储，防止作品被自动清理。' : studio.live ? '此设备 + 私人空间同步' : '保存在此设备上')),
      h('button.me__row', { type: 'button', onclick: () => { setPref('onboarded', false); go('live'); location.reload(); } }, h('span.me__rowico', { html: icon('sparkle') }), h('span.me__rowname', null, '重新查看介绍'), h('span', { html: icon('chevron') })),
      h('button.me__row', { type: 'button', onclick: () => { resetTours(); setPref('coached', false); toast('新手教程已重新打开：跟着高亮提示一步一步来。', { tone: 'ok' }); go('live'); } }, h('span.me__rowico', { html: icon('hand') }), h('span.me__rowname', null, '新手教程'), h('span', { html: icon('chevron') })),
      h('button.me__row', { type: 'button', onclick: () => privacy() }, h('span.me__rowico', { html: icon('lock') }), h('span.me__rowname', null, '隐私'), h('span', { html: icon('chevron') })));
    body.replaceChildren(...[card, authActs, stats, rows, h('p.me__foot', null, T.brand + ' · ' + T.slogan)].filter(Boolean));
  }
  const stat = (/** @type {number} */ n, /** @type {string} */ label, /** @type {() => void} */ run) => h('li', null, h('button', { type: 'button', onclick: run }, h('b', null, String(n)), h('span', null, label)));
  const row = (/** @type {any} */ ic, /** @type {string} */ name, /** @type {any} */ right) => h('div.me__row', null, h('span.me__rowico', { html: icon(ic) }), h('span.me__rowname', null, name), right);

  /** 注册与登录表单靠近顶部，确保在键盘上方保持可见。 */
  function authBox(/** @type {'signup' | 'login'} */ mode) {
    const handle = /** @type {HTMLInputElement} */ (h('input.field__input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 20, placeholder: T.handleHint, enterkeyhint: 'next' }));
    const pw = /** @type {HTMLInputElement} */ (h('input.field__input', { type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', maxlength: 64, placeholder: T.pwHint, enterkeyhint: mode === 'signup' ? 'next' : 'go' }));
    const nick = /** @type {HTMLInputElement} */ (h('input.field__input', { type: 'text', maxlength: 24, placeholder: '我们该如何称呼你？（选填）', enterkeyhint: 'go' }));
    const err = h('p.field__err', { role: 'alert' });
    const submit = h('button.btn.btn--main.btn--wide', { type: 'submit' }, mode === 'signup' ? T.signUp : T.signIn);
    const form = h('form.auth', { onsubmit: async (/** @type {Event} */ e) => {
      e.preventDefault(); err.textContent = ''; submit.setAttribute('disabled', '');
      try {
        await sync().catch(() => {});   // 登录前同步访客作品，让服务器可以将其合并到账户。
        if (mode === 'signup') {
          const r = await signup({ handle: handle.value, password: pw.value, nickname: nick.value });
          await switchAccount(r.account, { keepLocal: true });
          toast(T.joined, { tone: 'ok' });
        } else {
          const r = await login({ handle: handle.value, password: pw.value });
          await switchAccount(r.account, { keepLocal: true });
          toast(r.moved ? T.merged(r.moved) : T.welcomeBack, { tone: 'ok' });
        }
        close(); paint();
      } catch (x) { err.textContent = /** @type {any} */ (x)?.message || '未能完成，请重试。'; }
      finally { submit.removeAttribute('disabled'); }
    } },
    h('label.field', null, h('span.field__name', null, T.handle), handle),
    h('label.field', null, h('span.field__name', null, T.password), pw),
    mode === 'signup' ? h('label.field', null, h('span.field__name', null, T.nickname), nick) : null,
    err, submit,
    h('p.auth__note', null, mode === 'signup' ? '你当前的作品和活动记录将移入新账户。' : '登录后，此设备上的访客作品将加入你的账户。'),
    h('button.auth__switch', { type: 'button', onclick: () => { close(); setTimeout(() => authBox(mode === 'signup' ? 'login' : 'signup'), 280); } }, mode === 'signup' ? '已有账户？立即登录' : '第一次来？注册账户'));
    const { close } = sheet(() => [form], { title: mode === 'signup' ? '加入 HakiShow' : '登录 HakiShow', cls: 'sheet--top' });
    focusSoon(handle);
  }
  /** 每次创作请求都会包含的个人偏好。 */
  function tasteBox() {
    const field = /** @type {HTMLTextAreaElement} */ (h('textarea.say__field', { rows: 3, maxlength: 200, placeholder: '例如：保留雀斑、保留肤色、遮住肩膀、保持头巾不变', 'aria-label': '我的偏好', enterkeyhint: 'done' }));
    field.value = String(pref('taste', '') || '');
    const { close } = sheet(c => [
      h('p.sheet__text', null, '这些偏好会应用于每次创作，除非你对某张图片给出不同指令。'),
      field,
      h('div.sheet__acts', null,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { setPref('taste', ''); c(); paint(); toast('偏好已清空'); } }, '清空'),
        h('button.btn.btn--main', { type: 'button', onclick: () => { setPref('taste', field.value.trim().slice(0, 200)); c(); paint(); toast('已保存，今后的创作会采用这些偏好。', { tone: 'ok' }); } }, '保存偏好'))], { title: '我的偏好', cls: 'sheet--top' });
    void close;
    focusSoon(field);
  }
  /** 用一个文件备份私人空间：作品、原始照片、收藏、草稿、偏好和自定义风格。 */
  async function backupNow() {
    toast('正在准备备份……');
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      await download(url, 'hakishow-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('备份已就绪：' + Math.max(1, Math.round(blob.size / 1024 / 1024)) + ' 兆字节。将此文件导入另一台设备，即可恢复作品。', { tone: 'ok', ms: 3600 });
    } catch (e) { toast(/** @type {any} */ (e)?.message || '备份未完成，请重试。'); }
  }
  async function restore() {
    const f = await chooseFile({ accept: 'application/json,.json' });
    if (!f) return;
    try { const n = await importBackup(f); toast(n ? '已恢复' + n + ' 条记录' : '所有内容都已存在。', { tone: 'ok' }); paint(); }
    catch (e) { toast(/** @type {any} */ (e)?.message || '无法读取此文件。'); }
  }
  function renameBox() {
    const field = /** @type {HTMLInputElement} */ (h('input.field__input', { type: 'text', maxlength: 24, value: studio.account?.nickname || '', enterkeyhint: 'done' }));
    const { close } = sheet(c => [h('label.field', null, h('span.field__name', null, T.nickname), field), h('div.sheet__acts', null, h('button.btn.btn--main', { type: 'button', onclick: async () => {
      try { const r = await rename(field.value); studio.account = r.account; c(); paint(); toast('已更新'); } catch (e) { toast(/** @type {any} */ (e)?.message || '无法保存更改。'); }
    } }, T.done))], { title: '修改显示名称', cls: 'sheet--top' });
    void close;
    focusSoon(field);
  }
  async function doLogout() {
    await sync().catch(() => {});
    await logout().catch(() => {});
    const r = await fetchMe().catch(() => null);   // 开始新的访客会话。
    await switchAccount(r?.account || null);
    toast('已退出登录，你的作品仍保留在账户中。');
    paint();
  }
  function privacy() {
    sheet(() => [h('div.prose', null,
      h('p', null, '📷 实时相机预览与人脸跟踪均在你的设备本地运行。'),
      h('p', null, '🖼️ 只有在拍照或选择“开始创作”时，照片才会上传到你的工作室私人空间，其他账户无法访问。'),
      h('p', null, '🔒 每个账户（包括访客）均有独立空间，用于存放作品、原始照片、收藏和活动记录。'),
      h('p', null, '🗑️ 你可以随时在作品详情页删除作品。'))], { title: '隐私' });
  }
  const offs = [on('account', () => { if (el.isConnected) paint(); }), on('works', () => { if (el.isConnected) paint(); })];
  return { el, shown: () => paint(), hidden: () => offs.forEach(f => f()) };
}

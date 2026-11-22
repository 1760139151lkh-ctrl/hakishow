/** 对话编辑会根据每条指令，从当前显示图片构建一个新版本。工作室回复图片和三个后续建议；对话同时也是可选择的版本历史。输入区位于键盘上方，不移动页面；按 Enter 发送，输入框最多增长为四行。参考图可引导造型或风格、提供背景或添加主体。快捷操作：变体、角度、更换背景和清理。保留对话编辑、回复、建议、参考用途、角度组与变体。 */
import { h, icon, toast, chooseFile, reduced } from '../core/dom.js';
import { chainOf, resultUrl, draft, saveDraft } from '../core/data.js';
import { isRunning, retry, watch } from '../core/generate.js';
import { prepare } from '../core/image.js';
import { etaText, opLabel } from '../ui/parts.js';
import { presetById } from '../presets.js';

/** @typedef {import('../core/data.js').Work} Work */
const ROLES = /** @type {const} */ ([['look', '参考造型'], ['style', '参考风格'], ['backdrop', '背景布景'], ['with', '添加主体']]);
const STARTERS = ['将背景改为海边日落', '添加几颗闪亮的星星', '给我一个灿烂的笑容', '将服装改成白色西装', '让头发长一点', '让整张图片更加梦幻', '在我的肩膀上加一只小猫', '使用霓虹夜景'];

export function chatPanel(/** @type {any} */ ctx) {
  /** @type {{ blob: Blob, url: string, role: string } | null} */ let ref = null;
  let open = false, unwatch = () => {};
  const thread = h('div.chat__thread', { role: 'log', 'aria-label': '对话记录' });
  const qbtn = (/** @type {string} */ label, /** @type {string} */ ico, /** @type {() => void} */ run) => h('button.chat__q', { type: 'button', onclick: run }, h('span', { html: icon(/** @type {any} */ (ico)) }), h('span', null, label));
  const quick = h('div.chat__quick', { role: 'group', 'aria-label': '快捷操作' },
    qbtn('变体', 'layers', () => vary()), qbtn('角度', 'rotate', () => angles()),
    qbtn('背景', 'image', () => fill('将背景改为')), qbtn('清理', 'eraser', () => fill('移除背景中的路人和杂物')));
  const ideas = h('div.chat__ideas', { role: 'group', 'aria-label': '继续探索' });
  const field = /** @type {HTMLTextAreaElement} */ (h('textarea.chat__field', { rows: 1, maxlength: 400, placeholder: '描述你想做的更改……', 'aria-label': '描述编辑要求', enterkeyhint: 'send' }));
  const attach = h('button.chat__attach', { type: 'button', 'aria-label': '添加参考图', title: '添加参考图', html: icon('image'), onclick: () => addRef() });
  const send = h('button.chat__send', { type: 'button', 'aria-label': '发送', title: '发送', html: icon('send'), onclick: () => submit() });
  const refBar = h('div.chat__ref', { hidden: true });
  const hint = h('p.chat__hint');
  const composer = h('div.chat__composer', null, refBar, ideas, h('div.chat__row', null, attach, field, send), hint);
  const body = h('div.tp.tp--split.chat', null, thread, quick);

  field.value = draft('chat')?.text || '';
  const grow = () => { field.style.height = 'auto'; field.style.height = Math.min(field.scrollHeight, 4 * 24 + 18) + 'px'; };
  field.addEventListener('input', () => { grow(); paintSend(); saveDraft('chat', { text: field.value }); });
  field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });

  function paintSend() {
    const ok = !!field.value.trim();
    send.toggleAttribute('disabled', !ok);
    send.classList.toggle('is-ready', ok);
    const w = ctx.shownWork();
    hint.textContent = (w && w.state === 'done' ? '正在编辑' + opLabel(w) + '版本' : w ? '正在编辑上一个版本' : '正在编辑原始照片') + ' · ' + etaText();
  }
  function fill(/** @type {string} */ text) {
    field.value = text; grow(); paintSend(); saveDraft('chat', { text });
    send.classList.remove('is-pulse'); void send.offsetWidth; send.classList.add('is-pulse');
    if (text.endsWith('为')) { field.focus({ preventScroll: true }); field.setSelectionRange(text.length, text.length); }
  }

  // ── 对话历史：每个版本配对显示指令、工作室回复和缩略图。──
  function paintThread() {
    const src = ctx.sourceObj(); if (!src) { thread.replaceChildren(); return; }
    /** @type {Work[][]} */ const groups = [];
    for (const w of chainOf(src.id).slice(-36)) {
      const last = groups.at(-1);
      if (w.batch && last && last[0].batch === w.batch) last.push(w); else groups.push([w]);
    }
    const kids = [h('div.msg.msg--sys', null, '这张照片的每次编辑都会显示在这里，选择缩略图即可从相应版本继续创作。')];
    for (const g of groups) {
      const w = g[0];
      kids.push(h('div.msg.msg--me', null, h('p', null, saidOf(w))));
      const thumbs = g.map(x => {
        const busy = x.state === 'working' || isRunning(x.id);
        const b = h('button.msg__thumb', { type: 'button', 'aria-pressed': String(x.id === ctx.S.shown), data: { state: busy ? 'working' : x.state }, 'aria-label': '查看此版本',
          // 选择其他版本进行切换；选择当前版本则收起面板，并以完整尺寸查看。
          onclick: () => (x.id === ctx.S.shown ? ctx.closePanel() : ctx.showVersion(x.id)) }, h('img', { alt: '' }));
        if (x.state === 'done') resultUrl(x).then(u => { /** @type {HTMLImageElement} */ (b.querySelector('img')).src = u; });
        return b;
      });
      const busy = g.some(x => x.state === 'working' || isRunning(x.id)), failed = g.every(x => x.state === 'failed' || x.state === 'stopped');
      const words = busy ? (g.length > 1 ? `正在创作 ${g.length} 张图片……` : '明白，正在更新图片……') : failed ? (w.error || '本次尝试未能完成。') : (w.reply || '完成啦，看看效果怎么样！');
      kids.push(h('div.msg.msg--ai' + (failed ? '.is-failed' : ''), null,
        h('div.msg__thumbs', { data: { n: String(g.length) } }, ...thumbs),
        h('p', null, words),
        failed ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { for (const x of g) retry(x); paintThread(); } }, h('span', { html: icon('refresh') }), '重试') : null));
    }
    thread.replaceChildren(...kids);
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    paintIdeas();
  }
  /** 以其创作请求的口吻描述一个版本。 */
  function saidOf(/** @type {Work} */ w) {
    if (w.say) return w.say;
    if (w.op === 'region') return '编辑区域：' + (w.parts || []).join(', ');
    if (w.op === 'vary') return '变体';
    if (w.op === 'angles') return '展示几个不同角度';
    return '创作肖像，采用' + (presetById(w.preset)?.name || '') + '';
  }
  function paintIdeas() {
    const src = ctx.sourceObj();
    const lastDone = src ? chainOf(src.id).filter(w => w.state === 'done' && w.ideas?.length).at(-1) : null;
    const list = lastDone?.ideas?.length ? lastDone.ideas : pickStarters();
    ideas.replaceChildren(h('span.chat__ideaslabel', null, lastDone?.ideas?.length ? '继续探索' : '试试这个'), ...list.slice(0, 3).map(t => h('button.chip2.chip2--idea', { type: 'button', onclick: () => fill(t) }, t)));
  }
  let starters = /** @type {string[]} */ ([]);
  function pickStarters() {
    if (!starters.length) starters = [...STARTERS].sort(() => Math.random() - .5).slice(0, 3);
    return starters;
  }

  // ── 参考图片 ──
  async function addRef() {
    const f = await chooseFile(); if (!f) return;
    try {
      const { blob } = await prepare(f, 1024);
      if (ref) URL.revokeObjectURL(ref.url);
      ref = { blob, url: URL.createObjectURL(blob), role: 'look' };
      paintRef();
    } catch { toast('无法打开这张图片，请换一张照片。'); }
  }
  function paintRef() {
    refBar.hidden = !ref;
    if (!ref) { refBar.replaceChildren(); return; }
    const r = ref;
    refBar.replaceChildren(h('img', { src: r.url, alt: '参考图片' }),
      h('div.chat__roles', { role: 'radiogroup', 'aria-label': '参考用途' }, ...ROLES.map(([id, label]) => h('button.chip2', { type: 'button', role: 'radio', 'aria-checked': String(r.role === id), onclick: () => { r.role = id; paintRef(); } }, label))),
      h('button.ibtn.chat__unref', { type: 'button', 'aria-label': '移除参考图', html: icon('close'), onclick: () => { URL.revokeObjectURL(r.url); ref = null; paintRef(); } }));
  }

  // ── 发送请求 ──
  async function submit() {
    const words = field.value.trim();
    if (!words) { field.focus({ preventScroll: true }); return; }
    const base = ctx.shownWork(), styled = !!base && base.state === 'done';
    const text = words + (styled ? '\n（保持图片当前的艺术风格、色板和光线，除非文字要求另有说明。）' : '');
    const refs = ref ? [{ blob: ref.blob, role: ref.role, label: ROLES.find(r => r[0] === ref?.role)?.[1] || '参考图片' }] : [];
    field.value = ''; grow(); saveDraft('chat', { text: '' }); paintSend();
    if (ref) { URL.revokeObjectURL(ref.url); ref = null; paintRef(); }
    field.blur();
    const w = await ctx.ask({ op: 'edit', text, say: words, label: '对话：' + (words.length > 14 ? words.slice(0, 14) + '…' : words), refs });
    if (!w) { field.value = words; grow(); paintSend(); return; }
    starters = [];
    paintThread(); follow(w);
  }
  async function vary() {
    const base = ctx.shownWork();
    if (!base || base.state !== 'done') { toast('请先创作一张图片，再探索变体。'); return; }
    const w = await ctx.ask({ op: 'vary', n: 3, text: '', say: '变体', label: '变体' });
    if (w) { paintThread(); follow(w); }
  }
  async function angles() {
    const base = ctx.shownWork();
    if (!base || base.state !== 'done') { toast('请先创作一张图片，再探索其他角度。'); return; }
    const w = await ctx.ask({ op: 'angles', n: 3, text: '', say: '展示几个不同角度', label: '角度' });
    if (w) { paintThread(); follow(w); }
  }
  /** 在对话中显示实时进度，完成后替换为缩略图和回复。 */
  function follow(/** @type {Work} */ w) {
    unwatch();
    let last = '';
    unwatch = watch(w.id, (_p, ww) => { if (!open) return; if (ww.state !== last) { last = ww.state; if (ww.state !== 'working') paintThread(); } });
  }
  void reduced;

  return {
    body, foot: composer,
    shown() { open = true; paintThread(); paintRef(); paintSend(); requestAnimationFrame(grow); },
    hidden() { open = false; unwatch(); if (document.activeElement === field) field.blur(); },
    repaint() { if (open) { paintThread(); paintSend(); } },
    paintCta() { if (open) paintSend(); },
  };
}

/** 工作室接口：连接与账户状态、上传、创作请求、进度、取消和记录同步。没有服务器时，静态演示仍可交互：示例肖像使用预先准备的作品，上传照片则生成本地滤镜预览。 */
const state = /** @type {{ mode: 'showcase' | 'simulator' | 'live', info: any, account: any }} */ ({ mode: 'showcase', info: null, account: null });
export const studio = {
  get mode() { return state.mode; },
  get live() { return state.mode !== 'showcase'; },
  get info() { return state.info; },
  get account() { return state.account; },
  set account(a) { state.account = a; },
  /** 每个画质等级的预计时长，单位为毫秒。 */
  eta(/** @type {string} */ pace) { return state.info?.portraitEta?.[pace] || ({ quick: 8000, fine: 10000, deep: 32000 })[pace] || 10000; },
};

export async function connect() {
  try {
    const inline = document.getElementById('studio-state');
    const info = inline ? JSON.parse(inline.textContent || 'null')
      : await fetch('studio.json', { cache: 'no-store', signal: AbortSignal.timeout(2500) }).then(r => (r.ok ? r.json() : null));
    if (info?.edition === 'live' && info.engine) {
      state.mode = info.engine.kind === 'simulator' ? 'simulator' : 'live';
      state.info = info;
      state.account = info.account || null;
      if (!state.account) state.account = (await me().catch(() => null))?.account || null;
    }
  } catch { /* 没有可用服务器：使用演示模式。 */ }
  document.documentElement.dataset.mode = state.mode;
  return studio;
}

/** @param {Response} res */
async function json(res) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  const said = typeof body?.detail === 'string' ? body.detail : '';
  throw Object.assign(new Error(said || friendly(res.status)), { status: res.status, hint: body?.hint || '' });
}
const friendly = (/** @type {number} */ s) => s === 429 ? '队列繁忙，请稍后几秒再试。' : s >= 500 ? '工作室暂时不可用，请重试。' : s === 401 ? '你的会话已过期，请刷新页面。' : '连接中断，请重试。';
const post = (/** @type {string} */ path, /** @type {any} */ body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json);

// ── 账户 ──
export const me = () => fetch('api/me', { cache: 'no-store' }).then(json);
export const signup = (/** @type {{ handle: string, password: string, nickname?: string }} */ b) => post('api/auth/signup', b);
export const login = (/** @type {{ handle: string, password: string }} */ b) => post('api/auth/login', b);
export const logout = () => post('api/auth/logout', {});
export const rename = (/** @type {string} */ nickname) => post('api/auth/profile', { nickname });

// ── 同步 ──
export const pull = (/** @type {number} */ cursor) => fetch('api/sync?cursor=' + cursor, { cache: 'no-store' }).then(json);
export const push = (/** @type {any[]} */ records) => post('api/sync', { records });

// ── 图片 ──
/** 上传图片或蒙版到私人空间。 @param {Blob} blob @param {'image' | 'mask'} kind @returns {Promise<{ id: string, url: string, w: number, h: number }>} */
export async function uploadBlob(blob, kind = 'image') {
  const form = new FormData();
  form.append('file', blob, kind === 'mask' ? 'mask.png' : 'photo.jpg'); form.append('kind', kind);
  for (let attempt = 0; ; attempt++) {
    try { return await fetch('api/assets', { method: 'POST', body: form }).then(json); }
    catch (e) { if (attempt >= 2 || (e.status && e.status < 500)) throw e; await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
  }
}
/** 上传照片。 @param {Blob} blob */
export const upload = (blob) => uploadBlob(blob, 'image');
export const fetchBlob = (/** @type {string} */ url) => fetch(url).then(r => { if (!r.ok) throw new Error('图片下载失败，请重试。'); return r.blob(); });

// ── 生成 ──
/** 提交风格、区域、对话、变体或角度请求。返回 { job, eta }；以相同标识重试具有幂等性。 @param {Record<string, any> & { id: string }} body
 */
export async function sendTurn(body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch('api/turns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).then(json);
    } catch (e) {
      if (attempt >= 2 || (e.status && ![429, 502, 503, 504].includes(e.status))) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
/** 根据描述、参考图片或二者共同创建新风格。 @param {{ text: string, asset?: string }} b */
export const inventStyle = (b) => post('api/styles', b);
export const cancelJob = (/** @type {string} */ job) => fetch(`api/jobs/${job}/cancel`, { method: 'POST' }).catch(() => {});

/** 通过服务器发送事件跟踪任务，流式连接不可用时退回轮询。产出 { type: 'stage' | 'plan' | 'partial' | 'result' | 'reply' | 'done', ... }；失败时抛出异常。 @param {string} job @param {{ signal?: AbortSignal }} [o]
 */
export async function* follow(job, o = {}) {
  const queue = /** @type {any[]} */ ([]);
  let wake = () => {}, finished = false, seen = 0, polling = false;
  const push = (/** @type {any} */ ev) => { queue.push(ev); wake(); };
  const poll = async () => {
    polling = true;
    while (!finished) {
      const res = await fetch(`api/jobs/${job}`, { cache: 'no-store' }).catch(() => null);
      if (res?.status === 404) { push({ type: 'failed', message: '图片完成前工作室已重新启动。', hint: '选择“重试”重新创作。' }); return; }
      const st = res?.ok ? await res.json().catch(() => null) : null;
      if (st) { st.events.slice(seen).forEach(push); seen = st.events.length; }
      await new Promise(r => setTimeout(r, 600));
    }
  };
  let source = /** @type {EventSource | null} */ (null);
  const usePoll = studio.info?.events === 'poll';
  if (usePoll) poll();
  else {
    try {
      source = new EventSource(`api/jobs/${job}/events`);
      for (const type of ['stage', 'plan', 'note', 'progress', 'partial', 'result', 'reply', 'done', 'failed']) {
        source.addEventListener(type, e => { seen++; push({ type, ...JSON.parse(/** @type {MessageEvent} */ (e).data) }); });
      }
      source.onerror = () => { source?.close(); if (!finished && !polling) poll(); };
    } catch { poll(); }
  }
  o.signal?.addEventListener('abort', () => push({ type: 'failed', cancelled: true, message: '已取消' }));
  try {
    while (true) {
      while (queue.length) {
        const ev = queue.shift();
        if (ev.type === 'failed') throw Object.assign(new Error(ev.message || '本次尝试未能完成。'), { hint: ev.hint || '', cancelled: !!ev.cancelled });
        yield ev;
        if (ev.type === 'done') return;
      }
      await new Promise(r => { wake = () => r(undefined); });
    }
  } finally { finished = true; source?.close(); }
}

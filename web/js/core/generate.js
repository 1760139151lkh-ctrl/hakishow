/** 同一条生成流水线服务于相机肖像、上传照片、区域编辑、对话编辑、变体和新角度。开始前：立即保存处理中记录，并上传请求所需的原图、蒙版和参考图。过程中：显示三个进度阶段和预计时长，请求可取消。结束后：在本地与私人空间保存图片，用可重试操作说明失败原因，并附上回复及三个后续编辑建议。重新打开时连接未完成的服务器任务，不创建重复请求。操作：restyle 重新绘制整张图片（默认）；region 编辑标记区域并保留蒙版外的像素；edit 按请求修改图片；vary 制作更多版本；angles 展示新的视角。 */
import { studio, sendTurn, follow, cancelJob, fetchBlob, uploadBlob } from './api.js';
import { work as workById, works, saveWork, setResult, note, source as sourceById, ensureUploaded, forgetUpload, sourceBlob, pref, workBlob } from './data.js';
import { presetById, promptFor, captionOf } from '../presets.js';
import { hasArt, styleArt } from './assets.js';
import { emit } from './bus.js';
import { uid, sleep } from './dom.js';
import { T } from '../copy.js';

/** @typedef {import('./data.js').Work} Work */
/** @typedef {{ stage: number, value: number, text: string, partial?: string, eta: number, started: number, got: number, of: number }} Progress */
/** @typedef {'restyle' | 'region' | 'edit' | 'vary' | 'angles'} Op */
/**
 * @typedef {{ source: string, preset: string, params: any, format: Work['format'], mode: Work['mode'], op?: Op, base?: string, n?: number,
 *   text?: string, pins?: { note: string, mask: Blob }[], refs?: { blob?: Blob, source?: string, role: string, label?: string }[],
 *   say?: string, parts?: string[], parent?: string, why?: string, trail?: import('./data.js').Step['kind'], pace?: string }} Ask
 */

/** 每个请求对应一个执行器，可能生成多张图片；任何页面都可以重新连接其进度。 */
const running = new Map();

const aspectOf = (/** @type {string} */ format) => (format === 'portrait' ? 'portrait' : format === 'avatar' ? 'square' : undefined);

/** 创建作品记录并启动生成。多图片请求共用一个批次，各自拥有独立索引。返回第一条记录。 @param {Ask} o @returns {Promise<Work>}
 */
export async function create(o) {
  const op = o.op || 'restyle';
  const p = presetById(o.preset);
  if (!p) throw new Error('未知风格');
  const n = Math.max(1, Math.min(4, o.n || 1));
  const now = Date.now(), batch = n > 1 ? uid('b') : '';
  const pace = o.pace || pref('pace', 'fine');
  const text = o.text ?? promptFor(p, o.params, { format: o.format === 'portrait' ? 'portrait' : 'avatar' });
  /** @type {Work[]} */
  const list = [];
  for (let i = 0; i < n; i++) {
    /** @type {Work} */
    const w = {
      id: uid('w'), preset: o.preset, params: { ...o.params, details: [...(o.params?.details || [])] }, format: o.format, source: o.source, mode: o.mode, op,
      state: 'working', kind: studio.mode === 'live' ? 'render' : studio.mode === 'simulator' ? 'simulated' : 'preview', createdAt: now + i, updatedAt: now + i, trail: [],
      prompt: text, pace, ...(o.base ? { base: o.base } : {}), ...(batch ? { batch, index: i } : {}), ...(o.say ? { say: o.say } : {}), ...(o.parts?.length ? { parts: o.parts } : {}),
      ...(o.refs?.length ? { refs: o.refs.map(r => r.label || r.role) } : {}), ...(o.parent ? { parent: o.parent } : {}),
    };
    note(w, o.trail || (op === 'restyle' ? 'make' : op === 'edit' ? 'say' : op === 'region' ? 'tweak' : 'make'), o.why || (o.mode === 'live' ? '实时相机 · ' : '') + captionOf(p, o.params), o.preset);
    list.push(w);
  }
  for (const w of list) await saveWork(w);
  run(list, { ...o, op, n, text, pace });
  return list[0];
}

/** 以相同请求和新的提交标识，重试失败或已取消的作品。 */
export function retry(/** @type {Work} */ w) {
  w.attempt = (w.attempt || 0) + 1;
  w.state = 'working'; delete w.error; delete w.job;
  note(w, 'make', '重试 · ' + (presetById(w.preset)?.name || ''), w.preset);
  run([w], { source: w.source, preset: w.preset, params: w.params, format: w.format, mode: w.mode, op: /** @type {Op} */ (w.op || 'restyle'), base: w.base, n: 1, text: w.prompt, pace: w.pace }, '', true);
  saveWork(w);
}

/** 订阅正在运行的作品执行器，立即获取最新进度；返回取消订阅函数。 @param {string} id @param {(p: Progress, w: Work) => void} fn */
export function watch(id, fn) {
  const r = running.get(id);
  if (!r) return () => {};
  const w = r.works.find((/** @type {Work} */ x) => x.id === id);
  const entry = { w, fn };
  r.listeners.add(entry);
  fn(r.progress, w);
  return () => r.listeners.delete(entry);
}
export const isRunning = (/** @type {string} */ id) => running.has(id);
/** 正在进行的生成请求数量。 */
export const busyCount = () => new Set(running.values()).size;

/** 取消当前请求。 */
export function stop(/** @type {string} */ id) {
  const r = running.get(id); if (!r) return;
  r.ctrl.abort();
  if (r.works[0].job) cancelJob(r.works[0].job);
}

/** @param {Work[]} list @param {Ask & { op: Op, n: number, text: string, pace: string }} o */
function run(list, o, resumeJob = '', again = false) {
  const ctrl = new AbortController();
  const eta = studio.live ? studio.eta(o.pace) * (o.op === 'angles' || o.op === 'vary' ? 1.25 : 1) : 2600;
  const r = { works: list, ctrl, listeners: new Set(), born: performance.now(), progress: /** @type {Progress} */ ({ stage: 0, value: .02, text: studio.live ? T.sending : T.stages[0], eta, started: performance.now(), got: 0, of: list.length }) };
  for (const w of list) running.set(w.id, r);
  emit('running', list[0].id);
  const tell = (/** @type {Partial<Progress>} */ patch) => {
    Object.assign(r.progress, patch);
    for (const l of r.listeners) l.fn(r.progress, l.w);
  };
  // 在每个预计阶段区间内平滑前进，收到事件时向前跳转；绝不后退。
  const BANDS = [[.02, .28], [.3, .82], [.84, .97]];
  const tick = setInterval(() => {
    const t = performance.now() - r.progress.started, [lo, hi] = BANDS[r.progress.stage];
    const curve = 1 - Math.exp(-t / Math.max(1500, r.progress.eta) * 2.2);
    tell({ value: Math.max(r.progress.value, Math.min(hi, lo + (.97 - lo) * curve)) });
  }, 160);

  (async () => {
    const started = performance.now();
    try {
      if (studio.live) await live(list, r, tell, o, resumeJob, again);
      else await offline(list, tell, ctrl.signal, o);
      const ms = Math.round(performance.now() - started);
      for (const w of list) if (w.asset || w.state === 'done' || !studio.live) { w.ms ||= ms; }
      tell({ stage: 2, value: 1, text: '你的图片已完成！' });
    } catch (e) {
      const cancelled = ctrl.signal.aborted || e?.cancelled;
      for (const w of list) {
        if (w.state === 'done') continue;
        w.state = cancelled ? 'stopped' : 'failed';
        w.error = cancelled ? T.stopped : (e?.message || T.failed) + (e?.hint ? ' ' + e.hint : '');
        note(w, 'fail', cancelled ? '已取消' : '未能完成：' + (e?.message || ''));
      }
    } finally {
      clearInterval(tick);
      for (const w of list) {
        if (w.state === 'working') {
          if (w.asset || (!studio.live && w.kind !== 'render')) w.state = 'done';
          else { w.state = 'failed'; w.error ||= '这张图片未能完成，请选择“重试”再次尝试。'; }
        }
        await saveWork(w);
        running.delete(w.id);
      }
      for (const l of r.listeners) l.fn(r.progress, l.w);
      for (const w of list) emit('finished', w);
    }
  })();
}

/** 返回已完成作品的私人资源标识；若结果仅在本地，则先上传。 @param {Work} w */
async function assetOfWork(w) {
  if (w.asset) return w.asset.split('/').pop() || '';
  const blob = await workBlob(w);
  if (!blob) throw new Error('上一个版本不可用。');
  const a = await uploadBlob(blob, 'image');
  w.asset = a.url; await saveWork(w);
  return a.id;
}

/** @param {Work} lead @param {Ask & { op: Op, n: number, text: string, pace: string }} o */
async function buildTurn(lead, o) {
  const s = sourceById(lead.source);
  const baseWork = lead.base ? workById(lead.base) : null;
  let subject;
  try { subject = baseWork ? await assetOfWork(baseWork) : s ? await ensureUploaded(s) : ''; }
  catch (e) { throw Object.assign(new Error('照片上传失败。'), { hint: '请检查连接后重试。' }); }
  if (!subject) throw new Error('原始照片不可用，请重新选择。');
  /** @type {Record<string, string>} */ const handles = { A: subject };
  const refs = [];
  let letter = 66;
  for (const ref of o.refs || []) {
    const src = ref.source ? sourceById(ref.source) : null;
    const id = src ? await ensureUploaded(src) : ref.blob ? (await uploadBlob(ref.blob, 'image')).id : '';
    if (!id) continue;
    handles[String.fromCharCode(letter++)] = id;
    refs.push({ asset: id, role: ref.role || 'with' });
  }
  const pins = [];
  for (const pin of o.pins || []) {
    const m = await uploadBlob(pin.mask, 'mask');
    pins.push({ n: pins.length + 1, note: String(pin.note || '').slice(0, 1200), mask: m.id });
  }
  const aspect = o.op === 'restyle' ? aspectOf(lead.format) : baseWork ? aspectOf(baseWork.format) : undefined;
  const taste = String(pref('taste', '') || '').trim();
  const name = presetById(lead.preset)?.name || '';
  // 简洁的用户请求用于驱动回复，与详细图像提示词分开。
  const say = lead.say || (o.op === 'region' ? '修饰：' + (lead.parts || []).join(', ') : o.op === 'vary' ? '制作更多版本' : o.op === 'angles' ? '尝试新角度' : '创作一个' + name + '肖像');
  return {
    text: o.text, pace: o.pace, n: o.n, handles, aspect, preset: lead.preset, pins, say: say.slice(0, 400),
    intent: { op: pins.length && o.op === 'edit' ? 'region' : o.op, subject, refs },
    ...(taste ? { taste } : {}),
    room: { id: lead.preset, name: presetById(lead.preset)?.name || lead.preset, line: '', colors: {}, voice: T.replies },
  };
}

/** @param {Work[]} list @param {any} r @param {(p: Partial<Progress>) => void} tell @param {Ask & { op: Op, n: number, text: string, pace: string }} o */
async function live(list, r, tell, o, resumeJob = '', again = false) {
  const lead = list[0];
  let job = resumeJob;
  if (!job) {
    let body;
    if (again && lead.turn) body = lead.turn;
    else {
      body = await buildTurn(lead, o);
      lead.turn = body;
    }
    if (r.ctrl.signal.aborted) throw { cancelled: true };
    tell({ text: T.queued });
    let res;
    try { res = await sendTurn({ ...body, id: turnId(lead) }); }
    catch (e) {
      if (e.status !== 409) throw e;
      // 服务器资源在重启或清理后消失时，先重新上传原始照片再重试。
      const s = sourceById(lead.source);
      if (s) forgetUpload(s);
      if (lead.base) { const b = workById(lead.base); if (b && b.asset) { delete b.asset; } }
      body = await buildTurn(lead, o); lead.turn = body;
      res = await sendTurn({ ...body, id: turnId(lead) + 'r' });
    }
    job = res.job;
    for (const w of list) w.job = job;
    r.progress.eta = (res.eta || r.progress.eta) * (o.n > 1 && o.op !== 'angles' ? 1.1 : 1);
    for (const w of list) saveWork(w);
  }
  if (r.ctrl.signal.aborted) { cancelJob(job); throw { cancelled: true }; }
  let got = 0;
  for await (const ev of follow(job, { signal: r.ctrl.signal })) {
    if (ev.type === 'stage') {
      const stage = ev.stage === 'read' ? 0 : ev.stage === 'finish' ? 2 : 1;
      const now = Math.max(stage, r.progress.stage);
      tell({ stage: now, text: T.stages[now], ...(stage === 1 && r.progress.stage < 1 ? { started: performance.now() } : {}) });
    } else if (ev.type === 'partial') {
      tell({ stage: Math.max(1, r.progress.stage), partial: ev.url, text: T.waits[1] });
    } else if (ev.type === 'result') {
      const w = list[ev.index] || list.find(x => !x.asset);
      if (!w) continue;
      w.asset = ev.url; w.w = ev.w; w.h = ev.h;
      w.kind = ev.provenance?.kind === 'simulated' ? 'simulated' : 'render';
      w.ms = Math.round(performance.now() - r.born);   // 从请求发出到图片完成的耗时。
      got++;
      tell({ stage: 2, text: list.length > 1 ? `${got}/${list.length} 张图片已完成` : T.stages[2], partial: ev.url, got });
      fetchBlob(ev.url).then(b => setResult(w, b)).then(async () => {
        if (w.state === 'working') { w.state = 'done'; await saveWork(w); }
        emit('works', w);
        if (list.length > 1) emit('finished', w);
      }).catch(() => {});
    } else if (ev.type === 'reply') {
      for (const w of list) { if (ev.text) w.reply = ev.text; if (ev.suggestions?.length) w.ideas = ev.suggestions.slice(0, 3); }
    }
  }
  if (!list.some(w => w.asset)) throw new Error('工作室没有返回已完成的图片。');
}

const turnId = (/** @type {Work} */ w) => w.id + (w.attempt ? '.' + w.attempt : '');

/** 没有工作室服务器时，示例肖像使用已保存的风格示例，或创建本地滤镜预览。 */
async function offline(/** @type {Work[]} */ list, /** @type {(p: Partial<Progress>) => void} */ tell, /** @type {AbortSignal} */ signal, /** @type {Ask & { op: Op }} */ o) {
  const steps = [[0, 520], [1, 900], [2, 700]];
  for (const [stage, ms] of steps) {
    if (signal.aborted) throw { cancelled: true };
    tell({ stage, text: T.stages[stage] });
    await sleep(ms);
  }
  if (signal.aborted) throw { cancelled: true };
  let got = 0;
  for (const w of list) {
    const s = sourceById(w.source);
    let blob, kind = /** @type {Work['kind']} */ ('preview');
    const base = w.base ? workById(w.base) : null;
    if (o.op === 'restyle' && s?.sample && hasArt(w.preset, s.sample)) { blob = await fetch(styleArt(w.preset, s.sample)).then(x => x.blob()); kind = 'example'; }
    else if (o.op === 'restyle') {
      const src = s && await sourceBlob(s);
      if (!src) throw new Error('原始照片不可用，请重新选择。');
      const { stylizeStill } = await import('../live/renderer.js');
      blob = await stylizeStill(src, w.preset, w.params.strength / 100, w.format === 'portrait' ? 'portrait' : 'avatar');
    } else {
      // 模型编辑需要连接图像引擎；离线模式保留上一张图片，并将其标注为本地预览。
      blob = (base && await workBlob(base)) || (s && await sourceBlob(s));
      if (!blob) throw new Error('原始照片不可用，请重新选择。');
    }
    await setResult(w, blob);
    w.kind = kind; w.state = 'done';
    if (o.op !== 'restyle') { w.reply = '这是本地流程预览，连接图像引擎后即可应用此编辑。'; w.ideas = ['换个背景试试', '制作更多版本', '换个角度试试']; }
    got++;
    tell({ got });
  }
}

/** 恢复未完成的服务器任务；从未提交的请求标记为已停止，等待重试。 */
export async function resumeAll() {
  /** @type {Map<string, Work[]>} */ const jobs = new Map();
  for (const w of works()) {
    if (w.state !== 'working' || running.has(w.id)) continue;
    if (studio.live && w.job) { if (!jobs.has(w.job)) jobs.set(w.job, []); jobs.get(w.job)?.push(w); }
    else { w.state = 'stopped'; w.error = '上一次请求已中断，请选择“重试”继续。'; await saveWork(w); }
  }
  for (const [job, list] of jobs) {
    list.sort((a, b) => (a.index || 0) - (b.index || 0));
    run(list, { source: list[0].source, preset: list[0].preset, params: list[0].params, format: list[0].format, mode: list[0].mode, op: /** @type {Op} */ (list[0].op || 'restyle'), n: list.length, text: list[0].prompt || '', pace: list[0].pace || 'fine' }, job);
  }
}
export { workById };

/** 特效音效：全部用 Web Audio 即时合成，无需音频文件。只在用户操作之后发声；静音偏好保存在本地。 */
let ctx = /** @type {AudioContext | null} */ (null);
let muted = (() => { try { return localStorage.getItem('hakishow.mute') === '1'; } catch { return false; } })();
export const isMuted = () => muted;
export function setMuted(/** @type {boolean} */ m) { muted = m; try { localStorage.setItem('hakishow.mute', m ? '1' : '0'); } catch { /* 隐私模式 */ } }
function ac() {
  if (!ctx) { const A = window.AudioContext || /** @type {any} */ (window).webkitAudioContext; if (!A) return null; ctx = new A(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
/** 浏览器要求在用户手势中解锁音频。 */
export const unlock = () => { if (!muted) ac(); };

function tone(/** @type {AudioContext} */ c, /** @type {OscillatorType} */ type, /** @type {number} */ f0, /** @type {number} */ f1, /** @type {number} */ t0, /** @type {number} */ dur, /** @type {number} */ vol, /** @type {AudioNode} */ out) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .012); g.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + .05);
}
function noise(/** @type {AudioContext} */ c, /** @type {number} */ t0, /** @type {number} */ dur, /** @type {number} */ vol, /** @type {BiquadFilterType} */ type, /** @type {number} */ f0, /** @type {number} */ f1, /** @type {AudioNode} */ out) {
  const len = Math.ceil(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = b; f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur); f.Q.value = 1.2;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
  s.connect(f).connect(g).connect(out); s.start(t0); s.stop(t0 + dur);
}

const SFX = /** @type {Record<string, (c: AudioContext, t: number, out: AudioNode) => void>} */ ({
  chime: (c, t, o) => [880, 1175, 1568].forEach((f, i) => tone(c, 'sine', f, f, t + i * .07, .9, .12, o)),
  magic: (c, t, o) => { for (let i = 0; i < 7; i++) tone(c, 'triangle', 660 * 2 ** (i / 6), 660 * 2 ** (i / 6), t + i * .045, .5, .07, o); },
  pop: (c, t, o) => tone(c, 'sine', 520, 180, t, .14, .22, o),
  boing: (c, t, o) => { tone(c, 'sine', 180, 520, t, .18, .2, o); tone(c, 'sine', 520, 260, t + .16, .22, .14, o); },
  roar: (c, t, o) => { noise(c, t, .55, .35, 'lowpass', 900, 160, o); tone(c, 'sawtooth', 120, 70, t, .5, .08, o); },
  zap: (c, t, o) => { tone(c, 'square', 1400, 220, t, .22, .06, o); noise(c, t, .18, .08, 'highpass', 3000, 800, o); },
  beep: (c, t, o) => { tone(c, 'square', 1046, 1046, t, .09, .06, o); tone(c, 'square', 1568, 1568, t + .12, .09, .06, o); },
  hit: (c, t, o) => { noise(c, t, .25, .45, 'lowpass', 2400, 200, o); tone(c, 'sine', 160, 50, t, .3, .3, o); },
  bell: (c, t, o) => { tone(c, 'sine', 392, 392, t, 1.4, .12, o); tone(c, 'sine', 784 * 1.01, 784, t, 1.1, .05, o); },
  whoosh: (c, t, o) => noise(c, t, .5, .2, 'bandpass', 400, 2600, o),
  shutter: (c, t, o) => { noise(c, t, .05, .35, 'highpass', 2000, 1500, o); noise(c, t + .07, .06, .25, 'bandpass', 1800, 1200, o); },
  tick: (c, t, o) => tone(c, 'sine', 1800, 1700, t, .025, .03, o),
});

/** 播放一个音效。 @param {string} name */
export function play(name) {
  if (muted) return;
  const c = ac(); const fn = SFX[name]; if (!c || !fn) return;
  const out = c.createGain(); out.gain.value = .8; out.connect(c.destination);
  try { fn(c, c.currentTime + .005, out); } catch { /* 忽略 */ }
}

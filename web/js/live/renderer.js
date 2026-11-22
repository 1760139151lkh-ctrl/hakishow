/** 实时渲染管线（WebGL2，兼容 WebGL1）。每帧依次执行：
 *  1 网格形变（美型）并写入皮肤权重 → 2 五官蒙版（唇、腮红）与人像分割 → 3 半分辨率双边滤波 → 4 合成：磨皮、美白、红润、
 *  上妆、背景虚化或场景替换、基础滤镜 → 5 风格层：调色、色阶、描边、网点、轮廓光、霓虹描边、泛光、扫描线、暗角和颗粒。
 * 同时负责自动构图：在不裁掉画面的前提下缓慢平移和放大，让人脸落在取景区的视觉中心。
 * 未连接工作室时，同一渲染器也用于从静态照片生成本地风格预览。 */
import { presetById } from '../presets.js';
import { canvasOf, blobOf } from '../core/image.js';
import { packOf } from './effects.js';
import { lutPixels, LOOKS } from './looks.js';
import { createMesh, STRIDE, NO_WARP } from './mesh.js';

const VS_MESH = `attribute vec2 aPos; attribute vec2 aUv; attribute vec3 aAttr; varying vec2 vUv; varying vec3 vAttr;
void main(){ vUv = aUv; vAttr = aAttr; gl_Position = vec4(aPos, 0., 1.); }`;
const FS_WARP = `precision mediump float; varying vec2 vUv; varying vec3 vAttr; uniform sampler2D uCam, uSeg; uniform float uMode, uSegOn;
void main(){
  if (uMode < .5) gl_FragColor = vec4(texture2D(uCam, vUv).rgb, vAttr.x);
  else gl_FragColor = vec4(vAttr.y, vAttr.z, 0., uSegOn > .5 ? texture2D(uSeg, vUv).r : 1.);
}`;
const VS_QUAD = `attribute vec2 aPos; varying vec2 v; void main(){ v = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
const FS_BIL = `precision mediump float; varying vec2 v; uniform sampler2D uTex; uniform vec2 uStep;
void main(){
  vec4 c0 = texture2D(uTex, v); vec3 s = c0.rgb; float ws = 1.;
  for (int i = 1; i <= 5; i++) {
    float fi = float(i), g = exp(-fi * fi * .07);
    vec3 a = texture2D(uTex, v + uStep * fi).rgb, b = texture2D(uTex, v - uStep * fi).rgb;
    float wa = g * exp(-dot(a - c0.rgb, a - c0.rgb) * 42.), wb = g * exp(-dot(b - c0.rgb, b - c0.rgb) * 42.);
    s += a * wa + b * wb; ws += wa + wb;
  }
  gl_FragColor = vec4(s / ws, c0.a);
}`;
const FS_DOWN = `precision mediump float; varying vec2 v; uniform sampler2D uTex; uniform vec2 uTexel;
void main(){ gl_FragColor = .25 * (texture2D(uTex, v + uTexel * vec2(-1., -1.)) + texture2D(uTex, v + uTexel * vec2(1., -1.)) + texture2D(uTex, v + uTexel * vec2(-1., 1.)) + texture2D(uTex, v + uTexel)); }`;
const FS_COMP = `precision mediump float; varying vec2 v;
uniform sampler2D uWarp, uBil, uFeat, uBg, uLut, uSmall;
uniform float uSmooth, uWhiten, uRosy, uLip, uBlush, uBgMode, uLutOn, uLutAmt, uSegOn, uBlur;
uniform vec3 uLipCol, uBlushCol; uniform vec4 uBgCrop; uniform vec2 uRes;
float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
vec3 soft(vec3 a, vec3 b){ return mix(a - (1. - 2. * b) * a * (1. - a), a + (2. * b - 1.) * (sqrt(a) - a), step(.5, b)); }
float skinLike(vec3 c){
  float y = luma(c), cb = (c.b - y) * .564 + .5, cr = (c.r - y) * .713 + .5;
  return (1. - smoothstep(.07, .13, abs(cb - .41))) * (1. - smoothstep(.05, .11, abs(cr - .59))) * smoothstep(.08, .2, y);
}
vec3 lut(vec3 c){
  float b = c.b * 63., f1 = floor(b), f2 = min(63., f1 + 1.);
  vec2 q1 = vec2(mod(f1, 8.), floor(f1 / 8.)), q2 = vec2(mod(f2, 8.), floor(f2 / 8.));
  vec2 t1 = (q1 * 64. + .5 + c.rg * 63.) / 512., t2 = (q2 * 64. + .5 + c.rg * 63.) / 512.;
  return mix(texture2D(uLut, t1).rgb, texture2D(uLut, t2).rgb, fract(b));
}
void main(){
  vec4 w = texture2D(uWarp, v); vec3 c = w.rgb;
  float sk = w.a * skinLike(c);
  if (uSmooth > .001) {
    vec3 bil = texture2D(uBil, v).rgb; float k = sk * uSmooth;
    c = mix(c, bil, k * .9) + (c - bil) * k * .16;
  }
  float L = luma(c);
  c = mix(c, c + (1. - c) * (.26 - .12 * L), sk * uWhiten);
  c = mix(c, c * vec3(1.04, .975, .985) + vec3(.018, 0., .006), sk * uRosy);
  vec4 f = texture2D(uFeat, v);
  float lm = smoothstep(.12, .55, f.r) * uLip;
  c = mix(c, mix(soft(c, uLipCol), c * uLipCol * 1.35, .35), lm);
  c = mix(c, soft(c, uBlushCol), f.g * uBlush * .85);
  if (uBgMode > .5) {
    float m = uSegOn > .5 ? smoothstep(.32, .78, f.a) : 1.;
    vec3 bg;
    if (uBgMode < 1.5) {
      vec3 acc = texture2D(uSmall, v).rgb; float n = 1.;
      for (int i = 0; i < 12; i++) { float a = float(i) * .5236; vec2 o = vec2(cos(a) * uRes.y / uRes.x, sin(a)) * uBlur; acc += texture2D(uSmall, v + o).rgb + texture2D(uSmall, v + o * .5).rgb; n += 2.; }
      bg = acc / n;
    } else {
      vec2 bu = uBgCrop.xy + vec2(v.x, 1. - v.y) * uBgCrop.zw;
      bg = texture2D(uBg, bu).rgb;
      bg = mix(bg, bg * (.85 + .3 * luma(c)), .15);
    }
    c = mix(bg, c, m);
    c = mix(c, bg, (1. - abs(m * 2. - 1.)) * .18);
  }
  if (uLutOn > .5) c = mix(c, lut(clamp(c, 0., 1.)), uLutAmt);
  gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
}`;
const FS_STYLE = `precision highp float; varying vec2 v;
uniform sampler2D uSrc, uCam; uniform vec2 uRes; uniform vec4 uCrop;
uniform float uMirror, uMix, uSplit, uTime, uBypass, uPunch;
uniform vec3 uGrade, uRimA, uRimB; uniform vec4 uGlow;
uniform float uSat, uContrast, uLift, uWarmth, uGrain, uVignette, uBloom, uPosterize, uEdge, uHalftone, uPixel, uRim, uScan;
float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 13.7) * 43758.5453); }
vec3 cam(vec2 uv){ return texture2D(uCam, vec2(uCrop.x + (uMirror > .5 ? 1. - uv.x : uv.x) * uCrop.z, uCrop.y + (1. - uv.y) * uCrop.w)).rgb; }
void main(){
  vec2 uv = .5 + (v - .5) / (1. + uPunch);
  if (uBypass > .5) { gl_FragColor = vec4(cam(uv), 1.); return; }
  vec2 w = uv;
  if (uPixel > 0.) { float cells = mix(260., 46., uPixel); vec2 g = vec2(cells * uRes.x / uRes.y, cells); w = (floor(w * g) + .5) / g; }
  vec3 base = texture2D(uSrc, uv).rgb;
  vec3 c = texture2D(uSrc, w).rgb;
  vec2 px = vec2(1. / uRes.x, 1. / uRes.y) * 1.6;
  float lx = luma(texture2D(uSrc, w + vec2(px.x, 0.)).rgb) - luma(texture2D(uSrc, w - vec2(px.x, 0.)).rgb);
  float ly = luma(texture2D(uSrc, w + vec2(0., px.y)).rgb) - luma(texture2D(uSrc, w - vec2(0., px.y)).rgb);
  float e = clamp(length(vec2(lx, ly)) * 4.2, 0., 1.);
  if (uPosterize > 0.) { float lv = mix(24., 4., uPosterize); c = mix(c, floor(c * lv + .5) / lv, uPosterize); }
  c = c + uLift * (1. - c);
  c = (c - .5) * uContrast + .5;
  c = mix(vec3(luma(c)), c, uSat);
  c.r += uWarmth * .08; c.b -= uWarmth * .08;
  c *= uGrade;
  if (uHalftone > 0.) {
    vec2 q = mat2(.7071, -.7071, .7071, .7071) * (uv * uRes);
    vec2 g = fract(q / 7.) - .5;
    float dark = 1. - luma(c), dotv = smoothstep(dark * .62, dark * .62 - .08, length(g));
    vec3 ink = mix(vec3(1.), vec3(.07), 1. - dotv);
    c = mix(c, mix(ink, c * ink, .35), uHalftone);
  }
  c *= 1. - uEdge * smoothstep(.18, .55, e) * .9;
  if (uRim > 0.) {
    float side = smoothstep(0., 1., uv.x); vec3 rc = mix(uRimA, uRimB, side);
    float lit = smoothstep(.12, .7, luma(base)) * (.35 + e * 1.4);
    c += rc * lit * .55; c = mix(c, c * rc * 1.6, .18);
  }
  if (uGlow.a > 0.) { vec3 gc = mix(uGlow.rgb, uGlow.gbr, smoothstep(.2, .8, uv.y)); c = c * (1. - uGlow.a * .35) + gc * smoothstep(.08, .45, e) * uGlow.a * 1.6; }
  if (uBloom > 0.) {
    vec3 b = vec3(0.);
    for (int i = 0; i < 8; i++) { float a = float(i) * .785398 + .39; vec3 s = texture2D(uSrc, w + vec2(cos(a), sin(a)) * px * 11.).rgb; b += s * smoothstep(.68, .98, dot(s, vec3(.299, .587, .114))); }
    b = b / 8. * uBloom * 1.5;
    c = 1. - (1. - clamp(c, 0., 1.)) * (1. - clamp(b, 0., 1.));
  }
  if (uScan > 0.) c *= 1. - uScan * .22 * (.5 + .5 * sin(uv.y * uRes.y * 1.4));
  vec2 vd = (uv - .5) * vec2(1.1, 1.);
  c *= 1. - uVignette * smoothstep(.25, .85, length(vd));
  if (uGrain > 0.) c += (hash(uv * uRes) - .5) * uGrain * .16;
  vec3 outc = mix(base, clamp(c, 0., 1.), uMix);
  if (uSplit >= 0. && v.x < uSplit) outc = cam(v);
  if (uSplit >= 0. && abs(v.x - uSplit) < 1.2 / uRes.x) outc = vec3(1.);
  gl_FragColor = vec4(outc, 1.);
}`;

/** 风格层的中性参数。 */
const ZERO = { grade: [1, 1, 1], sat: 1, contrast: 1, lift: 0, warmth: 0, grain: 0, vignette: 0, bloom: 0, posterize: 0, edge: 0, halftone: 0, pixel: 0, rim: [0, 0, 0, 0, 0, 0], scan: 0, glow: [0, 0, 0, 0] };
/** 用户美颜（全局基础层），0–1。 */
export const BEAUTY0 = { smooth: 0, whiten: 0, rosy: 0, slim: 0, eyes: 0, chin: 0, nose: 0 };
const ease = (/** @type {any} */ a, /** @type {any} */ b, /** @type {number} */ k) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * k) : a + (b - a) * k;

/** @param {HTMLCanvasElement} canvas @param {{ topology?: ReturnType<typeof import('./mesh.js').buildTopology> }} [o] */
export function createRenderer(canvas, o = {}) {
  const opts = { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, powerPreference: 'high-performance' };
  const gl = /** @type {WebGLRenderingContext | null} */ (canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts));
  if (!gl) return null;
  const compile = (/** @type {string} */ vs, /** @type {string} */ fs) => {
    const p = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = /** @type {WebGLShader} */ (gl.createShader(/** @type {number} */ (type))); gl.shaderSource(s, /** @type {string} */ (src)); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('着色器：' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUv'); gl.bindAttribLocation(p, 2, 'aAttr');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接：' + gl.getProgramInfoLog(p));
    /** @type {Record<string, WebGLUniformLocation | null>} */ const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = /** @type {WebGLActiveInfo} */ (gl.getActiveUniform(p, i)).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  };
  let P;
  try { P = { warp: compile(VS_MESH, FS_WARP), bil: compile(VS_QUAD, FS_BIL), down: compile(VS_QUAD, FS_DOWN), comp: compile(VS_QUAD, FS_COMP), style: compile(VS_QUAD, FS_STYLE) }; }
  catch { return null; }

  const tex = (/** @type {number} */ filter = gl.LINEAR) => {
    const t = /** @type {WebGLTexture} */ (gl.createTexture()); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, val] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  };
  const camTex = tex(), segTex = tex(), bgTex = tex(), lutTex = tex();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  /** @typedef {{ fb: WebGLFramebuffer, t: WebGLTexture, w: number, h: number }} Target */
  const target = () => /** @type {Target} */ ({ fb: /** @type {WebGLFramebuffer} */ (gl.createFramebuffer()), t: tex(), w: 0, h: 0 });
  const T = { warp: target(), feat: target(), h1: target(), h2: target(), small: target(), comp: target() };
  const size = (/** @type {Target} */ r, /** @type {number} */ w, /** @type {number} */ h) => {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (r.w === w && r.h === h) return;
    r.w = w; r.h = h;
    gl.bindTexture(gl.TEXTURE_2D, r.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const baseBuf = gl.createBuffer(), meshBuf = gl.createBuffer(), idxBuf = gl.createBuffer();
  const baseData = new Float32Array(4 * STRIDE);
  let topo = o.topology || null, mesh = topo ? createMesh(topo) : null, meshOn = false;
  if (topo) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topo.index, gl.STATIC_DRAW); }

  // ── 状态 ──
  let look = { ...ZERO }, lookT = { ...ZERO };
  let fx = { ...NO_WARP, lip: 0, blush: 0, smooth: 0, whiten: 0, rosy: 0 }, fxT = { ...fx };
  let lipCol = [.78, .2, .3], blushCol = [.95, .55, .6];
  let beauty = { ...BEAUTY0 };
  let strength = .8, mirror = true, split = -1, bypass = false, punch = 0;
  let srcW = 1, srcH = 1, crop = [0, 0, 1, 1];
  /** @type {import('./tracker.js').Track | null} */ let face = null;
  let bgMode = 0, bgReady = false, bgAspect = 1, bgWanted = '', segOn = false, segAt = 0;
  let lutId = 'none', lutAmt = 1;
  let framing = { on: false, top: .12, bottom: .72 }, zoom = 1, fcx = .5, fcy = .5, framed = false, headroom = 0;

  /** 覆盖适配的基础裁剪，再叠加自动构图的缩放与平移。 */
  function fitCover() {
    const W = canvas.width, H = canvas.height, s = Math.max(W / srcW, H / srcH);
    const rw = W / s / srcW / zoom, rh = H / s / srcH / zoom;
    const cx = Math.max(rw / 2, Math.min(1 - rw / 2, framed ? fcx : .5)), cy = Math.max(rh / 2, Math.min(1 - rh / 2, framed ? fcy : .5));
    crop = [cx - rw / 2, cy - rh / 2, rw, rh];
  }
  /** 视频像素 → 画布像素（含裁剪与镜像）。 */
  const toCanvas = (/** @type {number} */ x, /** @type {number} */ y) => {
    let u = (x / srcW - crop[0]) / crop[2]; if (mirror) u = 1 - u;
    return [u * canvas.width, (y / srcH - crop[1]) / crop[3] * canvas.height];
  };
  const toClip = (/** @type {number} */ x, /** @type {number} */ y) => {
    let u = (x / srcW - crop[0]) / crop[2]; if (mirror) u = 1 - u;
    return /** @type {[number, number]} */ ([u * 2 - 1, 1 - (y / srcH - crop[1]) / crop[3] * 2]);
  };
  /** 人脸居中：目标是取景区（顶栏与底部面板之间）的视觉中心，人脸高度约占画面三成；佩戴头饰时把人脸下移并略微拉远，给头饰留出空间。 */
  function frameFace(/** @type {number} */ k) {
    if (!framing.on || !face) { zoom += (1 - zoom) * k * .5; fcx += (.5 - fcx) * k * .5; fcy += (.5 - fcy) * k * .5; framed = Math.abs(zoom - 1) > .002 || Math.abs(fcx - .5) > .002 || Math.abs(fcy - .5) > .002; return; }
    const p = face.pts, top = [p[30], p[31]], chin = [p[152 * 3], p[152 * 3 + 1]];
    const fh = Math.hypot(chin[0] - top[0], chin[1] - top[1]) / srcH;
    const W = canvas.width, H = canvas.height, s = Math.max(W / srcW, H / srcH), visH = H / s / srcH;
    const zWant = Math.max(1, Math.min(1.45, .3 * visH / Math.max(.05, fh) / (1 + .45 * headroom)));
    const mx = (top[0] + chin[0]) / 2 / srcW, my = ((top[1] + chin[1]) / 2 - (.1 + .5 * headroom) * fh * srcH) / srcH;
    const zoneMid = (framing.top + framing.bottom) / 2;
    const cyWant = my - (zoneMid - .5) * visH / zWant;
    const dz = zWant - zoom, dx = mx - fcx, dy = cyWant - fcy;
    // 死区让小幅晃动不触发构图变化，缓动让变化如同摄影师推拉镜头。
    if (Math.abs(dz) > .03) zoom += dz * k * .25;
    if (Math.abs(dx) > .012) fcx += dx * k * .35;
    if (Math.abs(dy) > .012) fcy += dy * k * .35;
    framed = true;
  }

  function bindAttrs(/** @type {WebGLBuffer | null} */ buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE * 4, 16);
  }
  function bindQuad() {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    gl.vertexAttrib2f(1, 0, 0); gl.vertexAttrib3f(2, 0, 0, 0);
  }
  const use = (/** @type {{ p: WebGLProgram, u: Record<string, WebGLUniformLocation | null> }} */ prog, /** @type {Target | null} */ to) => {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, to ? to.w : canvas.width, to ? to.h : canvas.height);
    return prog.u;
  };
  const bindTex = (/** @type {number} */ unit, /** @type {WebGLTexture} */ t, /** @type {WebGLUniformLocation | null | undefined} */ loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); if (loc) gl.uniform1i(loc, unit); };

  function writeBase() {
    const corners = [[-1, -1, 0, 1], [1, -1, 1, 1], [-1, 1, 0, 0], [1, 1, 1, 0]];
    corners.forEach(([x, y, u, vv], i) => {
      const o = i * STRIDE;
      baseData[o] = x; baseData[o + 1] = y;
      baseData[o + 2] = crop[0] + (mirror ? 1 - u : u) * crop[2]; baseData[o + 3] = crop[1] + vv * crop[3];
      baseData[o + 4] = baseData[o + 5] = baseData[o + 6] = baseData[o + 7] = 0;
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf); gl.bufferData(gl.ARRAY_BUFFER, baseData, gl.DYNAMIC_DRAW);
  }

  function upload(/** @type {TexImageSource | ArrayBuffer} */ src, /** @type {number} */ w, /** @type {number} */ h) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, camTex);
    try {
      if (src instanceof ArrayBuffer) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(src));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return true;
    } catch { return false; }
  }

  return {
    gl,
    /** 选择风格：风格层参数、特效包的美型与妆容都会在数帧内平滑过渡。 */
    setPreset(/** @type {string} */ id) {
      const p = presetById(id), pack = packOf(id);
      lookT = { ...ZERO, ...(p?.live || {}), ...(pack.look || {}) };
      fxT = /** @type {any} */ ({ ...NO_WARP, smooth: 0, whiten: 0, rosy: 0, ...(pack.warp || {}), ...(pack.beauty || {}), lip: pack.makeup?.lip?.[3] || 0, blush: pack.makeup?.blush?.[3] || 0 });
      if (pack.makeup?.lip) lipCol = pack.makeup.lip.slice(0, 3);
      if (pack.makeup?.blush) blushCol = pack.makeup.blush.slice(0, 3);
    },
    /** 特效包的临时改动（交互触发的变身阶段等）。 @param {Record<string, any>} patch */
    patchLook(patch) { Object.assign(fxT, patch.fx || {}); Object.assign(lookT, patch.look || {}); if (patch.lip) lipCol = patch.lip; if (patch.blush) blushCol = patch.blush; },
    setStrength(/** @type {number} */ v) { strength = v; },
    setMirror(/** @type {boolean} */ m) { mirror = m; },
    setSplit(/** @type {number} */ x) { split = x; },
    setBypass(/** @type {boolean} */ b) { bypass = b; },
    setPunch(/** @type {number} */ k) { punch = k; },
    /** @param {Partial<typeof BEAUTY0>} b */
    setBeauty(b) { beauty = { ...beauty, ...b }; },
    setLook(/** @type {string} */ id, amt = 1) {
      lutAmt = amt;
      if (id === lutId) return;
      lutId = LOOKS[id] ? id : 'none';
      const px = lutPixels(lutId);
      if (px) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lutTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    },
    /** 背景：0 原样、1 虚化、2 场景替换。 */
    setBackground(/** @type {number} */ mode, /** @type {string} */ src = '') {
      bgMode = mode;
      if (mode !== 2 || !src || src === bgWanted) return;
      bgWanted = src; bgReady = false;
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { if (bgWanted !== src) return; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); bgAspect = im.naturalWidth / im.naturalHeight; bgReady = true; };
      im.src = src;
    },
    get background() { return bgMode; },
    /** 人像分割置信度（0–255），坐标与视频一致。 */
    setSegMask(/** @type {Uint8Array} */ px, /** @type {number} */ w, /** @type {number} */ h) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, segTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, px);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      segOn = true; segAt = performance.now();
    },
    setTopology(/** @type {any} */ t) { topo = t; mesh = createMesh(t); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, t.index, gl.STATIC_DRAW); },
    /** @param {import('./tracker.js').Track | null} f */
    setFace(f) { face = f; },
    /** 自动构图开关与取景区（画面高度的比例）。 */
    setFraming(/** @type {boolean} */ on, top = .12, bottom = .72) { framing = { on, top, bottom }; },
    /** 头饰需要的额外头顶空间（以人脸高度为单位，0 表示没有头饰）。 */
    setHeadroom(/** @type {number} */ h) { headroom = Math.max(0, Math.min(1, +h || 0)); },
    get crop() { return crop; },
    get mirror() { return mirror; },
    get size() { return [srcW, srcH]; },
    toCanvas,
    /** @param {TexImageSource | ArrayBuffer} src @param {number} w @param {number} h @param {number} t */
    draw(src, w, h, t, k = .16) {
      if (w !== srcW || h !== srcH) { srcW = w; srcH = h; fitCover(); }
      for (const key of Object.keys(ZERO)) /** @type {any} */ (look)[key] = ease(/** @type {any} */ (look)[key], /** @type {any} */ (lookT)[key] ?? /** @type {any} */ (ZERO)[key], k);
      for (const key of Object.keys(fxT)) /** @type {any} */ (fx)[key] = ease(/** @type {any} */ (fx)[key] ?? 0, /** @type {any} */ (fxT)[key], k);
      frameFace(k); fitCover();
      if (!upload(src, w, h)) return;
      const W = canvas.width, H = canvas.height;
      size(T.warp, W, H); size(T.comp, W, H); size(T.feat, W / 2, H / 2); size(T.h1, W / 2, H / 2); size(T.h2, W / 2, H / 2); size(T.small, W / 8, H / 8);
      writeBase();
      const s = strength;
      const warp = {
        slim: beauty.slim + fx.slim * s, chin: beauty.chin + fx.chin * s, eyes: beauty.eyes + fx.eyes * s, nose: beauty.nose + fx.nose * s,
        head: fx.head * s, long: fx.long * s, wide: fx.wide * s, mouth: fx.mouth * s, jaw: fx.jaw * s,
      };
      meshOn = !!(face && mesh && topo);
      if (meshOn) { gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf); gl.bufferData(gl.ARRAY_BUFFER, /** @type {any} */ (mesh).update(face, warp, toClip), gl.DYNAMIC_DRAW); }
      const segLive = segOn && bgMode > 0 && performance.now() - segAt < 1500;
      // 1–2：形变与五官蒙版。
      for (const [to, mode] of /** @type {[Target, number][]} */ ([[T.warp, 0], [T.feat, 1]])) {
        const u = use(P.warp, to);
        bindTex(0, camTex, u.uCam); bindTex(1, segTex, u.uSeg);
        gl.uniform1f(u.uMode, mode); gl.uniform1f(u.uSegOn, segLive ? 1 : 0);
        bindAttrs(baseBuf); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (meshOn) { bindAttrs(meshBuf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.drawElements(gl.TRIANGLES, /** @type {any} */ (topo).index.length, gl.UNSIGNED_SHORT, 0); }
      }
      bindQuad();
      // 3：双边滤波（磨皮与虚化共用）。
      const smooth = Math.min(1, beauty.smooth + fx.smooth * s);
      if (smooth > .01 || bgMode === 1) {
        let u = use(P.bil, T.h1); bindTex(0, T.warp.t, u.uTex); gl.uniform2f(u.uStep, 1.5 / T.h1.w, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        u = use(P.bil, T.h2); bindTex(0, T.h1.t, u.uTex); gl.uniform2f(u.uStep, 0, 1.5 / T.h2.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (bgMode === 1) { u = use(P.down, T.small); bindTex(0, T.h2.t, u.uTex); gl.uniform2f(u.uTexel, 1 / T.h2.w, 1 / T.h2.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
      }
      // 4：合成。
      let u = use(P.comp, T.comp);
      bindTex(0, T.warp.t, u.uWarp); bindTex(1, T.h2.t, u.uBil); bindTex(2, T.feat.t, u.uFeat); bindTex(3, bgTex, u.uBg); bindTex(4, lutTex, u.uLut); bindTex(5, T.small.t, u.uSmall);
      gl.uniform1f(u.uSmooth, meshOn ? smooth : 0);
      gl.uniform1f(u.uWhiten, meshOn ? Math.min(1, beauty.whiten + fx.whiten * s) : 0);
      gl.uniform1f(u.uRosy, meshOn ? Math.min(1, beauty.rosy + fx.rosy * s) : 0);
      gl.uniform1f(u.uLip, meshOn ? fx.lip * s : 0); gl.uniform1f(u.uBlush, meshOn ? fx.blush * s : 0);
      gl.uniform3f(u.uLipCol, lipCol[0], lipCol[1], lipCol[2]); gl.uniform3f(u.uBlushCol, blushCol[0], blushCol[1], blushCol[2]);
      const bgOn = bgMode === 1 || (bgMode === 2 && bgReady);
      gl.uniform1f(u.uBgMode, bgOn && (segLive || bgMode === 1 && segLive) ? bgMode : 0);
      gl.uniform1f(u.uSegOn, segLive ? 1 : 0);
      gl.uniform1f(u.uBlur, .045);
      gl.uniform2f(u.uRes, W, H);
      // 场景背景：覆盖适配，并随头部转动产生轻微视差。
      const ca = W / H, cw = bgAspect > ca ? ca / bgAspect : 1, ch = bgAspect > ca ? 1 : bgAspect / ca;
      const par = face ? [Math.sin(face.yaw) * .04 * (mirror ? 1 : -1), Math.sin(face.pitch) * .03] : [0, 0];
      const bx = Math.max(0, Math.min(1 - cw * .94, (1 - cw * .94) / 2 + par[0])), by = Math.max(0, Math.min(1 - ch * .94, (1 - ch * .94) / 2 + par[1]));
      gl.uniform4f(u.uBgCrop, bx, by, cw * .94, ch * .94);
      gl.uniform1f(u.uLutOn, lutId !== 'none' ? 1 : 0); gl.uniform1f(u.uLutAmt, lutAmt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 5：风格层输出到屏幕。
      u = use(P.style, null);
      bindTex(0, T.comp.t, u.uSrc); bindTex(1, camTex, u.uCam);
      const L = /** @type {any} */ (look), glow = LOOKS[lutId]?.glow;
      gl.uniform2f(u.uRes, W, H); gl.uniform4f(u.uCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform1f(u.uMirror, mirror ? 1 : 0); gl.uniform1f(u.uMix, strength); gl.uniform1f(u.uSplit, split);
      gl.uniform1f(u.uTime, (t / 1000) % 100); gl.uniform1f(u.uBypass, bypass ? 1 : 0); gl.uniform1f(u.uPunch, punch);
      gl.uniform3f(u.uGrade, L.grade[0], L.grade[1], L.grade[2]);
      gl.uniform3f(u.uRimA, L.rim[0], L.rim[1], L.rim[2]); gl.uniform3f(u.uRimB, L.rim[3], L.rim[4], L.rim[5]);
      gl.uniform1f(u.uRim, Math.max(...L.rim) > .01 ? 1 : 0);
      const g = glow ? [glow[0], glow[1], glow[2], Math.max(glow[3] * lutAmt, L.glow[3])] : L.glow;
      gl.uniform4f(u.uGlow, g[0], g[1], g[2], g[3]);
      for (const key of ['sat', 'contrast', 'lift', 'warmth', 'grain', 'vignette', 'bloom', 'posterize', 'edge', 'halftone', 'pixel', 'scan']) gl.uniform1f(u['u' + key[0].toUpperCase() + key.slice(1)], L[key]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    resize(/** @type {number} */ w, /** @type {number} */ h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; fitCover(); } },
    /** 对静态照片立即应用，不播放过渡。 */
    snap() { look = JSON.parse(JSON.stringify({ ...ZERO, ...lookT })); fx = { ...fxT }; },
    destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

/** 为独立演示从静态照片渲染风格化本地预览。 @param {Blob} blob @param {string} preset @param {number} strength 0–1 @param {'avatar' | 'portrait' | 'photo'} format */
export async function stylizeStill(blob, preset, strength, format) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  // 先按目标格式裁剪，保留上方（人脸所在区域），而不是严格取正中央。
  const have = bitmap.width / bitmap.height, want = format === 'portrait' ? 2 / 3 : format === 'photo' ? have : 1;
  const cw = have > want ? Math.round(bitmap.height * want) : bitmap.width, ch = have > want ? bitmap.height : Math.round(bitmap.width / want);
  const sx = Math.round((bitmap.width - cw) / 2), sy = Math.round(Math.max(0, Math.min(bitmap.height - ch, (bitmap.height - ch) * .28)));
  const bmp = canvasOf(cw, ch);
  const context = /** @type {CanvasRenderingContext2D} */ (bmp.getContext('2d'));
  context.drawImage(bitmap, sx, sy, cw, ch, 0, 0, cw, ch); bitmap.close?.();
  const big = 1024 / Math.max(cw, ch);
  const W = format === 'portrait' ? 768 : format === 'photo' ? Math.round(cw * Math.min(1, big)) : 896, H = format === 'portrait' ? 1152 : format === 'photo' ? Math.round(ch * Math.min(1, big)) : 896;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const r = createRenderer(c);
  if (!r) {
    const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const s = Math.max(W / bmp.width, H / bmp.height);
    x.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    return blobOf(c, 'image/jpeg', .9);
  }
  r.setMirror(false); r.setPreset(preset); r.snap(); r.setStrength(Math.max(.35, strength));
  r.draw(bmp, bmp.width, bmp.height, performance.now(), 1);
  const out = await new Promise(res => c.toBlob(b => res(b), 'image/jpeg', .9));
  r.destroy();
  return /** @type {Blob} */ (out);
}

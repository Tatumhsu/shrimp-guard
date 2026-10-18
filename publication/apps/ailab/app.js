// 瀏覽器 AI 實驗室 — UI thread. All model work happens in worker.js; this file handles
// tabs, file/mic input, the WebGL parallax view, and drawing results.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const FORCED = params.get('backend') === 'wasm' ? 'wasm' : null;
const lab = (window.__lab = { depth: null, asr: null, detect: null, device: null });

/* ---------------- worker RPC ---------------- */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
lab.worker = worker;
let seq = 0; const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id); if (!p) return;
  if (data.type === 'result') { pending.delete(data.id); p.resolve(data); }
  else if (data.type === 'error') { pending.delete(data.id); p.reject(new Error(data.message)); }
  else p.onEvent?.(data);
};
worker.onerror = (e) => { for (const [id, p] of pending) { pending.delete(id); p.reject(new Error(e.message || '背景執行緒錯誤')); } };
function call(task, payload = {}, transfer = [], onEvent) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onEvent });
    worker.postMessage({ id, task, forced: FORCED, ...payload }, transfer);
  });
}

/* ---------------- engine badge ---------------- */
const engine = $('#engine'), engineText = $('#engineText');
function setEngine(device) {
  lab.device = device;
  engine.classList.toggle('gpu', device === 'webgpu');
  engine.classList.toggle('cpu', device === 'wasm');
  engineText.textContent = device === 'webgpu' ? '運算：WebGPU（顯示卡）' : '運算：WASM（CPU）';
}
call('probe').then((r) => {
  engine.classList.toggle('gpu', r.webgpu); engine.classList.toggle('cpu', !r.webgpu);
  engineText.textContent = r.webgpu ? '可用 WebGPU（顯示卡加速）' : '使用 WASM（CPU，較慢）';
}).catch(() => { engineText.textContent = '無法啟動背景執行緒'; });

/* ---------------- tabs ---------------- */
const TABS = ['depth', 'speech', 'detect'];
function showTab() {
  const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'depth';
  for (const a of $$('.tabs a')) a.setAttribute('aria-selected', String(a.dataset.tab === t));
  for (const p of $$('.panel')) p.hidden = p.dataset.panel !== t;
  if (t === 'depth') gl3d.kick();
}
addEventListener('hashchange', showTab);

/* ---------------- shared helpers ---------------- */
const fmtMB = (b) => (b / 1048576).toFixed(1);
function progressUI(panel) {
  const box = $('.progress', panel), bar = $('.bar i', box), txt = $('.ptext', box);
  const files = new Map();
  return {
    event(ev) {
      if (ev.type === 'progress') {
        if (!ev.file) return;
        const f = files.get(ev.file) || { loaded: 0, total: 0 };
        if (ev.total) f.total = ev.total;
        f.loaded = ev.status === 'done' ? (f.total || f.loaded) : (ev.loaded || f.loaded);
        files.set(ev.file, f);
        let L = 0, T = 0; for (const v of files.values()) { L += v.loaded; T += v.total; }
        if (T > 1048576) {
          box.hidden = false;
          bar.style.width = Math.min(100, (L / T) * 100).toFixed(1) + '%';
          txt.textContent = `下載／讀取模型 ${fmtMB(L)} / ${fmtMB(T)} MB`;
        }
      } else if (ev.type === 'status') {
        if (ev.phase === 'loading') { panel.dataset.state = 'loading'; }
        if (ev.phase === 'fallback') { txt.textContent = 'WebGPU 失敗，改用 WASM…'; box.hidden = false; }
        if (ev.phase === 'running') {
          panel.dataset.state = 'running';
          if (files.size) { bar.style.width = '100%'; txt.textContent = '模型已就緒（已快取，下次免下載）'; }
          setEngine(ev.device);
        }
      }
    },
  };
}
function setBusy(panel, on, text) {
  const b = $('.busy', panel); b.hidden = !on; if (text) $('.btext', b).textContent = text;
}
function setStatus(el, msg, err = false) { el.textContent = msg; el.classList.toggle('err', err); }
const secs = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' 秒';
const devName = (d) => (d === 'webgpu' ? 'WebGPU' : 'WASM');

function wireDrop(label, input, onFile) {
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  label.addEventListener('dragover', (e) => { e.preventDefault(); label.classList.add('over'); });
  label.addEventListener('dragleave', () => label.classList.remove('over'));
  label.addEventListener('drop', (e) => {
    e.preventDefault(); label.classList.remove('over');
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  });
}
async function loadImage(src) {
  const img = new Image(); img.decoding = 'async';
  img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  try { await img.decode(); } catch { throw new Error('無法讀取這張圖片'); }
  return img;
}
// Downscale to maxSide on a canvas; returns {canvas, img: raw RGBA pixels for the worker}
async function prepImage(src, maxSide) {
  const img = await loadImage(src);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  if (typeof src !== 'string') URL.revokeObjectURL(img.src);
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  return { canvas: c, img: { pixels: px.buffer, width: w, height: h } };
}

/* ================= 01 depth ================= */
const gl3d = (() => {
  const canvas = $('#gl');
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  const VS = `attribute vec2 a_uv;attribute float a_d;uniform mat4 u_mvp;uniform float u_k;uniform vec2 u_size;
varying vec2 v_uv;varying float v_d;
void main(){v_uv=a_uv;v_d=a_d;vec3 p=vec3((a_uv.x-.5)*u_size.x,(.5-a_uv.y)*u_size.y,(a_d-.5)*u_k);gl_Position=u_mvp*vec4(p,1.);}`;
  const FS = `precision mediump float;uniform sampler2D u_tex;varying vec2 v_uv;varying float v_d;
void main(){vec3 c=texture2D(u_tex,v_uv).rgb;gl_FragColor=vec4(c*(.82+.18*v_d),1.);}`;
  let prog, loc = {}, buf = {}, nIdx = 0, ready = false, tex, size = [1, 1];
  let strength = 0.45, yaw = 0, pitch = 0, tYaw = 0, tPitch = 0, lastInput = -1e9, raf = 0, tilt = null;
  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    for (const n of ['a_uv', 'a_d']) loc[n] = gl.getAttribLocation(prog, n);
    for (const n of ['u_mvp', 'u_k', 'u_size', 'u_tex']) loc[n] = gl.getUniformLocation(prog, n);
    buf.uv = gl.createBuffer(); buf.d = gl.createBuffer(); buf.idx = gl.createBuffer(); tex = gl.createTexture();
  }
  // tiny mat4 helpers (column-major)
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const persp = (fy, asp, n, f) => { const t = 1 / Math.tan(fy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); };
  const trans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };

  function setData(photoCanvas, depth, w, h) {
    if (!gl) return;
    let mn = 255, mx = 0; for (const v of depth) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const span = Math.max(1, mx - mn), asp = w / h;
    const cols = asp >= 1 ? 240 : Math.max(8, Math.round(240 * asp)), rows = asp >= 1 ? Math.max(8, Math.round(240 / asp)) : 240;
    const uv = new Float32Array((cols + 1) * (rows + 1) * 2), dd = new Float32Array((cols + 1) * (rows + 1));
    for (let j = 0, i = 0; j <= rows; j++) for (let k = 0; k <= cols; k++, i++) {
      const u = k / cols, v = j / rows; uv[i * 2] = u; uv[i * 2 + 1] = v;
      const x = Math.min(w - 1, Math.round(u * (w - 1))), y = Math.min(h - 1, Math.round(v * (h - 1)));
      dd[i] = (depth[y * w + x] - mn) / span;
    }
    const idx = new Uint16Array(cols * rows * 6);
    for (let j = 0, p = 0; j < rows; j++) for (let k = 0; k < cols; k++) {
      const a = j * (cols + 1) + k, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], p); p += 6;
    }
    nIdx = idx.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.d); gl.bufferData(gl.ARRAY_BUFFER, dd, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photoCanvas);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    size = asp >= 1 ? [asp, 1] : [1, 1 / asp];
    ready = true; kick();
  }
  function frame(t) {
    raf = 0;
    if (!ready || canvas.hidden || canvas.closest('.panel').hidden) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (!tilt && t - lastInput > 2500) { tYaw = Math.sin(t / 1600) * 0.16; tPitch = Math.sin(t / 2300) * 0.07; }
    yaw += (tYaw - yaw) * 0.08; pitch += (tPitch - pitch) * 0.08;
    const fov = 0.6, va = W / H, k = strength * 0.9;
    const halfH = Math.max(size[1] / 2, size[0] / 2 / va) / 1.06;
    const dist = halfH / Math.tan(fov / 2) + k * 0.5;
    const mvp = mul(persp(fov, va, 0.05, 20), mul(trans(0, 0, -dist), mul(rotX(pitch), rotY(yaw))));
    gl.viewport(0, 0, W, H); gl.clearColor(0.027, 0.035, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.enableVertexAttribArray(loc.a_uv); gl.vertexAttribPointer(loc.a_uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.d); gl.enableVertexAttribArray(loc.a_d); gl.vertexAttribPointer(loc.a_d, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
    gl.uniformMatrix4fv(loc.u_mvp, false, mvp); gl.uniform1f(loc.u_k, k); gl.uniform2f(loc.u_size, size[0], size[1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.u_tex, 0);
    gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  const stage = $('#depthStage');
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    tYaw = ((e.clientX - r.left) / r.width - 0.5) * 0.5; tPitch = ((e.clientY - r.top) / r.height - 0.5) * 0.32;
    lastInput = performance.now();
  });
  function onTilt(e) {
    if (e.gamma == null) return;
    if (!tilt) tilt = { beta: e.beta };
    tYaw = Math.max(-0.3, Math.min(0.3, e.gamma / 90)); tPitch = Math.max(-0.2, Math.min(0.2, (e.beta - tilt.beta) / 90));
    lastInput = performance.now();
  }
  function enableTilt() { addEventListener('deviceorientation', onTilt); }
  return {
    ok: !!gl, setData, kick, enableTilt,
    setStrength(v) { strength = v; kick(); },
  };
})();

(() => {
  const panel = $('#panel-depth'), status = $('#depthStatus'), dl = $('#depthDownload');
  const dView = $('#depthView'), pView = $('#photoView'), glc = $('#gl'), empty = $('#depthEmpty');
  let last = null, view = '3d', running = false;
  if (!gl3d.ok) setStatus(status, '這個瀏覽器不支援 WebGL，只能看深度圖。', true);

  const STOPS = [[0, [13, 8, 40]], [0.25, [84, 26, 120]], [0.5, [182, 54, 122]], [0.75, [251, 136, 97]], [1, [252, 253, 191]]];
  const ramp = (t) => { for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (t - a) / (b - a); return ca.map((v, j) => v + (cb[j] - v) * k); } return STOPS[4][1]; };

  function setView(v) {
    view = v;
    for (const b of $$('.seg button', panel)) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    glc.hidden = v !== '3d' || !last; dView.hidden = v !== 'depth' || !last; pView.hidden = v !== 'photo' || !last;
    if (v === '3d') gl3d.kick();
  }
  $$('.seg button', panel).forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  async function run(src) {
    if (running) return; running = true;
    const prog = progressUI(panel);
    try {
      panel.dataset.state = 'loading';
      setStatus(status, '準備圖片…');
      const { canvas, img } = await prepImage(src, 768);
      setBusy(panel, true, '分析深度中…（第一次會比較久）');
      const t0 = performance.now();
      const r = await call('depth', img, [img.pixels], (ev) => { prog.event(ev); if (ev.phase === 'running') setBusy(panel, true, `用 ${devName(ev.device)} 分析深度中…`); });
      const { width: w, height: h, depth } = r;
      // the model returns depth at input size; guard anyway
      const photo = canvas.width === w && canvas.height === h ? canvas : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(canvas, 0, 0, w, h); return c; })();
      $('#depthStage').style.aspectRatio = `${w} / ${h}`;
      // depth view (colormapped)
      let mn = 255, mx = 0; for (const v of depth) { if (v < mn) mn = v; if (v > mx) mx = v; }
      dView.width = w; dView.height = h;
      const id = new ImageData(w, h), span = Math.max(1, mx - mn);
      for (let i = 0; i < depth.length; i++) { const c = ramp((depth[i] - mn) / span); id.data[i * 4] = c[0]; id.data[i * 4 + 1] = c[1]; id.data[i * 4 + 2] = c[2]; id.data[i * 4 + 3] = 255; }
      dView.getContext('2d').putImageData(id, 0, 0);
      pView.width = w; pView.height = h; pView.getContext('2d').drawImage(photo, 0, 0);
      last = { w, h, depth, mn, mx };
      gl3d.setData(photo, depth, w, h);
      empty.hidden = true; dl.disabled = false;
      setView(gl3d.ok ? view : 'depth');
      lab.depth = { w, h, min: mn, max: mx, device: r.device, ms: r.ms };
      // normalized depth (0 far … 1 near) at relative coords — used by the e2e test
      lab.depthAt = (u, v) => (depth[Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))] - mn) / Math.max(1, mx - mn);
      panel.dataset.state = 'done';
      setStatus(status, `完成：${w}×${h}，${devName(r.device)} 用時 ${secs(performance.now() - t0)}`);
    } catch (e) {
      panel.dataset.state = 'error';
      setStatus(status, '出錯了：' + e.message, true);
    } finally { setBusy(panel, false); running = false; }
  }
  wireDrop($('#depthDrop'), $('#depthFile'), run);
  $$('.sample', panel).forEach((b) => b.addEventListener('click', () => run(b.dataset.sample)));

  const s = $('#depthStrength'), so = $('#depthStrengthOut');
  s.addEventListener('input', () => { so.textContent = s.value; gl3d.setStrength(s.value / 100); });

  dl.addEventListener('click', () => {
    if (!last) return;
    const { w, h, depth, mn, mx } = last, c = document.createElement('canvas'); c.width = w; c.height = h;
    const id = new ImageData(w, h), span = Math.max(1, mx - mn);
    for (let i = 0; i < depth.length; i++) { const v = Math.round(((depth[i] - mn) / span) * 255); id.data.set([v, v, v, 255], i * 4); }
    c.getContext('2d').putImageData(id, 0, 0);
    c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'depth-map.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
  });

  // device tilt: iOS needs an explicit permission tap; others just listen on touch devices
  const tiltBtn = $('#tiltBtn');
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener('click', async () => {
      try { if ((await DeviceOrientationEvent.requestPermission()) === 'granted') { gl3d.enableTilt(); tiltBtn.textContent = '傾斜已啟用'; tiltBtn.disabled = true; } }
      catch { tiltBtn.textContent = '無法啟用傾斜'; }
    });
  } else if (matchMedia('(pointer:coarse)').matches) gl3d.enableTilt();
})();

/* ================= 02 speech ================= */
let s2tFn = null;
async function toTraditional(text) {
  if (!/[㐀-鿿]/.test(text)) return text;
  if (!s2tFn) {
    const { S2T_CHARS, S2T_PHRASES } = await import('./s2t.js');
    const cm = new Map(), a = Array.from(S2T_CHARS);
    for (let i = 0; i + 1 < a.length; i += 2) cm.set(a[i], a[i + 1]);
    const pm = new Map(S2T_PHRASES.split('|').map((e) => e.split('=')));
    s2tFn = (s) => {
      const c = Array.from(s); let out = '';
      for (let i = 0; i < c.length;) {
        let hit = false;
        for (const L of [3, 2]) {
          if (i + L > c.length) continue;
          const v = pm.get(c.slice(i, i + L).join(''));
          if (v) { out += v; i += L; hit = true; break; }
        }
        if (!hit) { out += cm.get(c[i]) ?? c[i]; i++; }
      }
      return out;
    };
  }
  return s2tFn(text).replace(/([\u3400-\u9fff]),\s*/g, '$1，').replace(/([\u3400-\u9fff])\?/g, '$1？').replace(/([\u3400-\u9fff])!/g, '$1！');
}
async function decodeAudio(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let buf;
  try { buf = await ctx.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('無法解碼這個音檔格式'); }
  finally { ctx.close?.(); }
  const len = Math.max(1, Math.ceil(buf.duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const node = off.createBufferSource(); node.buffer = buf; node.connect(off.destination); node.start();
  const out = await off.startRendering();
  return { pcm: out.getChannelData(0), duration: buf.duration };
}
// Whisper sometimes loops on noise/silence ("字幕:郭文明 字幕:郭文明 …"); keep one copy and mark it.
const collapseRepeats = (t) => t.replace(/(.{1,16}?)(?:\s*\1){4,}/gu, '$1…');
const fmtT = (s) => (s == null || !isFinite(s) ? '…' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`);

(() => {
  const panel = $('#panel-speech'), status = $('#asrStatus'), list = $('#chunks'), copyBtn = $('#copyBtn');
  const recBtn = $('#recBtn'), recTime = $('#recTime'), preview = $('#audioPreview');
  let running = false, lastText = '';
  const ASR_INFO = {
    base: ['Whisper base', '≈ 77 MB', '第一次使用要下載模型（WASM 約 77 MB、WebGPU 約 95–136 MB），之後會快取。base 版小而快，中文準確度普通；講慢一點、環境安靜會好很多。'],
    small: ['Whisper small', '≈ 250 MB', '第一次使用要下載約 250 MB（WebGPU 約 330–510 MB），之後會快取。中文明顯比 base 準，但速度慢 3–4 倍，手機上建議只轉短錄音。'],
  };
  const sizeSel = $('#asrSize');
  const showInfo = () => { const [n, z, t] = ASR_INFO[sizeSel.value]; $('#asrName').textContent = n; $('#asrSizeTxt').textContent = z; $('#asrNote').textContent = t; };
  sizeSel.addEventListener('change', showInfo); showInfo();

  async function transcribe(blob) {
    if (running) return; running = true;
    const prog = progressUI(panel);
    try {
      panel.dataset.state = 'loading';
      preview.src = URL.createObjectURL(blob); preview.hidden = false;
      setStatus(status, '解碼音訊…');
      const { pcm, duration } = await decodeAudio(blob);
      if (duration > 900) throw new Error('音檔超過 15 分鐘，請先剪短');
      setBusy(panel, true, '轉寫中…（第一次要先下載模型）');
      const t0 = performance.now();
      const lang = $('#asrLang').value;
      const r = await call('asr', { audio: pcm, language: lang || null, size: $('#asrSize').value, gen: lab.asrGen }, [pcm.buffer], (ev) => { prog.event(ev); if (ev.phase === 'running') setBusy(panel, true, `用 ${devName(ev.device)} 轉寫 ${duration.toFixed(1)} 秒音訊…`); });
      const chunks = r.chunks.length ? r.chunks : [{ timestamp: [0, duration], text: r.text }];
      const rows = [];
      for (const c of chunks) rows.push({ a: c.timestamp?.[0], b: c.timestamp?.[1] ?? duration, text: collapseRepeats((await toTraditional(c.text || '')).trim()) });
      list.textContent = '';
      for (const row of rows) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="ts"></span><span class="tx"></span>';
        li.firstChild.textContent = `${fmtT(row.a)} → ${fmtT(row.b)}`; li.lastChild.textContent = row.text || '（無聲）';
        list.append(li);
      }
      lastText = rows.map((r) => `[${fmtT(r.a)} → ${fmtT(r.b)}] ${r.text}`).join('\n');
      copyBtn.disabled = !lastText;
      lab.asr = { text: collapseRepeats(await toTraditional(r.text || '')), chunks: rows.length, device: r.device, ms: r.ms };
      panel.dataset.state = 'done';
      setStatus(status, `完成：${duration.toFixed(1)} 秒音訊，${rows.length} 段，${devName(r.device)} 用時 ${secs(performance.now() - t0)}` +
        (sizeSel.value === 'base' && lang !== 'english' ? '。結果不準？改用「精準」模型再試一次。' : ''));
    } catch (e) {
      panel.dataset.state = 'error';
      setStatus(status, '出錯了：' + e.message, true);
    } finally { setBusy(panel, false); running = false; }
  }
  wireDrop($('.drop', panel), $('#audioFile'), transcribe);

  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastText); }
    catch { const t = document.createElement('textarea'); t.value = lastText; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    copyBtn.textContent = '已複製'; setTimeout(() => (copyBtn.textContent = '複製'), 1500);
  });

  let rec = null, timer = 0, startAt = 0;
  recBtn.addEventListener('click', async () => {
    if (rec) { rec.stop(); return; }
    if (running) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); clearInterval(timer);
        recBtn.setAttribute('aria-pressed', 'false'); $('.rtext', recBtn).textContent = '開始錄音';
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' }); rec = null;
        transcribe(blob);
      };
      rec.start(); startAt = Date.now();
      recBtn.setAttribute('aria-pressed', 'true'); $('.rtext', recBtn).textContent = '停止並轉寫';
      timer = setInterval(() => {
        const s = (Date.now() - startAt) / 1000;
        recTime.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        if (s >= 300) rec?.stop();
      }, 250);
      setStatus(status, '錄音中…（最長 5 分鐘）');
    } catch (e) {
      setStatus(status, '無法使用麥克風：' + (e.name === 'NotAllowedError' ? '權限被拒絕' : e.message), true);
    }
  });
})();

/* ================= 03 detect ================= */
const COCO_ZH = {
  person: '人', bicycle: '腳踏車', car: '汽車', motorcycle: '機車', airplane: '飛機', bus: '公車', train: '火車', truck: '卡車', boat: '船',
  'traffic light': '紅綠燈', 'fire hydrant': '消防栓', 'street sign': '路牌', 'stop sign': '停車標誌', 'parking meter': '停車計時器', bench: '長椅',
  bird: '鳥', cat: '貓', dog: '狗', horse: '馬', sheep: '羊', cow: '牛', elephant: '大象', bear: '熊', zebra: '斑馬', giraffe: '長頸鹿',
  hat: '帽子', backpack: '背包', umbrella: '雨傘', shoe: '鞋子', 'eye glasses': '眼鏡', handbag: '手提包', tie: '領帶', suitcase: '行李箱',
  frisbee: '飛盤', skis: '滑雪板', snowboard: '單板滑雪板', 'sports ball': '球', kite: '風箏', 'baseball bat': '球棒', 'baseball glove': '棒球手套',
  skateboard: '滑板', surfboard: '衝浪板', 'tennis racket': '網球拍', bottle: '瓶子', plate: '盤子', 'wine glass': '酒杯', cup: '杯子',
  fork: '叉子', knife: '刀子', spoon: '湯匙', bowl: '碗', banana: '香蕉', apple: '蘋果', sandwich: '三明治', orange: '柳橙', broccoli: '花椰菜',
  carrot: '紅蘿蔔', 'hot dog': '熱狗', pizza: '披薩', donut: '甜甜圈', cake: '蛋糕', chair: '椅子', couch: '沙發', 'potted plant': '盆栽',
  bed: '床', mirror: '鏡子', 'dining table': '餐桌', window: '窗戶', desk: '書桌', toilet: '馬桶', door: '門', tv: '電視', laptop: '筆電',
  mouse: '滑鼠', remote: '遙控器', keyboard: '鍵盤', 'cell phone': '手機', microwave: '微波爐', oven: '烤箱', toaster: '烤麵包機', sink: '水槽',
  refrigerator: '冰箱', blender: '果汁機', book: '書', clock: '時鐘', vase: '花瓶', scissors: '剪刀', 'teddy bear': '泰迪熊',
  'hair drier': '吹風機', toothbrush: '牙刷', 'hair brush': '梳子',
};
const PALETTE = ['#7fe0c4', '#5ab8ff', '#ffc46b', '#ff8a7a', '#c59bff', '#8ee26b', '#ff9bd2', '#6be3e8', '#f2e86d', '#ffa95a'];
const colorOf = (label) => { let h = 0; for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

(() => {
  const panel = $('#panel-detect'), status = $('#detStatus'), cv = $('#detCanvas'), list = $('#detList');
  const th = $('#detThreshold'), tho = $('#detThresholdOut');
  let running = false, last = null;

  function draw() {
    if (!last) return;
    const { photo, items } = last, t = th.value / 100;
    cv.width = photo.width; cv.height = photo.height;
    const g = cv.getContext('2d'); g.drawImage(photo, 0, 0);
    const shown = items.filter((d) => d.score >= t).sort((a, b) => b.score - a.score);
    const fs = Math.max(13, Math.round(Math.max(cv.width, cv.height) / 48));
    g.font = `700 ${fs}px "Noto Sans TC", sans-serif`; g.textBaseline = 'top';
    for (const d of shown) {
      const { xmin, ymin, xmax, ymax } = d.box, c = colorOf(d.label);
      g.lineWidth = Math.max(2, fs / 6); g.strokeStyle = c; g.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);
      const txt = `${COCO_ZH[d.label] || d.label} ${Math.round(d.score * 100)}%`, tw = g.measureText(txt).width + fs * 0.6;
      const ty = ymin - fs * 1.35 < 0 ? ymin : ymin - fs * 1.35;
      g.fillStyle = c; g.fillRect(xmin - g.lineWidth / 2, ty, tw, fs * 1.35);
      g.fillStyle = '#081016'; g.fillText(txt, xmin + fs * 0.3 - g.lineWidth / 2, ty + fs * 0.17);
    }
    list.textContent = '';
    if (!shown.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = '在這個門檻下沒有找到認得的物件，試著調低信心門檻或換張照片。'; list.append(li); }
    for (const d of shown) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="sw"></span><span class="zh"></span><span class="en"></span><span class="sc"></span>';
      li.children[0].style.background = colorOf(d.label);
      li.children[1].textContent = COCO_ZH[d.label] || d.label; li.children[2].textContent = d.label;
      li.children[3].textContent = Math.round(d.score * 100) + '%';
      list.append(li);
    }
    lab.detect = { ...(lab.detect || {}), shown: shown.length, labels: shown.map((d) => d.label) };
  }
  th.addEventListener('input', () => { tho.textContent = th.value + '%'; draw(); });

  async function run(src) {
    if (running) return; running = true;
    const prog = progressUI(panel);
    try {
      panel.dataset.state = 'loading';
      setStatus(status, '準備圖片…');
      const { canvas, img } = await prepImage(src, 1024);
      cv.width = canvas.width; cv.height = canvas.height; cv.getContext('2d').drawImage(canvas, 0, 0);
      $('#detEmpty').hidden = true;
      setBusy(panel, true, '辨識中…（第一次要先下載模型）');
      const t0 = performance.now();
      // ask for everything above 20%; the slider filters client-side without re-running
      const r = await call('detect', { ...img, threshold: 0.2 }, [img.pixels], (ev) => { prog.event(ev); if (ev.phase === 'running') setBusy(panel, true, `用 ${devName(ev.device)} 辨識中…`); });
      last = { photo: canvas, items: r.items };
      lab.detect = { total: r.items.length, scores: r.items.map((d) => d.score), device: r.device, ms: r.ms };
      draw();
      panel.dataset.state = 'done';
      setStatus(status, `完成：找到 ${r.items.length} 個候選（≥20%），${devName(r.device)} 用時 ${secs(performance.now() - t0)}`);
    } catch (e) {
      panel.dataset.state = 'error';
      setStatus(status, '出錯了：' + e.message, true);
    } finally { setBusy(panel, false); running = false; }
  }
  wireDrop($('#detDrop'), $('#detFile'), run);
  $$('.sample', panel).forEach((b) => b.addEventListener('click', () => run(b.dataset.sample)));
})();

showTab();

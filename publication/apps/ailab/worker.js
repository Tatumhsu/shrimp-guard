// Inference worker: loads transformers.js pipelines lazily and runs them off the main thread.
// Protocol (main -> worker): {id, task:'depth'|'asr'|'detect', ...payload}
// (worker -> main): {id, type:'progress'|'status'|'result'|'error', ...}
import { pipeline, env, RawImage } from './vendor/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// The dashboard's nginx serves .mjs as application/octet-stream (module scripts refuse that), so point ONNX Runtime
// at a .js copy of its loader and at the .wasm explicitly.
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/ort-wasm-simd-threaded.jsep.js', import.meta.url).href,
  wasm: new URL('./vendor/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href,
};

const MODELS = {
  // dtype per device; `f16` = GPU supports shader-f16 (half-size weights), otherwise fp32 on GPU.
  depth: { task: 'depth-estimation', id: 'onnx-community/depth-anything-v2-small',
    dtype: (dev, f16) => dev === 'wasm' ? 'q8' : f16 ? 'fp16' : 'fp32' },
  asr: { task: 'automatic-speech-recognition', id: 'Xenova/whisper-base',
    dtype: (dev, f16) => dev === 'wasm' ? 'q8' : { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q8' } },
  'asr-small': { task: 'automatic-speech-recognition', id: 'Xenova/whisper-small',
    dtype: (dev, f16) => dev === 'wasm' ? 'q8' : { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q8' } },
  detect: { task: 'object-detection', id: 'Xenova/detr-resnet-50',
    dtype: (dev, f16) => dev === 'wasm' ? 'q8' : f16 ? 'fp16' : 'fp32' },
};

let gpuOk = null, gpuF16 = false;
async function hasWebGPU(forced) {
  if (forced === 'wasm') return false;
  if (gpuOk !== null) return gpuOk;
  try {
    const a = navigator.gpu && await navigator.gpu.requestAdapter();
    gpuOk = !!a; gpuF16 = !!a?.features?.has('shader-f16');
  } catch { gpuOk = false; }
  return gpuOk;
}

const pipes = {};   // key -> Promise<{pipe, device}>
async function getPipe(key, id, forced) {
  if (pipes[key]) return pipes[key];
  const m = MODELS[key];
  const load = async (device) => {
    const progress_callback = (p) => {
      if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate')
        postMessage({ id, type: 'progress', key, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status });
    };
    postMessage({ id, type: 'status', key, phase: 'loading', device });
    const pipe = await pipeline(m.task, m.id, { device, dtype: m.dtype(device, gpuF16), progress_callback });
    return { pipe, device };
  };
  pipes[key] = (async () => {
    if (await hasWebGPU(forced)) {
      try { return await load('webgpu'); }
      catch (e) { postMessage({ id, type: 'status', key, phase: 'fallback', note: String(e?.message || e) }); }
    }
    return load('wasm');
  })();
  pipes[key].catch(() => { delete pipes[key]; });
  return pipes[key];
}

// Run with the current device; if WebGPU inference itself fails, rebuild on WASM once.
async function run(key, id, forced, fn) {
  let p = await getPipe(key, id, forced);
  postMessage({ id, type: 'status', key, phase: 'running', device: p.device });
  try { return { out: await fn(p.pipe), device: p.device }; }
  catch (e) {
    if (p.device !== 'webgpu') throw e;
    postMessage({ id, type: 'status', key, phase: 'fallback', note: String(e?.message || e) });
    delete pipes[key];
    p = await getPipe(key, id, 'wasm');
    postMessage({ id, type: 'status', key, phase: 'running', device: p.device });
    return { out: await fn(p.pipe), device: p.device };
  }
}

// Images arrive as raw RGBA pixels decoded on the main thread (no OffscreenCanvas decode in the worker).
const toRaw = (d) => new RawImage(new Uint8ClampedArray(d.pixels), d.width, d.height, 4).rgb();

self.onmessage = async ({ data }) => {
  const { id, task, forced } = data;
  const t0 = performance.now();
  try {
    if (task === 'probe') {
      postMessage({ id, type: 'result', webgpu: await hasWebGPU(forced) });
      return;
    }
    if (task === 'depth') {
      const img = toRaw(data);
      const { out, device } = await run('depth', id, forced, (pipe) => pipe(img));
      const d = out.depth; // RawImage, 1 channel, resized to input size
      const buf = new Uint8Array(d.data);
      postMessage({ id, type: 'result', device, ms: performance.now() - t0, width: d.width, height: d.height, depth: buf }, [buf.buffer]);
    } else if (task === 'asr') {
      const opts = { task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
      if (data.language) opts.language = data.language;
      // guard against Whisper's repetition loops ("惡 惡 惡 …") on unclear audio
      Object.assign(opts, { no_repeat_ngram_size: 3, repetition_penalty: 1.15 }, data.gen || {});
      const key = data.size === 'small' ? 'asr-small' : 'asr';
      // only keep one Whisper in memory
      const other = key === 'asr' ? 'asr-small' : 'asr';
      if (pipes[other]) { const o = pipes[other]; delete pipes[other]; o.then((p) => p.pipe.dispose?.()).catch(() => {}); }
      const { out, device } = await run(key, id, forced, (pipe) => pipe(data.audio, opts));
      postMessage({ id, type: 'result', device, ms: performance.now() - t0, text: out.text, chunks: out.chunks || [] });
    } else if (task === 'detect') {
      const img = toRaw(data);
      const { out, device } = await run('detect', id, forced, (pipe) => pipe(img, { threshold: data.threshold ?? 0.5, percentage: false }));
      postMessage({ id, type: 'result', device, ms: performance.now() - t0, width: img.width, height: img.height, items: out });
    } else throw new Error('unknown task ' + task);
  } catch (e) {
    postMessage({ id, type: 'error', message: String(e?.message || e) });
  }
};

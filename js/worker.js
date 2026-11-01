/* ==========================================================
   worker.js  -  runs the open-source AI models inside the browser (no server, no API key)
     mt   : Meta NLLB-200 (600M, CC-BY-NC 4.0)    any language  <->  Dzongkha
     llm  : Qwen2.5 Instruct (Apache 2.0)          chat answers and smart summaries (in English)
     asr  : OpenAI Whisper base (MIT)              voice recording -> text
   Models are downloaded once from Hugging Face and then kept in the browser cache.
   ========================================================== */
// The library is loaded lazily, so if it fails the page is told why (instead of waiting forever).
let pipeline, env, libError = null;
const libReady = import('../vendor/transformers/transformers.min.js').then(m => {
  ({ pipeline, env } = m);
  env.allowLocalModels = true;                                                                  // look in ./models first (see download_models.py) ...
  env.localModelPath = new URL('../models/', import.meta.url).href;
  env.allowRemoteModels = true;                                                                 // ... and fall back to Hugging Face
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;   // our own copy of onnxruntime
  env.backends.onnx.wasm.numThreads = 1;                                                        // works on GitHub Pages (no special headers needed)
}).catch(e => { libError = e; });

const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;

const SPECS = {
  mt:         { task: 'translation',                  id: 'Xenova/nllb-200-distilled-600M',      opts: { dtype: 'q8' } },
  asr:        { task: 'automatic-speech-recognition', id: 'Xenova/whisper-base',                  opts: {} },
  llm_fast:   { task: 'text-generation',              id: 'onnx-community/Qwen2.5-0.5B-Instruct', opts: gpu ? { dtype: 'q4f16', device: 'webgpu' } : { dtype: 'q4' } },
  llm_better: { task: 'text-generation',              id: 'onnx-community/Qwen2.5-1.5B-Instruct', opts: gpu ? { dtype: 'q4f16', device: 'webgpu' } : { dtype: 'q4' } }
};

const loaded = {};
async function load(key) {
  await libReady;
  if (libError) throw new Error('The AI library could not start: ' + (libError.message || libError));
  if (!loaded[key]) {
    const s = SPECS[key];
    loaded[key] = pipeline(s.task, s.id, { ...s.opts, progress_callback: p => self.postMessage({ type: 'progress', key, p }) })
      .catch(e => { delete loaded[key]; throw e; });
  }
  return loaded[key];
}
self.postMessage({ type: 'alive' });

const handlers = {
  async load({ key }) { await load(key); self.postMessage({ type: 'progress', key, p: { status: 'ready' } }); return { gpu }; },

  async translate({ text, src, tgt, beams }) {
    const mt = await load('mt');
    const out = await mt(text, { src_lang: src, tgt_lang: tgt, max_new_tokens: 320, num_beams: beams || 1, no_repeat_ngram_size: 4 });
    return out[0].translation_text;
  },

  async generate({ key, messages, max }) {
    const llm = await load(key);
    const out = await llm(messages, { max_new_tokens: max || 320, do_sample: false, repetition_penalty: 1.1 });
    const last = out[0].generated_text;
    return Array.isArray(last) ? last.at(-1).content : String(last);
  },

  async transcribe({ audio, language }) {
    const asr = await load('asr');
    const opts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
    if (language && language !== 'auto') opts.language = language;
    const out = await asr(audio, opts);
    return out.text;
  }
};

self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    const result = await handlers[op](data);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};

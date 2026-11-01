/* ==========================================================
   engine.js  -  the "brain" of the page, all inside your browser. No server and no API key.
   Parts:  languages · text splitting · Dzongkha tidy-up · model worker · file reading (OCR / PDF / Word)
           · translate · summarise · explain · chat · voice recording
   ========================================================== */
(() => {
  'use strict';
  const DZ = 'dzo_Tibt', EN = 'eng_Latn';
  const mock = new URLSearchParams(location.search).has('mock');           // ?mock=1 is for testing the page without downloading models
  const abs = p => new URL(p, document.baseURI).href;

  /* ---------- languages: [NLLB code, name, Tesseract OCR code] ---------- */
  const LANGS = [
    [EN, 'English', 'eng'], ['hin_Deva', 'Hindi · हिन्दी', 'hin'], ['npi_Deva', 'Nepali · नेपाली', 'nep'], ['ben_Beng', 'Bengali · বাংলা', 'ben'],
    ['zho_Hans', 'Chinese (simplified) · 中文', 'chi_sim'], ['zho_Hant', 'Chinese (traditional) · 中文', 'chi_tra'], ['jpn_Jpan', 'Japanese · 日本語', 'jpn'],
    ['kor_Hang', 'Korean · 한국어', 'kor'], ['fra_Latn', 'French', 'fra'], ['deu_Latn', 'German', 'deu'], ['spa_Latn', 'Spanish', 'spa'],
    ['por_Latn', 'Portuguese', 'por'], ['ita_Latn', 'Italian', 'ita'], ['nld_Latn', 'Dutch', 'nld'], ['rus_Cyrl', 'Russian · русский', 'rus'],
    ['ukr_Cyrl', 'Ukrainian', 'ukr'], ['arb_Arab', 'Arabic · العربية', 'ara'], ['urd_Arab', 'Urdu · اردو', 'urd'], ['pes_Arab', 'Persian · فارسی', 'fas'],
    ['tha_Thai', 'Thai · ไทย', 'tha'], ['vie_Latn', 'Vietnamese', 'vie'], ['ind_Latn', 'Indonesian', 'ind'], ['tur_Latn', 'Turkish', 'tur'],
    ['tam_Taml', 'Tamil · தமிழ்', 'tam'], ['tel_Telu', 'Telugu · తెలుగు', 'tel'], ['mar_Deva', 'Marathi · मराठी', 'mar'], ['sin_Sinh', 'Sinhala · සිංහල', 'sin'],
    ['bod_Tibt', 'Tibetan · བོད་ཡིག', 'bod'], [DZ, 'Dzongkha · རྫོང་ཁ།', 'dzo']
  ];
  const tessOf = code => (LANGS.find(l => l[0] === code) || LANGS[0])[2];

  const STOP = {
    fra_Latn: 'le la les des une est que pour dans avec sur pas qui nous vous ce cette',
    deu_Latn: 'der die das und ist nicht ein eine mit für von zu auf den dem',
    spa_Latn: 'el la los las una es que para con por del se no en un',
    por_Latn: 'o a os as uma é que para com por do da não em um',
    ita_Latn: 'il lo la gli le una è che per con non di del della in un',
    nld_Latn: 'de het een en is niet van voor met op dat die',
    ind_Latn: 'yang dan di ini itu untuk dengan tidak dari pada adalah',
    tur_Latn: 've bir bu için ile değil de da çok olarak',
    vie_Latn: 'và của là có không một những được trong cho',
    eng_Latn: 'the and is of to in that for with on are this it as was be'
  };
  const SCRIPTS = [
    [/[ༀ-࿿]/g, DZ], [/[ऀ-ॿ]/g, 'hin_Deva'], [/[ঀ-৿]/g, 'ben_Beng'], [/[஀-௿]/g, 'tam_Taml'], [/[ఀ-౿]/g, 'tel_Telu'],
    [/[඀-෿]/g, 'sin_Sinh'], [/[฀-๿]/g, 'tha_Thai'], [/[؀-ۿݐ-ݿ]/g, 'arb_Arab'], [/[Ѐ-ӿ]/g, 'rus_Cyrl'],
    [/[가-힯ᄀ-ᇿ]/g, 'kor_Hang'], [/[぀-ヿ]/g, 'jpn_Jpan'], [/[㐀-鿿]/g, 'zho_Hans']
  ];
  /** Guess the language from the writing system (and common words for Latin text). */
  function detectLang(text) {
    let best = null, bestN = 0;
    for (const [re, code] of SCRIPTS) { const n = (text.match(re) || []).length; if (n > bestN) { best = code; bestN = n; } }
    const latin = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (best && bestN >= latin * 0.3) return best;
    const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
    const count = list => { const set = new Set(list.split(' ')); return words.reduce((a, w) => a + (set.has(w) ? 1 : 0), 0); };
    let top = EN, topN = count(STOP[EN]);                       // English unless another language clearly wins
    for (const [code, list] of Object.entries(STOP)) { const n = count(list); if (n > topN && n >= 2) { top = code; topN = n; } }
    return top;
  }

  /* ---------- splitting text into pieces the model can handle ---------- */
  function splitParas(text, max = 260) {
    const paras = String(text).replace(/\r/g, '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    return paras.map(p => {
      const sentences = p.match(/[^.!?。！？།؟]+[.!?。！？།؟]*["'”’)\]]*\s*/g) || [p];
      const chunks = []; let cur = '';
      const push = s => { if (cur && (cur + s).length > max) { chunks.push(cur.trim()); cur = ''; } cur += s; };
      for (let s of sentences) {
        while (s.length > max * 1.6) {                         // very long sentence: cut at a comma or space
          let cut = s.lastIndexOf(',', max); if (cut < max * 0.4) cut = s.lastIndexOf(' ', max); if (cut < 1) cut = max;
          push(s.slice(0, cut + 1)); s = s.slice(cut + 1);
        }
        push(s);
      }
      if (cur.trim()) chunks.push(cur.trim());
      return chunks;
    }).filter(c => c.length);
  }

  /* ---------- verified word glossary (exact short terms override weak model output) ---------- */
  let glossary = [];
  const glossaryReady = fetch(abs('data/glossary.csv')).then(r => r.ok ? r.text() : '').then(t => {
    glossary = t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf(','); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; })
      .filter(row => row && row[0] && row[1]);
  }).catch(() => {});

  /* ---------- Dzongkha tidy-up (no AI): tsheg, shad, spaces + your corrections.csv ---------- */
  let corrections = [];
  fetch(abs('data/corrections.csv')).then(r => r.ok ? r.text() : '').then(t => {
    corrections = t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf(','); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter(Boolean);
  }).catch(() => {});

  function cleanDz(text, { withCorrections = true } = {}) {
    let t = String(text || '').replace(/\r\n/g, '\n');
    t = t.replace(/[​‌‍﻿]/g, '');
    t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/\*\*|__|`/g, '');
    t = t.replace(/([ༀ-࿿])\s*[.]\s+/g, '$1། ').replace(/([ༀ-࿿])\s*[.]\s*$/gm, '$1།');   // . → །
    t = t.replace(/་{2,}/g, '་').replace(/་[ \t]+(?=[ༀ-࿿])/g, '་');
    t = t.replace(/[ \t]+([།༎༑])/g, '$1');
    t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    t = t.trim();
    if (withCorrections) for (const [wrong, right] of corrections) t = t.split(wrong).join(right);
    return t;
  }
  /** Share of real Tibetan-script letters (to warn when some text stayed in another language). */
  function dzShare(text) {
    const t = String(text).replace(/\([^)]*\)|༼[^༽]*༽|\[[^\]]*\]/g, ' ');
    const letters = t.replace(/[\s\d\p{P}\p{S}•]/gu, '');
    return letters.length ? (letters.match(/[ༀ-࿿]/g) || []).length / letters.length : 1;
  }

  /* ---------- the model worker (real, or a fake one for ?mock=1) ---------- */
  class MockWorker {
    postMessage(d) {
      const reply = (m) => setTimeout(() => this.onmessage && this.onmessage({ data: m }), 0);
      const done = r => reply({ id: d.id, ok: true, result: r });
      if (d.op === 'load') {
        let i = 0; const t = setInterval(() => {
          i += 25; reply({ type: 'progress', key: d.key, p: { status: 'progress', file: 'model.onnx', loaded: i * 1e6, total: 100e6, progress: i } });
          if (i >= 100) { clearInterval(t); reply({ type: 'progress', key: d.key, p: { status: 'ready' } }); done({ gpu: false }); }
        }, 40);
      } else if (d.op === 'translate') setTimeout(() => done(d.tgt === DZ ? 'འདི་ནི་ཚོད་ལྟའི་ཡིག་ཆ་ཅིག་ཨིན། ' + d.text.length : 'English text: ' + d.text), 25);
      else if (d.op === 'generate') setTimeout(() => done('This is a test answer. Thimphu is the capital of Bhutan.'), 25);
      else if (d.op === 'transcribe') setTimeout(() => done('hello this is my voice'), 25);
    }
  }
  const worker = mock ? new MockWorker() : new Worker(abs('js/worker.js'), { type: 'module' });
  const pending = new Map(); let seq = 0;
  const dl = {};                                     // download progress per model
  const NAMES = { mt: 'Translation model (NLLB-200)', llm_fast: 'Chat model (Qwen2.5 0.5B)', llm_better: 'Chat model (Qwen2.5 1.5B)', asr: 'Voice model (Whisper)' };
  const api = { onDownload: () => {}, hasGPU: !!navigator.gpu, mock, ready: {}, beams: 3 };   // beams: 1 fast · 3 better · 5 best

  worker.onmessage = ({ data }) => {
    if (data.type === 'alive') { api.workerAlive = true; return; }
    if (data.type === 'progress') {
      const d = dl[data.key] || (dl[data.key] = { files: {} }), p = data.p || {};
      if (p.status === 'progress' && p.file) d.files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      const vals = Object.values(d.files), total = vals.reduce((a, f) => a + f.total, 0), loaded = vals.reduce((a, f) => a + f.loaded, 0);
      const ready = p.status === 'ready';
      api.onDownload({ key: data.key, name: NAMES[data.key], pct: ready ? 100 : total ? Math.min(99, Math.round(loaded / total * 100)) : 0, mb: Math.round(total / 1e6), ready });
      return;
    }
    const h = pending.get(data.id); if (!h) return; pending.delete(data.id);
    data.ok ? h.resolve(data.result) : h.reject(new Error(data.error));
  };
  let dead = null;                                   // set if the worker crashes at start-up
  worker.onerror = e => {
    dead = 'The AI worker could not start' + (e && e.message ? ': ' + e.message : '. Open the page from http://localhost (not from a file) and use a recent Chrome or Edge.');
    if (e && e.preventDefault) e.preventDefault();
    pending.forEach(h => h.reject(new Error(dead))); pending.clear();
  };
  worker.onmessageerror = () => { dead = 'The AI worker sent an unreadable message.'; };
  const call = (op, payload) => new Promise((resolve, reject) => {
    if (dead) return reject(new Error(dead));
    const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...payload });
  });

  /** Download (first time only) and start a model. */
  async function ensure(key) {
    if (api.ready[key]) return;
    await call('load', { key });
    api.ready[key] = true;
  }

  /* ---------- jobs (so the Stop button works) ---------- */
  api.newJob = () => ({ cancelled: false, cancel() { this.cancelled = true; } });
  const check = job => { if (job && job.cancelled) throw new Error('Stopped.'); };

  /** Verified glossary, other direction: a standalone Dzongkha word/phrase -> its English source term. */
  const normDz = t => String(t || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[།༎\s]+$/u, '').replace(/་+$/u, '').replace(/\s+/g, '').trim();
  function glossaryReverse(text) {
    const key = normDz(text);
    if (!key || key.length > 80) return null;
    const hit = glossary.find(([, dz]) => normDz(dz) === key);
    return hit ? hit[0] : null;
  }

  /* ---------- translating ---------- */
  /** Translate text between any two NLLB languages; long text is done piece by piece. */
  async function mt(text, src, tgt, job, step) {
    if (src === tgt) return text;
    // For a standalone word/short phrase, prefer an explicitly curated glossary entry.
    // This makes verified vocabulary reliable even when the offline NLLB model guesses poorly.
    if (tgt === DZ && src !== DZ) {
      await glossaryReady;
      const key = String(text || '').trim().toLocaleLowerCase().replace(/[.!?。！？།]+$/u, '').trim();
      const hit = glossary.find(([from]) => from.toLocaleLowerCase() === key);
      if (hit) { step && step(1, text.length); return cleanDz(hit[1], { withCorrections: false }); }
    }
    if (src === DZ && tgt === EN) {                       // verified Dzongkha word -> its English meaning
      await glossaryReady;
      const hit = glossaryReverse(text);
      if (hit) { step && step(1, text.length); return hit; }
    }
    await ensure('mt');
    const paras = splitParas(text), total = paras.reduce((a, p) => a + p.length, 0);
    let n = 0; const out = [];
    for (const chunks of paras) {
      const pieces = [];
      for (const c of chunks) {
        check(job);
        let r = await call('translate', { text: c, src, tgt, beams: api.beams });
        if (tgt === DZ) r = cleanDz(r, { withCorrections: false });
        pieces.push(r); n++; step && step(n, total);
      }
      out.push(pieces.join(' '));
    }
    const joined = out.join('\n\n');
    return tgt === DZ ? cleanDz(joined) : joined;
  }

  /* ---------- reading files: text, Word, PDF (even scanned), images (OCR) ---------- */
  const ocrWorkers = {};
  async function ocr(source, lang, status) {
    if (typeof Tesseract === 'undefined') await loadScript('vendor/tesseract/tesseract.min.js');
    const tess = tessOf(lang);
    if (!ocrWorkers[tess]) {
      ocrWorkers[tess] = Tesseract.createWorker(tess, 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract/'),
        logger: m => { if (status && m.status) status(`Reading picture: ${m.status} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`); }
      });
    }
    const w = await ocrWorkers[tess];
    const { data } = await w.recognize(source);
    return data.text || '';
  }
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = abs(src); s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });

  async function readFile(file, lang, status) {
    const name = (file.name || '').toLowerCase(), type = file.type || '';
    if (type.startsWith('image/')) return ocr(file, lang, status);
    if (name.endsWith('.docx')) {
      if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js');
      return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    if (name.endsWith('.pdf') || type === 'application/pdf') {
      const pdfjs = await import(abs('vendor/pdf.min.mjs'));
      pdfjs.GlobalWorkerOptions.workerSrc = abs('vendor/pdf.worker.min.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        status && status(`Reading PDF page ${i} of ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        let t = tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
        if (t.length < 20) {                                    // scanned page → OCR it
          const vp = page.getViewport({ scale: 2 }), cv = document.createElement('canvas');
          cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          t = (await ocr(cv, lang, status)).trim();
        }
        pages.push(t);
      }
      return pages.join('\n\n');
    }
    return file.text();                                         // .txt .md .csv
  }
  api.readFiles = async (files, lang, status) => {
    const parts = [];
    for (const f of files) { status && status(`Reading ${f.name || 'image'}…`); parts.push((await readFile(f, lang, status)).trim()); }
    return parts.filter(Boolean).join('\n\n');
  };

  /* ---------- summary: pick the best sentences (works without a chat model) ---------- */
  const STOPEN = new Set('the a an and or but of to in on at for with by from as is are was were be been it its this that these those he she they we you i his her their our your not no so if then than also can could will would may might has have had do does did into about over after before which who whom what when where how'.split(' '));
  function extractive(text, { length, style, focus }) {
    const sents = (text.replace(/\n+/g, ' \n').match(/[^.!?。！？]+[.!?。！？]*/g) || []).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 4);
    if (!sents.length) return [text.trim()];
    const tf = {}; const toks = s => (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter(w => !STOPEN.has(w) && w.length > 2);
    sents.forEach(s => toks(s).forEach(w => { tf[w] = (tf[w] || 0) + 1; }));
    const fw = new Set(toks(focus || ''));
    const scored = sents.map((s, i) => {
      const t = toks(s); let sc = t.reduce((a, w) => a + tf[w], 0) / Math.sqrt(t.length + 1);
      if (i < 2) sc *= 1.25; t.forEach(w => { if (fw.has(w)) sc += 4; });
      if (style === 'simple') sc /= Math.max(1, s.split(/\s+/).length / 14);     // prefer short sentences
      return { i, s, sc };
    });
    const want = { short: [3, 0.1], medium: [6, 0.2], detailed: [12, 0.35] }[length] || [6, 0.2];
    let n = Math.min(sents.length, Math.max(want[0], Math.ceil(sents.length * want[1])), want[0] * 3);
    if (style === 'keypoints') n = Math.min(n, 6);
    return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map(x => x.s);
  }

  const LEN_TXT = { short: '2 to 3 sentences', medium: 'about 5 to 6 sentences', detailed: 'about 10 sentences' };
  const STYLE_TXT = { paragraph: 'one clear paragraph', bullets: 'a bulleted list (each line starts with "- ")', keypoints: 'a list of the 5 most important key points (each line starts with "- ")', simple: 'very simple words that a child can understand, in a short paragraph' };
  const ask = (key, system, user, max, job) => { check(job); return call('generate', { key, max, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }); };

  async function smartSummary(en, o, key, job, step) {
    const pieces = []; const parts = en.match(/[\s\S]{1,2600}(?:\s|$)/g) || [en];
    for (let i = 0; i < parts.length; i++) {
      step && step(`Summarising part ${i + 1} of ${parts.length}…`);
      pieces.push(await ask(key, 'You are a careful summariser. Use only facts from the text. Write plain English.',
        `Summarise the text below in ${LEN_TXT[parts.length > 1 ? 'medium' : o.length]}.${o.focus ? ' Focus on: ' + o.focus + '.' : ''}\n\nTEXT:\n${parts[i]}`, 300, job));
    }
    let merged = pieces.join('\n');
    if (parts.length > 1) { step && step('Joining the parts…'); merged = await ask(key, 'You are a careful summariser. Use only facts from the text. Write plain English.', `Combine these notes into a final summary of ${LEN_TXT[o.length]}.\n\n${merged}`, 400, job); }
    return merged;
  }

  /** Format the English summary lines according to the chosen style. */
  function lines(summaryEn, style) {
    const raw = summaryEn.split(/\n+/).map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
    if (style === 'bullets' || style === 'keypoints') return raw.length > 1 ? raw : (summaryEn.match(/[^.!?]+[.!?]*/g) || raw).map(s => s.trim()).filter(Boolean);
    return [raw.join(' ')];
  }

  /**
   * Summary in Dzongkha.  any language → English → pick/write summary → Dzongkha
   * opts: {length, style, focus, smart, src, model}
   */
  const localSummarise = async (text, opts, job, step) => {
    const src = opts.src || detectLang(text);
    const total = 3;
    step(`Step 1 of ${total}: understanding the text…`);
    const en = await mt(text, src, EN, job, (n, t) => step(`Step 1 of ${total}: reading… (${n}/${t})`));
    let focusEn = opts.focus || '';
    if (focusEn && detectLang(focusEn) !== EN) focusEn = await mt(focusEn, detectLang(focusEn), EN, job);
    step(`Step 2 of ${total}: choosing the main points…`);
    let summary;
    let method = 'extractive';
    if (opts.smart) {
      await ensure(opts.model || 'llm_fast');
      summary = await smartSummary(en, { ...opts, focus: focusEn }, opts.model || 'llm_fast', job, m => step(`Step 2 of ${total}: ${m}`));
      method = 'generative';
    } else {
      summary = extractive(en, { ...opts, focus: focusEn }).join(opts.style === 'bullets' || opts.style === 'keypoints' ? '\n' : ' ');
    }
    const items = lines(summary, opts.style);
    step(`Step 3 of ${total}: writing in Dzongkha…`);
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const dz = await mt(items[i], EN, DZ, job);
      out.push((opts.style === 'bullets' || opts.style === 'keypoints') ? '• ' + dz : dz);
    }
    const dz = out.join('\n');
    return { dz, en: items.join('\n'), src, method, local: true };
  };

  /** Translate (full text) and optionally add a plain-words explanation. */
  const localTranslate = async (text, opts, job, step) => {
    const src = opts.src || detectLang(text);
    if (src === DZ) return { dz: cleanDz(text), src, already: true };
    step('Translating into Dzongkha…');
    const dz = await mt(text, src, DZ, job, (n, t) => step(`Translating… (${n} of ${t})`));
    let explain = '';
    if (opts.explain) {
      step('Explaining the meaning…');
      await ensure(opts.model);
      const en = await mt(text, src, EN, job);
      const ex = await ask(opts.model, 'You explain texts clearly. Use only the facts in the text. Write plain, simple English with short sentences.',
        `Explain the full meaning of this text in simple words, in 3 to 6 short sentences.\n\nTEXT:\n${en.slice(0, 3000)}`, 300, job);
      explain = await mt(ex, EN, DZ, job);
    }
    return { dz, explain, src };
  };

  /* ---------- Ollama (free, runs on your own computer): the best chat quality ---------- */
  const OLLAMA = 'http://localhost:11434';
  api.ollamaModels = async () => {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2500) });
    return ((await r.json()).models || []).map(m => m.name);
  };
  async function ollamaChat(model, messages) {
    let r;
    try { r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.4, num_predict: 900 } }) }); }
    catch { throw new Error('Ollama is not running. Install it from ollama.com, run "ollama pull ' + model + '" and keep it open.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ollama error ' + r.status);
    return j.message.content;
  }

  /** Chat: question (any language) → English answer (full, like ChatGPT) → Dzongkha, paragraph by paragraph. */
  const SYS_CHAT = 'You are Dzongkha Lamton, a careful and helpful assistant. First identify exactly what the user asks, then answer that question directly. Match the length to the question: a greeting gets a short greeting, a simple question gets a concise explanation, and a complex question gets organised detail. Use only reliable facts; never invent dates, numbers, quotations, sources or details from a document. If unsure, say so. Use the conversation history for follow-up questions. When a document is supplied, answer only from its readable contents and say when information is missing. Write plain, simple English because the answer will be translated into Dzongkha. Avoid unrelated information and unnecessary long essays.';
  const localChat = async ({ message, context, history, model, ollamaModel }, job, step, onPart) => {
    const src = detectLang(message || context || '');
    step('Understanding your question…');
    const q = message ? await mt(message, src, EN, job) : 'Please summarise the document.';
    const ctx = context ? await mt(context.slice(0, 4000), detectLang(context), EN, job) : '';
    // The local Qwen model is prompted in English. Convert Dzongkha chat history too;
    // otherwise old Dzongkha turns are mixed into an English-only prompt and follow-ups drift.
    const recentHistory = [];
    for (const item of history.slice(-8)) {
      const content = String(item.content || '');
      const lang = detectLang(content);
      const english = lang === EN ? content : await mt(content, lang, EN, job);
      recentHistory.push({ role: item.role, content: english });
    }
    const messages = [{ role: 'system', content: SYS_CHAT }, ...recentHistory,
      { role: 'user', content: ctx ? `Use the document as source material. Do not invent facts.\nDocument:\n${ctx.slice(0, 3000)}\n\nQuestion: ${q}` : q }];
    check(job);
    let en;
    if (model === 'ollama') { step(`Thinking with ${ollamaModel}…`); en = await ollamaChat(ollamaModel, messages); }
    else { await ensure(model); step('Thinking… (a full answer can take a minute or two)'); en = await call('generate', { key: model, messages, max: 700 }); }
    en = en.trim();
    // translate paragraph by paragraph so the answer appears as it is written
    const paras = en.replace(/\*\*|__|^#+\s*/gm, '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < paras.length; i++) {
      step(`Writing in Dzongkha… (${i + 1} of ${paras.length})`);
      out.push(await mt(paras[i].replace(/^[-•*]\s*/, ''), EN, DZ, job));
      onPart && onPart(out.join('\n\n'));
    }
    return { dz: out.join('\n\n'), en, q };
  };


  /* ==========================================================
     ONLINE ENGINE (through the backend): writes Dzongkha directly with the DDC grammar rules,
     then proofreads it again.  Pictures and PDFs are read by the AI itself (no OCR needed).
     ========================================================== */
  const P = () => window.DzoPrompts, Cl = () => window.DzoCloud;
  api.proofread = false; api.proofreadChat = true;       // check online chat answers by default for better Dzongkha grammar
  Object.defineProperty(api, 'mode', { get: () => (window.DzoCloud ? Cl().mode() : 'local') });

  const toBase64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
  /** Turns uploaded files into text (Word, txt, offline OCR) and, for the online engine, raw pictures/PDFs. */
  api.prepare = async (files, lang, status) => {
    const media = [], rest = []; let total = 0;
    const useMedia = api.mode === 'cloud' && Cl().canReadFiles();
    for (const f of files) {
      const pdf = /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''), img = (f.type || '').startsWith('image/');
      if (useMedia && (pdf || img) && f.size <= 12e6 && total + f.size <= 16e6) { total += f.size; media.push({ mime: pdf ? 'application/pdf' : (f.type || 'image/png'), data: await toBase64(f), name: f.name }); }
      else rest.push(f);
    }
    return { text: rest.length ? await api.readFiles(rest, lang, status) : '', media };
  };

  function groupParas(text, max) {                     // big pieces (about max characters) that end at paragraph breaks
    const out = []; let cur = '';
    for (const para of text.replace(/\r/g, '').split(/\n/)) {
      if (cur && (cur + '\n' + para).length > max) { out.push(cur); cur = ''; }
      cur += (cur ? '\n' : '') + para;
      while (cur.length > max * 1.5) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  /** Second pass: re-check Dzongkha spelling and grammar against the source meaning. Keeps the draft if the checker does something odd. */
  async function polish(draft, source) {
    if (dzShare(draft) <= 0.5) return draft;
    try {
      const fixed = cleanDz(await Cl().generate({ system: P().PROOFREAD_PROMPT,
        messages: [{ role: 'user', content: `SOURCE (only to check the meaning, never output it):\n${(source || '').slice(0, 6000)}\n\nDZONGKHA TEXT TO PROOFREAD:\n${draft}` }] }));
      if (dzShare(fixed) >= 0.7 && fixed.length > draft.length * 0.6) return fixed;
    } catch (e) { if (/stopped/i.test(e.message)) throw e; }
    return draft;
  }
  /** One write + (optional) proofreading pass. */
  async function cloudWrite({ system, user, media, history = [], job, step, onPart, proof, source }) {
    check(job);
    let draft = await Cl().generate({ system, messages: [...history, { role: 'user', content: user }], media, onToken: onPart ? (t, all) => onPart(all) : undefined });
    draft = cleanDz(draft);
    if (proof) { check(job); step && step('Checking spelling and grammar again…'); draft = await polish(draft, source || user); }
    return draft;
  }

  /* Translation engines (set on the backend, TRANSLATION_ENGINE in .env):
       gemini         the AI writes the Dzongkha following the DDC rules (default; also reads pictures and PDFs)
       google         Google Cloud Translation (official machine translation, supports Dzongkha)
       google+gemini  Google translates, then the AI polishes spelling and grammar
     If the first choice fails or is busy the other one is tried, so the person is not left without an answer. */
  const ISO = { eng_Latn: 'en', hin_Deva: 'hi', npi_Deva: 'ne', ben_Beng: 'bn', zho_Hans: 'zh-CN', zho_Hant: 'zh-TW', jpn_Jpan: 'ja', kor_Hang: 'ko', fra_Latn: 'fr', deu_Latn: 'de', spa_Latn: 'es',
    por_Latn: 'pt', ita_Latn: 'it', nld_Latn: 'nl', rus_Cyrl: 'ru', ukr_Cyrl: 'uk', arb_Arab: 'ar', urd_Arab: 'ur', pes_Arab: 'fa', tha_Thai: 'th', vie_Latn: 'vi', ind_Latn: 'id', tur_Latn: 'tr',
    tam_Taml: 'ta', tel_Telu: 'te', mar_Deva: 'mr' };
  // Free, keyless Google Translate web endpoint. It is unofficial and can be rate-limited,
  // so every failure is caught and the app continues to its configured/local fallback.
  const FREE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
  async function freeGoogleTranslate(text, opts, job, step, onPart) {
    const src = opts.src || detectLang(text);
    if (src === DZ) return { dz: cleanDz(text), src, already: true };
    const chunks = groupParas(text, 3500), out = [];
    for (let i = 0; i < chunks.length; i++) {
      check(job);
      step(chunks.length > 1 ? `Trying free online translation… (${i + 1} of ${chunks.length})` : 'Trying free online translation…');
      const params = new URLSearchParams({ client: 'gtx', sl: ISO[src] || (src === 'auto' ? 'auto' : 'auto'), tl: 'dz', dt: 't', q: chunks[i] });
      const response = await fetch(`${FREE_TRANSLATE_URL}?${params.toString()}`, {
        method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`Free translation service returned HTTP ${response.status}.`);
      const payload = await response.json();
      const translated = Array.isArray(payload?.[0]) ? payload[0].map(part => Array.isArray(part) ? part[0] || '' : '').join('') : '';
      if (!translated.trim()) throw new Error('Free translation service returned an empty answer.');
      const dz = cleanDz(translated);
      out.push(dz);
      onPart && onPart(out.join('\n\n'));
    }
    return { dz: cleanDz(out.join('\n\n')), src, cloud: true, via: 'free-google' };
  }
  async function glossaryTranslation(text, src, job, step) {
    if (src === DZ) return null;
    await glossaryReady;
    const key = String(text || '').trim().toLocaleLowerCase().replace(/[.!?。！？།]+$/u, '').trim();
    if (!key || key.length > 80) return null;
    const hit = glossary.find(([from]) => from.toLocaleLowerCase() === key);
    return hit ? { dz: cleanDz(hit[1], { withCorrections: false }), src, cloud: true, via: 'verified-glossary' } : null;
  }

  /* ==========================================================
     FREE ONLINE ENGINE (no key, works from the static page)
     Used for BOTH directions so the chatbot and summary understand words exactly as well as the Translate tab does:
       question (any language) --free Google Translate--> English --free chat model--> English answer --free Google Translate--> Dzongkha
     If the free service fails, the user chooses: retry, use the offline local models, or cancel.
     ========================================================== */
  const GTX2 = 'https://clients5.google.com/translate_a/t';
  const isoOf = code => code === DZ ? 'dz' : code === 'bod_Tibt' ? 'bo' : (ISO[code] || 'auto');
  async function gtxOne(q, sl, tl) {                       // main free endpoint
    const params = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q });
    const r = await fetch(`${FREE_TRANSLATE_URL}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const t = Array.isArray(j?.[0]) ? j[0].map(x => Array.isArray(x) ? x[0] || '' : '').join('') : '';
    if (!t.trim()) throw new Error('empty answer');
    return t;
  }
  async function gtxTwo(q, sl, tl) {                       // second free endpoint, tried if the first one is blocked
    const params = new URLSearchParams({ client: 'dict-chrome-ex', sl, tl, q });
    const r = await fetch(`${GTX2}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const t = Array.isArray(j) ? j.map(x => Array.isArray(x) ? x[0] : x).join('') : (j.sentences || []).map(x => x.trans).join('');
    if (!String(t).trim()) throw new Error('empty answer');
    return String(t);
  }
  /** Free online translation between any two supported languages. Verified glossary words win over the machine.
      Results are remembered (same text is never translated twice) and long text is translated in parallel pieces. */
  const tcache = new Map();
  async function gtxAny(chunk, sl, tl) {
    try { return await gtxOne(chunk, sl, tl); }
    catch (e1) { try { return await gtxTwo(chunk, sl, tl); } catch { throw new Error(`The free translation service is unavailable (${e1.message}).`); } }
  }
  async function onlineMt(text, src, tgt, job) {
    if (!text || !String(text).trim() || src === tgt) return text;
    await glossaryReady;
    if (tgt === DZ) { const g = await glossaryTranslation(text, src); if (g) return g.dz; }
    else if (src === DZ) { const g = glossaryReverse(text); if (g) return g; }
    const ck = `${src}|${tgt}|${text}`; if (tcache.has(ck)) return tcache.get(ck);
    const sl = src === 'auto' ? 'auto' : isoOf(src), tl = isoOf(tgt);
    check(job);
    const parts = await Promise.all(groupParas(String(text), 3000).map(c => gtxAny(c, sl, tl)));   // pieces run at the same time
    check(job);
    const res = parts.map(t => tgt === DZ ? cleanDz(t) : t.trim()).join('\n');
    if (tcache.size > 400) tcache.clear(); tcache.set(ck, res);
    return res;
  }
  /** Many short items (words, summary lines) in ONE request; falls back to one request each if the count does not match. */
  async function onlineMtMany(items, src, tgt, job) {
    const list = items.map(x => String(x || '').trim());
    if (!list.length || src === tgt) return list;
    const out = new Array(list.length), todo = [];
    await glossaryReady;
    for (let i = 0; i < list.length; i++) {
      const hit = tgt === DZ ? (await glossaryTranslation(list[i], src))?.dz : src === DZ ? glossaryReverse(list[i]) : null;
      const c = tcache.get(`${src}|${tgt}|${list[i]}`);
      if (hit) out[i] = hit; else if (c !== undefined) out[i] = c; else todo.push(i);
    }
    if (todo.length) {
      const sl = src === 'auto' ? 'auto' : isoOf(src), tl = isoOf(tgt);
      let got = null;
      if (todo.length > 1) {
        try { const r = (await gtxAny(todo.map(i => list[i].replace(/\n+/g, ' ')).join('\n'), sl, tl)).split(/\n+/).map(x => x.trim()).filter(Boolean); if (r.length === todo.length) got = r; } catch { /* use single requests below */ }
      }
      if (!got) got = await Promise.all(todo.map(i => gtxAny(list[i], sl, tl).then(t => t.trim())));
      todo.forEach((i, k) => { const v = tgt === DZ ? cleanDz(got[k]) : got[k]; out[i] = v; tcache.set(`${src}|${tgt}|${list[i]}`, v); });
    }
    return out;
  }

  /* ---------- word by word: split the question into words and get each word's meaning ---------- */
  function keyWords(text, src) {
    const t = String(text || '');
    let words;
    if (src === DZ) words = api.space(t, true).split(/[\s།༎༑,.?!]+/).map(w => w.replace(/་+$/, '').trim());
    else words = t.split(/[\s,.;:!?()"“”‘’¿¡、。！？，]+/).map(w => w.trim());
    const seen = new Set(), out = [];
    for (const w of words) { const k = w.toLocaleLowerCase(); if (!w || /^[\d\p{P}\p{S}\s_]+$/u.test(w) || seen.has(k)) continue; seen.add(k); out.push(w); }
    return out;
  }
  /** [{w, m}] : every word of the user's question with its meaning (to English, or to Dzongkha when the question is English). */
  async function wordMeanings(text, src, job) {
    const words = keyWords(text, src);
    if (!words.length || words.length > 14) return [];             // long questions: the whole-sentence translation is enough (and faster)
    const tgt = src === EN ? DZ : EN;
    try { const m = await onlineMtMany(words.slice(0, 10), src, tgt, job); return words.slice(0, 10).map((w, i) => ({ w, m: m[i] })).filter(x => x.m); }
    catch (e) { if (/stopped/i.test(e.message)) throw e; return []; }
  }

  /* Free keyless chat model (OpenAI-compatible). Only ever sees ENGLISH text, which models handle well. */
  const FREE_LLM_URL = 'https://text.pollinations.ai/openai';
  async function freeLLM(messages, job, max = 700, onDelta) {
    check(job);
    let r;
    try { r = await fetch(FREE_LLM_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ model: 'openai', messages, temperature: 0.3, max_tokens: max, private: true, stream: !!onDelta }) }); }
    catch { throw new Error('The free chat service could not be reached.'); }
    if (!r.ok) throw new Error(`The free chat service returned HTTP ${r.status}.`);
    if (onDelta && r.body && /event-stream/i.test(r.headers.get('content-type') || '')) {      // streaming: words arrive while the model is still writing
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', text = '';
      for (;;) {
        check(job);
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
          try { const d = JSON.parse(line.slice(5)).choices[0].delta.content; if (d) { text += d; onDelta(d); } } catch { /* ignore a broken line */ }
        }
      }
      if (!text.trim()) throw new Error('The free chat service returned an empty answer.');
      return text.trim();
    }
    const j = await r.json().catch(() => ({}));
    const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!t || !String(t).trim()) throw new Error('The free chat service returned an empty answer.');
    if (onDelta) onDelta(String(t));
    return String(t).trim();
  }
  const WORD_RULE = ' You are given the question, the meaning of each of its words, and the original text. Combine the meaning of ALL the words to understand exactly what is asked, then answer that question directly and briefly (usually under 120 words) in plain, simple English. If the question is only a word or a short phrase, give its meaning in one or two simple sentences with a short example. The question was machine-translated, so a small wording error is possible: when the English looks odd, trust the word meanings.';
  async function toEnglishHistory(history, job) {
    const out = [];
    for (const item of (history || []).slice(-6)) {
      const content = String(item.content || ''), lang = detectLang(content);
      out.push({ role: item.role, content: lang === EN ? content : await onlineMt(content, lang, EN, job) });
    }
    return out;
  }
  /** Take the finished lines (and, for long lines, finished sentences) out of the text the model is still writing. */
  function takeDone(buf, force) {
    if (force) return { done: buf.trim() ? [buf.trim()] : [], rest: '' };
    const lines = buf.split('\n'); let rest = lines.pop(); const done = lines.map(x => x.trim()).filter(Boolean);
    if (rest.length > 200) { const m = [...rest.matchAll(/[.!?]\s/g)].pop(); if (m) { done.push(rest.slice(0, m.index + 1).trim()); rest = rest.slice(m.index + 2); } }
    return { done, rest };
  }
  /** Chatbot, free route.
      1. split the question into words and get every word's meaning  +  translate the whole question   (all at the same time)
      2. the free chat model combines the meanings and answers in English (streaming)
      3. every finished paragraph is translated into Dzongkha while the model is still writing the next one. */
  const freeChat = async ({ message, context, history }, job, step, onPart) => {
    const src = detectLang(message || context || '');
    step('Understanding your words…');
    const [q, words, ctx, hist] = await Promise.all([
      message ? onlineMt(message, src, EN, job) : 'Please summarise the document.',
      message ? wordMeanings(message, src, job) : [],
      context ? onlineMt(context.slice(0, 6000), detectLang(context), EN, job) : '',
      toEnglishHistory(history, job)]);
    const meaning = src !== EN && words.length ? `\nMeaning of each word: ${words.map(x => `${x.w} = ${x.m}`).join('; ')}` : '';
    const original = message && src !== EN ? `\nOriginal text of the question (${(LANGS.find(l => l[0] === src) || [0, src])[1]}): ${message}` : '';
    const user = ctx ? `Use the document as source material. Do not invent facts.\nDocument:\n${ctx.slice(0, 5000)}\n\nQuestion: ${q}${meaning}${original}` : `Question: ${q}${meaning}${original}`;
    step('Thinking…');
    const doneDz = []; let buf = '', chain = Promise.resolve();
    const push = chunk => { const c = chunk.replace(/\*\*|__|^#+\s*/gm, '').replace(/^[-*]\s+/, '• ').trim(); if (!c) return;
      chain = chain.then(async () => { const dz = await onlineMt(c, EN, DZ, job); doneDz.push(dz); onPart && onPart(doneDz.join('\n\n')); }); };
    let en;
    try {
      en = await freeLLM([{ role: 'system', content: SYS_CHAT + WORD_RULE }, ...hist, { role: 'user', content: user }], job, 450, d => {
        buf += d; const t = takeDone(buf, false); buf = t.rest; t.done.forEach(push); });
      takeDone(buf, true).done.forEach(push);
      step('Writing in Dzongkha…');
      await chain;
    } catch (e) { chain.catch(() => {}); throw e; }
    en = en.replace(/\*\*|__|^#+\s*/gm, '').trim();
    return { dz: doneDz.join('\n\n'), en, q, understood: src !== EN ? q : '', words, hist: en, cloud: true, via: 'free' };
  };

  /** Summary, free route: any language -> English (online) -> good summary (free chat model, or best-sentence picker) -> Dzongkha (online). */
  async function freeSummaryText(en, o, job, step) {
    const parts = groupParas(en, 6000);
    const sys = 'You are a careful summariser. Use only facts from the text. Keep important names, numbers and dates. Write plain English.';
    const cap = { short: 220, medium: 380, detailed: 650 }[o.length] || 380;
    step(parts.length > 1 ? `Step 2 of 3: summarising ${parts.length} parts at the same time…` : 'Step 2 of 3: writing the summary…');
    const len = parts.length > 1 ? 'medium' : o.length;
    const notes = await Promise.all(parts.map(part => freeLLM([{ role: 'system', content: sys }, { role: 'user', content:      // all parts at the same time
      `Summarise the text below in ${LEN_TXT[len] || LEN_TXT.medium}, as ${STYLE_TXT[o.style] || STYLE_TXT.paragraph}.${o.focus ? ' Focus on: ' + o.focus + '.' : ''} Do not add anything that is not in the text.\n\nTEXT:\n${part}` }], job, parts.length > 1 ? 380 : cap)));
    if (parts.length === 1) return notes[0];
    return freeLLM([{ role: 'system', content: sys }, { role: 'user', content: `Combine these notes into one final summary of ${LEN_TXT[o.length] || LEN_TXT.medium}, as ${STYLE_TXT[o.style] || STYLE_TXT.paragraph}.\n\n${notes.join('\n')}` }], job, cap);
  }
  const freeSummarise = async (text, opts, job, step) => {
    const src = opts.src || detectLang(text);
    step('Step 1 of 3: understanding the text…');
    const fl = opts.focus || '';
    const [en, focusEn] = await Promise.all([src === EN ? text : onlineMt(text, src, EN, job),            // text and focus together
      fl && detectLang(fl) !== EN ? onlineMt(fl, detectLang(fl), EN, job) : fl]);
    const o = { ...opts, focus: focusEn };
    let summary, method = 'generative';
    try { summary = await freeSummaryText(en, o, job, step); }
    catch (e) {
      if (/stopped/i.test(e.message)) throw e;
      step('Step 2 of 3: choosing the main points…'); method = 'extractive';       // the chat model is busy: pick the best sentences instead
      summary = extractive(en, o).join(o.style === 'bullets' || o.style === 'keypoints' ? '\n' : ' ');
    }
    const items = lines(summary, opts.style);
    step('Step 3 of 3: writing in Dzongkha…');
    const dzs = await onlineMtMany(items, EN, DZ, job);                                                       // all lines in ONE request
    const out = dzs.map(dz => (opts.style === 'bullets' || opts.style === 'keypoints') ? '• ' + dz : dz);
    return { dz: out.join('\n'), en: items.join('\n'), src, method, cloud: true, via: 'free' };
  };

  /* When the free online route fails the USER chooses: use the offline local models, try online again, or cancel.
     api.fallbackPolicy: 'ask' (default) | 'local' (go offline automatically) | 'never' (just show the error).
     api.chooseFallback is set by the page (app.js) and shows the question. */
  api.fallbackPolicy = 'ask';
  async function askFallback(task, reason) {
    if (api.fallbackPolicy === 'local') return 'local';
    if (api.fallbackPolicy === 'never') return 'cancel';
    return api.chooseFallback ? api.chooseFallback({ task, reason }) : 'local';
  }
  async function withFallback({ task, label, online, local, step }) {
    let why = '';
    for (let tries = 0; tries < 3; tries++) {
      try { return await online(); }
      catch (e) {
        if (/stopped/i.test(e.message)) throw e;
        why = e.message;
        const choice = await askFallback(task, why);
        if (choice === 'retry') { step && step('Trying the online service again…'); continue; }
        if (choice === 'local') {
          step && step('Starting the offline open-source model; the first download may take a few minutes…');
          try { const r = await local(); r.fallback = label; r.fallbackWhy = why; return r; }
          catch (le) { throw new Error(`The online service failed (${why}) and the offline model could not start (${le.message}). Check your internet connection for the first model download, then try again.`); }
        }
        throw new Error(`Stopped. The online service failed (${why}).`);
      }
    }
    throw new Error(`The online service kept failing (${why}).`);
  }

  const tinfo = () => (Cl().backend && Cl().backend.translate) || {};
  async function googleTranslate(text, opts, job, step, onPart) {
    const chunks = groupParas(text, 4000), out = [];
    for (let i = 0; i < chunks.length; i++) {
      check(job); step(chunks.length > 1 ? `Translating… (part ${i + 1} of ${chunks.length})` : 'Translating…');
      let d = cleanDz((await Cl().post('api/translate', { text: chunks[i], sl: ISO[opts.src] || '' })).text);
      onPart && onPart([...out, d].join('\n\n'));
      if (tinfo().engine === 'google+gemini' && Cl().canReadFiles()) { step('Checking spelling and grammar…'); d = await polish(d, chunks[i]); onPart && onPart([...out, d].join('\n\n')); }
      out.push(d);
    }
    return { dz: cleanDz(out.join('\n\n')), src: opts.src, cloud: true };
  }
  async function geminiTranslate(text, opts, job, step, onPart) {
    const chunks = text.trim() ? groupParas(text, 5000) : [''];
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      step(chunks.length > 1 ? `Writing in Dzongkha… (part ${i + 1} of ${chunks.length})` : 'Writing in Dzongkha…');
      const prefix = out.length ? out.join('\n\n') + '\n\n' : '';
      out.push(await cloudWrite({ system: P().TRANSLATE_PROMPT, user: chunks[i] || 'Read the attached file and write its full meaning in Dzongkha.',
        media: i === 0 ? opts.media : undefined, job, step, proof: api.proofread, source: chunks[i], onPart: onPart && (t => onPart(prefix + t)) }));
    }
    return { dz: cleanDz(out.join('\n\n')), src: opts.src, cloud: true };
  }
  const cloudTranslate = async (text, opts, job, step, onPart) => {
    const t = tinfo(), textOnly = text.trim() && !(opts.media && opts.media.length);
    const googleFirst = t.google && textOnly && (t.engine === 'google' || t.engine === 'google+gemini');
    const order = [];
    if (googleFirst) order.push(googleTranslate);
    if (Cl().canReadFiles() || !t.google || !textOnly) order.push(geminiTranslate);
    if (!googleFirst && t.google && textOnly) order.push(googleTranslate);      // Gemini busy -> the official translation service
    let last;
    for (const fn of order) {
      try { return await fn(text, opts, job, step, onPart); }
      catch (e) { last = e; if (/stopped/i.test(e.message)) throw e; }
    }
    throw last;
  };
  const cloudSummarise = async (text, opts, job, step, onPart) => {
    let body = text;
    if (text.length > 14000) {                           // long input: summarise each part, then summarise the summaries
      const parts = groupParas(text, 10000), notes = [];
      for (let i = 0; i < parts.length; i++) {
        step(`Reading part ${i + 1} of ${parts.length}…`);
        notes.push(await cloudWrite({ system: P().summaryPrompt({ length: 'medium', style: 'paragraph' }), user: parts[i], job, step, proof: false }));
      }
      body = notes.join('\n\n');
    }
    step('Writing the summary in Dzongkha…');
    const dz = await cloudWrite({ system: P().summaryPrompt(opts), user: body || 'Summarise the attached file.', media: opts.media, job, step, proof: api.proofread, source: body, onPart });
    return { dz, src: opts.src, cloud: true };
  };
  const cloudChat = async ({ message, context, history, media }, job, step, onPart) => {
    const user = context ? `Document:\n${context.slice(0, 15000)}\n\nQuestion: ${message || 'Please summarise the document.'}` : (message || 'Please look at the attached file and tell me what it is.');
    step('Thinking…');
    const dz = await cloudWrite({ system: P().CHAT_PROMPT, user, media, history: history.slice(-10), job, step, onPart, proof: api.proofreadChat, source: user });
    return { dz, en: '', q: message || '(file)', hist: dz };
  };

  /* ==========================================================
     AUTOMATIC FAILOVER
     Order for every request:  online engines (the backend tries all keys, models, Google Translation, backup, Ollama)
                               -> the offline open-source models stored on this computer (NLLB-200, Qwen2.5, Whisper).
     Nobody has to change a setting: if the online side fails, is busy, has no key, or the backend is not running, the offline
     model answers and the result says so. When the backend reports "busy for N seconds" the page goes straight to the offline
     model for that time instead of waiting, then tries the online side again. ========================================== */
  api.blockedUntil = 0;
  const off = () => (window.DzoCloud && Cl().backend && Cl().backend.offline) || {};
  async function failover({ online, local, need, step, args, label }) {
    if (api.mode !== 'cloud') return local();
    const usable = !!(window.DzoCloud && Cl().configured()) && Date.now() >= api.blockedUntil;
    let err;
    if (usable) {
      try { return await online(); }
      catch (e) {
        if (/stopped/i.test(e.message)) throw e;
        err = e; if (e.retryAfter) api.blockedUntil = Date.now() + Math.min(e.retryAfter, 600) * 1000;
      }
    } else err = new Error(Date.now() < api.blockedUntil ? 'The online service is temporarily busy.' : !Cl().backend ? 'The online backend is not running.' : 'The online backend is not configured.');
    if (args.media && args.media.length) {
      throw new Error(`${err.message} This attached image or PDF could not be sent to the online model, and the offline model cannot inspect this attachment. Try again when the online service is available, or paste the document text into the chat.`);
    }
    step('Online service unavailable. Starting the open-source model; the first download may take a few minutes…');
    try {
      // Let the model worker try to load/download its model instead of blocking fallback
      // on backend status. This also supports browser-only use with no API key.
      const r = await local();
      r.fallback = label; r.fallbackWhy = err.message;
      return r;
    } catch (localError) {
      throw new Error(`The online service failed (${err.message}). The open-source fallback could not start (${localError.message}). Check your internet connection for the first model download, then try again.`);
    }
  }
  const backendUsable = () => !!(window.DzoCloud && Cl().configured()) && Date.now() >= api.blockedUntil;
  const noteBlock = e => { if (e && e.retryAfter) api.blockedUntil = Date.now() + Math.min(e.retryAfter, 600) * 1000; };

  api.translate = async (text, opts, job, step, onPart) => {
    if (api.mode !== 'cloud') return localTranslate(text, opts, job, step);
    const src = opts.src || detectLang(text);
    if (src === DZ) return localTranslate(text, { ...opts, src }, job, step);

    if (!opts.media || !opts.media.length) {
      const known = await glossaryTranslation(text, src, job, step);      // verified words always win
      if (known) return known;
      return withFallback({ task: 'translation', label: 'the offline open-source model (NLLB-200)', step,
        online: async () => {
          try { return await freeGoogleTranslate(text, { ...opts, src }, job, step, onPart); }
          catch (e) {
            if (/stopped/i.test(e.message)) throw e;
            if (!backendUsable()) throw e;
            try { return await cloudTranslate(text, { ...opts, src }, job, step, onPart); }
            catch (e2) { if (/stopped/i.test(e2.message)) throw e2; noteBlock(e2); throw new Error(`Free translation failed (${e.message}); backend also failed (${e2.message}).`); }
          }
        },
        local: () => localTranslate(text, { ...opts, src }, job, step) });
    }
    // Images/PDFs need the optional backend; the keyless text API cannot read attachments.
    try { if (backendUsable()) return await cloudTranslate(text, { ...opts, src }, job, step, onPart); }
    catch (e) { if (/stopped/i.test(e.message)) throw e; }
    return failover({ step, need: ['translation'], label: 'the offline open-source model (NLLB-200)', args: { text, media: opts.media },
      online: () => cloudTranslate(text, { ...opts, src }, job, step, onPart), local: () => localTranslate(text, { ...opts, src }, job, step) });
  };

  api.summarise = (text, opts, job, step, onPart) => {
    const local = () => localSummarise(text, { ...opts, smart: !!opts.smart, model: opts.model || 'llm_fast' }, job, step);
    if (api.mode !== 'cloud') return local();
    if (opts.media && opts.media.length) return failover({ step, need: ['translation'], label: 'the offline summariser', args: { text, media: opts.media }, online: () => cloudSummarise(text, opts, job, step, onPart), local });
    return withFallback({ task: 'summary', step,
      label: opts.smart ? 'the offline Qwen2.5 summariser with NLLB-200 translation' : 'the offline extractive summariser with NLLB-200 translation',
      online: async () => {
        let err;
        if (backendUsable()) { try { return await cloudSummarise(text, opts, job, step, onPart); } catch (e) { if (/stopped/i.test(e.message)) throw e; err = e; noteBlock(e); } }
        try { return await freeSummarise(text, opts, job, step); }
        catch (e) { if (/stopped/i.test(e.message)) throw e; throw new Error(err ? `${err.message}; free route: ${e.message}` : e.message); }
      }, local });
  };

  api.chat = (args, job, step, onPart) => {
    const localArgs = { ...args, model: args.model === 'llm_better' ? 'llm_better' : args.model === 'ollama' ? 'ollama' : 'llm_fast' };
    const local = () => localChat(localArgs, job, step, onPart);
    if (api.mode !== 'cloud') return local();
    if (args.media && args.media.length) return failover({ step, need: ['translation', 'chat'], label: 'the offline open-source model (Qwen2.5 + NLLB-200)', args: { text: args.message || args.context, media: args.media }, online: () => cloudChat(args, job, step, onPart), local });
    return withFallback({ task: 'chat', step, label: 'the offline open-source model (Qwen2.5 + NLLB-200)',
      online: async () => {
        let err;
        if (backendUsable()) { try { return await cloudChat(args, job, step, onPart); } catch (e) { if (/stopped/i.test(e.message)) throw e; err = e; noteBlock(e); } }
        try { return await freeChat(args, job, step, onPart); }
        catch (e) { if (/stopped/i.test(e.message)) throw e; throw new Error(err ? `${err.message}; free route: ${e.message}` : e.message); }
      }, local });
  };

  /** Voice recording (any language Whisper knows) → text */
  function wavBase64(audio, rate) {                      // 16-bit PCM WAV, base64 (what the online engine accepts)
    const pcm = new DataView(new ArrayBuffer(44 + audio.length * 2)), w = (o, t) => [...t].forEach((c, i) => pcm.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); pcm.setUint32(4, 36 + audio.length * 2, true); w(8, 'WAVEfmt '); pcm.setUint32(16, 16, true); pcm.setUint16(20, 1, true); pcm.setUint16(22, 1, true);
    pcm.setUint32(24, rate, true); pcm.setUint32(28, rate * 2, true); pcm.setUint16(32, 2, true); pcm.setUint16(34, 16, true); w(36, 'data'); pcm.setUint32(40, audio.length * 2, true);
    for (let i = 0; i < audio.length; i++) pcm.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 0x7fff, true);
    let bin = ''; const u = new Uint8Array(pcm.buffer); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  api.transcribe = async (blob, language) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const audio = buf.getChannelData(0); ctx.close && ctx.close();
    if (api.mode === 'cloud' && Cl().canReadFiles() && Cl().configured()) {          // online: the AI listens (many languages)
      try {
        const t = await Cl().generate({ system: 'You are a careful transcriber. Reply with ONLY the exact words spoken, in the language spoken, no comments.',
          messages: [{ role: 'user', content: 'Transcribe this recording.' }], media: [{ mime: 'audio/wav', data: wavBase64(audio, 16000) }] });
        return t.trim();
      } catch (e) { if (!ready('voice')) throw e; }            // online failed: Whisper (offline) listens instead
    }
    await ensure('asr');                                                               // offline: Whisper
    return (await call('transcribe', { audio, language })).trim();
  };

  /* ---------- spaces between Dzongkha words ----------
     Dzongkha is normally written with a tsheg (་) between syllables and no spaces. For easier reading this puts a space after
     the little words that end a word group (case markers, plural, verb endings, and so on). It is a rule-based helper, not a full
     word segmenter, so the unspaced original is kept and the spacing can be switched off. */
  const ENDERS = ['གི', 'གིས', 'ཀྱི', 'ཀྱིས', 'གྱི', 'གྱིས', 'ཡི', 'ཡིས', 'ལུ', 'ལས', 'དང', 'ཚུ', 'ཅིག', 'རུང', 'ཨིན', 'ཨིན་པས', 'ཨིན་ན', 'ཨིན་པའི', 'མེན', 'ཡོད', 'མིན', 'ཡིན', 'འབད', 'བཏང', 'ནི', 'ནིའི', 'པའི', 'པས', 'བའི', 'ཏེ', 'སྟེ', 'ཞིང', 'ཤིང', 'ནིའི', 'ཁའི', 'ཕྱི་ལས', 'ཡང', 'ཧེ', 'རུ', 'ལ'];
  const ENDSET = new Set(ENDERS);
  api.space = (text, on = true) => {
    if (!on) return text;
    return String(text || '').split('\n').map(line => {
      if (!/[ༀ-࿿]/.test(line)) return line;
      const syl = line.match(/[^་།༎༑\s]+[་།༎༑]*|\s+/g) || [line];            // syllable + its tsheg/shad
      let out = '';
      for (let i = 0; i < syl.length; i++) {
        const cur = syl[i]; out += cur;
        const nxt = syl[i + 1];
        if (!nxt || /^\s/.test(cur) || /^\s/.test(nxt) || !/[ༀ-࿿]/.test(nxt)) continue;
        if (/[།༎༑]$/.test(cur)) { out += ' '; continue; }                      // after a shad
        const w = cur.replace(/་$/, '');
        const prev = syl[i - 1] && !/^\s/.test(syl[i - 1]) ? syl[i - 1] : '';
        if (cur.endsWith('་') && (ENDSET.has(w) || (prev && ENDSET.has(prev.replace(/་$/, '') + '་' + w)))) out += ' ';
      }
      return out.replace(/ {2,}/g, ' ');
    }).join('\n');
  };

  api.corrections = () => corrections;
  Object.assign(api, { LANGS, DZ, EN, detectLang, cleanDz, dzShare, ensure, mt });
  window.DzoEngine = api;
})();

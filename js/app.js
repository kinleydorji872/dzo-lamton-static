/* ==========================================================
   རྫོང་ཁ་ལམ་སྟོན། · app.js   (plain JavaScript, no framework, no server)
   Sections: helpers · model download bar · languages · fix spelling · tabs · uploads
             · translate / summary · chat · copy & download (Word, PDF)
   The AI itself lives in js/engine.js and js/worker.js.
   ========================================================== */
(() => {
  'use strict';
  const E = window.DzoEngine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = n => `<svg class="ico" aria-hidden="true" focusable="false"><use href="images/icons.svg#${n}"/></svg>`;
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ---------- helpers ---------- */
  const toastEl = $('#toast');
  let toastTimer;
  function toast(msg, ms = 1600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);       // fades by itself: no "OK" button
  }
  window.DzoToast = toast;
  const MSG = { copied: 'འདྲ་བཤུས་འབད་ཡི།', downloading: 'ཕབ་ལེན་འབད་དོ།…', empty: 'ཕབ་ལེན་འབད་ནི་ལུ་ཁོག་པ་ཡོད་མ་རེད། (Nothing yet)' };

  /** Turns a technical error into a plain sentence with what to do. */
  function friendly(err) {
    const m = String(err && err.message || err);
    if (/stopped/i.test(m)) return 'Stopped.';
    if (/ollama/i.test(m)) return m;
    if (E.mode === 'cloud') {                                   // online errors are already written in plain words: show them as they are
      if (/^TypeError|failed to fetch|networkerror|load failed/i.test(m)) return 'The page lost contact with its local server. Make sure the window that runs “py start.py” is still open, then try again.';
      return m;
    }
    if (/fetch|network|load failed|failed to load|could not start/i.test(m))
      return 'The AI model could not be downloaded. Check your internet connection and try again. The first use needs a one-time download.';
    if (/memory|allocation|out of/i.test(m))
      return 'This device ran out of memory. Close other tabs, or choose the smaller chat model, and try again.';
    return m;
  }
  const errorCard = msg => { const t = friendly(msg); return `<div class="error-card">${ICON('alert')}<div><b>${/busy|please wait/i.test(t) ? 'Please wait' : 'That did not work'}</b><span>${esc(t)}</span></div></div>`; };

  if (!window.Worker || !window.WebAssembly) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="alert"><div><h2>This browser is too old</h2><p>Please use a recent Chrome, Edge, Firefox or Safari.</p></div></div>');
  }


  /* ---------- model download bar ---------- */
  const bar = $('#engine-bar');
  const MB = { mt: 'about 600 MB', llm_fast: 'about 400 MB', llm_better: 'about 1.2 GB', asr: 'about 80 MB' };
  const rows = {};
  function renderBar(first) {
    if (!bar.dataset.built) {
      bar.dataset.built = '1';
      bar.innerHTML = `${ICON('translate')}<div><h2>Offline engine: the AI runs inside this page</h2>
        <p>The first time you translate, your browser downloads the open-source translation model once (${MB.mt}) and keeps it for next time. After that, your text stays on your device. Tip: run <code>py start.py</code> once to keep the model as a file on your computer so it is never downloaded again.</p>
        <div class="alert-actions"><button type="button" class="primary" id="engine-go">Download the translation model now</button></div></div>
        <div class="meter-list" id="meters"></div>`;
      $('#engine-go').onclick = e => { const b = e.currentTarget; b.disabled = true; E.ensure('mt').catch(err => { bar.hidden = false; toast(friendly(err), 4000); b.disabled = false; }); };
    }
    bar.hidden = false;
  }
  if (!lsGet('dzo-mt-ready') && !E.mock && E.mode === 'local') renderBar(true);
  E.onDownload = ({ key, name, pct, mb, ready }) => {
    renderBar();
    $('#engine-go') && ($('#engine-go').hidden = true);
    let r = rows[key];
    if (!r) {
      const el = document.createElement('div'); el.className = 'meter';
      el.innerHTML = '<div class="meter-row"><span></span><b></b></div><div class="meter-track"><i></i></div>';
      $('#meters').appendChild(el); r = rows[key] = el;
    }
    $('span', r).textContent = `${name || key}${mb ? ` · ${mb} MB` : ''}`;
    $('b', r).textContent = ready ? 'Ready' : pct + '%';
    $('i', r).style.width = pct + '%';
    if (ready) {
      if (key === 'mt') lsSet('dzo-mt-ready', '1');
      setTimeout(() => { r.remove(); delete rows[key]; if (!Object.keys(rows).length) bar.hidden = true; }, 1400);
    }
  };

  /* ---------- engine: online (the backend's AI) or offline models ---------- */
  const Cl = window.DzoCloud;
  const engBox = $('#engine-box'), stateEl = $('#engine-state'), connEl = $('#eng-conn-text');
  $$('[data-quality-select]').forEach(s => s.closest('.field').classList.add('local-only'));
  ['#tr-explain', '#su-smart'].forEach(id => $(id).closest('.check').classList.add('local-only'));
  $('#chat-model').closest('.field').classList.add('local-only'); $('#ollama-row').classList.add('local-only');
  bar.classList.add('local-only');
  function applyMode() {
    document.body.dataset.mode = Cl.mode();
    $$('input[name="eng-mode"]').forEach(r => { r.checked = r.value === Cl.mode(); });
    if (Cl.mode() === 'cloud') {
      const b = Cl.backend, ok = Cl.configured();
      stateEl.className = 'eng-state ' + (ok ? 'ok' : 'warn');
      if (!b) {
        stateEl.textContent = 'Online · backend not running';
        connEl.textContent = 'The backend is not running. Open a terminal in the project folder and run:  py start.py   then use the address it prints (http://localhost:8000).';
      } else if (!ok) {
        stateEl.textContent = 'Online · backend has no AI key';
        connEl.textContent = 'The backend is running but has no AI key yet. In the terminal run:  py start.py --add-key   (the key is stored on the server, not in this page).';
      } else {
        stateEl.textContent = 'Online · connected';
        const t = b.translate || {}, eng = { gemini: 'AI (DDC rules)', google: 'Google Cloud Translation', 'google+gemini': 'Google Cloud Translation, then AI polish' }[t.engine] || 'AI (DDC rules)';
        connEl.textContent = `Backend connected. Translation: ${eng}${t.google ? ` (${Math.round((t.used || 0) / 1000)}k of ${Math.round((t.cap || 0) / 1000)}k characters used this month)` : ''}. ${b.keys} AI key${b.keys === 1 ? '' : 's'}${b.fallback ? ' + backup engine' : ''}. Repeated requests are answered from memory (${b.cache} saved).`;
      }
      if (!ok) engBox.open = true;
    } else { stateEl.className = 'eng-state'; stateEl.textContent = 'Offline · open-source models (weaker Dzongkha)'; }
  }
  $('#eng-proof').checked = Cl.get('proof', '0') === '1'; $('#eng-proof-chat').checked = Cl.get('proof-chat', '1') === '1';
  $('#eng-space').checked = Cl.get('space', '1') === '1';
  E.proofread = $('#eng-proof').checked; E.proofreadChat = $('#eng-proof-chat').checked;
  let spaceOn = $('#eng-space').checked;
  const view = t => E.space(t, spaceOn);
  /** Puts Dzongkha text into an element; the plain original is kept so the spacing can be switched on and off. */
  const setDz = (el, raw) => { el.dataset.raw = raw; el.textContent = view(raw); };
  const mainOf = out => $('.dzmain', out) || out.insertAdjacentElement('afterbegin', Object.assign(document.createElement('span'), { className: 'dzmain' }));
  $('#eng-space').addEventListener('change', e => { spaceOn = e.target.checked; Cl.set('space', spaceOn ? '1' : '0'); $$('[data-raw]').forEach(el => { el.textContent = view(el.dataset.raw); }); });
  $$('input[name="eng-mode"]').forEach(r => r.addEventListener('change', () => { if (r.checked) { Cl.set('mode', r.value); applyMode(); if (r.value === 'local' && !lsGet('dzo-mt-ready') && !E.mock) renderBar(true); } }));
  $('#eng-proof').addEventListener('change', e => { Cl.set('proof', e.target.checked ? '1' : '0'); E.proofread = e.target.checked; });
  $('#eng-proof-chat').addEventListener('change', e => { Cl.set('proof-chat', e.target.checked ? '1' : '0'); E.proofreadChat = e.target.checked; });

  /* When the free online service fails, the user chooses what happens (setting: ask / use local automatically / just show the error) */
  E.fallbackPolicy = Cl.get('fb', 'ask');
  const fbSel = $('#eng-fb'); if (fbSel) { fbSel.value = E.fallbackPolicy; fbSel.addEventListener('change', () => { E.fallbackPolicy = fbSel.value; Cl.set('fb', fbSel.value); }); }
  E.chooseFallback = ({ task, reason }) => new Promise(resolve => {
    const names = { chat: 'chatbot', summary: 'summary', translation: 'translation' };
    const d = document.createElement('dialog'); d.className = 'fb-dialog';
    d.innerHTML = `<form method="dialog"><h3>The online ${esc(names[task] || task)} service did not answer</h3>
      <p class="fb-why">${esc(reason)}</p>
      <p>Do you want to use the <b>local (offline) model</b> on this device instead? It works without internet after its first download, but its answers and Dzongkha are weaker.</p>
      <div class="fb-actions"><button value="local" class="fb-primary">Use local model</button><button value="retry">Try online again</button><button value="cancel">Cancel</button></div>
      <label class="fb-remember"><input type="checkbox"> Always use the local model automatically when online fails</label></form>`;
    d.addEventListener('close', () => {
      const v = d.returnValue || 'cancel';
      if (v === 'local' && $('input', d).checked && fbSel) { fbSel.value = 'local'; E.fallbackPolicy = 'local'; Cl.set('fb', 'local'); }
      d.remove(); resolve(v);
    });
    document.body.appendChild(d); d.showModal();
  });

  /* ---------- offline backup models download by themselves in the background ----------
     With the backend running they are saved as files in ./models (never downloaded again); otherwise the browser downloads
     and keeps them. It waits a few seconds so the page opens fast, one model at a time, and can be switched off in Settings. */
  const pfBox = $('#eng-prefetch'), mstat = $('#model-status');
  if (pfBox) { pfBox.checked = Cl.get('prefetch', '1') === '1'; pfBox.addEventListener('change', () => { Cl.set('prefetch', pfBox.checked ? '1' : '0'); if (pfBox.checked) startPrefetch(); }); }
  let prefetching = false;
  async function startPrefetch() {
    if (prefetching || E.mock || Cl.get('prefetch', '1') !== '1') return;
    if (navigator.connection && navigator.connection.saveData) return;                    // respect "data saver"
    prefetching = true;
    const say = t => { if (mstat) mstat.textContent = t; };
    try {
      if (Cl.backend) {                                                                   // backend: store the models as files once
        let info = {}; try { info = await (await fetch(Cl.api('api/models'), { cache: 'no-store' })).json(); } catch {}
        for (const k of ['translation', 'chat']) if (info[k] && !info[k].have && info[k].state !== 'running') { try { await Cl.post('api/models/download', { name: k }); } catch {} }
        renderModels(); return;
      }
      for (const key of ['mt', 'llm_fast']) {                                             // browser: translation model first, then chat model
        if (E.ready[key]) continue;
        say(`Getting the offline backup ready: ${key === 'mt' ? 'translation' : 'chat'} model (downloads once)…`);
        await E.ensure(key);
      }
      say('✓ Offline backup is ready. It is used only if you choose it.');
    } catch { say('The offline backup could not finish downloading yet. It will try again next time.'); }
    finally { prefetching = false; }
  }
  document.addEventListener('dzo-ready', () => setTimeout(startPrefetch, 6000));

  /* offline models: shown only when the backend runs; downloaded one time into ./models */
  const MODEL_NAMES = { translation: 'Translation (NLLB-200)', chat: 'Small chat model', 'chat-better': 'Better chat model', voice: 'Voice typing (Whisper)' };
  let modelTimer;
  async function renderModels() {
    const box = $('#eng-models'); box.hidden = !Cl.backend;
    if (!Cl.backend) return;
    let info; try { info = await (await fetch(Cl.api('api/models'), { cache: 'no-store' })).json(); } catch { return; }
    const ul = $('#eng-model-list'); ul.innerHTML = ''; let busy = false;
    Object.entries(info).forEach(([k, v]) => {
      const li = document.createElement('li');
      const state = v.state === 'running' ? `<span>Downloading… ${v.mb} of about ${v.expect_mb} MB</span>` : v.have ? `<span class="have">✓ Stored on this computer (${v.mb} MB). Never downloaded again.</span>`
        : v.state === 'error' ? `<span class="warn">Could not download: ${esc(v.msg)}</span><button type="button" class="mini" data-dl="${k}">Try again</button>` : `<button type="button" class="mini" data-dl="${k}">Download once (about ${v.expect_mb} MB)</button>`;
      li.innerHTML = `<b>${MODEL_NAMES[k] || k}</b>${state}`; ul.appendChild(li); if (v.state === 'running') busy = true;
    });
    $$('[data-dl]', ul).forEach(b => b.onclick = async () => { b.disabled = true; try { await Cl.post('api/models/download', { name: b.dataset.dl }); } catch (e) { toast(e.message, 3000); } renderModels(); });
    clearTimeout(modelTimer); if (busy) modelTimer = setTimeout(async () => { await Cl.refresh(); applyMode(); renderModels(); }, 2500);
  }
  stateEl.textContent = 'Connecting…';
  Cl.init().finally(() => {
    applyMode(); renderModels();
    if (Cl.configured()) engBox.open = false;
    document.dispatchEvent(new Event('dzo-ready'));
  });

  /* ---------- language pickers ---------- */
  $$('[data-lang-select]').forEach(sel => {
    sel.innerHTML = '<option value="">Auto-detect</option>' + E.LANGS.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('');
    const saved = lsGet('dzo-lang-' + sel.id); if (saved) sel.value = saved;
    sel.addEventListener('change', () => lsSet('dzo-lang-' + sel.id, sel.value));
  });
  const ocrLang = sel => sel.value || E.EN;

  /* ---------- one-time download: keep models on this device ---------- */
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}   // ask the browser not to delete the cache
  const statusEl = $('#model-status');
  fetch('models/Xenova/nllb-200-distilled-600M/onnx/encoder_model_quantized.onnx', { method: 'HEAD' }).then(r => {
    if (r.ok) { lsSet('dzo-mt-ready', '1'); bar.hidden = true; statusEl.textContent = '✓ The translation model is stored on this computer (models folder). No download needed.'; }
  }).catch(() => {});

  /* translation quality (beam search): fast / better / best */
  $$('[data-quality-select]').forEach(sel => {
    sel.value = lsGet('dzo-quality') || '3'; E.beams = +sel.value;
    sel.addEventListener('change', () => { E.beams = +sel.value; lsSet('dzo-quality', sel.value); $$('[data-quality-select]').forEach(o => { o.value = sel.value; }); });
  });
  E.beams = +(lsGet('dzo-quality') || 3);

  /* Ollama (free local chat engine) */
  const chatSel = $('#chat-model'), ollamaRow = $('#ollama-row'), ollamaNote = $('#ollama-note');
  chatSel.value = lsGet('dzo-chat-model') || 'llm_fast';
  $('#ollama-model').value = lsGet('dzo-ollama-model') || 'qwen2.5:7b';
  async function checkOllama() {
    ollamaRow.hidden = chatSel.value !== 'ollama';
    if (chatSel.value !== 'ollama') return;
    const want = $('#ollama-model').value.trim();
    try {
      const have = await E.ollamaModels();
      ollamaNote.textContent = have.some(n => n === want || n.startsWith(want + ':') || n.split(':')[0] === want)
        ? `Ollama is running and "${want}" is installed.`
        : `Ollama is running, but "${want}" is not installed. Run:  ollama pull ${want}   (installed: ${have.join(', ') || 'none'})`;
    } catch { ollamaNote.textContent = 'Ollama is not running. Install it free from ollama.com, run "ollama pull ' + want + '", keep it open, then pick this option again.'; }
  }
  chatSel.addEventListener('change', () => { lsSet('dzo-chat-model', chatSel.value); checkOllama(); });
  $('#ollama-model').addEventListener('change', () => { lsSet('dzo-ollama-model', $('#ollama-model').value.trim()); checkOllama(); });
  checkOllama();

  /* ---------- Fix spelling (ཞུ་དག): tidy-up + corrections list + free Hunspell dictionary suggestions ---------- */
  function fixSpelling({ getText, setText, box, btn }) {
    const original = getText();
    if (!original.trim()) return toast('Nothing to check yet.', 2000);
    if (E.dzShare(original) < 0.5) return toast('Fix spelling works on Dzongkha text. Translate first.', 3000);
    const tidy = E.cleanDz(original, { withCorrections: false });
    const fixed = E.cleanDz(original);
    box.hidden = false;
    const items = [];
    if (tidy !== original) items.push('Tidied tsheg, shad (།) marks and spaces');
    const n = E.corrections().filter(([w]) => tidy.includes(w)).length;
    if (n) items.push(`Applied ${n} fix${n > 1 ? 'es' : ''} from your corrections list`);
    if (fixed !== original) setText(fixed);
    let current = fixed;
    const render = () => {
      let html = '';
      if (items.length) html += `<div class="changes-head"><b lang="dz">བཟོ་བཅོས།</b> <small>${items.length} change${items.length > 1 ? 's' : ''} made</small><button type="button" class="undo">Undo</button></div><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      const sp = window.DzoSpell && DzoSpell.check(current);
      if (sp && sp.flagged && sp.flagged.length) {
        html += `<p class="used"><b>${sp.badCount}</b> of ${sp.total} syllables are not in the Dzongkha dictionary. Tap a suggestion to use it, or ignore it if the word is a name or new term.</p><ul class="spell-list">` +
          sp.flagged.map((f, i) => `<li><del lang="dz">${esc(f.word)}</del>${f.count > 1 ? ` ×${f.count}` : ''} → ${f.suggestions.length ? f.suggestions.map(s => `<button type="button" class="sug" data-i="${i}" data-s="${esc(s)}" lang="dz">${esc(s)}</button>`).join(' ') : '<small>no suggestion</small>'}</li>`).join('') + '</ul>';
      } else if (sp && sp.unsuitable) html += '<p class="used">The installed dictionary does not match this text (too many words flagged), so the dictionary check was switched off.</p>';
      else if (sp) html += '<p class="ok">No spelling problems found by the dictionary.</p>';
      else html += `<p class="used">${DzoSpell && DzoSpell.state === 'loading' ? 'Dictionary loading… press again in a moment.' : 'Dictionary check is off: run <code>py get_dictionary.py</code> once to add the free Dzongkha dictionary.'}</p>`;
      if (!items.length && !html.includes('spell-list') && !html.includes('No spelling')) html = '<p class="ok">No formatting mistakes found.</p>' + html;
      box.innerHTML = html;
      const undo = $('.undo', box); if (undo) undo.onclick = () => { setText(original); box.hidden = true; };
      $$('.sug', box).forEach(b => b.onclick = () => {
        const w = sp.flagged[+b.dataset.i].word;
        current = current.split(w).join(b.dataset.s); setText(current); render();
      });
    };
    (window.DzoSpell ? DzoSpell.ready : Promise.resolve()).then(render);
  }
  const fixInput = (ta, box, btn) => fixSpelling({ getText: () => ta.value, setText: v => { ta.value = v; ta.dispatchEvent(new Event('input')); }, box, btn });
  $('#tr-fix').onclick = e => fixInput($('#tr-text'), $('#tr-changes'), e.currentTarget);
  $('#su-fix').onclick = e => fixInput($('#su-text'), $('#su-changes'), e.currentTarget);
  $('#chat-fix').onclick = e => fixInput($('#chat-input'), $('#chat-changes'), e.currentTarget);
  function fixOutput(targetId, btn) {
    const out = document.getElementById(targetId);
    const main = () => mainOf(out);
    fixSpelling({ getText: () => main().dataset.raw || main().textContent, setText: v => setDz(main(), v), box: $('#' + targetId.split('-')[0] + '-changes'), btn });
  }

  /* ---------- tabs ---------- */
  function showTab(name) {
    $$('.nav-btn').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
    $$('.panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', location.search + '#' + name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const startTab = location.hash.slice(1);
  if (['translate', 'chat', 'summary', 'sources'].includes(startTab)) showTab(startTab);

  /* ---------- file upload widgets ---------- */
  function uploader({ input, drop, chips, button }) {
    const state = { files: [] };
    const inputEl = $(input), chipsEl = $(chips);
    const dropEl = drop && $(drop);
    function render() {
      chipsEl.innerHTML = '';
      state.files.forEach((f, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span title="${esc(f.name)}">${esc(f.name)}</span><button type="button" aria-label="Remove">×</button>`;
        li.querySelector('button').onclick = () => { state.files.splice(i, 1); render(); };
        chipsEl.appendChild(li);
      });
    }
    function add(list) { state.files.push(...list); render(); inputEl.value = ''; }
    inputEl.addEventListener('change', () => add([...inputEl.files]));
    (dropEl || $(button)).addEventListener('click', () => inputEl.click());
    if (dropEl) {
      dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputEl.click(); } });
      ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('is-over'); }));
      dropEl.addEventListener('drop', e => add([...e.dataTransfer.files]));
    }
    state.add = add;
    state.clear = () => { state.files = []; render(); };
    return state;
  }
  const trUp = uploader({ input: '#tr-files', drop: '#tr-drop', chips: '#tr-chips' });
  const suUp = uploader({ input: '#su-files', drop: '#su-drop', chips: '#su-chips' });
  const chUp = uploader({ input: '#chat-files', button: '#chat-attach', chips: '#chat-chips' });
  const pasteMap = { 'tr-text': trUp, 'su-text': suUp, 'chat-input': chUp };
  document.addEventListener('paste', e => {
    const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    const up = pasteMap[e.target.id];
    if (imgs.length && up) up.add(imgs);
  });

  /* ---------- translate & summary ---------- */
  const chatModel = () => $('#chat-model').value;
  const ollamaName = () => $('#ollama-model').value.trim() || 'qwen2.5:7b';
  let currentJob = null;
  function setBusy(p, on, msg) {
    const prog = $(p.progress);
    $(p.run).disabled = on;
    prog.hidden = !on;
    if (on) {
      $('span', prog).textContent = msg || 'Working…';
      if (!$('.stop', prog)) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'stop'; b.textContent = 'Stop';
        b.onclick = () => currentJob && currentJob.cancel();
        prog.appendChild(b);
      }
    }
  }
  async function runProcess(mode, p) {
    const text = $(p.text).value.trim();
    if (!text && !p.up.files.length) { $(p.text).focus(); return toast('Please type text or upload a file.', 2200); }
    const out = $(p.out), box = $(p.result), langSel = $(p.lang);
    const job = currentJob = E.newJob();
    const step = m => { if (!job.cancelled) $('span', $(p.progress)).textContent = m; };
    setBusy(p, true, 'Starting…');
    box.hidden = false; out.textContent = ''; $(p.used).textContent = ''; $('.sel-hint', box) || $('.result-bar', box).insertAdjacentHTML('afterend', '<p class="sel-hint">Tip: select part of the text first, then press Copy, Word or PDF to take only that part.</p>'); $(p.changes).hidden = true;
    try {
      let all = text, media = [];
      if (p.up.files.length) {
        const prep = await E.prepare(p.up.files, ocrLang(langSel), step);
        all = [text, prep.text].filter(Boolean).join('\n\n'); media = prep.media;
        if (!all.trim() && !media.length) throw new Error('No text could be read from the file. For a picture, choose the language of the writing and try again.');
      }
      const src = !langSel.value || langSel.value === 'auto' ? E.detectLang(all) : langSel.value;
      const opts = { src, model: chatModel(), media };
      const onPart = part => { if (!job.cancelled) setDz(mainOf(out), part); };      // the online engine shows the text as it is written
      let res;
      if (mode === 'translate') {
        res = await E.translate(all, { ...opts, explain: $('#tr-explain').checked }, job, step, onPart);
        setDz(mainOf(out), res.dz);
        if (res.already) $(p.used).textContent = 'This text is already in Dzongkha, so it was only tidied.';
        if (res.explain) {
          const ex = document.createElement('span'); ex.className = 'explain';
          ex.innerHTML = '<b lang="dz">དོན་འགྲེལ།</b>'; ex.appendChild(document.createTextNode(res.explain));
          out.appendChild(ex);
        }
      } else {
        res = await E.summarise(all, {
          ...opts, smart: $('#su-smart').checked,
          length: ($('input[name="su-length"]:checked') || {}).value, style: ($('input[name="su-style"]:checked') || {}).value, focus: $('#su-focus').value
        }, job, step, onPart);
        setDz(mainOf(out), res.dz);
      }
      const lang = (E.LANGS.find(l => l[0] === res.src) || [0, res.src])[1];
      const warn = E.dzShare(res.dz) < 0.7 ? '<span class="warn">Some words stayed in the original language (names or numbers). Please check.</span>' : '';
      let spellHint = '';
      if (window.DzoSpell) { await DzoSpell.ready; const sp = DzoSpell.check(res.dz); if (sp && sp.badCount) spellHint = `<span class="warn">${sp.badCount} syllable(s) are not in the Dzongkha dictionary. Press “Fix spelling” to review them.</span>`; }
      if (res.fallback) $(p.used).innerHTML = `The online service was not available, so ${esc(res.fallback)} made this (you chose or allowed this). Its Dzongkha is weaker: please check it, and try again later for the better result.${warn}${spellHint}`;
      else if (res.via === 'free') $(p.used).innerHTML = `Made with the free online service (${res.method === 'extractive' ? 'best-sentence summary' : 'AI summary'}). Please have important text checked by a Dzongkha speaker.${warn}${spellHint}`;
      else if (res.cloud) $(p.used).innerHTML = `Please have important text checked by a Dzongkha speaker.${warn}${spellHint}`;
      else if (!res.already) $(p.used).innerHTML = `Made on your device · from ${esc(lang)}${langSel.value ? '' : ' (auto-detected)'} · open-source NLLB-200 model. Please have important text checked by a Dzongkha speaker.${warn}${spellHint}`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      out.innerHTML = errorCard(err);
    } finally { setBusy(p, false); currentJob = null; }
  }
  const TR = { text: '#tr-text', up: trUp, run: '#tr-run', progress: '#tr-progress', out: '#tr-out', result: '#tr-result', used: '#tr-used', changes: '#tr-changes', lang: '#tr-lang' };
  const SU = { text: '#su-text', up: suUp, run: '#su-run', progress: '#su-progress', out: '#su-out', result: '#su-result', used: '#su-used', changes: '#su-changes', lang: '#su-lang' };
  $('#tr-run').onclick = () => runProcess('translate', TR);
  $('#su-run').onclick = () => runProcess('summary', SU);
  $('#tr-clear').onclick = () => { $('#tr-text').value = ''; trUp.clear(); $('#tr-out').textContent = ''; $('#tr-result').hidden = true; $('#tr-changes').hidden = true; };
  $('#su-clear').onclick = () => { $('#su-text').value = ''; $('#su-focus').value = ''; suUp.clear(); $('#su-out').textContent = ''; $('#su-result').hidden = true; $('#su-changes').hidden = true; };

  /* ---------- chatbot: many chats like ChatGPT, saved on this device ---------- */
  const log = $('#chat-log'), form = $('#chat-form'), input = $('#chat-input'), sendBtn = $('#chat-send');
  const WELCOME = log.innerHTML;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let chats = [], cur = null;
  try { chats = JSON.parse(lsGet('dzo-chats') || '[]').filter(c => c && c.id); } catch { chats = []; }
  const saveChats = () => {
    chats.sort((a, b) => b.ts - a.ts); chats = chats.slice(0, 40);
    try { localStorage.setItem('dzo-chats', JSON.stringify(chats)); } catch { try { chats = chats.slice(0, 10); localStorage.setItem('dzo-chats', JSON.stringify(chats)); } catch {} }
    lsSet('dzo-chat-cur', cur ? cur.id : '');
  };
  const sideEl = $('#chat-side'), listEl = $('#chat-list');
  function renderList() {
    listEl.innerHTML = '';
    const shown = chats.filter(c => c.msgs.length || c === cur);
    if (!shown.length) listEl.innerHTML = '<li class="empty">No chats yet.</li>';
    shown.forEach(c => {
      const li = document.createElement('li'); li.className = c === cur ? 'is-current' : '';
      li.innerHTML = '<button type="button" class="pick" lang="dz"></button><button type="button" class="x" aria-label="Delete this chat" title="Delete">×</button>';
      const pick = $('.pick', li); pick.textContent = c.title || 'New chat'; pick.title = (c.title || 'New chat') + ' (double-click to rename)';
      pick.onclick = () => { openChat(c); sideEl.classList.remove('is-open'); $('#chat-side-toggle').setAttribute('aria-expanded', 'false'); };
      pick.ondblclick = () => { const t = prompt('Name of this chat', c.title || ''); if (t && t.trim()) { c.title = t.trim().slice(0, 60); saveChats(); renderList(); } };
      $('.x', li).onclick = () => { chats = chats.filter(x => x !== c); if (c === cur) { cur = null; newChat(); } else { saveChats(); renderList(); } toast('Chat deleted', 1400); };
      listEl.appendChild(li);
    });
  }
  function newChat() {
    if (cur && !cur.msgs.length) { input.focus(); return; }              // an empty chat is already open
    cur = { id: uid(), title: '', ts: Date.now(), msgs: [], hist: [] };
    chats.push(cur); chUp.clear(); drawChat(); saveChats(); renderList(); input.focus();
  }
  function openChat(c) { cur = c; chUp.clear(); drawChat(); saveChats(); renderList(); }
  function drawChat() {
    log.innerHTML = '';
    if (!cur.msgs.length) { log.innerHTML = WELCOME; return; }
    cur.msgs.forEach(m => { const b = addMsg(m.role, m.text, m.id); if (m.role === 'bot') finishBot(b, m.text, m.en, m.note); });
    log.scrollTop = log.scrollHeight;
  }

  function addMsg(role, text, id) {
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'user' : 'bot'); d.dataset.id = id || '';
    d.innerHTML = (role === 'user' ? '' : '<img src="images/icon-192.png" alt="">') + '<div class="msg-col"><div class="bubble dz-text" lang="dz"><span class="main"></span></div></div>';
    const bubble = $('.bubble', d);
    if (text) setDz($('.main', bubble), text);
    if (role === 'user' || text) addTools(d);
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return bubble;
  }
  /** The small row under each message: tick it, copy it, or download just this one. */
  function addTools(d) {
    if ($('.msg-tools', d)) return;
    const t = document.createElement('div'); t.className = 'msg-tools';
    t.innerHTML = '<label><input type="checkbox" class="pick-msg"> Select</label><button type="button" data-a="copy">Copy</button><button type="button" data-a="docx">Word</button><button type="button" data-a="pdf">PDF</button>';
    $('.msg-col', d).appendChild(t);
    $('.pick-msg', t).onchange = e => d.classList.toggle('is-picked', e.target.checked);
  }
  const mainText = b => ($('.main', b) || b).textContent;
  function finishBot(bubble, dz, en, note, understood, words) {
    bubble.innerHTML = '<span class="main"></span>';
    setDz($('.main', bubble), dz);
    const wm = words && words.length ? '\nWord meanings: ' + words.map(x => `${x.w} = ${x.m}`).join(' · ') : '';
    if (note) { const s = document.createElement('span'); s.className = 'en-line'; s.textContent = note + (understood ? '\nI understood your question as: ' + understood : '') + wm; bubble.appendChild(s); }
    else if (en) { const s = document.createElement('span'); s.className = 'en-line'; s.textContent = (understood ? 'I understood your question as: ' + understood + '\n' : '') + (words && words.length ? 'Word meanings: ' + words.map(x => `${x.w} = ${x.m}`).join(' · ') + '\n' : '') + 'English (before translation): ' + en; bubble.appendChild(s); }
    addTools(bubble.closest('.msg'));
  }
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = input.value.trim();
    if (!msg && !chUp.files.length) return;
    if (!cur) newChat();
    const chat = cur, files = chUp.files.slice();
    const userText = (msg || '') + (files.length ? `\n📎 ${files.map(f => f.name || 'image').join(', ')}` : '');
    const uMsg = { id: uid(), role: 'user', text: userText };
    chat.msgs.push(uMsg); if (!chat.title) chat.title = (msg || files[0].name || 'File').replace(/\s+/g, ' ').slice(0, 40); chat.ts = Date.now();
    addMsg('user', userText, uMsg.id); renderList();
    input.value = ''; input.style.height = 'auto'; chUp.clear();
    sendBtn.disabled = true;
    const bubble = addMsg('bot', '');
    const status = m => { bubble.innerHTML = `<span class="typing"><i></i><i></i><i></i></span> <small>${esc(m)}</small>`; };
    status('Starting…');
    try {
      const prep = files.length ? await E.prepare(files, E.EN, status) : { text: '', media: [] };
      const r = await E.chat({ message: msg, context: prep.text, media: prep.media, history: chat.hist, model: chatModel(), ollamaModel: ollamaName() }, null, status,
        part => { bubble.innerHTML = '<span class="main"></span>'; setDz($('.main', bubble), part); log.scrollTop = log.scrollHeight; });
      const note = r.fallback ? `The online service was unavailable, so ${r.fallback} answered (you chose or allowed this). This is a local fallback and may be less accurate; please verify important facts and Dzongkha wording.` : '';
      finishBot(bubble, r.dz, r.en, note, r.understood, r.words);
      const bMsg = { id: uid(), role: 'bot', text: r.dz, en: r.en || '', note }; bubble.closest('.msg').dataset.id = bMsg.id;
      chat.msgs.push(bMsg);
      chat.hist.push({ role: 'user', content: r.q }, { role: 'assistant', content: r.hist || r.en }); chat.hist = chat.hist.slice(-16);
      chat.ts = Date.now(); saveChats(); renderList();
    } catch (err) {
      bubble.classList.add('is-error'); bubble.textContent = friendly(err);
      chat.msgs.pop(); saveChats();                                       // a failed question is not kept in the saved chat
    } finally { sendBtn.disabled = false; log.scrollTop = log.scrollHeight; input.focus(); }
  });
  $('#chat-new').onclick = newChat; $('#chat-new2').onclick = () => { newChat(); sideEl.classList.remove('is-open'); };
  $('#chat-side-toggle').onclick = e => { const o = sideEl.classList.toggle('is-open'); e.currentTarget.setAttribute('aria-expanded', o); };
  {
    const last = chats.find(c => c.id === lsGet('dzo-chat-cur')) || chats.sort((a, b) => b.ts - a.ts)[0];
    if (last && last.msgs.length) openChat(last); else { cur = null; newChat(); }
  }

  /** Text of the ticked messages (or of the whole chat when nothing is ticked). */
  function chatTranscript(onlyTicked = true) {
    let msgs = $$('.msg', log).filter(m => !m.querySelector('.typing') && m.querySelector('.main'));
    const ticked = msgs.filter(m => m.classList.contains('is-picked'));
    if (onlyTicked && ticked.length) msgs = ticked;
    return msgs.map(m => `${m.classList.contains('user') ? 'ཁྱོད།' : 'ལམ་སྟོན།'}\n${mainText(m.querySelector('.bubble')).trim()}`).join('\n\n');
  }

  /* ---------- copy (instant, no confirmation dialog) ---------- */
  async function copyText(text) {
    text = (text || '').trim();
    if (!text) return toast(MSG.empty, 2200);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.className = 'clip-helper';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    toast(MSG.copied);
  }

  /* ---------- download: Word (.docx, DDC Joyig 12) and PDF — both made in the browser ---------- */
  /* A selected piece of text wins: the person can take just one part of a result. */
  let lastSel = null;
  document.addEventListener('selectionchange', () => { const x = getSelection(); if (x && !x.isCollapsed && x.toString().trim()) lastSel = { text: x.toString().trim(), node: x.anchorNode }; });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.tool, .msg-tools button')) lastSel = null; }, true);
  function targetText(id, btn) {
    if (id === 'chat-sel') return chatTranscript(true);
    if (id === 'msg') { const m = btn.closest('.msg'); return m ? mainText(m.querySelector('.bubble')).trim() : ''; }
    const el = document.getElementById(id);
    if (!el) return '';
    if (lastSel && el.contains(lastSel.node)) { toast('Only the part you selected', 1400); return lastSel.text; }
    return el.innerText.trim();
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function downloadDocx(text, title) {
    toast(MSG.downloading);
    if (!window.docx) return toast('The Word maker did not load. Refresh the page.', 3000);
    const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, BorderStyle } = window.docx;
    const FONT = 'DDC Joyig', SIZE = 24;
    const run = (t, extra = {}) => new TextRun({ text: t, font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size: SIZE, sizeComplexScript: SIZE, ...extra });
    const children = [];
    try {
      const logo = new Uint8Array(await (await fetch('images/logo.png')).arrayBuffer());
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 90, height: 90 } })] }));
    } catch { /* the logo is optional */ }
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run('༆ ༼ འབྱོན་པར་ལེགས་སོ  ༽༎་', { bold: true, size: 32, sizeComplexScript: 32 })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: 'B8860B', space: 6 } }, children: [run(title, { bold: true })] }));
    text.replace(/\r\n/g, '\n').split('\n').forEach(line => children.push(new Paragraph({ spacing: { after: line.trim() ? 80 : 160, line: 360 }, children: [run(line)] })));
    const doc = new Document({
      creator: 'KD Smart System', title,
      styles: { default: { document: { run: { font: FONT, size: SIZE, sizeComplexScript: SIZE } } } },
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }]
    });
    saveBlob(await Packer.toBlob(doc), 'dzongkha-lamton.docx');
  }

  function pageHtml(text, title) {
    return `<div class="pdf-page">
      <div class="pdf-head"><img src="${new URL('images/logo.png', document.baseURI).href}" width="80" height="80" alt="">
        <h1>༆ ༼ འབྱོན་པར་ལེགས་སོ  ༽༎་</h1><h2>${esc(title)}</h2></div>
      <div class="pdf-body">${esc(text)}</div></div>`;
  }
  async function downloadPdf(text, title) {
    toast(MSG.downloading, 2500);
    await (document.fonts && document.fonts.ready);
    if (window.html2pdf) {
      const wrap = document.createElement('div');
      wrap.className = 'pdf-offscreen';
      wrap.innerHTML = pageHtml(text, title);
      document.body.appendChild(wrap);
      try {
        await html2pdf().set({
          margin: [12, 12, 12, 12], filename: 'dzongkha-lamton.pdf',
          image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] }
        }).from(wrap.firstElementChild).save();
        return;
      } catch (e) { console.warn('html2pdf failed, using print', e); }
      finally { wrap.remove(); }
    }
    const w = window.open('', '_blank');                        // fallback: Print → Save as PDF
    if (!w) return toast('Please allow pop-ups to save the PDF', 3000);
    const base = document.baseURI;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
      <link rel="stylesheet" href="${new URL('css/tokens.css', base).href}"><link rel="stylesheet" href="${new URL('css/pdf.css', base).href}">
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Tibetan:wght@400;700&display=swap" rel="stylesheet">
      <body>${pageHtml(text, title)}</body>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 600);
  }

  function act(kind, text, title) {
    if (!text) return toast(MSG.empty, 2200);
    if (kind === 'copy') copyText(text);
    if (kind === 'docx') downloadDocx(text, title).catch(() => toast('Word export failed', 2500));
    if (kind === 'pdf') downloadPdf(text, title);
  }
  document.addEventListener('click', e => {
    const m = e.target.closest('.msg-tools button[data-a]');
    if (m) return act(m.dataset.a, targetText('msg', m), 'ཁ་བརྡ།');
    const b = e.target.closest('.tool[data-act]');
    if (!b) return;
    if (b.dataset.act === 'fix') return fixOutput(b.dataset.target, b);
    act(b.dataset.act, targetText(b.dataset.target, b), b.dataset.title || 'རྫོང་ཁ་ལམ་སྟོན།');
  });
})();

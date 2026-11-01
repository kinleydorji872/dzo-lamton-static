/* ==========================================================
   voice.js  -  voice INPUT with the open-source Whisper model (runs in your browser)
   Press the microphone, speak, press again: the words are typed into the box.
   Whisper does not know Dzongkha, so speak English, Hindi, Nepali… and press Translate.
   The microphone needs https:// or http://localhost (GitHub Pages is https).
   ========================================================== */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = window.DzoEngine, toast = (m, ms) => window.DzoToast && window.DzoToast(m, ms);
  const MAX_SECONDS = 120;
  let active = null;

  const LS = 'dzo-voice-lang';
  const saved = (() => { try { return localStorage.getItem(LS); } catch { return null; } })();
  $$('.mic-lang').forEach(sel => {
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
    sel.addEventListener('change', () => { try { localStorage.setItem(LS, sel.value); } catch {} $$('.mic-lang').forEach(s => { s.value = sel.value; }); });
  });
  if (!window.isSecureContext) $$('.mic-status').forEach(s => { s.textContent = 'The microphone needs https:// or localhost'; });

  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function setUi(bar, on, text = '') {
    const btn = $('.mic', bar), st = $('.mic-status', bar);
    btn.classList.toggle('is-rec', on); btn.setAttribute('aria-pressed', on);
    st.textContent = text;
  }
  function append(el, add) {
    add = (add || '').trim(); if (!add) return;
    el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + add;
    el.dispatchEvent(new Event('input')); el.focus();
  }

  async function record(bar) {
    const target = document.getElementById(bar.dataset.voiceFor), lang = $('.mic-lang', bar).value;
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('This browser cannot record. Try Chrome, Edge, Firefox or Safari.', 3500);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return setUi(bar, false, 'Please allow the microphone (or use https:// or localhost).'); }
    const rec = new MediaRecorder(stream), chunks = []; let secs = 0;
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const timer = setInterval(() => { secs++; setUi(bar, true, `Recording ${fmt(secs)} · press again to stop`); if (secs >= MAX_SECONDS) rec.stop(); }, 1000);
    rec.onstop = async () => {
      clearInterval(timer); stream.getTracks().forEach(t => t.stop()); active = null;
      setUi(bar, false, 'Turning your voice into text… (first time downloads the voice model, about 80 MB)');
      try { append(target, await E.transcribe(new Blob(chunks, { type: rec.mimeType }), lang)); setUi(bar, false, ''); }
      catch (err) { setUi(bar, false, 'Could not read the recording: ' + (err.message || err)); }
    };
    rec.start(); active = { stop: () => rec.stop(), bar }; setUi(bar, true, 'Recording 0:00 · press again to stop');
  }
  $$('.voicebar').forEach(bar => $('.mic', bar).addEventListener('click', () => {
    if (active) { const same = active.bar === bar; active.stop(); if (same) return; }
    else record(bar);
  }));
})();

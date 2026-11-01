/* ==========================================================
   spell.js  -  free Dzongkha spell-check with the Hunspell "dz_BT" dictionary (see dict/README.txt)
   Runs in the browser with nspell (MIT).  Finds syllables that are not in the dictionary and suggests fixes.
   If the dictionary is missing, or does not fit the text (too many words flagged), it switches itself off
   instead of showing wrong warnings.
   ========================================================== */
(() => {
  'use strict';
  const abs = p => new URL(p, document.baseURI).href;
  let speller = null, state = 'loading';                       // loading | ready | missing | unsuitable
  const API = { get state() { return state; } };

  API.ready = (async () => {
    try {
      if (!window.nspell) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = abs('vendor/nspell.min.js'); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const [aff, dic] = await Promise.all(['dict/dz_BT.aff', 'dict/dz_BT.dic'].map(f => fetch(abs(f)).then(r => { if (!r.ok) throw new Error('missing'); return r.text(); })));
      if (dic.length < 2000) throw new Error('missing');         // an empty or placeholder dictionary
      speller = window.nspell({ aff, dic });
      state = 'ready';
    } catch { state = 'missing'; }
    return state;
  })();

  const SYL = /[ༀ-࿿]+/g;                                 // runs of Tibetan-script letters
  const clean = t => String(t).replace(/[་།༎༑༔༈༄༅༆༇༼༽]/g, ' ');
  const known = w => speller.correct(w) || speller.correct(w + '་') || speller.correct(w.replace(/་$/, ''));

  /** → { flagged: [{word, count, suggestions[]}], total } or { unsuitable:true } */
  API.check = text => {
    if (state !== 'ready') return null;
    const words = (clean(text).match(SYL) || []).filter(w => w.length > 0);
    const seen = new Map(); let bad = 0;
    for (const w of words) {
      if (known(w)) continue;
      bad++;
      const e = seen.get(w) || { word: w, count: 0 }; e.count++; seen.set(w, e);
    }
    if (words.length >= 12 && bad / words.length > 0.4) { state = 'unsuitable'; return { unsuitable: true }; }   // dictionary does not match this kind of text
    const flagged = [...seen.values()].slice(0, 40).map(e => ({ ...e, suggestions: speller.suggest(e.word).slice(0, 4) }));
    return { flagged, total: words.length, badCount: bad };
  };
  window.DzoSpell = API;
})();

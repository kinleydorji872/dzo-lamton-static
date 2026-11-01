/* ==========================================================
   cloud.js  -  client for the BACKEND (server.py).
   The page never handles an API key: keys, rotation between keys and models, the answer cache and the fallbacks
   all live in the backend (see ARCHITECTURE.md).  This file only talks to /api/*.
   ========================================================== */
(() => {
  'use strict';
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const C = {};

  /* small per-device preferences (never secrets) */
  C.get = (k, d = '') => lsGet('dzo-' + k) || d;
  C.set = (k, v) => lsSet('dzo-' + k, v);
  C.mode = () => C.get('mode', 'cloud');                       // 'cloud' = the backend's AI, 'local' = offline models in the browser

  C.backend = null;                                            // status object when the backend answers
  C.base = '';
  C.api = p => new URL(p, C.base || document.baseURI).href;
  C.configured = () => !!C.backend && (C.backend.keys > 0 || C.backend.fallback || !!(C.backend.translate && C.backend.translate.google));
  C.canReadFiles = () => !!C.backend && C.backend.keys > 0;    // Gemini reads pictures and PDFs itself
  C.model = () => 'backend';

  /** Finds the backend: the same address as the page, or (page opened with VS Code Live Server etc.) localhost:8000-8005. */
  C.init = async () => {
    const tries = ['', ...[8000, 8001, 8002, 8003, 8004, 8005].map(p => `http://127.0.0.1:${p}/`)];
    for (const base of tries) {
      try {
        const r = await fetch(new URL('api/status', base || document.baseURI).href, { cache: 'no-store', signal: AbortSignal.timeout(1500) });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) { const j = await r.json(); if (j.backend) { C.backend = j; C.base = base; return j; } }
      } catch { /* try the next address */ }
    }
    C.backend = null; return null;
  };
  C.refresh = () => C.init();
  C.post = async (path, body) => {
    const r = await fetch(C.api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Server error ' + r.status), { kind: j.error && j.error.kind, retryAfter: j.error && j.error.retry_after });
    return j;
  };

  async function readSSE(res, onJson) {
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try { onJson(JSON.parse(line.slice(5))); } catch { /* ignore a broken line */ }
      }
    }
  }

  /** The one call everything uses: ask the backend, show the answer as it is written. */
  C.generate = async ({ system, messages, media, onToken, maxTokens, temperature, signal }) => {
    if (!C.backend) throw new Error('The backend is not running. Start it with  py start.py  and open the page it shows (http://localhost:8000).');
    const stream = !!onToken;
    let res;
    try { res = await fetch(C.api('api/generate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ system, messages, media, maxTokens, temperature, think: 'fast', stream }) }); }
    catch { throw new Error('The page lost contact with the backend. Make sure the window running  py start.py  is still open.'); }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw Object.assign(new Error((j.error && j.error.message) || `The backend answered HTTP ${res.status}.`), { kind: j.error && j.error.kind, retryAfter: j.error && j.error.retry_after });
    }
    if (!stream) return (await res.json()).text;
    let text = '', err;
    await readSSE(res, j => { if (j.t) { text += j.t; onToken(j.t, text); } if (j.error) err = new Error(j.error.message); });
    if (err && !text) throw err;
    if (!text) throw new Error('The engine sent an empty answer. Please try again.');
    return text;
  };

  window.DzoCloud = C;
})();

"""
server.py  -  the BACKEND of Dzongkha Lamton (Python standard library only, nothing to install)

  Page  <->  /api/*  <->  [ cache ]  ->  Gemini (all your keys x models, rotated)  ->  backup service  ->  Ollama (your own computer)

  * /api/generate    one text-generation endpoint for translate, chat and summary (streams the answer)
  * /api/models      offline open-source models: downloaded once into ./models
  * /api/status      health information (never contains a key)
Configuration lives in the file  .env  next to this script (never uploaded; add a key with  py start.py --add-key).
It listens on 127.0.0.1 only. See ARCHITECTURE.md.
"""
import base64, hashlib, http.server, json, os, re, socketserver, subprocess, sys, threading, time
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, 'cache.jsonl')
GEMINI_BASE = os.environ.get('GEMINI_BASE', 'https://generativelanguage.googleapis.com')
GT_BASE = os.environ.get('GT_BASE', 'https://translation.googleapis.com')
USAGE_FILE = os.path.join(HERE, 'usage.json')
LOCK = threading.Lock()

# ------------------------------------------------------------------ configuration (server side only; the page never sees it)
ENV_FILE = os.path.join(HERE, '.env')
def read_env():
    env = {}
    try:
        with open(ENV_FILE, encoding='utf8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1); env[k.strip()] = v.strip().strip('"\'')
    except Exception:
        pass
    return {**env, **{k: v for k, v in os.environ.items() if k.startswith(('GEMINI_', 'FALLBACK_', 'OLLAMA_', 'GOOGLE_', 'TRANSLATION_'))}}

def load_secrets():
    e = read_env()
    keys = [k for k in re.split(r'[\s,;]+', e.get('GEMINI_API_KEYS', e.get('GEMINI_API_KEY', ''))) if k]
    openai = {'base': e.get('FALLBACK_BASE', ''), 'key': e.get('FALLBACK_KEY', ''), 'model': e.get('FALLBACK_MODEL', '')}
    return {'gemini_keys': list(dict.fromkeys(keys)), 'models': [m for m in re.split(r'[\s,;]+', e.get('GEMINI_MODELS', '')) if m],
            'openai': openai if all(openai.values()) else {}, 'ollama': e.get('OLLAMA_MODEL', ''), 'ollama_url': e.get('OLLAMA_URL', 'http://localhost:11434'),
            'gt_key': e.get('GOOGLE_TRANSLATE_KEY', ''), 'gt_cap': int(e.get('GOOGLE_MONTHLY_CHAR_CAP', '450000') or 450000),
            'engine': (e.get('TRANSLATION_ENGINE', 'gemini') or 'gemini').lower()}

def add_keys(raw):
    """Used by  py start.py --add-key  : checks each key with Google, then appends it to .env."""
    added = []
    for k in [x for x in re.split(r'[\s,;]+', raw) if x]:
        try: list_models(k)
        except Err as e: print(f'  Key {k[:6]}...: rejected (HTTP {e.status}) {e.message[:140]}'); continue
        added.append(k)
    if added:
        have = load_secrets()['gemini_keys']
        allk = list(dict.fromkeys(have + added))
        lines = [l for l in (open(ENV_FILE, encoding='utf8').read().splitlines() if os.path.exists(ENV_FILE) else []) if not l.startswith('GEMINI_API_KEYS')]
        lines.append('GEMINI_API_KEYS=' + ','.join(allk))
        with open(ENV_FILE, 'w', encoding='utf8') as f: f.write('\n'.join(lines) + '\n')
        try: os.chmod(ENV_FILE, 0o600)
        except Exception: pass
    return added

def set_env(name, value):
    lines = [l for l in (open(ENV_FILE, encoding='utf8').read().splitlines() if os.path.exists(ENV_FILE) else []) if not l.startswith(name + '=')]
    lines.append(f'{name}={value}')
    with open(ENV_FILE, 'w', encoding='utf8') as f: f.write('\n'.join(lines) + '\n')
    try: os.chmod(ENV_FILE, 0o600)
    except Exception: pass

def add_google_key(key):
    """py start.py --add-google-key : tests the key with a real Dzongkha translation, then stores it."""
    os.environ['GOOGLE_TRANSLATE_KEY'] = key
    try:
        out = google_translate('Good morning', 'en')
    except Err as e:
        os.environ.pop('GOOGLE_TRANSLATE_KEY', None); print(f'  Key rejected (HTTP {e.status}): {e.message[:200]}'); return False
    os.environ.pop('GOOGLE_TRANSLATE_KEY', None)
    set_env('GOOGLE_TRANSLATE_KEY', key)
    if load_secrets()['engine'] == 'gemini' and 'TRANSLATION_ENGINE=' not in open(ENV_FILE, encoding='utf8').read(): set_env('TRANSLATION_ENGINE', 'google+gemini')
    print('  Test translation of "Good morning":', out); return True

_MODELS = {'t': 0, 'v': []}
def auto_models(S):
    """The Gemini models this key can use, best first (asked from Google, refreshed hourly)."""
    if S['models']: return S['models']
    if time.time() - _MODELS['t'] > 3600 and S['gemini_keys']:
        try: _MODELS['v'] = list_models(S['gemini_keys'][0])[:4]
        except Err: pass
        _MODELS['t'] = time.time()
    return _MODELS['v'] or ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']

# ------------------------------------------------------------------ cache (so repeated requests cost nothing)
CACHE = {}
def load_cache():
    try:
        with open(CACHE_FILE, encoding='utf8') as f:
            for line in f:
                try:
                    k, v = json.loads(line); CACHE[k] = v
                except Exception: pass
    except Exception: pass
load_cache()

def cache_key(req):
    media = [hashlib.sha256((m.get('data') or '').encode()).hexdigest() for m in req.get('media') or []]
    blob = json.dumps({'s': req.get('system'), 'm': req.get('messages'), 'f': media, 't': req.get('temperature'), 'k': req.get('think')}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()

def cache_put(k, text):
    if len(text) < 2: return
    with LOCK:
        CACHE[k] = text
        try:
            with open(CACHE_FILE, 'a', encoding='utf8') as f:
                f.write(json.dumps([k, text], ensure_ascii=False) + '\n')
        except Exception: pass

# ------------------------------------------------------------------ errors
class Err(Exception):
    def __init__(self, status, message, retry_after=0, kind=''):
        super().__init__(message); self.status = status; self.message = message; self.retry_after = retry_after; self.kind = kind

def parse_err(e):
    body = {}
    try: body = json.loads(e.read().decode('utf8', 'ignore'))
    except Exception: pass
    msg = (body.get('error') or {}).get('message', '') if isinstance(body, dict) else ''
    raw = json.dumps(body)
    delay = 0
    m = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', raw)
    if m: delay = float(m.group(1))
    return e.code, msg, delay, ('day' if re.search(r'PerDay|per day', raw, re.I) else '')

# ------------------------------------------------------------------ Gemini with rotation
COOL = {}          # (key_index, model) -> time until we try it again
BADKEY = {}        # key_index -> time
THINK = {}         # model -> index of the thinking setting that works
THINK_VARIANTS = [{'thinkingConfig': {'thinkingLevel': 'minimal'}}, {'thinkingConfig': {'thinkingBudget': 0}}, None]

def http_json(url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type': 'application/json', **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout)

def list_models(key):
    try:
        with http_json(f'{GEMINI_BASE}/v1beta/models?pageSize=200&key={urllib.parse.quote(key)}', timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        st, msg, _, _ = parse_err(e); raise Err(st, msg)
    except Exception as e:
        raise Err(0, f'Cannot reach Google ({e}). Check the internet, a VPN or a firewall.')
    names = [m['name'].replace('models/', '') for m in data.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
    names = [n for n in names if n.startswith('gemini') and not re.search(r'tts|live|transcribe|image|embed|audio|robotics|computer-use|learnlm', n)]
    ver = lambda n: float((re.search(r'(\d+(?:\.\d+)?)', n) or [0, '0'])[1])
    score = lambda n: (2 if 'flash' in n else 0) + (-1 if 'lite' in n else 0) + (-0.5 if re.search('preview|exp', n) else 0)
    return sorted(names, key=lambda n: (-score(n), -ver(n)))

def gemini_stream(key, model, req):
    """Yields text pieces. Raises Err before the first piece if Google refuses."""
    contents = []
    msgs = req.get('messages') or []
    for i, m in enumerate(msgs):
        parts = [{'text': m.get('content') or ' '}]
        if i == len(msgs) - 1 and m.get('role') == 'user':
            for f in req.get('media') or []:
                parts.append({'inlineData': {'mimeType': f['mime'], 'data': f['data']}})
        contents.append({'role': 'model' if m.get('role') == 'assistant' else 'user', 'parts': parts})
    base = {'contents': contents, 'generationConfig': {'temperature': req.get('temperature', 0.3), 'maxOutputTokens': req.get('maxTokens') or 8192}}
    if req.get('system'): base['systemInstruction'] = {'parts': [{'text': req['system']}]}
    fast = req.get('think', 'fast') != 'deep'
    variants = [THINK_VARIANTS[THINK[model]]] if (fast and model in THINK) else (THINK_VARIANTS if fast else [None])
    last = None
    for vi, var in enumerate(variants):
        body = json.loads(json.dumps(base))
        if var: body['generationConfig'].update(var)
        url = f'{GEMINI_BASE}/v1beta/models/{urllib.parse.quote(model)}:streamGenerateContent?alt=sse&key={urllib.parse.quote(key)}'
        try:
            resp = http_json(url, body)
        except urllib.error.HTTPError as e:
            st, msg, delay, kind = parse_err(e)
            if st == 400 and re.search('thinking', msg, re.I) and vi < len(variants) - 1: last = Err(st, msg); continue
            raise Err(st, msg, delay, kind)
        except Exception as e:
            raise Err(0, f'Cannot reach Google ({e}).')
        if fast: THINK[model] = THINK_VARIANTS.index(var) if var in THINK_VARIANTS else len(THINK_VARIANTS) - 1
        got = False
        with resp:
            for raw in resp:
                line = raw.decode('utf8', 'ignore').strip()
                if not line.startswith('data:'): continue
                try: j = json.loads(line[5:].strip())
                except Exception: continue
                c = (j.get('candidates') or [{}])[0]
                t = ''.join(p.get('text', '') for p in (c.get('content') or {}).get('parts', []) if not p.get('thought'))
                if t: got = True; yield t
                fr = c.get('finishReason', '')
                if not got and (j.get('promptFeedback', {}).get('blockReason') or re.search('SAFETY|BLOCK|RECITATION', fr)):
                    raise Err(422, 'Gemini did not answer this request (' + (fr or 'blocked') + '). Try different wording.')
        if not got: raise Err(502, 'Gemini sent an empty answer.')
        return
    raise last or Err(400, 'Gemini rejected the request.')

def openai_stream(cfg, req):
    msgs = ([{'role': 'system', 'content': req['system']}] if req.get('system') else []) + [{'role': m['role'], 'content': m['content']} for m in req.get('messages') or []]
    body = {'model': cfg['model'], 'messages': msgs, 'temperature': req.get('temperature', 0.3), 'max_tokens': min(req.get('maxTokens') or 4096, 8192), 'stream': True}
    try:
        resp = http_json(cfg['base'].rstrip('/') + '/chat/completions', body, {'Authorization': 'Bearer ' + cfg['key']})
    except urllib.error.HTTPError as e:
        st, msg, delay, kind = parse_err(e); raise Err(st, msg, delay, kind)
    except Exception as e:
        raise Err(0, f'Cannot reach the fallback service ({e}).')
    with resp:
        for raw in resp:
            line = raw.decode('utf8', 'ignore').strip()
            if not line.startswith('data:') or line.endswith('[DONE]'): continue
            try: t = json.loads(line[5:])['choices'][0]['delta'].get('content')
            except Exception: t = None
            if t: yield t

def generate_stream(req, _waited=0):
    """Yields ('text', piece) ... then ('done', info). Tries every key x model, then the optional backup service and Ollama.
    When everything is only briefly busy it simply waits (up to 30 s) instead of failing."""
    S = load_secrets()
    keys = S['gemini_keys']
    models = auto_models(S)
    now = time.time(); soonest = None; errors = []
    for ki, key in enumerate(keys):
        if BADKEY.get(ki, 0) > now: continue
        for model in models:
            until = COOL.get((ki, model), 0)
            if until > now:
                soonest = min(soonest or until, until); continue
            try:
                gen = gemini_stream(key, model, req)
                first = next(gen)                      # connect + first piece: errors surface here, before we promise anything
            except StopIteration:
                continue
            except Err as e:
                errors.append(f'{model}: HTTP {e.status} {e.message[:100]}')
                if e.status == 429:
                    wait = e.retry_after + 2 if e.retry_after else (3 * 3600 if e.kind == 'day' else 65)
                    COOL[(ki, model)] = time.time() + wait; soonest = min(soonest or COOL[(ki, model)], COOL[(ki, model)])
                elif e.status in (500, 503, 502): COOL[(ki, model)] = time.time() + 20
                elif e.status == 404: COOL[(ki, model)] = time.time() + 3600
                elif e.status in (400, 401, 403) and re.search(r'api key|denied|permission|suspend|disabled|refused', e.message, re.I): BADKEY[ki] = time.time() + 3600; break
                elif e.status == 422: raise
                continue
            yield ('text', first)
            for piece in gen: yield ('text', piece)
            yield ('done', {'model': model, 'key': ki + 1, 'via': 'gemini'})
            return
    oa = S.get('openai') or {}
    if oa.get('key'):
        try:
            for piece in openai_stream(oa, req): yield ('text', piece)
            yield ('done', {'model': oa['model'], 'via': 'backup'}); return
        except Err as e: errors.append(f'backup: HTTP {e.status} {e.message[:100]}')
    if S.get('ollama'):                                            # your own computer: no limit at all
        try:
            for piece in ollama_stream(S, req): yield ('text', piece)
            yield ('done', {'model': S['ollama'], 'via': 'ollama'}); return
        except Err as e: errors.append(f'ollama: {e.message[:100]}')
    if not keys and not oa.get('key') and not S.get('ollama'):
        raise Err(401, 'The backend has no AI key yet. Add one on the server: run  py start.py --add-key  (see README).', kind='nokey')
    wait = int(max(0, (soonest or now) - now))
    if soonest and 0 < wait <= 30 and _waited < 2:                 # a short cool-down: wait here, the person just sees the progress dots
        time.sleep(wait + 1)
        yield from generate_stream(req, _waited + 1); return
    raise Err(429 if soonest else 503, 'The service is busy right now. ' + (f'Please wait about {wait // 60 + 1 if wait > 60 else wait} {"minute(s)" if wait > 60 else "seconds"} and try again.' if wait else 'Please wait a moment and try again.'), retry_after=wait, kind='limit')

def ollama_stream(S, req):
    msgs = ([{'role': 'system', 'content': req['system']}] if req.get('system') else []) + [{'role': m['role'], 'content': m['content']} for m in req.get('messages') or []]
    try:
        resp = http_json(S['ollama_url'].rstrip('/') + '/api/chat', {'model': S['ollama'], 'messages': msgs, 'stream': True, 'options': {'temperature': req.get('temperature', 0.3)}}, timeout=600)
    except urllib.error.HTTPError as e:
        st, msg, _, _ = parse_err(e); raise Err(st, msg)
    except Exception as e:
        raise Err(0, f'Ollama is not running ({e}).')
    with resp:
        for raw in resp:
            try: t = json.loads(raw)['message']['content']
            except Exception: t = ''
            if t: yield t

# ------------------------------------------------------------------ Google Cloud Translation (Basic, v2, NMT): official, supports Dzongkha
def usage_load():
    month = time.strftime('%Y-%m')
    try:
        u = json.load(open(USAGE_FILE, encoding='utf8'))
        if u.get('month') == month: return u
    except Exception: pass
    return {'month': month, 'google_chars': 0}

def usage_add(n):
    with LOCK:
        u = usage_load(); u['google_chars'] += n
        try: json.dump(u, open(USAGE_FILE, 'w', encoding='utf8'))
        except Exception: pass
    return u

def google_translate(text, source=''):
    """Plain machine translation into Dzongkha. The characters sent are counted against a monthly cap (default 450,000 =
    below the 500,000 free allowance) so the free allowance can never be exceeded by accident."""
    S = load_secrets()
    if not S['gt_key']: raise Err(401, 'Google Cloud Translation is not set up on the backend (GOOGLE_TRANSLATE_KEY in .env).', kind='nokey')
    n = len(text)
    if usage_load()['google_chars'] + n > S['gt_cap']:
        raise Err(429, f"The monthly translation allowance ({S['gt_cap']:,} characters) is used up. It renews next month.", kind='limit')
    chunks, cur = [], ''
    for para in text.split('\n'):
        if cur and len(cur) + len(para) > 4000: chunks.append(cur); cur = ''
        cur += ('\n' if cur else '') + para
    if cur.strip(): chunks.append(cur)
    body = {'q': chunks or [''], 'target': 'dz', 'format': 'text'}
    if source and source != 'auto': body['source'] = source
    try:
        with http_json(f"{GT_BASE}/language/translate/v2?key={urllib.parse.quote(S['gt_key'])}", body, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        st, msg, delay, kind = parse_err(e)
        raise Err(st, 'Google Cloud Translation: ' + (msg or f'HTTP {st}'), delay, 'limit' if st == 429 else kind)
    except Exception as e:
        raise Err(0, f'Cannot reach Google Cloud Translation ({e}).')
    usage_add(n)
    return '\n'.join(t['translatedText'] for t in data['data']['translations'])

# ------------------------------------------------------------------ offline model manager (download once, stored in ./models)
MODELS = {'translation': 700e6, 'chat': 800e6, 'chat-better': 2.2e9, 'voice': 160e6}
DL = {}            # name -> {'state': 'running'|'done'|'error', 'msg': ''}
def dm():
    sys.path.insert(0, HERE); import download_models; return download_models
def model_info():
    d = dm(); info = {}
    for name in MODELS:
        repo = d.SETS[name][0]; mb = d.size_of(os.path.join(d.MODELS, *repo.split('/'))) / 1e6
        st = DL.get(name, {})
        info[name] = {'have': d.have(name), 'mb': round(mb), 'expect_mb': round(MODELS[name] / 1e6), 'state': st.get('state', ''), 'msg': st.get('msg', '')}
    return info
def start_download(name):
    if name not in MODELS: raise Err(400, 'Unknown model')
    if DL.get(name, {}).get('state') == 'running': return
    DL[name] = {'state': 'running'}
    def work():
        try:
            try: import huggingface_hub  # noqa
            except ImportError: subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', 'huggingface_hub'])
            dm().download([name]); DL[name] = {'state': 'done'}
        except BaseException as e:
            DL[name] = {'state': 'error', 'msg': str(e)[:200]}
    threading.Thread(target=work, daemon=True).start()

def fetch_models_in_background(names=('translation', 'chat')):
    """At start-up: fetch the offline open-source models in the background, one after another, only if missing (one time)."""
    def run():
        for n in names:
            try:
                if dm().have(n): continue
                start_download(n)
                while DL.get(n, {}).get('state') == 'running': time.sleep(2)
            except BaseException: pass
    threading.Thread(target=run, daemon=True).start()

# ------------------------------------------------------------------ HTTP
BLOCK = re.compile(r'(^|/)(secrets\.json.*|\.env.*|usage\.json|cache\.jsonl|\..*|.*\.py|.*\.bat|__pycache__.*|node_modules.*)$', re.I)

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.onnx': 'application/octet-stream', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'}
    def __init__(self, *a, **k): super().__init__(*a, directory=HERE, **k)
    def log_message(self, *a): pass

    def cors(self):
        o = self.headers.get('Origin', '')
        if re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', o):
            self.send_header('Access-Control-Allow-Origin', o); self.send_header('Access-Control-Allow-Headers', 'Content-Type'); self.send_header('Vary', 'Origin')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.send_header('Access-Control-Allow-Methods', 'GET, POST'); self.end_headers()

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.cors(); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 60e6: raise Err(413, 'That request is too large.')
        return json.loads(self.rfile.read(n) or b'{}')
    def fail(self, e):
        self.send_json(e.status if 400 <= e.status < 600 else 502, {'error': {'message': e.message, 'status': e.status, 'retry_after': e.retry_after, 'kind': e.kind}})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/api/'):
            try:
                if path == '/api/status': return self.send_json(200, self.status())
                if path == '/api/models': return self.send_json(200, model_info())
                raise Err(404, 'Unknown API')
            except Err as e: return self.fail(e)
        if BLOCK.search(urllib.parse.unquote(path).lstrip('/')): return self.send_error(404)
        return super().do_GET()
    do_HEAD = do_GET

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            req = self.body()
            if path == '/api/generate': return self.generate(req)
            if path == '/api/translate':
                txt = req.get('text', ''); k = 'gt:' + hashlib.sha256((req.get('sl', '') + '|' + txt).encode()).hexdigest()
                if k in CACHE: return self.send_json(200, {'text': CACHE[k], 'via': 'google', 'cached': True})
                out = google_translate(txt, req.get('sl', '')); cache_put(k, out)
                return self.send_json(200, {'text': out, 'via': 'google'})
            if path == '/api/models/download': start_download(req.get('name')); return self.send_json(200, {'ok': True})
            if path == '/api/cache/clear':
                CACHE.clear()
                try: os.remove(CACHE_FILE)
                except Exception: pass
                return self.send_json(200, {'ok': True})
            raise Err(404, 'Unknown API')
        except Err as e: self.fail(e)
        except Exception as e: self.fail(Err(500, 'Server error: ' + str(e)[:200]))

    def status(self):
        s = load_secrets(); oa = s.get('openai') or {}
        return {'backend': True, 'keys': len(s['gemini_keys']), 'fallback': bool(oa.get('key')) or bool(s.get('ollama')), 'cache': len(CACHE),
                'translate': {'engine': s['engine'], 'google': bool(s['gt_key']), 'used': usage_load()['google_chars'], 'cap': s['gt_cap']}, 'downloading': any(v.get('state') == 'running' for v in DL.values()), 'cooling': sum(1 for v in COOL.values() if v > time.time()), 'offline': {k: v['have'] for k, v in model_info().items()},
                'dictionary': os.path.exists(os.path.join(HERE, 'dict', 'dz_BT.dic'))}

    def generate(self, req):
        k = cache_key(req)
        stream = bool(req.get('stream'))
        if k in CACHE:
            text = CACHE[k]
            if not stream: return self.send_json(200, {'text': text, 'cached': True, 'model': 'cache'})
            self.start_sse(); self.sse({'t': text}); self.sse({'done': True, 'cached': True, 'model': 'cache'}); return
        gen = generate_stream(req)
        if not stream:
            text, info = '', {}
            for kind, v in gen:
                if kind == 'text': text += v
                else: info = v
            cache_put(k, text)
            return self.send_json(200, {'text': text, **info})
        try:
            it = iter(gen); first = next(it)               # errors before streaming starts -> normal JSON error
        except StopIteration:
            raise Err(502, 'Empty answer.')
        self.start_sse(); text = ''
        try:
            kind, v = first
            while True:
                if kind == 'text': text += v; self.sse({'t': v})
                else: self.sse({'done': True, **v})
                kind, v = next(it)
        except StopIteration: pass
        except Err as e: self.sse({'error': {'message': e.message, 'status': e.status}})
        except (BrokenPipeError, ConnectionResetError): return
        cache_put(k, text)

    def start_sse(self):
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.send_header('Connection', 'close'); self.cors(); self.end_headers()
    def sse(self, obj):
        self.wfile.write(('data: ' + json.dumps(obj, ensure_ascii=False) + '\n\n').encode()); self.wfile.flush()

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def make_server(port):
    while True:
        try: return Server(('127.0.0.1', port), Handler), port
        except OSError: port += 1

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv, port = make_server(port); print(f'http://localhost:{port}/'); srv.serve_forever()

"""
start.py  -  ONE command to run everything:   py start.py
  1. (optional, --models) downloads the offline models one time into ./models, never again; they can also be fetched from the page
  2. tries to get the free Dzongkha spelling dictionary (once)
  3. starts the BACKEND + page at http://localhost:8000 and opens your browser (your free API keys are kept by the backend)
Options:  --no-models (do not download the offline fallback models)  --add-key (save your AI key in the backend)  --models (offline models)  --skip-download (just run the page)   --chat (small chat model)   --chat-better (bigger)   --voice   --all   --port 9000   --no-open
"""
import argparse, os, subprocess, sys, threading, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

def ensure_hub():
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        print('Installing huggingface_hub (one time)…')
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', 'huggingface_hub'])

def main():
    ap = argparse.ArgumentParser()
    for k in ('chat', 'chat-better', 'voice', 'all', 'no-open', 'skip-download', 'models', 'no-models'):
        ap.add_argument('--' + k, action='store_true')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--add-key', nargs='?', const='', metavar='KEY', help='save an AI key in the backend (.env); without a value it asks, hidden')
    ap.add_argument('--add-google-key', nargs='?', const='', metavar='KEY', help='store a Google Cloud Translation key in the backend (.env), tested first')
    a = ap.parse_args()

    import server                                              # the backend: serves the page, keeps the keys, handles limits
    if a.add_google_key is not None:
        k = a.add_google_key or input('Google Cloud Translation API key: ').strip()
        if k: print('Saved in .env.' if server.add_google_key(k) else 'Not saved.')
        return
    if a.add_key is not None or (not server.load_secrets()['gemini_keys'] and sys.stdin.isatty()):
        raw = a.add_key
        if not raw:
            print('\nThe backend needs an AI key (one time). Create one at https://aistudio.google.com/apikey and paste it here\n(right-click pastes in the terminal; the key is shown on screen). Several keys: separate with commas. Press Enter to skip.')
            raw = input('API key: ').strip()
        if raw:
            ok = server.add_keys(raw)
            print(f'Saved {len(ok)} key(s) in .env on this computer.' if ok else 'No key was saved.')
        if a.add_key is not None: return
    if a.models or a.chat or a.chat_better or a.voice or a.all:      # offline models are optional (also downloadable from the page, one time)
        ensure_hub()
        import download_models as dm
        want = ['translation'] + [k for k in ('chat', 'chat-better', 'voice') if getattr(a, k.replace('-', '_')) or a.all]
        dm.download(want)

    marker = os.path.join(HERE, 'dict', '.tried')
    if not os.path.exists(os.path.join(HERE, 'dict', 'dz_BT.dic')) and not os.path.exists(marker):
        try:
            import get_dictionary
            get_dictionary.main()
        except BaseException as e:                  # never stop the app because of the optional dictionary
            print('(Spelling dictionary not downloaded:', e, ') You can try later: py get_dictionary.py')
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        open(marker, 'w').close()

    srv, port = server.make_server(a.port)
    n = len(server.load_secrets()['gemini_keys'])
    print(f"Backend ready. Saved Gemini keys: {n}" + ("" if n else "  (add one with:  py start.py --add-key)"))
    if not a.no_models and not a.skip_download:            # the automatic fallback needs the offline models: fetched once, in the background
        server.fetch_models_in_background(); print('Offline fallback models: checking / downloading once in the background (about 1.5 GB the first time).')
    url = f'http://localhost:{port}/'
    print(f'\nReady!  Open {url}   (press Ctrl+C to stop)')
    if not a.no_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')

if __name__ == '__main__':
    main()

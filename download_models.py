"""
download_models.py  -  download the open-source AI models from the terminal into ./models
The page loads them from there first, so the browser downloads nothing.
Safe to stop (Ctrl+C) and run again: it continues where it stopped.

  py -m pip install huggingface_hub
  py download_models.py                 translation model only (about 600 MB)  <- needed
  py download_models.py --chat          + small chat model Qwen2.5 0.5B (about 700 MB)
  py download_models.py --chat-better   + bigger chat model Qwen2.5 1.5B (about 2 GB)
  py download_models.py --voice         + Whisper voice model (about 150 MB)
  py download_models.py --all           everything
  py download_models.py --check         list what is already downloaded

If huggingface.co is slow or blocked on your network, try a hotspot or VPN, or set a mirror first
(PowerShell):   $env:HF_ENDPOINT = "https://hf-mirror.com"      (third-party mirror, use at your own risk)
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, 'models')
JSON_ETC = ['*.json', '*.model', '*.txt']          # config + tokenizer files

SETS = {
    'translation': ('Xenova/nllb-200-distilled-600M', JSON_ETC + ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']),
    'chat':        ('onnx-community/Qwen2.5-0.5B-Instruct', JSON_ETC + ['onnx/model_q4.onnx', 'onnx/model_q4f16.onnx']),
    'chat-better': ('onnx-community/Qwen2.5-1.5B-Instruct', JSON_ETC + ['onnx/model_q4.onnx', 'onnx/model_q4f16.onnx']),
    'voice':       ('Xenova/whisper-base', JSON_ETC + ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']),
}

def size_of(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs) if os.path.isdir(path) else 0

def have(name):
    repo, patterns = SETS[name]
    root = os.path.join(MODELS, *repo.split('/'))
    need = [p for p in patterns if '*' not in p]                   # the big .onnx files must all be there (a half download does not count)
    return all(os.path.exists(os.path.join(root, *p.split('/'))) and os.path.getsize(os.path.join(root, *p.split('/'))) > 1e6 for p in need if p.endswith('.onnx') and 'q4f16' not in p) and size_of(root) > 50e6

def download(names):
    """Download only what is missing (so it is a one-time download)."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        sys.exit('Please run first:   py -m pip install huggingface_hub')
    for name in names:
        if have(name):
            print(f'{name}: already downloaded, skipping.')
            continue
        repo, patterns = SETS[name]
        target = os.path.join(MODELS, *repo.split('/'))
        print(f'\n== {name}: {repo}\n   -> {target}')
        snapshot_download(repo_id=repo, local_dir=target, allow_patterns=patterns, max_workers=4)

def check():
    for name, (repo, _) in SETS.items():
        p = os.path.join(MODELS, *repo.split('/'))
        mb = size_of(p) / 1e6
        print(f"{'OK     ' if mb > 50 else 'missing'}  {name:12s} {repo:42s} {mb:7.0f} MB")

def main():
    ap = argparse.ArgumentParser()
    for k in ('chat', 'chat-better', 'voice', 'all', 'check'):
        ap.add_argument('--' + k, action='store_true')
    a = ap.parse_args()
    if a.check:
        return check()
    want = ['translation'] + [k for k in ('chat', 'chat-better', 'voice') if getattr(a, k.replace('-', '_')) or a.all]
    download(want)
    print('\nDone. Models in this folder:')
    check()
    print('\nNow start the page (py -m http.server 8000) and press Ctrl+Shift+R in the browser.')

if __name__ == '__main__':
    main()

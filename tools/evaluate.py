"""
Scores the translation quality of the running backend with chrF (character n-gram F-score, good for Dzongkha / Tibetan script).

  py tools/evaluate.py                      uses data/eval.csv   (columns: source,reference)
  py tools/evaluate.py my.csv --url http://localhost:8000

Needs the backend running (py start.py). Standard library only.
"""
import argparse, csv, json, os, sys, urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

def ngrams(s, n):
    s = ''.join(s.split())
    return Counter(s[i:i + n] for i in range(len(s) - n + 1))

def chrf(hyp, ref, N=6, beta=2.0):
    ps, rs = [], []
    for n in range(1, N + 1):
        h, r = ngrams(hyp, n), ngrams(ref, n)
        if not h or not r: continue
        ov = sum((h & r).values())
        ps.append(ov / sum(h.values())); rs.append(ov / sum(r.values()))
    if not ps: return 0.0
    p, r = sum(ps) / len(ps), sum(rs) / len(rs)
    return 0.0 if p + r == 0 else (1 + beta ** 2) * p * r / (beta ** 2 * p + r) * 100

def literal(src, name):
    i = src.index('const ' + name + ' = `') + len('const ' + name + ' = `'); import re; return src[i:re.compile(r'`(\.trim\(\))?;').search(src, i).start()].strip()

def prompt():
    """The translate prompt exactly as the page uses it (js/prompts.js)."""
    src = open(os.path.join(os.path.dirname(HERE), 'js', 'prompts.js'), encoding='utf8').read()
    return literal(src, 'TRANSLATE_PROMPT').replace('${DZONGKHA_RULES}', literal(src, 'DZONGKHA_RULES'))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('csv', nargs='?', default=os.path.join(os.path.dirname(HERE), 'data', 'eval.csv')); ap.add_argument('--url', default='http://localhost:8000'); ap.add_argument('--engine', choices=['gemini', 'google', 'both'], default='gemini', help='which translation engine to score (both = compare side by side)')
    a = ap.parse_args()
    if not os.path.exists(a.csv): sys.exit(f'Create {a.csv} with the columns  source,reference  (reference = a correct Dzongkha translation made by a Dzongkha speaker).')
    rows = list(csv.DictReader(open(a.csv, encoding='utf8')))
    system = prompt()
    def call(path, payload):
        r = urllib.request.Request(a.url + path, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        return json.loads(urllib.request.urlopen(r, timeout=300).read())['text']
    engines = ['gemini', 'google'] if a.engine == 'both' else [a.engine]
    scores = {e: [] for e in engines}
    for i, row in enumerate(rows, 1):
        line = f'{i:3d}  '
        for e in engines:
            hyp = call('/api/generate', {'system': system, 'messages': [{'role': 'user', 'content': row['source']}], 'stream': False}) if e == 'gemini' else call('/api/translate', {'text': row['source']})
            sc = chrf(hyp, row['reference']); scores[e].append(sc); line += f'{e} chrF {sc:5.1f}   '
        print(line + row['source'][:50])
    for e in engines:
        if scores[e]: print(f'\nAverage chrF, {e}: {sum(scores[e]) / len(scores[e]):.1f}  over {len(scores[e])} sentences')

if __name__ == '__main__':
    main()

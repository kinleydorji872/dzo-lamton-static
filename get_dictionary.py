"""
get_dictionary.py  -  download the free Dzongkha Hunspell dictionary (Debian package "hunspell-dz")
and put dz_BT.aff / dz_BT.dic into ./dict.      Run once:   py get_dictionary.py
Uses only Python's standard library.  Debian packages are .deb files (an "ar" archive holding a tar file).
"""
import io, lzma, gzip, os, re, sys, tarfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'dict')
POOL = 'https://deb.debian.org/debian/pool/main/h/hunspell-dz/'

def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def ar_members(data):
    if data[:8] != b'!<arch>\n':
        raise ValueError('not a .deb file')
    i = 8
    while i + 60 <= len(data):
        name = data[i:i + 16].decode().strip().rstrip('/')
        size = int(data[i + 48:i + 58].decode().strip())
        body = data[i + 60:i + 60 + size]
        yield name, body
        i += 60 + size + (size % 2)

def extract(deb):
    for name, body in ar_members(deb):
        if not name.startswith('data.tar'):
            continue
        if name.endswith('.xz'):
            raw = lzma.decompress(body)
        elif name.endswith('.gz'):
            raw = gzip.decompress(body)
        elif name.endswith('.zst'):
            sys.exit('This package uses zstd compression. Run:  py -m pip install zstandard   then try again.')
        else:
            raw = body
        os.makedirs(OUT, exist_ok=True)
        found = {}
        with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
            for m in tf.getmembers():
                base = os.path.basename(m.name)
                if m.isfile() and re.fullmatch(r'dz.*\.(aff|dic)', base):
                    found[base[-3:]] = tf.extractfile(m).read()
        if len(found) < 2:
            sys.exit('The package did not contain the dictionary files.')
        for ext, content in found.items():
            with open(os.path.join(OUT, 'dz_BT.' + ext), 'wb') as f:
                f.write(content)
        return True
    return False

def main(deb_path=None):
    if deb_path:                                # offline: py get_dictionary.py path\to\hunspell-dz.deb
        deb = open(deb_path, 'rb').read()
    else:
        print('Looking for the package…')
        index = fetch(POOL).decode('utf8', 'ignore')
        names = sorted(set(re.findall(r'href="(hunspell-dz_[^"]+_all\.deb)"', index)))
        if not names:
            sys.exit('Could not find the package. Download hunspell-dz_*_all.deb from packages.debian.org/sid/hunspell-dz and run:  py get_dictionary.py file.deb')
        print('Downloading', names[-1])
        deb = fetch(POOL + names[-1])
    if not extract(deb):
        sys.exit('No data archive found in the package.')
    print('Done: dict/dz_BT.aff and dict/dz_BT.dic are ready. Refresh the page (Ctrl+Shift+R).')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)

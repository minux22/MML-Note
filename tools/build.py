#!/usr/bin/env python3
"""Build MML Note from src/app.html (the single source) plus src/mabi-mml.js and src/mabi-lint.js.
- index.html: the app page for GitHub Pages, with PWA head tags and service-worker registration
- dist/artifact.html: the same app for a claude.ai preview (keeps the first two lines of the source)
- sw.js: cache name stamped with the app version (so installed apps update)
Run from the repo root: python3 tools/build.py"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent

def module(name):
    js = (root / 'src' / name).read_text(encoding='utf-8')
    js = '\n'.join(l for l in js.split('\n') if not l.startswith('import '))
    return re.sub(r'^export\s+(const|function|let|class)', r'\1', js, flags=re.M)

mml = 'const MabiCore=(function(){\n' + module('mabi-mml.js') + '\n' + module('mabi-lint.js') + \
      '\nreturn {TPQN,WHOLE,MAX_TRACKS,DEFAULT_CHAR_LIMIT,TEMPO_MIN,TEMPO_MAX,encodeSong,encodeTrack,toMML,splitMML,parseTrack,parseSong,lintParts,lintMML,formatPos,midiToName,fitTicks};\n})();'
src = (root / 'src/app.html').read_text(encoding='utf-8').replace('/*MABI_CORE*/', lambda m: mml) if False else \
      (root / 'src/app.html').read_text(encoding='utf-8').replace('/*MABI_CORE*/', mml)
ver = re.search(r'MML Note v([0-9][0-9.]*)', src).group(1)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/artifact.html').write_text('<!DOCTYPE html>\n' + src, encoding='utf-8')
# the first two lines (<title>, claude viewport meta) are for the claude.ai artifact only
body = src.split('\n', 2)[2]
head = '''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MML Note</title>
<meta name="theme-color" content="#0e0f11">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
</head><body>
'''
tail = '''
<script>
if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
  window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});
}
</script>
</body></html>
'''
(root / 'index.html').write_text(head + body + tail, encoding='utf-8')
sw = (root / 'sw.js').read_text(encoding='utf-8')
sw = re.sub(r"const CACHE='[^']*';", "const CACHE='mmlnote-v%s';" % ver, sw)
(root / 'sw.js').write_text(sw, encoding='utf-8')
print('built v' + ver)

"""Builds a single self-contained index.html.

python3 build.py                  -> dist/index.html, loads statistics live
python3 build.py stats.json       -> dist/index.html with statistics embedded
"""
import json, pathlib, sys

here = pathlib.Path(__file__).parent
src = here / 'src'
page = (src / 'page.html').read_text(encoding='utf-8')
heroes = json.loads((src / 'heroes.json').read_text(encoding='utf-8'))
stats = ''
if len(sys.argv) > 1:
    data = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    stats = '<script>window.EMBEDDED_STATS = ' + data.replace('</', '<\\/') + ';</script>'
parts = {
    '/*STYLE*/': (src / 'style.css').read_text(encoding='utf-8'),
    '/*HEROES*/': json.dumps(heroes, ensure_ascii=False),
    '<!--STATS-->': stats,
    '/*SCORING*/': (src / 'scoring.js').read_text(encoding='utf-8'),
    '/*ABILITIES*/': (src / 'abilities.json').read_text(encoding='utf-8'),
    '/*POSITIONS*/': (src / 'positions.json').read_text(encoding='utf-8'),
    '/*ABILITY_ANALYSIS*/': (src / 'abilities.js').read_text(encoding='utf-8'),
    '/*DATA*/': (src / 'data.js').read_text(encoding='utf-8'),
    '/*APP*/': (src / 'app.js').read_text(encoding='utf-8'),
    '/*GAME*/': (src / 'game.js').read_text(encoding='utf-8'),
}
for k, v in parts.items():
    page = page.replace(k, v)
out = here / 'dist' / 'index.html'
out.parent.mkdir(exist_ok=True)
# A standalone file (GitHub Pages) needs its own document skeleton.
doc = ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1">'
       '</head><body>' + page + '</body></html>')
out.write_text(doc, encoding='utf-8')
(here / 'dist' / 'artifact.html').write_text(page, encoding='utf-8')
print(out, len(doc))

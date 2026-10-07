#!/usr/bin/env python3
"""Build a single self-contained index.html: inline lightweight-charts + signal engine into src/app.html."""
import pathlib
root = pathlib.Path(__file__).parent
lib = (root / 'tools/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js').read_text()
eng = (root / 'src/engine.js').read_text()
html = (root / 'src/app.html').read_text()
for ph in ('/*__LWC__*/', '/*__ENGINE__*/'):
    assert ph in html, ph
html = html.replace('/*__LWC__*/', lib.replace('</script>', '<\\/script>')).replace('/*__ENGINE__*/', eng.replace('</script>', '<\\/script>'))
(root / 'index.html').write_text(html)
print('built index.html', len(html), 'bytes')

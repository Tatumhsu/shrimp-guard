"""Generate identical, closed-site notices for / and /projects/.

Run: python3 scripts/build_projects_entry.py
"""
from pathlib import Path


def build():
    return '''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>網站目前沒有公開內容</title>
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}
body{margin:0;font-family:system-ui,"Noto Sans TC",sans-serif;line-height:1.7}
main{max-width:600px;margin:15vh auto;padding:24px}
h1{font-size:clamp(24px,5vw,32px)}
</style>
</head>
<body><main><h1>這個網站目前沒有公開內容。</h1></main></body>
</html>
'''


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'overlays'
    for out in (root / 'index.html', root / 'projects' / 'index.html'):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(build(), encoding='utf-8')
    print('Home and projects: identical closed-site notices, no public links.')

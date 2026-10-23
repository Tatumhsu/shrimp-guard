import json
from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest
from urllib.parse import unquote, urljoin, urlsplit

from build_publication import build, hashes, validate
import build_projects_entry as entry

ROOT = Path(__file__).resolve().parents[1]
RETIRED = ('apps/world/', 'apps/world-taiwan/', 'apps/ai-frontier/', 'apps/oracle/',
           'apps/future/oracle/', 'apps/shared/', 'posts/', 'tags/', 'categories/',
           'archives/', 'page/', 'about/', 'public/', 'assets/css/')


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.elements = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class PublicationSafety(unittest.TestCase):
    def test_unapproved_deletion(self):
        with self.assertRaises(ValueError):
            validate({'room/a': 'x'}, {}, {'added': [], 'deleted': [], 'changed': []})

    def test_unapproved_mutation(self):
        with self.assertRaises(ValueError):
            validate({'room/a': 'x'}, {'room/a': 'y'}, {'added': [], 'deleted': [], 'changed': []})

    def test_unapproved_addition(self):
        with self.assertRaises(ValueError):
            validate({}, {'unexpected': 'x'}, {'added': [], 'deleted': [], 'changed': []})

    def test_exact_allowlist(self):
        self.assertEqual(validate({'a': 'x'}, {'a': 'x', 'projects/index.html': 'y'},
                         {'added': ['projects/index.html'], 'deleted': [], 'changed': []})['added'],
                         ['projects/index.html'])


class PublicWorks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.out = Path(cls.temp.name) / 'public'
        cls.report = build(ROOT, cls.out, Path(cls.temp.name) / 'report.json')
        cls.files = hashes(cls.out)

    def html(self, path):
        return (self.out / path).read_text(encoding='utf-8')

    def test_root_and_projects_are_generated_works_page(self):
        html = entry.build()
        self.assertEqual(self.html('index.html'), html)
        self.assertEqual(self.html('projects/index.html'), html)
        self.assertEqual(entry.CHECKED, '2026-10-24')
        self.assertEqual(entry.CATS, [('live', '看台灣'), ('ai', 'AI 作品'), ('game', '遊戲與故事')])
        self.assertIn('狀態核對日 2026-10-24', html)
        self.assertEqual([w['name'] for w in entry.WORKS],
                         ['時光之城', '光影台灣', '此刻台灣的聲音', '瀏覽器 AI 實驗室', 'Emergence World', '航程風浪'])
        self.assertEqual([w['url'] for w in entry.WORKS], [
            '/apps/future/', '/apps/relief/', '/apps/sound/', '/apps/ailab/',
            'https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/',
            '/room/'])
        self.assertEqual(entry.WORKS[-1]['links'], [{'name': '沖繩上岸', 'url': '/room/#landing'}])
        links = [a['href'] for tag, a in Elements(html).elements if tag == 'a']
        self.assertEqual(links, ['/', '/projects/', '#live', '#ai', '#game'] +
                         [w['url'] for w in entry.WORKS] + ['/room/#landing'])
        for removed in ('全球關注', '對台灣的影響', 'AI 前沿日報', '每日預言', '部落格', '文章',
                        '離港前60分鐘', '僅擁有者', '需要登入', 'dashboard.shrimp-guard.us.ci'):
            self.assertNotIn(removed, html)
        self.assertNotRegex(html, r'\d+/\d+ 通過')

    def test_retirements_are_absent_from_composed_output(self):
        for prefix in RETIRED:
            self.assertFalse((self.out / prefix).exists(), prefix)
        for path in ('index.xml', 'sitemap.xml', 'taiwan-stock-chart.png', '.hugo_build.lock',
                     'apps/future/tabs.js'):
            self.assertNotIn(path, self.files)
        self.assertFalse(any(p.endswith('.xml') for p in self.files), 'No remaining blog RSS or sitemap')
        self.assertFalse((ROOT / 'content/posts').exists())
        self.assertFalse((ROOT / 'static/taiwan-stock-chart.png').exists())
        self.assertFalse((ROOT / 'content/about.md').exists())

    def test_exact_removal_allowlist(self):
        allow = json.loads((ROOT / 'verification/allowlist.json').read_text())
        baseline = json.loads((ROOT / 'verification/baseline.json').read_text())
        removals = json.loads((ROOT / 'verification/remove.json').read_text())
        self.assertEqual(self.report['diff'], allow)
        matched = sorted(p for p in baseline if any(
            p.startswith(r) if r.endswith('/') else p == r for r in removals))
        self.assertEqual(matched, allow['deleted'])
        for removal in removals:
            self.assertTrue(any(p.startswith(removal) if removal.endswith('/') else p == removal
                                for p in baseline), removal)
        for overlay in (ROOT / 'overlays').rglob('*'):
            if overlay.is_file():
                self.assertNotIn(overlay.relative_to(ROOT / 'overlays').as_posix(), matched)

    def test_remaining_works_and_domain_are_preserved(self):
        baseline = json.loads((ROOT / 'verification/baseline.json').read_text())
        for path, digest in baseline.items():
            if path.startswith(('apps/relief/', 'apps/sound/', 'apps/ailab/', 'room/', 'apps/future/vendor/')) or path in (
                    'CNAME', 'apps/future/data.html', 'apps/future/data/world.json',
                    'apps/future/app.js', 'apps/future/style.css'):
                self.assertEqual(self.files.get(path), digest, path)
        self.assertEqual((self.out / 'CNAME').read_text().strip(), 'shrimp-guard.us.ci')
        for name in ('ailab', 'emergence', 'room'):
            for ext in ('.webp', '.poster.webp'):
                self.assertIn('projects/previews/' + name + ext, self.files)
        self.assertEqual(len([p for p in self.files if p.startswith('projects/previews/')]), 6)

    def test_city_is_standalone_and_has_unique_ids(self):
        html = self.html('apps/future/index.html')
        elements = Elements(html).elements
        ids = [a['id'] for _, a in elements if 'id' in a]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn('<title>時光之城</title>', html)
        self.assertTrue(any(tag == 'main' and a.get('id') == 'city-panel' for tag, a in elements))
        self.assertFalse(any(a.get('role') in ('tab', 'tablist', 'tabpanel') for _, a in elements))
        for token in ('oracle', 'work-tabs', 'tabs.js', '每日預言'):
            for path in ('index.html', 'city.js', 'city.css'):
                self.assertNotIn(token, self.html('apps/future/' + path))
        self.assertIn('milestone', ids)
        self.assertIn('src="city.js"', html)
        self.assertIn('href="data.html"', html)
        self.assertIn('visibilitychange', self.html('apps/future/city.js'))

    def test_chinese_404_and_real_favicons(self):
        html = self.html('404.html')
        self.assertIn('lang="zh-Hant"', html)
        self.assertIn('找不到這個頁面', html)
        self.assertIn('href="/projects/"', html)
        for path in ('404.html', 'index.html', 'projects/index.html'):
            self.assertIn('href="/favicon.ico"', self.html(path))
            self.assertIn('href="/favicon.svg"', self.html(path))
        self.assertTrue((self.out / 'favicon.ico').read_bytes().startswith(b'\x00\x00\x01\x00'))
        self.assertIn('<svg ', self.html('favicon.svg'))

    def test_local_links_resolve_after_deletions(self):
        for page in ('index.html', 'projects/index.html', '404.html', 'apps/future/index.html', 'apps/future/data.html'):
            for tag, attrs in Elements(self.html(page)).elements:
                for key in ('href', 'src', 'srcset'):
                    if key not in attrs:
                        continue
                    url = urlsplit(urljoin('https://local.invalid/' + page, attrs[key]))
                    if url.netloc != 'local.invalid':
                        continue
                    path = unquote(url.path).lstrip('/')
                    if not path or path.endswith('/'):
                        path += 'index.html'
                    self.assertIn(path, self.files, f'{page}: {attrs[key]}')


if __name__ == '__main__':
    unittest.main()

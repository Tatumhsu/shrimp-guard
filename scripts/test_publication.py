import json
from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest
from urllib.parse import unquote, urljoin, urlsplit

from build_publication import build, hashes, validate
import build_projects_entry as entry

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = {'index.html', 'projects/index.html', '404.html', 'CNAME', 'favicon.ico', 'favicon.svg'}
PAGES = ('index.html', 'projects/index.html', '404.html')
RETIRED = ('apps/', 'room/', 'projects/previews/', 'posts/', 'tags/', 'categories/',
           'archives/', 'page/', 'about/', 'public/', 'assets/')
NOTICE = '這個網站目前沒有公開內容。'


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


class ClosedPublicSite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.out = Path(cls.temp.name) / 'public'
        cls.report = build(ROOT, cls.out, Path(cls.temp.name) / 'report.json')
        cls.files = hashes(cls.out)

    def html(self, path):
        return (self.out / path).read_text(encoding='utf-8')

    def test_root_and_projects_are_identical_generated_notices(self):
        for page in ('index.html', 'projects/index.html'):
            html = self.html(page)
            self.assertEqual(html, entry.build())
            self.assertIn(f'<h1>{NOTICE}</h1>', html)
            elements = Elements(html).elements
            self.assertEqual(sum(tag == 'main' for tag, _ in elements), 1)
            self.assertEqual(sum(tag == 'h1' for tag, _ in elements), 1)
            self.assertFalse(any(tag in ('article', 'nav', 'section', 'footer', 'details')
                                 for tag, _ in elements), page)

    def test_retirements_are_absent_and_only_support_files_remain(self):
        self.assertEqual(set(self.files), PUBLIC_FILES)
        self.assertEqual(self.report['after_count'], len(PUBLIC_FILES))
        for prefix in RETIRED:
            self.assertFalse((self.out / prefix).exists(), prefix)
        self.assertFalse((ROOT / 'overlays/apps').exists())
        self.assertFalse((ROOT / 'content/posts').exists())
        self.assertFalse((ROOT / 'static/taiwan-stock-chart.png').exists())
        self.assertFalse((ROOT / 'content/about.md').exists())

    def test_exact_removal_allowlist(self):
        allow = json.loads((ROOT / 'verification/allowlist.json').read_text())
        baseline = json.loads((ROOT / 'verification/baseline.json').read_text())
        removals = json.loads((ROOT / 'verification/remove.json').read_text())
        self.assertEqual(self.report['diff'], allow)
        if any(p.startswith('apps/') for p in baseline):
            self.assertIn('apps/', removals)
        matched = sorted(p for p in baseline if any(
            p.startswith(r) if r.endswith('/') else p == r for r in removals))
        self.assertEqual(matched, allow['deleted'])
        self.assertEqual(set(allow['deleted']), set(baseline) - PUBLIC_FILES)
        self.assertEqual(allow['added'], sorted(PUBLIC_FILES - set(baseline)))
        self.assertLessEqual(set(allow['changed']), set(PAGES))
        for removal in removals:
            self.assertTrue(any(p.startswith(removal) if removal.endswith('/') else p == removal
                                for p in baseline), removal)
        for overlay in (ROOT / 'overlays').rglob('*'):
            if overlay.is_file():
                name = overlay.relative_to(ROOT / 'overlays').as_posix()
                self.assertFalse(any(name.startswith(r) if r.endswith('/') else name == r
                                     for r in removals), name)

    def test_domain_and_favicons_are_preserved(self):
        baseline = json.loads((ROOT / 'verification/baseline.json').read_text())
        self.assertEqual(self.files['CNAME'], baseline['CNAME'])
        self.assertEqual((self.out / 'CNAME').read_text().strip(), 'shrimp-guard.us.ci')
        for icon in ('favicon.ico', 'favicon.svg'):
            if icon in baseline:
                self.assertEqual(self.files[icon], baseline[icon])
            else:
                self.assertEqual((self.out / icon).read_bytes(), (ROOT / 'overlays' / icon).read_bytes())
        self.assertTrue((self.out / 'favicon.ico').read_bytes().startswith(b'\x00\x00\x01\x00'))
        self.assertIn('<svg ', self.html('favicon.svg'))

    def test_all_pages_are_chinese_noindex_without_links_or_active_content(self):
        for page in PAGES:
            html = self.html(page)
            elements = Elements(html).elements
            self.assertIn(('html', {'lang': 'zh-Hant'}), elements)
            robots = [a.get('content', '').split(',') for tag, a in elements
                      if tag == 'meta' and a.get('name') == 'robots']
            self.assertEqual(len(robots), 1, page)
            self.assertIn('noindex', [v.strip().lower() for v in robots[0]], page)
            self.assertFalse(any(tag in ('a', 'area', 'script', 'iframe', 'object', 'embed',
                                        'form', 'button', 'input', 'canvas', 'picture', 'img', 'source')
                                 for tag, _ in elements), page)
            self.assertFalse(any(a.get('http-equiv', '').lower() == 'refresh' for _, a in elements), page)
            self.assertFalse(any(key.lower().startswith('on') for _, a in elements for key in a), page)
            for removed in ('時光之城', '/apps/', '作品入口', 'projects/previews/', '部落格',
                            '光影台灣', '此刻台灣的聲音', '瀏覽器 AI 實驗室', 'Emergence World',
                            '航程風浪', '沖繩上岸', 'dashboard.shrimp-guard.us.ci'):
                self.assertNotIn(removed, html, page)

    def test_chinese_404_explains_site_closure(self):
        html = self.html('404.html')
        self.assertIn('<h1>找不到這個頁面</h1>', html)
        self.assertIn('404', html)
        self.assertIn(NOTICE, html)

    def test_local_assets_resolve_without_external_or_work_links(self):
        for page in PAGES:
            targets = []
            for tag, attrs in Elements(self.html(page)).elements:
                for key in ('href', 'src', 'srcset'):
                    if key not in attrs:
                        continue
                    self.assertEqual((tag, key, attrs.get('rel')), ('link', 'href', 'icon'), page)
                    url = urlsplit(urljoin('https://local.invalid/' + page, attrs[key]))
                    self.assertEqual(url.netloc, 'local.invalid', page)
                    path = unquote(url.path).lstrip('/')
                    self.assertIn(path, self.files, f'{page}: {attrs[key]}')
                    targets.append(path)
            self.assertEqual(sorted(targets), ['favicon.ico', 'favicon.svg'], page)


if __name__ == '__main__':
    unittest.main()

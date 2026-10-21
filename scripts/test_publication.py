import unittest
from build_publication import validate
class PublicationSafety(unittest.TestCase):
 def test_unapproved_deletion(self):
  with self.assertRaises(ValueError): validate({'room/a':'x'},{},{'added':[],'deleted':[],'changed':[]})
 def test_unapproved_mutation(self):
  with self.assertRaises(ValueError): validate({'world-impact/a':'x'},{'world-impact/a':'y'},{'added':[],'deleted':[],'changed':[]})
 def test_unapproved_addition(self):
  with self.assertRaises(ValueError): validate({},{'unexpected':'x'},{'added':[],'deleted':[],'changed':[]})
 def test_exact_allowlist(self):
  self.assertEqual(validate({'a':'x'},{'a':'x','projects/index.html':'y'},{'added':['projects/index.html'],'deleted':[],'changed':[]})['added'],['projects/index.html'])

class EntryContent(unittest.TestCase):
 def test_public_world_snapshot_index(self):
  import json
  from pathlib import Path
  root=Path(__file__).resolve().parents[1]
  data=next(d for d in (root/'overlays/apps/world/data/api',root/'publication/apps/world/data/api') if d.exists())
  days=sorted(p.stem for p in data.glob('*.json') if len(p.stem)==8 and p.stem.isdigit())
  self.assertTrue(days)
  self.assertEqual(json.loads((data/'days.json').read_text()),{'days':days,'latest':days[-1]})
  for day in days:
   snapshot=json.loads((data/(day+'.json')).read_text())
   self.assertEqual(snapshot['status'],'done')
   self.assertEqual(snapshot['doc']['day'],day)
  for app in ('world','future'):
   for path in (root/'overlays/apps'/app).rglob('*'):
    if path.is_file():
     text=path.read_text(encoding='utf-8')
     self.assertNotIn('/workroom/',text,str(path))
     self.assertNotIn('/api/',text.replace('data/api/',''),str(path))

 def test_local_entry_links_and_homepage_delta(self):
  from pathlib import Path
  from html.parser import HTMLParser
  root=Path(__file__).resolve().parents[1]
  class Links(HTMLParser):
   def __init__(self): super().__init__(); self.links=[]
   def handle_starttag(self,tag,attrs):
    d=dict(attrs)
    if tag=='a' and 'href' in d:self.links.append(d['href'])
  entry=root/'overlays/projects/index.html'
  if not entry.exists(): entry=root/'publication/projects/index.html'
  if not entry.exists(): self.skipTest('Entry absent in rollback baseline')
  parser=Links(); html=entry.read_text(encoding='utf-8');parser.feed(html)
  import importlib.util
  spec=importlib.util.spec_from_file_location('entry',root/'scripts/build_projects_entry.py'); entry_src=importlib.util.module_from_spec(spec); spec.loader.exec_module(entry_src)
  self.assertEqual(html,entry_src.build())   # overlay is exactly the generated page
  ordered=[w for c,_ in entry_src.CATS for w in sorted((w for w in entry_src.WORKS if w['c']==c),key=lambda w:w['g']!='ok')]
  expected=['/','/']+['#'+c for c,_ in entry_src.CATS]+[w['url'] for w in ordered if w.get('url')]
  self.assertEqual(parser.links,expected)
  self.assertEqual(entry_src.CHECKED,'2026-10-21')
  self.assertEqual(entry_src.CATS,[('live','看世界'),('ai','AI 作品'),('game','遊戲與故事'),('tools','文章')])
  self.assertEqual([w['url'] for w in ordered],[
   '/apps/world/','/apps/future/','/apps/world-taiwan/','/apps/relief/','/apps/sound/',
   '/apps/ai-frontier/','/apps/oracle/','/apps/ailab/',
   'https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/',
   '/room/','/room/#landing','https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site','/'])
  self.assertEqual(sum(not w.get('sub',False) for w in ordered),12)
  self.assertEqual([w['name'] for w in ordered if w.get('sub')],['沖繩上岸'])
  self.assertNotIn('dashboard.shrimp-guard.us.ci',html)
  for href in parser.links:
   if href.startswith('/'):
    self.assertTrue(any((root/d/href.split('#')[0].lstrip('/')/'index.html').is_file() for d in ('publication','overlays')))
  for w in entry_src.WORKS:
   if w['g']=='ask': self.assertIsNone(w.get('url'))
  for status in ['開發中','公開','免登入','僅擁有者 ChatGPT 帳號']: self.assertIn(status,html)
  self.assertNotIn('需要登入',html)
  self.assertNotRegex(html,r'\d+/\d+ 通過')   # test results stay in the report, not on public cards
  delta='\n<li><a href="/projects/">作品入口</a></li>'.encode()
  if (root/'overlays/index.html').exists():
   self.assertEqual((root/'overlays/index.html').read_bytes().replace(delta,b''),(root/'publication/index.html').read_bytes())

if __name__=='__main__': unittest.main()

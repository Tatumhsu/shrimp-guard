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
  expected=['/','/']+['#'+c for c,_ in entry_src.CATS]+[url for w in ordered for url in ([w['url']] if w.get('url') else [])+[link['url'] for link in w.get('links',[])]]
  self.assertEqual(parser.links,expected)
  self.assertEqual(entry_src.CHECKED,'2026-10-23')
  self.assertEqual(entry_src.CATS,[('live','看世界'),('ai','AI 作品'),('game','遊戲與故事'),('tools','文章')])
  self.assertEqual([w['url'] for w in ordered],[
   '/apps/world/','/apps/future/','/apps/relief/','/apps/sound/',
   '/apps/ai-frontier/','/apps/ailab/',
   'https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/',
   '/room/','/'])
  self.assertEqual(len(ordered),9)
  self.assertFalse(any(w.get('sub') for w in ordered))
  room=next(w for w in ordered if w['name']=='航程風浪')
  self.assertEqual(room['links'],[{'name':'沖繩上岸','url':'/room/#landing'}])
  self.assertIn('時光之城＋每日預言',html)
  for removed in ('離港前60分鐘','harbor-sixty-minute-game','僅擁有者 ChatGPT 帳號','/apps/oracle/','/apps/world-taiwan/'):
   self.assertNotIn(removed,html)
  self.assertNotIn('dashboard.shrimp-guard.us.ci',html)
  for href in parser.links:
   if href.startswith('/'):
    self.assertTrue(any((root/d/href.split('#')[0].lstrip('/')/'index.html').is_file() for d in ('publication','overlays')))
  for w in entry_src.WORKS:
   if w['g']=='ask': self.assertIsNone(w.get('url'))
  for status in ['開發中','公開','免登入']: self.assertIn(status,html)
  self.assertNotIn('需要登入',html)
  self.assertNotRegex(html,r'\d+/\d+ 通過')   # test results stay in the report, not on public cards
  delta='\n<li><a href="/projects/">作品入口</a></li>'.encode()
  if (root/'overlays/index.html').exists():
   self.assertEqual((root/'overlays/index.html').read_bytes().replace(delta,b''),(root/'publication/index.html').read_bytes())

class MergedWorks(unittest.TestCase):
 def setUp(self):
  from pathlib import Path
  self.root=Path(__file__).resolve().parents[1]

 def effective(self,path):
  return next(p for d in ('overlays','publication') if (p:=self.root/d/path).is_file())

 def test_tab_routes_and_unique_ids(self):
  from html.parser import HTMLParser
  class Elements(HTMLParser):
   def __init__(self): super().__init__(); self.elements=[]
   def handle_starttag(self,tag,attrs): self.elements.append((tag,dict(attrs)))
  for app,tabs in [('future',['city','oracle']),('world',['world','taiwan'])]:
   parser=Elements(); parser.feed(self.effective(f'apps/{app}/index.html').read_text())
   ids=[attrs['id'] for _,attrs in parser.elements if 'id' in attrs]
   self.assertEqual(len(ids),len(set(ids)),app+' has duplicate DOM IDs')
   links=[attrs for _,attrs in parser.elements if attrs.get('role')=='tab']
   self.assertEqual([a['href'] for a in links],['#'+tab for tab in tabs])
   for a in links: self.assertIn(a['aria-controls'],ids)
   panels=[attrs for _,attrs in parser.elements if attrs.get('role')=='tabpanel']
   self.assertEqual([p['id'] for p in panels],[tab+'-panel' for tab in tabs])
   self.assertNotIn('hidden',panels[0]); self.assertIn('hidden',panels[1])

 def test_old_routes_have_static_redirect_and_fallback(self):
  from html.parser import HTMLParser
  class Redirect(HTMLParser):
   def __init__(self): super().__init__(); self.refresh=[];self.links=[];self.scripts=[]
   def handle_starttag(self,tag,attrs):
    a=dict(attrs)
    if tag=='meta' and a.get('http-equiv','').lower()=='refresh': self.refresh.append(a['content'])
    if tag=='a': self.links.append(a['href'])
    if tag=='script': self.scripts.append(a)
  for old,target in [('oracle','/apps/future/#oracle'),('world-taiwan','/apps/world/#taiwan')]:
   parser=Redirect();parser.feed(self.effective(f'apps/{old}/index.html').read_text())
   self.assertEqual(parser.refresh,['0; url='+target]);self.assertEqual(parser.links,[target]);self.assertFalse(parser.scripts)

 def test_migrated_public_data(self):
  import json
  for name in ('latest','board','history'):
   old=json.loads(self.effective(f'apps/oracle/data/{name}.json').read_text())
   old.pop('cost_usd',None)
   new=json.loads(self.effective(f'apps/future/oracle/data/{name}.json').read_text())
   self.assertEqual(old,new)
   self.assertNotIn('cost_usd',new)
  for name in ('data/news.json','assets/world.svg'):
   self.assertEqual(self.effective('apps/world-taiwan/'+name).read_bytes(),self.effective('apps/world/taiwan/'+name).read_bytes())

 def test_composed_publication_and_preview_retirement(self):
  import json,tempfile
  from pathlib import Path
  from build_publication import build
  with tempfile.TemporaryDirectory() as tmp:
   out=Path(tmp)/'public'
   report=build(self.root,out,Path(tmp)/'report.json')
   self.assertEqual(report['diff'],json.loads((self.root/'verification/allowlist.json').read_text()))
   self.assertFalse((out/'projects/previews/oracle.webp').exists())
   self.assertFalse((out/'projects/previews/oracle.poster.webp').exists())
   for name in ('world','ai-frontier','ailab','emergence','room','blog'):
    for ext in ('.webp','.poster.webp'): self.assertTrue((out/f'projects/previews/{name}{ext}').is_file())
   for route in ('future/','future/data.html','oracle/','world/','world-taiwan/'):
    self.assertTrue((out/'apps'/(route+'index.html' if route.endswith('/') else route)).is_file())

if __name__=='__main__': unittest.main()

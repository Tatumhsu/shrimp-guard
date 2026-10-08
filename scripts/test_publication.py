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
  self.assertEqual(len(parser.links),9)
  for href in parser.links:
   if href.startswith('/'):
    self.assertTrue((root/'publication'/href.lstrip('/')/'index.html').is_file())
  for status in ['保留待改作','待整理','假資料測試版']: self.assertIn(status,html)
  delta='\n<li><a href="/projects/">作品入口</a></li>'.encode()
  if (root/'overlays/index.html').exists():
   self.assertEqual((root/'overlays/index.html').read_bytes().replace(delta,b''),(root/'publication/index.html').read_bytes())

if __name__=='__main__': unittest.main()

import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release


class ReleaseState(unittest.TestCase):
    def setUp(self):
        self.plan = {'before': {'main': 'm0', 'gh-pages': 'p0'},
                     'source_commit': 'm1', 'publication_commit': 'p1', 'promotion_commit': 'm2'}

    def test_remote_advance_stops(self):
        with self.assertRaises(RuntimeError):
            release.phase(self.plan, {'main': 'someone-else', 'gh-pages': 'p0'})

    def test_retry_recognizes_each_phase(self):
        for main, pub, expected in [('m0', 'p0', 'prepared'), ('m1', 'p0', 'source-ready'),
                                    ('m1', 'p1', 'published'), ('m2', 'p1', 'complete')]:
            self.assertEqual(release.phase(self.plan, {'main': main, 'gh-pages': pub}), expected)

    def test_already_published_never_repushes(self):
        with patch.object(release, 'verify_plan'), patch.object(release, 'heads', return_value={'main':'m1','gh-pages':'p1'}), patch.object(release, 'push') as push:
            release.publish(argparse.Namespace(execute=True), self.plan)
            push.assert_not_called()

    def test_failed_build_never_promotes(self):
        with patch.object(release, 'verify_plan'), patch.object(release, 'heads', return_value={'main':'m1','gh-pages':'p1'}), patch.object(release, 'preflight'), patch.object(release, 'api_client', return_value=lambda p: {'status':'errored','commit':'p1'}), patch.object(release, 'push') as push:
            with self.assertRaises(RuntimeError):
                release.finalize(argparse.Namespace(execute=True), self.plan)
            push.assert_not_called()

    def test_completed_retry_no_write(self):
        with patch.object(release, 'verify_plan'), patch.object(release, 'heads', return_value={'main':'m2','gh-pages':'p1'}), patch.object(release, 'push') as push:
            release.finalize(argparse.Namespace(execute=True), self.plan)
            push.assert_not_called()

    def test_preflight_active_legacy_run_stops(self):
        def api(path):
            if path == '/pages':
                return {'build_type':'legacy','source':{'branch':'gh-pages','path':'/'},'cname':release.DOMAIN}
            return {'workflow_runs':[{'id':1,'path':'.github/workflows/hugo.yml','status':'queued'}]} if 'status=queued' in path else {'workflow_runs':[]}
        with self.assertRaisesRegex(RuntimeError, 'no cancellation'):
            release.preflight(api)

    def test_tree_publication_and_promotion_are_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(release, 'ROOT', Path(tmp)):
            root=Path(tmp);(root/'.release').mkdir()
            release.git('init', '-q')
            initial_tree=release.object_tree({'publication/index.html':b'old', 'overlays/projects/index.html':b'new', '.github/workflows/publication.yml':b'validation-only'})
            # Root commit fixture, then ordinary parented release objects.
            source=release.git('-c','user.name=Test','-c','user.email=test@localhost','commit-tree',initial_tree,data=b'fixture\n').decode().strip()
            release.git('read-tree',source)
            release.git('update-index','--add','--cacheinfo','160000',source,'themes/PaperMod')
            source=release.commit(release.textgit('write-tree'),source,'with theme gitlink')
            output={'index.html':b'old','projects/index.html':b'new','CNAME':b'shrimp-guard.us.ci\n'}
            pub=release.commit(release.object_tree(output), source, 'publish')
            self.assertEqual(release.tree_files(pub),output)
            promoted=release.promotion(source,output,pub)
            files=release.tree_files(promoted)
            self.assertFalse(any(p.startswith('overlays/') for p in files))
            self.assertEqual(files['.github/workflows/publication.yml'],b'validation-only')
            self.assertEqual(release.git('ls-tree',source,'themes/PaperMod'),release.git('ls-tree',promoted,'themes/PaperMod'))
            self.assertEqual(json.loads(files['verification/source-state.json'])['publication_commit'],pub)
            self.assertEqual(json.loads(files['verification/baseline.json']),{p:hashlib.sha256(b).hexdigest() for p,b in output.items()})
            self.assertEqual(json.loads(files['verification/allowlist.json']),{'added':[],'changed':[],'deleted':[]})
            rollback=release.commit(release.object_tree({'index.html':b'old'}),pub,'rollback')
            self.assertEqual(release.textgit('rev-parse',rollback+'^'),pub)
            self.assertEqual(release.tree_files(rollback),{'index.html':b'old'})


if __name__ == '__main__':
    unittest.main()

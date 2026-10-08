"""Local, authenticated legacy-Pages release. Default commands never push.

prepare creates immutable Git objects + a resumable plan; publish and finalize
require --execute. No credentials/settings/workflow runs are created or cancelled.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

from build_publication import build, hashes

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Tatumhsu/shrimp-guard'
DOMAIN = 'shrimp-guard.us.ci'


def git(*args, data=None, env=None):
    return subprocess.check_output(['git', *args], cwd=ROOT, input=data, env=env)


def textgit(*args):
    return git(*args).decode().strip()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def api_client():
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never')
    result = subprocess.run(['git', 'credential', 'fill'], cwd=ROOT,
        input=b'protocol=https\nhost=github.com\npath=Tatumhsu/shrimp-guard.git\n\n',
        capture_output=True, env=env)
    credentials = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    if result.returncode or not credentials.get('password'):
        raise RuntimeError('Existing Git credentials unavailable; no new credential will be created')
    token = credentials['password']
    def api(path):
        request = urllib.request.Request('https://api.github.com/repos/'+REPO+path,
            headers={'Authorization': 'Bearer '+token, 'Accept': 'application/vnd.github+json',
                     'User-Agent': 'local-publication-release'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    return api


def heads():
    rows = textgit('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/gh-pages').splitlines()
    return {line.split()[1].rsplit('/', 1)[1]: line.split()[0] for line in rows}


def require_heads(actual, main, published):
    if actual != {'main': main, 'gh-pages': published}:
        raise RuntimeError('Remote advanced or changed; stop and reconcile. '+json.dumps(actual))


def preflight(api):
    settings = api('/pages')
    if (settings.get('build_type') != 'legacy' or
        settings.get('source') != {'branch': 'gh-pages', 'path': '/'} or settings.get('cname') != DOMAIN):
        raise RuntimeError('Existing Pages configuration changed; do not alter settings')
    active = []
    for status in ['queued', 'in_progress', 'waiting', 'pending', 'requested']:
        page = 1
        while True:
            runs = api(f'/actions/runs?status={status}&per_page=100&page={page}')['workflow_runs']
            active.extend({'id': r['id'], 'path': r.get('path'), 'status': r['status']}
                          for r in runs if r.get('path') != '.github/workflows/publication.yml')
            if len(runs) < 100:
                break
            page += 1
    if active:
        raise RuntimeError('Unreviewed workflow runs active; no cancellation performed: '+json.dumps(active))
    latest = api('/pages/builds/latest')
    if latest.get('status') in ('queued', 'building'):
        raise RuntimeError('Existing Pages build is active; retry after it finishes')
    return {'settings': {k: settings.get(k) for k in ['build_type', 'source', 'cname']},
            'active_nonvalidation_runs': active, 'latest_build_commit': latest.get('commit')}


def tree_files(commit, prefix=''):
    paths = git('ls-tree', '-rz', '--name-only', commit, '--', prefix or '.').decode().split('\0')
    return {p: git('show', commit+':'+p) for p in paths if p}


def object_tree(files, parent=None, remove_prefixes=()):
    # A private index builds trees without checkout/reset or touching the user's index.
    fd, index = tempfile.mkstemp(prefix='release-index-', dir=ROOT/'.release')
    os.close(fd)
    Path(index).unlink()
    env = dict(os.environ, GIT_INDEX_FILE=index)
    try:
        git('read-tree', parent if parent else '--empty', env=env)
        if parent:
            for path in tree_files(parent):
                if any(path.startswith(prefix) for prefix in remove_prefixes):
                    git('update-index', '--force-remove', '--', path, env=env)
        for path, content in files.items():
            blob = git('hash-object', '-w', '--stdin', data=content).decode().strip()
            git('update-index', '--add', '--cacheinfo', '100644', blob, path, env=env)
        return git('write-tree', env=env).decode().strip()
    finally:
        Path(index).unlink(missing_ok=True)


def commit(tree, parent, message):
    return git('-c', 'user.name=Codex', '-c', 'user.email=codex@localhost',
               'commit-tree', tree, '-p', parent, data=(message+'\n').encode()).decode().strip()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def promotion(source, output, publication_commit):
    manifest = {p: hashlib.sha256(b).hexdigest() for p, b in output.items()}
    files = {'publication/'+p: b for p, b in output.items()}
    files['verification/baseline.json'] = json_bytes(manifest)
    files['verification/source-state.json'] = json_bytes({'publication_commit': publication_commit})
    files['verification/allowlist.json'] = json_bytes({'added': [], 'changed': [], 'deleted': []})
    files['verification/result.json'] = json_bytes({'baseline_commit': publication_commit,
        'before_count': len(output), 'after_count': len(output), 'unchanged': len(output),
        'diff': {'added': [], 'changed': [], 'deleted': []},
        'files': {p: {'before': h, 'after': h} for p, h in manifest.items()}})
    tree = object_tree(files, source, ('publication/', 'overlays/'))
    return commit(tree, source, 'Synchronize verified Pages publication baseline '+publication_commit[:12])


def verify_plan(plan):
    output = tree_files(plan['publication_commit'])
    if {p: hashlib.sha256(b).hexdigest() for p, b in output.items()} != plan['artifact_hashes']:
        raise RuntimeError('Prepared publication object does not match reviewed artifact')
    if textgit('rev-parse', plan['publication_commit']+'^') != plan['before']['gh-pages']:
        raise RuntimeError('Publication is not an ordinary child of the expected remote head')
    if textgit('rev-parse', plan['promotion_commit']+'^') != plan['source_commit']:
        raise RuntimeError('Source promotion parent mismatch')
    if any(p.startswith(('.github/', 'scripts/', 'verification/')) for p in output):
        raise RuntimeError('Only the public artifact may be published')
    promoted = tree_files(plan['promotion_commit'])
    promoted_files = {p.removeprefix('publication/'): b for p, b in promoted.items() if p.startswith('publication/')}
    if promoted_files != output or any(p.startswith('overlays/') for p in promoted):
        raise RuntimeError('Source promotion does not exactly match publication output')
    if json.loads(promoted['verification/baseline.json']) != plan['artifact_hashes']:
        raise RuntimeError('Promoted manifest differs from reviewed artifact')
    if json.loads(promoted['verification/source-state.json'])['publication_commit'] != plan['publication_commit']:
        raise RuntimeError('Promoted expected publication SHA mismatch')
    if json.loads(promoted['verification/allowlist.json']) != {'added': [], 'changed': [], 'deleted': []}:
        raise RuntimeError('Promotion must reset reviewed deltas')
    return output


def prepare(args):
    if textgit('status', '--porcelain'):
        raise RuntimeError('Commit reviewed source changes first; working tree must be clean')
    if args.plan.exists():
        raise RuntimeError('Plan already exists; reuse publish/finalize or choose a new plan path')
    (ROOT/'.release').mkdir(exist_ok=True)
    api = api_client()
    before = heads()
    expected_pub = read(ROOT/'verification/source-state.json')['publication_commit']
    require_heads(before, args.expected_main, expected_pub)
    evidence = preflight(api)
    source = textgit('rev-parse', 'HEAD')
    subprocess.run(['git', 'merge-base', '--is-ancestor', args.expected_main, source], cwd=ROOT, check=True)
    if any((ROOT/'.github/workflows'/name).exists() for name in ['hugo.yml', 'deploy.yml']):
        raise RuntimeError('Competing workflows still present in source')
    # Fetch exact expected objects only; refs/working tree stay unchanged.
    git('fetch', '--no-tags', 'origin', before['gh-pages'])
    backup = {p: hashlib.sha256(b).hexdigest() for p, b in tree_files(before['gh-pages']).items()}
    if backup != read(ROOT/'verification/baseline.json'):
        raise RuntimeError('Remote publication bytes differ from canonical baseline')
    subprocess.run(['python', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'],
                   cwd=ROOT, check=True)
    directory = Path(tempfile.mkdtemp(prefix='artifact-', dir=ROOT/'.release'))
    report = build(ROOT, directory/'public', directory/'report.json')
    output = {p.relative_to(directory/'public').as_posix(): p.read_bytes()
              for p in (directory/'public').rglob('*') if p.is_file()}
    if args.rollback_plan:
        previous = read(args.rollback_plan)
        output = tree_files(previous['before']['gh-pages'])
        if {p: hashlib.sha256(b).hexdigest() for p, b in output.items()} != previous['backup_hashes']:
            raise RuntimeError('Rollback tree differs from verified backup')
    publication = commit(object_tree(output), before['gh-pages'],
                         'Rollback verified publication' if args.rollback_plan else 'Publish reviewed projects entry')
    plan = {'kind': 'rollback' if args.rollback_plan else 'release', 'before': before,
        'source_commit': source, 'publication_commit': publication,
        'promotion_commit': promotion(source, output, publication),
        'artifact_hashes': {p: hashlib.sha256(b).hexdigest() for p, b in output.items()},
        'backup_hashes': backup,
        'preflight': evidence, 'review_report': str(directory/'report.json')}
    verify_plan(plan)
    require_heads(heads(), before['main'], before['gh-pages'])
    save(args.plan, plan)
    print(json.dumps({k: plan[k] for k in ['kind', 'before', 'source_commit', 'publication_commit', 'promotion_commit']}, indent=2))
    print('DRY RUN: local objects prepared; no remote writes. Source baseline promotion remains pending verified deployment.')


def phase(plan, actual):
    if actual == {'main': plan['promotion_commit'], 'gh-pages': plan['publication_commit']}:
        return 'complete'
    if actual == {'main': plan['source_commit'], 'gh-pages': plan['publication_commit']}:
        return 'published'
    if actual == {'main': plan['source_commit'], 'gh-pages': plan['before']['gh-pages']}:
        return 'source-ready'
    if actual == plan['before']:
        return 'prepared'
    raise RuntimeError('Remote advanced outside this plan; stop, do not force-push')


def push(sha, branch):
    # Explicit normal FF push using the user's existing login; never GITHUB_TOKEN/force.
    git('push', 'origin', sha+':refs/heads/'+branch)


def publish(args, plan):
    verify_plan(plan)
    current = phase(plan, heads())
    if current in ('published', 'complete'):
        print('Publication already pushed; no duplicate push. Run finalize after Pages build succeeds.')
        return
    api = api_client()
    preflight(api)
    if not args.execute:
        print('DRY RUN: would FF main to source, recheck active runs and heads, then FF gh-pages to prepared publication.')
        return
    if current == 'prepared':
        require_heads(heads(), plan['before']['main'], plan['before']['gh-pages'])
        push(plan['source_commit'], 'main')
    preflight(api)
    require_heads(heads(), plan['source_commit'], plan['before']['gh-pages'])
    push(plan['publication_commit'], 'gh-pages')
    print('Publication pushed once via existing user login. Run finalize after the matching Pages build succeeds.')


def finalize(args, plan):
    output = verify_plan(plan)
    current = phase(plan, heads())
    if current == 'complete':
        print('Already finalized; no write repeated.')
        return
    if current != 'published':
        raise RuntimeError('Publication not pushed; baseline cannot be promoted')
    api = api_client()
    preflight(api)
    latest = api('/pages/builds/latest')
    if latest.get('status') != 'built' or latest.get('commit') != plan['publication_commit']:
        raise RuntimeError('Matching Pages build not successful yet; retry finalize, never republish')
    for path in ['index.html', 'projects/index.html', 'room/index.html', 'world-impact/index.html',
                 'taipei-mrt/index.html', 'posts/ai-virtual-model-economy/index.html']:
        if path not in output:
            continue
        with urllib.request.urlopen('https://'+DOMAIN+'/'+path, timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != plan['artifact_hashes'][path]:
            raise RuntimeError('Live hash not converged: '+path+'; retry finalize without republishing')
    require_heads(heads(), plan['source_commit'], plan['publication_commit'])
    if not args.execute:
        print('DRY RUN: deployment and live hashes verified; would FF main to matching source baseline promotion.')
        return
    push(plan['promotion_commit'], 'main')
    print('Baseline synchronized. Update local branch with: git merge --ff-only '+plan['promotion_commit'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'release', 'publish', 'finalize'])
    parser.add_argument('--plan', type=Path, default=ROOT/'.release/plan.json')
    parser.add_argument('--expected-main')
    parser.add_argument('--rollback-plan', type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        if not args.expected_main:
            parser.error('prepare requires --expected-main')
        prepare(args)
    elif args.command == 'release':
        plan = read(args.plan)
        publish(args, plan)
        if args.execute:
            finalize(args, plan)
        else:
            print('DRY RUN: after successful matching Pages build + live checks, the same command promotes the baseline.')
    elif args.command == 'publish':
        publish(args, read(args.plan))
    else:
        finalize(args, read(args.plan))

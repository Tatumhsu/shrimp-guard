from pathlib import Path
import hashlib,json,shutil,sys
ROOT=Path(__file__).resolve().parents[1]
def hashes(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}
def validate(before,after,allow):
    diff={ 'added':sorted(after.keys()-before.keys()),'deleted':sorted(before.keys()-after.keys()),'changed':sorted(k for k in before.keys() & after.keys() if before[k]!=after[k]) }
    if diff != {k:sorted(v) for k,v in allow.items()}: raise ValueError('Publication diff differs from reviewed allowlist: '+str(diff))
    return diff
def build(root=ROOT, out=None, report_path=None):
    root=Path(root)
    out=Path(out) if out else root/'public'
    report_path=Path(report_path) if report_path else root/'verification/result.json'
    baseline=json.loads((root/'verification/baseline.json').read_text(encoding='utf-8'))
    if hashes(root/'publication')!=baseline: raise ValueError('Immutable publication baseline changed')
    if out.exists(): raise ValueError('Output exists: use a fresh checkout or explicitly move previous output aside')
    shutil.copytree(root/'publication',out)
    if (root/'overlays').exists(): shutil.copytree(root/'overlays',out,dirs_exist_ok=True)
    actual=hashes(out)
    diff=validate(baseline,actual,json.loads((root/'verification/allowlist.json').read_text()))
    if (out/'CNAME').read_text().strip()!='shrimp-guard.us.ci': raise ValueError('CNAME mismatch')
    report={'baseline_commit':json.loads((root/'verification/source-state.json').read_text())['publication_commit'],'before_count':len(baseline),'after_count':len(actual),'unchanged':len(baseline)-len(diff['changed'])-len(diff['deleted']),'diff':diff,'files':{k:{'before':baseline.get(k),'after':actual.get(k)} for k in sorted(baseline.keys()|actual.keys())}}
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report
if __name__=='__main__':
    report=build()
    print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False))

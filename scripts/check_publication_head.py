"""Read-only freshness gate: never compose over an unreviewed publication head."""
import subprocess,json
from pathlib import Path
EXPECTED=json.loads((Path(__file__).resolve().parents[1]/'verification/source-state.json').read_text())['publication_commit']
result=subprocess.check_output(['git','ls-remote','origin','refs/heads/gh-pages'],text=True).strip().split()
if len(result)!=2 or result[0]!=EXPECTED:
 raise SystemExit('Published head changed or missing; reconcile and review the full baseline before proceeding.')
print('Publication head matches reviewed baseline: '+EXPECTED)

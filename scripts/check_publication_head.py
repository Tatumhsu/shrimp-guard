"""Read-only freshness gate: never compose over an unreviewed publication head."""
import subprocess
EXPECTED='c1e7679273d2e7c0fcd4c9f00d43b0ad0ffa896d'
result=subprocess.check_output(['git','ls-remote','origin','refs/heads/gh-pages'],text=True).strip().split()
if len(result)!=2 or result[0]!=EXPECTED:
 raise SystemExit('Published head changed or missing; reconcile and review the full baseline before proceeding.')
print('Publication head matches reviewed baseline: '+EXPECTED)

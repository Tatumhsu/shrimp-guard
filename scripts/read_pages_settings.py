import subprocess,json,urllib.request,urllib.error,os
from pathlib import Path
# Use the existing configured Git credential helper only, never print its response.
env=os.environ.copy();env['GIT_TERMINAL_PROMPT']='0';env['GCM_INTERACTIVE']='Never'
p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\npath=Tatumhsu/shrimp-guard.git\n\n',text=True,capture_output=True,env=env)
creds=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
result={}
if p.returncode or not creds.get('password'):
 result={'status':'blocked','reason':'Existing Git credential helper did not supply credentials noninteractively; no credentials created.'}
else:
 req=urllib.request.Request('https://api.github.com/repos/Tatumhsu/shrimp-guard/pages',headers={'Authorization':'Bearer '+creds['password'],'Accept':'application/vnd.github+json','User-Agent':'publication-readonly-check'})
 try:
  with urllib.request.urlopen(req) as r: data=json.load(r)
  result={k:data.get(k) for k in ['status','cname','build_type','source','html_url']}
 except urllib.error.HTTPError as e:
  result={'status':'blocked','http_status':e.code,'reason':json.load(e).get('message','API rejected request')}
creds.clear()
Path('verification/pages-settings.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))

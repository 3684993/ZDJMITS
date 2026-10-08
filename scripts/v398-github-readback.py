"""GitHub read-only API; credentials remain process-local and never enter output."""
import json, subprocess, urllib.request, pathlib, datetime
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
out.mkdir(parents=True,exist_ok=True)
credential=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
fields=dict(x.split('=',1) for x in credential.stdout.splitlines() if '=' in x)
headers={'Accept':'application/vnd.github+json','User-Agent':'ZDJMITS-readonly-audit','Authorization':'Bearer '+fields.get('password','')}
req=urllib.request.Request('https://api.github.com/repos/3684993/ZDJMITS/actions/runs?branch=main&per_page=5',headers=headers)
try:
    with urllib.request.urlopen(req,timeout=30) as response: data=json.load(response)
    result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runs':[{k:r.get(k) for k in ['id','head_sha','status','conclusion','html_url','name','created_at','updated_at']} for r in data['workflow_runs']]}
except Exception as e: result={'status':'UNKNOWN','errorType':type(e).__name__}
(out/'github-actions.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))

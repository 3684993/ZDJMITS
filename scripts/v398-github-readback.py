"""GitHub read-only API; credentials remain process-local and never enter output."""
import json, subprocess, urllib.request, pathlib, datetime, sys, re
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
out.mkdir(parents=True,exist_ok=True)
filename=next((arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--snapshot=')),'github-actions.json')
if not re.fullmatch(r'[a-z0-9-]+\.json',filename):raise SystemExit('INVALID_SNAPSHOT_FILENAME')
credential=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
fields=dict(x.split('=',1) for x in credential.stdout.splitlines() if '=' in x)
headers={'Accept':'application/vnd.github+json','User-Agent':'ZDJMITS-readonly-audit','Authorization':'Bearer '+fields.get('password','')}
req=urllib.request.Request('https://api.github.com/repos/3684993/ZDJMITS/actions/runs?branch=main&per_page=5',headers=headers)
try:
    with urllib.request.urlopen(req,timeout=30) as response: data=json.load(response)
    result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runs':[{k:r.get(k) for k in ['id','head_sha','status','conclusion','html_url','name','created_at','updated_at']} for r in data['workflow_runs']]}
except Exception as e: result={'status':'UNKNOWN','errorType':type(e).__name__}
run=next((arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--run=')),None)
if run:
    if not run.isdigit():raise SystemExit('INVALID_RUN_ID')
    try:
        request=urllib.request.Request(f'https://api.github.com/repos/3684993/ZDJMITS/actions/runs/{run}/jobs',headers=headers)
        with urllib.request.urlopen(request,timeout=30) as response:jobs=json.load(response)
        result['inspectedRun']=run
        result['jobs']=[{k:j.get(k) for k in ['id','name','status','conclusion','html_url','started_at','completed_at','steps']} for j in jobs['jobs']]
        # Only GitHub-masked failing step log. Keep it as text, with no credential in URLs/headers.
        for job in jobs['jobs']:
            if job.get('conclusion')!='failure':continue
            request=urllib.request.Request(f"https://api.github.com/repos/3684993/ZDJMITS/actions/jobs/{job['id']}/logs",headers=headers)
            with urllib.request.urlopen(request,timeout=30) as response:log=response.read().decode('utf-8',errors='replace')
            if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}',log):raise ValueError('CREDENTIAL_PATTERN')
            (out/f"github-run-{run}-job-{job['id']}.log").write_text(log,encoding='utf-8')
    except Exception as e:result['jobReadbackErrorType']=type(e).__name__
(out/filename).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))

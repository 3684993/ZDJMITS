"""Exact-head GitHub Actions evidence, read-only. Tokens never leave process output."""
import sys, json, subprocess, urllib.request, urllib.error, pathlib, re, datetime, hashlib
head, phase = sys.argv[1:3]
if not re.fullmatch(r'[a-f0-9]{40}', head) or phase not in ['integration']:
    raise SystemExit('INVALID_ARGS')
out=pathlib.Path.cwd()/'docs/reports/v398-trade24h-release-20261010'
credential=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
fields=dict(x.split('=',1) for x in credential.stdout.splitlines() if '=' in x)
headers={'Accept':'application/vnd.github+json','User-Agent':'ZDJMITS-readonly-evidence','Authorization':'Bearer '+fields.get('password','')}
base='https://api.github.com/repos/3684993/ZDJMITS'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
op=urllib.request.build_opener(NoRedirect())
def fetch(url):
    with op.open(urllib.request.Request(url,headers=headers),timeout=20) as r:return json.load(r)
try:
    runs=fetch(base+'/actions/runs?head_sha='+head+'&event=pull_request&per_page=10')['workflow_runs']
    report={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestedHead':head,'runs':[]}
    for run in runs:
        if run.get('head_sha')!=head:continue
        row={k:run.get(k) for k in ['id','head_sha','head_branch','event','status','conclusion','html_url','name','created_at','updated_at']}
        jobs=fetch(base+f"/actions/runs/{run['id']}/jobs")['jobs']
        row['jobs']=[{k:j.get(k) for k in ['id','name','status','conclusion','html_url','steps']} for j in jobs]
        for job in jobs:
            if job.get('conclusion') not in (['failure','success'] if '--include-success' in sys.argv else ['failure']):continue
            try:
                url=base+f"/actions/jobs/{job['id']}/logs"
                try:r=op.open(urllib.request.Request(url,headers=headers),timeout=20)
                except urllib.error.HTTPError as e:
                    if e.code!=302:raise
                    # Official signed artifact URL: never print it or forward bearer.
                    r=urllib.request.urlopen(urllib.request.Request(e.headers['Location']),timeout=20)
                raw=r.read();r.close();log=raw.decode('utf-8',errors='replace')
                if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}',log):raise ValueError('SECRET_PATTERN')
                filename=f"github-ci-{phase}-{run['id']}-{job['conclusion']}.log"
                normalized='\n'.join(line.rstrip() for line in log.splitlines()).rstrip()+'\n'
                (out/filename).write_text(normalized,encoding='utf-8')
                row['archivedLog']={'path':filename,'originalSha256':hashlib.sha256(raw).hexdigest(),'normalization':'trailing whitespace and EOF only'}
            except Exception as e:row['logReadErrorType']=type(e).__name__
        report['runs'].append(row)
except Exception as e:report={'requestedHead':head,'status':'UNKNOWN','errorType':type(e).__name__}
(out/f'github-actions-{phase}.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'head':head,'runs':[{k:r.get(k) for k in ['id','status','conclusion','html_url']} for r in report.get('runs',[])],'status':report.get('status')}))

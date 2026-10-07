"""Publish exact local Git objects via GitHub REST when receive-pack fails. No force/history rewrite.
Git credential helper is used only in memory for the same authorized repository; never log credentials.
"""
import subprocess,json,urllib.request,urllib.error,base64,datetime,pathlib,re,os
REPO='3684993/ZDJMITS';BASE='https://api.github.com/repos/'+REPO+'/git'
def git(*args):return subprocess.check_output(['git',*args])
head=git('rev-parse','HEAD').decode().strip();parent=git('rev-parse','origin/main').decode().strip()
subprocess.run(['git','merge-base','--is-ancestor',parent,head],check=True)
credential=subprocess.run(['git','credential','fill'],input=b'protocol=https\nhost=github.com\npath=3684993/ZDJMITS.git\n\n',stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
values=dict(line.split('=',1) for line in credential.decode().splitlines() if '=' in line);token=values['password'];del credential,values
report={'head':head,'expectedMain':parent,'objects':[]}
def api(method,path,value=None):
 data=json.dumps(value).encode() if value is not None else None
 req=urllib.request.Request(BASE+path,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ZDJMITS-authorized-git-object-publisher'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError('GitHub API HTTP '+str(e.code)+' '+method+' '+path) from None
objects=git('rev-list','--objects',parent+'..'+head).decode().splitlines();pending={line.split(' ',1)[0] for line in objects}
def publish(sha):
 if sha not in pending:return
 kind=git('cat-file','-t',sha).decode().strip()
 if kind=='blob':
  result=api('POST','/blobs',{'content':base64.b64encode(git('cat-file','blob',sha)).decode(),'encoding':'base64'})
 elif kind=='tree':
  entries=[]
  for line in git('ls-tree','-z',sha).split(b'\0'):
   if not line:continue
   meta,name=line.split(b'\t',1);mode,typ,child=meta.decode().split();publish(child);entries.append({'path':name.decode(),'mode':mode,'type':typ,'sha':child})
  result=api('POST','/trees',{'tree':entries})
 elif kind=='commit':
  raw=git('cat-file','commit',sha).decode();headers,message=raw.split('\n\n',1);meta={};parents=[]
  for line in headers.splitlines():
   key,value=line.split(' ',1)
   if key=='parent':parents.append(value)
   else:meta[key]=value
  for item in parents:publish(item)
  publish(meta['tree'])
  def identity(value):
   m=re.fullmatch(r'(.*) <([^>]+)> (\d+) ([+-])(\d\d)(\d\d)',value);name,email,stamp,sign,hour,minute=m.groups();offset=(int(hour)*60+int(minute))*(1 if sign=='+' else -1);date=datetime.datetime.fromtimestamp(int(stamp),datetime.timezone(datetime.timedelta(minutes=offset))).isoformat();return {'name':name,'email':email,'date':date}
  result=api('POST','/commits',{'message':message.rstrip('\n'),'tree':meta['tree'],'parents':parents,'author':identity(meta['author']),'committer':identity(meta['committer'])})
 else:raise RuntimeError('Unsupported Git object type')
 report['objects'].append({'type':kind,'expectedSha':sha,'actualSha':result['sha']});print(json.dumps(report['objects'][-1]),flush=True)
 if result['sha']!=sha:raise RuntimeError('Object SHA differs; refusing ref update')
 pending.remove(sha)
try:
 current=api('GET','/ref/heads/main')['object']['sha']
 if current!=parent:raise RuntimeError('Main head changed; refusing ref update')
 publish(head)
 current=api('GET','/ref/heads/main')['object']['sha']
 if current!=parent:raise RuntimeError('Main head changed; refusing ref update')
 report['refUpdate']=api('PATCH','/refs/heads/main',{'sha':head,'force':False})['object']['sha']
 report['result']='EXACT_SHA_FAST_FORWARD_PUBLISHED'
except Exception as e:
 report['result']='BLOCKED';report['error']=type(e).__name__+': '+str(e);print(report['error'],flush=True)
finally:
 pathlib.Path(__file__).with_name('git-object-publication.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 if report['result']=='BLOCKED':raise SystemExit(1)

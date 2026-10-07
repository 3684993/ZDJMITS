"""Independent read-only SSH diagnostic to the existing configured proxy host; no tunnel/service change."""
import subprocess,os,pathlib,json,datetime,time
root=pathlib.Path(os.environ['LOCALAPPDATA'])/'ZDJ-MITS/trade-proxy'
args=['C:/Windows/System32/OpenSSH/ssh.exe','-T','-p','22091','-i',str(root/'id_ed25519'),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(root/'known_hosts'),'-o','LogLevel=ERROR','zdjproxy@43.156.0.24','date -u; getent ahosts demo-fapi.binance.com; curl --connect-timeout 3 --max-time 6 --silent --show-error --head https://demo-fapi.binance.com/fapi/v1/time']
r={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'new diagnostic client only; originalSSH PID40308 unchanged','remote':'43.156.0.24:22091','command':'date/getent/public time HEAD only'};start=time.monotonic()
try:
 p=subprocess.run(args,capture_output=True,text=True,timeout=20);r.update(exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr)
except subprocess.TimeoutExpired as e:r.update(result='DIAGNOSTIC_TIMEOUT',stdout=(e.stdout or b'').decode(errors='replace') if isinstance(e.stdout,bytes) else e.stdout,stderr=(e.stderr or b'').decode(errors='replace') if isinstance(e.stderr,bytes) else e.stderr)
r['elapsedMs']=round((time.monotonic()-start)*1000);pathlib.Path(__file__).with_name('ssh-readonly-diagnostic.json').write_text(json.dumps(r,indent=2),encoding='utf-8');print(json.dumps(r))

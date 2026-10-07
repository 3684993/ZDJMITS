"""Bounded read-only SOCKS phase probe; no credentials, no direct exchange fallback."""
import socket,time,json,pathlib,ssl,datetime
out={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'proxy':'127.0.0.1:20091','target':'demo-fapi.binance.com:443','stages':[]}
s=None;phase='LOCAL_TCP_CONNECT';start=time.monotonic()
def recv(n):
 b=b''
 while len(b)<n:
  x=s.recv(n-len(b))
  if not x: raise EOFError('peer closed')
  b+=x
 return b
def done():out['stages'].append({'phase':phase,'elapsedMs':round((time.monotonic()-start)*1000)})
try:
 s=socket.create_connection(('127.0.0.1',20091),timeout=5);done();s.settimeout(5)
 phase='SOCKS_GREETING';s.sendall(b'\x05\x01\x00');g=recv(2);out['greetingHex']=g.hex();done()
 if g!=b'\x05\x00':raise RuntimeError('unexpected SOCKS greeting')
 phase='SOCKS_CONNECT_REPLY';host=b'demo-fapi.binance.com';s.sendall(b'\x05\x01\x00\x03'+bytes([len(host)])+host+b'\x01\xbb');r=recv(4);out['replyHex']=r.hex()
 if r[1]!=0:raise RuntimeError('SOCKS reply code '+str(r[1]))
 if r[3]==1:recv(6)
 elif r[3]==4:recv(18)
 elif r[3]==3:recv(recv(1)[0]+2)
 done();phase='TLS_HANDSHAKE';s=ssl.create_default_context().wrap_socket(s,server_hostname=host.decode());done()
 phase='HTTP_PUBLIC_TIME';s.sendall(b'GET /fapi/v1/time HTTP/1.1\r\nHost: demo-fapi.binance.com\r\nConnection: close\r\n\r\n');out['httpPrefix']=s.recv(4096).decode(errors='replace');done();out['result']='RESPONSE'
except Exception as e:out.update(result='FAILED',failurePhase=phase,error=type(e).__name__+': '+str(e),elapsedMs=round((time.monotonic()-start)*1000))
finally:
 if s:s.close()
p=pathlib.Path(__file__).parent/'socks-phase-probe.json';p.write_text(json.dumps(out,indent=2));print(json.dumps(out))

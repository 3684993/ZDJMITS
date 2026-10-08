import sqlite3, json, pathlib, hashlib, sys
r=pathlib.Path(__file__).resolve().parent
d=sqlite3.connect('file:D:/MITS/data/zdj-settings.sqlite?mode=ro',uri=True,timeout=2)
version,payload,updated=d.execute('SELECT version,payload,updated_at FROM settings ORDER BY id LIMIT 1').fetchone()
settings=json.loads(payload)
result={'settingsVersion':version,'settingsSha256':hashlib.sha256(payload.encode()).hexdigest(),'updatedAt':updated,'environment':settings.get('connections',{}).get('exchange',{}).get('environment'),'executionMode':settings.get('connections',{}).get('executionMode'),'resources':{}}
for name in ['ai_resources','exchange_resources','proxy_resources']:
 result['resources'][name]=[{'id':row[0],'sha256':hashlib.sha256(row[1].encode()).hexdigest(),'updatedAt':row[2]} for row in d.execute('SELECT id,payload,updated_at FROM '+name+' ORDER BY id')]
(r/('settings-'+(sys.argv[1] if len(sys.argv)>1 else 'before')+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
d.close()

#!/usr/bin/env node
import {readdirSync,statSync,lstatSync,rmSync,realpathSync,copyFileSync,mkdtempSync,existsSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
const argv=process.argv.slice(2),apply=argv.includes('--apply'),option=(key,fallback)=>argv.find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const dir=realpathSync(path.resolve(option('dir','data/backups'))),baselineArg=option('baseline',null);
const files=readdirSync(dir).filter(name=>name.endsWith('.sqlite')).map(name=>({name,file:path.join(dir,name)})).filter(row=>lstatSync(row.file).isFile()&&!lstatSync(row.file).isSymbolicLink()).map(row=>({...row,size:statSync(row.file).size}));
if(!baselineArg){console.log(JSON.stringify({mode:'DRY_RUN',dir,files,requires:'Choose --baseline=<complete SQLite file in this directory>; verify the replacement before pruning.'},null,2));if(apply)throw new Error('EXPLICIT_BASELINE_REQUIRED');process.exit(0);}
const baseline=realpathSync(path.resolve(baselineArg));
if(path.dirname(baseline)!==dir||!files.some(row=>row.file===baseline))throw new Error('BASELINE_MUST_BE_A_COMPLETE_DB_IN_BACKUP_DIRECTORY');
for(const suffix of ['-wal','-shm','-journal'])if(existsSync(baseline+suffix))throw new Error('BASELINE_HAS_SQLITE_SIDECARS');
const temporary=mkdtempSync(path.join(tmpdir(),'zdj-baseline-verify-'));
try{const copy=path.join(temporary,'baseline.sqlite');copyFileSync(baseline,copy);const db=new DatabaseSync(copy,{readOnly:true});try{const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||rows[0].integrity_check!=='ok')throw new Error('BASELINE_INTEGRITY_FAILED');}finally{db.close();}}finally{if(path.dirname(temporary)===tmpdir()&&path.basename(temporary).startsWith('zdj-baseline-verify-'))rmSync(temporary,{recursive:true,force:true});}
const remove=files.filter(row=>row.file!==baseline);
console.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',baseline,keep:1,delete:remove},null,2));
if(apply){if(!argv.includes('--engine-stopped')||!argv.includes('--replacement-verified'))throw new Error('OFFLINE_VERIFIED_REPLACEMENT_REQUIRED');
 for(const row of remove){if(path.dirname(realpathSync(row.file))!==dir)throw new Error('BACKUP_PATH_ESCAPED');for(const suffix of ['', '-wal','-shm','-journal']){const file=row.file+suffix;if(existsSync(file)){if(lstatSync(file).isSymbolicLink())throw new Error('BACKUP_SYMLINK_REFUSED');rmSync(file);}}}
}

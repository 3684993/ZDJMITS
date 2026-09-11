import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/windows/credential-manager.ps1');
function run(action: 'set'|'get'|'delete'|'status', target: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, action, target], { windowsHide: true });
    let out=''; let err=''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`Windows Credential Manager unavailable (${code}): ${err.trim().slice(0,300)}`)));
    if (input !== undefined) child.stdin.end(Buffer.from(input, 'utf8').toString('base64')); else child.stdin.end();
  });
}
export class WindowsCredentialManagerSecretStore {
  readonly backend = 'WINDOWS_CREDENTIAL_MANAGER';
  async set(target: string, value: string) { if (!value.trim()) throw new Error('Secret must not be empty'); await run('set', target, value); }
  async get(target: string) { const value=await run('get',target); return value ? Buffer.from(value,'base64').toString('utf8') : null; }
  async delete(target: string) { await run('delete',target); }
  async status(target: string) { return (await run('status',target)) === 'READY' ? 'READY' as const : 'MISSING' as const; }
}

import { spawn } from 'node:child_process';

function invoke(mode: 'protect' | 'unprotect', value: string, scopeName: 'CurrentUser'|'LocalMachine'): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$mode='${mode}';$value=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($value);$scope=[System.Security.Cryptography.DataProtectionScope]::${scopeName};if($mode -eq 'protect'){$result=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope)}else{$result=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope)};[Console]::Out.Write([Convert]::ToBase64String($result))`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; let error = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; }); child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`DPAPI ${mode} failed${error ? `: ${error.trim()}` : ''}`)));
    child.stdin.end(`${Buffer.from(value, mode === 'protect' ? 'utf8' : 'base64').toString('base64')}\n`);
  });
}

export class WindowsDpapiSecretStore {
  constructor(private readonly scope: 'CurrentUser'|'LocalMachine'='CurrentUser'){}
  protect(plaintext: string) { return invoke('protect', plaintext, this.scope); }
  async unprotect(ciphertext: string) { return Buffer.from(await invoke('unprotect', ciphertext, this.scope), 'base64').toString('utf8'); }
}

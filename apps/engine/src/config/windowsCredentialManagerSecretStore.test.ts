import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {WindowsCredentialManagerSecretStore} from './windowsCredentialManagerSecretStore.js';

vi.mock('node:child_process',()=>({spawn:vi.fn()}));
const platformDescriptor=Object.getOwnPropertyDescriptor(process,'platform')!;
const usePlatform=(value:string)=>Object.defineProperty(process,'platform',{...platformDescriptor,value});
function childWith(output:string){
  const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.stdin={end:vi.fn(()=>queueMicrotask(()=>{child.stdout.emit('data',output);child.emit('close',0);} ))};
  vi.mocked(spawn).mockReturnValue(child);return child;
}
afterEach(()=>{Object.defineProperty(process,'platform',platformDescriptor);vi.clearAllMocks();});
describe('local release credential backend compatibility',()=>{
  it('reads macOS Keychain only through the existing helper stdin protocol',async()=>{
    usePlatform('darwin');const child=childWith(Buffer.from('synthetic-test-value').toString('base64'));const store=new WindowsCredentialManagerSecretStore();
    expect(store.backend).toBe('MACOS_KEYCHAIN');expect(await store.get('synthetic-target')).toBe('synthetic-test-value');
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toMatch(/\.local-runtime\/zdj-keychain-helper$/);
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([]);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual({action:'get',target:'synthetic-target'});
  });
  it('writes macOS values through stdin rather than command arguments',async()=>{
    usePlatform('darwin');const child=childWith('');await new WindowsCredentialManagerSecretStore().set('synthetic-target','synthetic-value');
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([]);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual({action:'set',target:'synthetic-target',value:'synthetic-value'});
  });
  it('preserves Windows Credential Manager behavior',async()=>{
    usePlatform('win32');const child=childWith('READY');const store=new WindowsCredentialManagerSecretStore();
    expect(store.backend).toBe('WINDOWS_CREDENTIAL_MANAGER');expect(await store.status('synthetic-target')).toBe('READY');
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('powershell.exe');
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['status','synthetic-target']));
    expect(child.stdin.end).toHaveBeenCalledWith();
  });
  it('does not send an empty credential to either backend',async()=>{
    usePlatform('darwin');await expect(new WindowsCredentialManagerSecretStore().set('synthetic-target',' ')).rejects.toThrow('Secret must not be empty');
    expect(spawn).not.toHaveBeenCalled();
  });
});

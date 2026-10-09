$ErrorActionPreference='Stop'
$stage='D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $stage 'scripts\start-zdj-engine-host.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'FORMAL_HOST_PARSE_FAILED'}
$definitions=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Invoke-NativeProbe','Get-NodeRuntimeGuard')},$true)
if($definitions.Count -ne 2){throw 'FORMAL_HOST_PROBE_FUNCTIONS_MISSING'}
foreach($definition in $definitions){Invoke-Expression $definition.Extent.Text}
$guard=Get-NodeRuntimeGuard ((Get-Command node.exe).Source)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class EnginePermissionProbe {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static bool CanOpenTerminateHandle(int id) { var h=OpenProcess(0x00100001,false,id); if(h==IntPtr.Zero) return false; CloseHandle(h); return true; }
}
'@
$health=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
$engine=Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)"
if($engine.Name -ne 'node.exe' -or $engine.CommandLine -notmatch 'ZDJMITS-v398-ai-entry-cb0de7b[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js'){throw 'IDENTIFIED_OLD_ENGINE_NOT_PROVEN'}
$wer=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe'
$observer=Get-CimInstance Win32_Process -Filter 'ProcessId=17772'
$policy=@(Get-ExecutionPolicy -List | ForEach-Object { @{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy} })
$result=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');formalHostFunctions='AST_EXTRACTED_NATIVE_PROBES_ONLY';nodeRuntime=$guard;nativeProbes='PASS';effectiveExecutionPolicy=[string](Get-ExecutionPolicy);executionPolicies=$policy;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;oldEnginePid=$engine.ProcessId;oldHostPid=$engine.ParentProcessId;oldEngineTerminateHandleOpen=[EnginePermissionProbe]::CanOpenTerminateHandle($engine.ProcessId);lifecycleAttempts=0;currentPolicyDenials=0;futureLifecyclePolicy='MUST_BE_CHECKED_AT_ACTUAL_FORMAL_ACTION_NO_ALTERNATE_ON_DENIAL';wer=@{dumpType=$wer.DumpType;dumpCount=$wer.DumpCount;dumpFolder=$wer.DumpFolder};observer=@{pid=$observer.ProcessId;createdAt=$observer.CreationDate};auxiliaryListeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(8081,8083,8084,20091) | Select-Object LocalPort,OwningProcess)}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'host-executor-proof.json') -Encoding utf8

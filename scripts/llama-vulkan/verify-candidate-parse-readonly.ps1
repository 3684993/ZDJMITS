# Pure syntax verification of the checked-out candidate .ps1 files.
# No model start, no HTTP, no Windows settings, no Engine interaction.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$files=@(
 'start-qwen3.8-27b-zdj-vulkan1.ps1',
 'start-qwen3.8-27b-harness-vulkan1.ps1',
 'start-qwen3.5-9b-vulkan.ps1',
 'measure-memory-handles-readonly.ps1',
 'maintenance-preflight-readonly.ps1',
 'ZDJ-memory-first-check.ps1'
)
$errorsFound=0
foreach($name in $files){
    $path=Join-Path $PSScriptRoot $name
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){
        Write-Host "MISSING $name"
        $errorsFound++
        continue
    }
    $tokens=$null
    $parseErrors=$null
    [void][System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){
        foreach($err in $parseErrors){
            Write-Host ("FAIL {0} line={1} reason={2}" -f $name,$err.Extent.StartLineNumber,$err.ErrorId)
            $errorsFound++
        }
    }else{
        Write-Host "PARSE PASS $name"
    }
}
if($errorsFound){throw "PWSH_PARSE_FAILURE count=$errorsFound"}
Write-Host 'ALL CANDIDATE POWERSHELL SCRIPTS PARSE PASS'

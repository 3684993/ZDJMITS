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
 'capture-kernel-pool-tags-readonly.ps1',
 'capture-kernel-pool-tags-native-readonly.ps1',
 'capture-filter-stack-readonly.ps1',
 'compare-kernel-pool-tags-readonly.ps1',
 'capture-filter-driver-provenance-readonly.ps1',
 'full-recovery-preflight-readonly.ps1',
 'ZDJ-memory-first-check.ps1'
)
function Get-ForbiddenAutomaticPidBindings {
    param([System.Management.Automation.Language.Ast]$Root)
    @($Root.FindAll({
        param($node)
        if($node -is [System.Management.Automation.Language.AssignmentStatementAst]){
            if($node.Left -is [System.Management.Automation.Language.VariableExpressionAst]){
                return ([string]$node.Left.VariablePath.UserPath -ieq 'PID')
            }
        }
        if($node -is [System.Management.Automation.Language.ParameterAst]){
            return ([string]$node.Name.VariablePath.UserPath -ieq 'PID')
        }
        return $false
    },$true))
}
# Regression: PowerShell reserved PID reads are valid; case-insensitive writes are forbidden.
$probeTokens=$null
$probeErrors=$null
$probeBad=[System.Management.Automation.Language.Parser]::ParseInput('$pid=1',[ref]$probeTokens,[ref]$probeErrors)
$probeTokens=$null
$probeErrors=$null
$probeGood=[System.Management.Automation.Language.Parser]::ParseInput('Write-Host $PID',[ref]$probeTokens,[ref]$probeErrors)
if(@(Get-ForbiddenAutomaticPidBindings -Root $probeBad).Count -ne 1 -or
    @(Get-ForbiddenAutomaticPidBindings -Root $probeGood).Count -ne 0){
    throw 'PID_AST_GUARD_SELF_TEST_FAILED'
}
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
    $ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){
        foreach($err in $parseErrors){
            Write-Host ("FAIL {0} line={1} reason={2}" -f $name,$err.Extent.StartLineNumber,$err.ErrorId)
            $errorsFound++
        }
    }else{
        Write-Host "PARSE PASS $name"
    }
    $forbidden=@(Get-ForbiddenAutomaticPidBindings -Root $ast)
    foreach($binding in $forbidden){
        Write-Host ("FAIL {0} line={1} reason=ASSIGNMENT_TO_READONLY_AUTOMATIC_PID" -f $name,$binding.Extent.StartLineNumber)
        $errorsFound++
    }
}
if($errorsFound){throw "PWSH_PARSE_OR_AUTOMATIC_PID_FAILURE count=$errorsFound"}
Write-Host 'ALL CANDIDATE POWERSHELL SCRIPTS PARSE PASS'

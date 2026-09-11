param(
    [switch]$RunAcceptanceFirst
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\MITS"
$AcceptanceScript = Join-Path $ProjectRoot "scripts\run-acceptance.ps1"
$EnduranceScript = Join-Path $ProjectRoot "scripts\run-3h-endurance.ps1"

function Test-TcpEndpoint {
    param(
        [string]$Name,
        [string]$HostName,
        [int]$Port
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(3000, $false)) {
            throw "$Name is not reachable at ${HostName}:$Port"
        }

        $client.EndConnect($async)
        Write-Host "[OK] $Name -> ${HostName}:$Port"
    }
    finally {
        $client.Close()
    }
}

function Invoke-PowerShellScript {
    param(
        [string]$ScriptPath,
        [string]$Label
    )

    Write-Host ""
    Write-Host "=== $Label ==="

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $ScriptPath

    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode"
    }

    Write-Host "[PASS] $Label"
}

Write-Host ""
Write-Host "=============================================="
Write-Host " ZDJ-MITS V3 - 3 Hour Endurance Launcher"
Write-Host " Project : $ProjectRoot"
Write-Host " Proxy   : 127.0.0.1:20081"
Write-Host " Scout   : 127.0.0.1:8081"
Write-Host " Brain   : 127.0.0.1:8084"
Write-Host "=============================================="
Write-Host ""

if (-not (Test-Path $ProjectRoot)) {
    throw "Project directory not found: $ProjectRoot"
}

if (-not (Test-Path $EnduranceScript)) {
    throw "Endurance script not found: $EnduranceScript"
}

Set-Location $ProjectRoot

Test-TcpEndpoint -Name "SOCKS5H Proxy" -HostName "127.0.0.1" -Port 20081
Test-TcpEndpoint -Name "Qwen3.5-9B Scout" -HostName "127.0.0.1" -Port 8081
Test-TcpEndpoint -Name "Qwen3.8-27B Primary Brain" -HostName "127.0.0.1" -Port 8084

if ($RunAcceptanceFirst) {
    if (-not (Test-Path $AcceptanceScript)) {
        throw "Acceptance script not found: $AcceptanceScript"
    }

    Invoke-PowerShellScript `
        -ScriptPath $AcceptanceScript `
        -Label "Acceptance"
}

Write-Host ""
Write-Host "Starting 3-hour endurance run..."
Write-Host ("Start time: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host "Do not close this PowerShell window."
Write-Host ""

Invoke-PowerShellScript `
    -ScriptPath $EnduranceScript `
    -Label "3-hour endurance"

Write-Host ""
Write-Host "=============================================="
Write-Host " 3-hour endurance completed successfully"
Write-Host ("End time: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host " Check the newest folder under:"
Write-Host " D:\MITS\data\endurance"
Write-Host "=============================================="

param([int]$DurationMinutes=10,[int]$SampleSeconds=15,[int]$Port=8080)

$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$dir=Join-Path $root "data\acceptance-v332-position\$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$samples=Join-Path $dir 'samples.jsonl'
$end=(Get-Date).AddMinutes($DurationMinutes)
$ok=0;$failed=0;$badReady=0;$badMarket=0;$badPrivate=0;$badProtected=0;$terminalActive=0

while((Get-Date)-lt$end){
  try{
    $health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 8
    $snapshot=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/snapshot" -TimeoutSec 8
    $orders=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/orders" -TimeoutSec 8
    $bad=@($snapshot.positions|Where-Object tpStatus -ne 'PROTECTED')
    $terminal=@($snapshot.entryOrders|Where-Object status -in @('CANCELED','FILLED','EXPIRED','REJECTED'))
    $row=[ordered]@{
      ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      ready=$health.ready
      engineVersion=$health.version
      marketStream=$health.checks.marketStream.state
      private=$health.checks.privateData.status
      positions=@($snapshot.positions).Count
      protected=@($snapshot.positions|Where-Object tpStatus -eq 'PROTECTED').Count
      activeEntry=@($snapshot.entryOrders).Count
      activeTp=@($snapshot.tpOrders).Count
      manual=@($orders.manual).Count
      drift=$health.checks.reconciliation.driftCount
    }
    $row|ConvertTo-Json -Compress|Add-Content -LiteralPath $samples -Encoding utf8
    $ok++
    if(!$health.ready){$badReady++}
    if($health.checks.marketStream.state -ne 'LIVE'){$badMarket++}
    if($health.checks.privateData.status -ne 'READY'){$badPrivate++}
    $badProtected+=$bad.Count
    $terminalActive+=$terminal.Count
  }catch{
    $failed++
    [ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress|Add-Content -LiteralPath $samples -Encoding utf8
  }
  Start-Sleep -Seconds $SampleSeconds
}

$summary=[ordered]@{
  startedAt=(Get-Item $samples).CreationTime.ToString('o')
  completedAt=(Get-Date).ToString('o')
  durationMinutes=$DurationMinutes
  sampleSeconds=$SampleSeconds
  samples=$ok
  failedSamples=$failed
  badReadySamples=$badReady
  badMarketSamples=$badMarket
  badPrivateSamples=$badPrivate
  badProtectedPositions=$badProtected
  terminalOrdersInActiveProjection=$terminalActive
  evidenceDir=$dir
  pass=($ok -gt 0 -and $failed -eq 0 -and $badReady -eq 0 -and $badMarket -eq 0 -and $badPrivate -eq 0 -and $badProtected -eq 0 -and $terminalActive -eq 0)
}
$summary|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $dir 'summary.json') -Encoding utf8
$summary|ConvertTo-Json -Depth 6
if(!$summary.pass){exit 1}

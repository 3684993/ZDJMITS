param([int]$DurationMinutes=30,[int]$SampleSeconds=30,[int]$Port=8080)

$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$dir=Join-Path $root "data\acceptance-v333-traderecord\$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$samples=Join-Path $dir 'samples.jsonl'
$end=(Get-Date).AddMinutes($DurationMinutes)
$ok=0;$failed=0;$badReady=0;$badMarket=0;$badPrivate=0;$badReconciliation=0;$badProtected=0;$badNetFormula=0;$badExperience=0;$badNewTpEconomics=0
while((Get-Date)-lt$end){
  try{
    $h=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 8
    $s=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/snapshot" -TimeoutSec 8
    $tr=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/trade-records?limit=100" -TimeoutSec 8
    $ex=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/experience" -TimeoutSec 8
    $op=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/operations/health" -TimeoutSec 8
    $complete=@($tr.items|Where-Object {$_.status -eq 'CLOSED' -and $_.recordCompleteness -eq 'COMPLETE'})
    $formula=@($complete|Where-Object {[math]::Abs(($_.grossRealizedPnl-($_.netPnl+$_.totalFee))) -gt 0.00001})
    $experienceIds=@($ex.samples|ForEach-Object tradeId)
    $missingExperience=@($complete|Where-Object {$experienceIds -notcontains $_.tradeId})
    $newTp=@($s.positions|Where-Object {$_.tpCoverageSource -eq 'SYSTEM_CREATED' -and $_.tpEconomics -and $_.tpEconomics.expectedNetProfit -lt $_.tpEconomics.requiredNetProfit})
    $badProtectedRows=@($s.positions|Where-Object {$_.tpStatus -ne 'PROTECTED'})
    $row=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$h.ready;engineVersion=$h.version;marketStream=$h.checks.marketStream.state;private=$h.checks.privateData.status;reconciliationError=$op.reconciliation.lastError;positions=@($s.positions).Count;protected=@($s.positions|Where-Object tpStatus -eq 'PROTECTED').Count;tpOk=@($s.positions|Where-Object {$_.tpEconomics.status -eq 'TP_OK'}).Count;tpLowNet=@($s.positions|Where-Object {$_.tpEconomics.status -eq 'TP_LOW_NET'}).Count;tradeRecords=@($tr.items).Count;completeRecords=$complete.Count;experienceSamples=@($ex.samples).Count;drift=$h.checks.reconciliation.driftCount}
    $row|ConvertTo-Json -Compress|Add-Content -LiteralPath $samples -Encoding utf8;$ok++
    if(!$h.ready){$badReady++};if($h.checks.marketStream.state -ne 'LIVE'){$badMarket++};if($h.checks.privateData.status -ne 'READY'){$badPrivate++};if($op.reconciliation.lastError){$badReconciliation++};$badProtected+=$badProtectedRows.Count;$badNetFormula+=$formula.Count;$badExperience+=$missingExperience.Count;$badNewTpEconomics+=$newTp.Count
  }catch{$failed++;[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress|Add-Content -LiteralPath $samples -Encoding utf8}
  Start-Sleep -Seconds $SampleSeconds
}
$summary=[ordered]@{startedAt=(Get-Item $samples).CreationTime.ToString('o');completedAt=(Get-Date).ToString('o');durationMinutes=$DurationMinutes;sampleSeconds=$SampleSeconds;samples=$ok;failedSamples=$failed;badReadySamples=$badReady;badMarketSamples=$badMarket;badPrivateSamples=$badPrivate;badReconciliationSamples=$badReconciliation;badProtectedPositions=$badProtected;badNetFormulaRecords=$badNetFormula;badExperienceLinks=$badExperience;badNewTpEconomics=$badNewTpEconomics;evidenceDir=$dir;pass=($ok -gt 0 -and $failed -eq 0 -and $badReady -eq 0 -and $badMarket -eq 0 -and $badPrivate -eq 0 -and $badReconciliation -eq 0 -and $badProtected -eq 0 -and $badNetFormula -eq 0 -and $badExperience -eq 0 -and $badNewTpEconomics -eq 0)}
$summary|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $dir 'summary.json') -Encoding utf8
$summary|ConvertTo-Json -Depth 8
if(!$summary.pass){exit 1}

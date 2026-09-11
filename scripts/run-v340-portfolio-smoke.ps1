param([int]$DurationSeconds=3600,[int]$IntervalSeconds=30)
$started=Get-Date
$end=$started.AddSeconds($DurationSeconds)
$samples=@()
while((Get-Date) -lt $end){
  $stamp=Get-Date
  try{
    $health=Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 20
    $snapshot=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/snapshot' -TimeoutSec 20
    $universe=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/universe' -TimeoutSec 20
    $settings=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/settings' -TimeoutSec 20
    $eligible=@($universe.candidates | Where-Object {$_.eligible -and $_.rank -gt 0})
    $duplicateUnderlyingGroups=@($eligible | Group-Object underlyingAsset | Where-Object {$_.Count -gt 1}).Count
    $sample=[pscustomobject]@{
      at=$stamp.ToString('o');health=$health.status;version=$health.version;stream=$health.checks.marketStream.state;private=$health.checks.privateData.status
      snapshots=[int]$health.checks.marketSnapshots;positions=[int]$snapshot.account.activePositions;eligible=[int]$eligible.Count;duplicateUnderlyingGroups=[int]$duplicateUnderlyingGroups
      portfolioEnabled=[bool]$settings.portfolioIntelligence.enabled;availableUsdt=$snapshot.portfolioIntelligence.availableUsdt;availableUsdc=$snapshot.portfolioIntelligence.availableUsdc
      longExposurePct=$snapshot.portfolioIntelligence.longExposurePct;shortExposurePct=$snapshot.portfolioIntelligence.shortExposurePct
      primary30m=$snapshot.tradeActivity.primaryCount30m;place30m=$snapshot.tradeActivity.placeCount30m;submit30m=$snapshot.tradeActivity.submitCount30m;fill30m=$snapshot.tradeActivity.fillCount30m
    }
    $samples+=$sample
    Write-Output ("{0} OK health={1} stream={2} private={3} snapshots={4} positions={5} eligible={6} duplicateUnderlying={7} USDT={8} USDC={9}" -f $stamp.ToString('s'),$health.status,$health.checks.marketStream.state,$health.checks.privateData.status,$health.checks.marketSnapshots,$snapshot.account.activePositions,$eligible.Count,$duplicateUnderlyingGroups,$snapshot.portfolioIntelligence.availableUsdt,$snapshot.portfolioIntelligence.availableUsdc)
  }catch{Write-Error ("{0} FAIL {1}" -f $stamp.ToString('s'),$_.Exception.Message);exit 1}
  Start-Sleep -Seconds $IntervalSeconds
}
$samples|ConvertTo-Json -Compress|Write-Output

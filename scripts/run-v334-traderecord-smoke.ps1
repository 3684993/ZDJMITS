param([int]$DurationSeconds=600,[int]$IntervalSeconds=15)
$started=Get-Date
$end=$started.AddSeconds($DurationSeconds)
$samples=@()
while((Get-Date) -lt $end){
  $stamp=Get-Date
  try{
    $readiness=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/settings/readiness' -TimeoutSec 20
    $complete=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/trade-records?category=COMPLETE&limit=1' -TimeoutSec 20
    $partial=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/trade-records?category=PARTIAL&limit=1' -TimeoutSec 20
    $history=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/trade-records/sync/history?limit=1' -TimeoutSec 20
    $samples+=([pscustomobject]@{at=$stamp.ToString('o');readiness=$readiness.overall;private=$readiness.privateDataStatus;complete=[int]$complete.total;partial=[int]$partial.total;history=[int]$history.items.Count})
    Write-Output ("{0} OK readiness={1} private={2} complete={3} partial={4}" -f $stamp.ToString('s'),$readiness.overall,$readiness.privateDataStatus,$complete.total,$partial.total)
  }catch{Write-Error ("{0} FAIL {1}" -f $stamp.ToString('s'),$_.Exception.Message);exit 1}
  Start-Sleep -Seconds $IntervalSeconds
}
$samples|ConvertTo-Json -Compress|Write-Output

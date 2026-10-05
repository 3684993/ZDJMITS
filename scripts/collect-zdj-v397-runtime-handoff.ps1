[CmdletBinding()]
param(
  [string]$RepoPath='D:\MITS',
  [string]$EngineBase='http://127.0.0.1:8080',
  [string]$OutputRoot=''
)
$ErrorActionPreference='Continue'
$ProgressPreference='SilentlyContinue'
if(-not $OutputRoot){$OutputRoot=Join-Path $RepoPath 'docs\reports\handoff'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir=Join-Path $OutputRoot ('ZDJ-MITS-handoff-'+$stamp)
$zipPath=$outDir+'.zip'
New-Item -ItemType Directory -Force -Path $outDir,(Join-Path $outDir 'http'),(Join-Path $outDir 'git'),(Join-Path $outDir 'system'),(Join-Path $outDir 'logs')|Out-Null

function Redact([string]$v){
  if($null -eq $v){return ''}
  $v=[regex]::Replace($v,'(?i)(apiKey|apiSecret|signature|authorization|secret)(\s*["'']?\s*[:=]\s*["'']?)[^"'',\s&}]+','$1$2[REDACTED]')
  $v=[regex]::Replace($v,'(?i)(https?|socks5h?|wss?)://[^/@\s:]+:[^/@\s]+@','$1://[REDACTED]@')
  return $v
}
function Put([string]$p,[object]$v){$t=if($v -is [string]){$v}else{$v|Out-String};(Redact $t)|Set-Content -LiteralPath $p -Encoding UTF8}
function Cmd([scriptblock]$b){try{return Redact((& $b 2>&1|Out-String))}catch{return Redact(('ERROR: '+($_|Out-String)))}}
function GetJson([string]$path,[string]$name,[int]$timeout=15){
  $target=Join-Path $outDir ('http\'+$name)
  try{$r=Invoke-WebRequest -UseBasicParsing -Method GET -Uri ($EngineBase+$path) -TimeoutSec $timeout -Headers @{'Cache-Control'='no-cache'};Put $target $r.Content;Put ($target+'.meta.txt') ('HTTP '+[int]$r.StatusCode+' '+(Get-Date).ToString('o'))}
  catch{Put ($target+'.meta.txt') ('ERROR '+(Get-Date).ToString('o')+' '+($_|Out-String))}
}

Put (Join-Path $outDir 'README-FIRST.txt') ('READ-ONLY collection. No POST/PUT/PATCH/DELETE API calls. Captured '+(Get-Date).ToString('o'))
Put (Join-Path $outDir 'system\node.txt') (Cmd {node --version;node -p "process.versions.v8";node -p "JSON.stringify(process.versions)"})
Put (Join-Path $outDir 'system\os.txt') (Cmd {Get-CimInstance Win32_OperatingSystem|Select Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime|Format-List})
Put (Join-Path $outDir 'system\ports.txt') (Cmd {Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where LocalPort -in 8080,8081,8083,8084|Select LocalAddress,LocalPort,OwningProcess,State|Sort LocalPort|Format-Table -AutoSize})
Put (Join-Path $outDir 'system\processes.txt') (Cmd {Get-CimInstance Win32_Process|Where {$_.ProcessId -in @((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where LocalPort -in 8080,8081,8083,8084).OwningProcess)}|Select ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine|Format-List})

if(Test-Path (Join-Path $RepoPath '.git')){
  Put (Join-Path $outDir 'git\status.txt') (Cmd {git -C $RepoPath status --porcelain=v2 --branch})
  Put (Join-Path $outDir 'git\head.txt') (Cmd {git -C $RepoPath rev-parse HEAD})
  Put (Join-Path $outDir 'git\origin-main.txt') (Cmd {git -C $RepoPath rev-parse origin/main})
  Put (Join-Path $outDir 'git\recent-log.txt') (Cmd {git -C $RepoPath log --oneline --decorate -20})
  Put (Join-Path $outDir 'git\diff-stat.txt') (Cmd {git -C $RepoPath diff --stat})
  Put (Join-Path $outDir 'git\diff.txt') (Cmd {git -C $RepoPath diff --no-ext-diff --unified=3})
  Put (Join-Path $outDir 'git\untracked.txt') (Cmd {git -C $RepoPath ls-files --others --exclude-standard})
}

$gets=@(
  @('/health','engine-health.json',10),
  @('/api/v3/ops/runtime','ops-runtime.json',10),
  @('/api/v3/diagnostics/closeout','diagnostics-closeout.json',15),
  @('/api/v3/snapshot','snapshot.json',20),
  @('/api/v3/pipeline','pipeline.json',15),
  @('/api/v3/operational-incidents','operational-incidents.json',10),
  @('/api/v3/account/assets','account-assets.json',10),
  @('/api/v3/orders','orders.json',15),
  @('/api/v3/brain/resources','brain-resources.json',10),
  @('/api/v3/observability/trading-quality','trading-quality-summary.json',10),
  @('/api/v3/trade-records?category=COMPLETE&limit=1&page=1','trade-records-summary.json',15),
  @('/api/v3/trade-records?category=ISSUES&limit=1&page=1','trade-records-issues-summary.json',15)
)
foreach($g in $gets){GetJson $g[0] $g[1] ([int]$g[2])}
foreach($port in 8081,8083,8084){try{$r=Invoke-WebRequest -UseBasicParsing -Method GET -Uri ('http://127.0.0.1:'+$port+'/health') -TimeoutSec 8;Put (Join-Path $outDir ('http\ai-'+$port+'-health.json')) $r.Content}catch{Put (Join-Path $outDir ('http\ai-'+$port+'-health.meta.txt')) ($_|Out-String)}}
for($i=1;$i -le 3;$i++){GetJson '/health' ('sample-'+$i+'-health.json') 8;GetJson '/api/v3/pipeline' ('sample-'+$i+'-pipeline.json') 12;if($i -lt 3){Start-Sleep -Seconds 10}}

$since=(Get-Date).AddHours(-12)
$events=Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$since} -ErrorAction SilentlyContinue|Where {$_.ProviderName -match 'Application Error|Windows Error Reporting' -or $_.Message -match 'node\.exe|0xc0000409|-1073740791'}|Select -First 100 TimeCreated,Id,LevelDisplayName,ProviderName,Message
Put (Join-Path $outDir 'system\windows-application-events.txt') ($events|Format-List|Out-String)

$runtimeLogs=Join-Path $RepoPath 'data\runtime-logs'
if(Test-Path $runtimeLogs){Get-ChildItem $runtimeLogs -File -ErrorAction SilentlyContinue|Sort LastWriteTime -Descending|Select -First 8|ForEach {$tail=Get-Content $_.FullName -Tail 500 -ErrorAction SilentlyContinue|Out-String;Put (Join-Path $outDir ('logs\'+($_.Name -replace '[^A-Za-z0-9._-]','_')+'.tail.txt')) $tail}}

if(Test-Path $zipPath){Remove-Item $zipPath -Force}
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host 'Collection complete.'
Write-Host ('Folder: '+$outDir)
Write-Host ('ZIP:    '+$zipPath)

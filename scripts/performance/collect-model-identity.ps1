# Read-only live process configuration plus file hashes. Never calls model generation.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$handler=[Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false
$http=[Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(4)
$listeners=Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8081,8083,8084
$hashes=@{};$rows=@()
function Argument([string]$text,[string]$name){$match=[regex]::Match($text,'(?:^|\s)'+[regex]::Escape($name)+'\s+(?:"([^"]+)"|(\S+))');if($match.Success){if($match.Groups[1].Success){return $match.Groups[1].Value};return $match.Groups[2].Value};return $null}
foreach($port in @(8081,8083,8084)){
 $listener=$listeners | Where-Object LocalPort -eq $port | Select-Object -First 1
 if(!$listener){$rows+=@{port=$port;status='UNKNOWN'};continue}
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
 $model=Argument $process.CommandLine '-m';$template=Argument $process.CommandLine '--chat-template-file'
 foreach($file in @($model,$template) | Where-Object {$_}){if(!$hashes.ContainsKey($file)){$hashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}}
 $row=@{asOf=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();port=$port;pid=$process.ProcessId;modelFilename=[IO.Path]::GetFileName($model);modelSha256=$hashes[$model];quantizationFromFilename=if([IO.Path]::GetFileName($model) -match '-(Q[0-9]+(?:_[A-Z0-9]+)+)\.gguf$'){$Matches[1]}else{$null};contextConfigured=Argument $process.CommandLine '-c';deviceConfigured=Argument $process.CommandLine '--device';templateSha256=if($template){$hashes[$template]}else{$null};reasoningConfigured=Argument $process.CommandLine '--reasoning';outputLimitConfigured=Argument $process.CommandLine '-n';schemaCompatibility='UNKNOWN';status='MEASURED'}
 try{$props=$http.GetStringAsync("http://127.0.0.1:$port/props").GetAwaiter().GetResult() | ConvertFrom-Json;$row.contextReported=$props.default_generation_settings.n_ctx;$row.totalSlots=$props.total_slots;$row.alias=$props.model_alias;$row.reasoningFormat=$props.default_generation_settings.params.reasoning_format}catch{$row.propsStatus='UNKNOWN'}
 $rows+=$row
}
$http.Dispose();$handler.Dispose()
$rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$PSScriptRoot/model-identities.json" -Encoding UTF8
$rows | ForEach-Object { [pscustomobject]@{port=$_.port;pid=$_.pid;status=$_.status} } | ConvertTo-Json

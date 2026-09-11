$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $workspace
npm run verify
if($LASTEXITCODE -ne 0){throw "verify failed with exit code $LASTEXITCODE"}
$failures=@()
if(Test-Path -LiteralPath (Join-Path $workspace '.env')){$failures+='forbidden .env exists'}
$stopHits=rg -n -i 'STOP_MARKET|TAKE_PROFIT_MARKET|closePosition|auto.?stop' apps packages -g '!**/dist/**' -g '!**/*.test.*' 2>$null
if($LASTEXITCODE -eq 0){$failures+="automatic-stop execution signatures found: $stopHits"}
$settings=Get-Content -Raw (Join-Path $workspace 'config\settings.default.json') | ConvertFrom-Json
if($settings.connections.proxy.url -ne 'socks5h://127.0.0.1:20081' -or !$settings.connections.proxy.forceBinanceRest -or !$settings.connections.proxy.forceBinanceWs -or !$settings.connections.proxy.proxyDns){$failures+='Binance SOCKS5H policy mismatch'}
$enabled=@($settings.aiResources | Where-Object enabled)
if($enabled.Count -ne 2 -or @($enabled.baseUrl) -notcontains 'http://127.0.0.1:8081/v1' -or @($enabled.baseUrl) -notcontains 'http://127.0.0.1:8084/v1'){$failures+='AI topology is not exactly 8081 Scout + 8084 Primary'}
if($settings.connections.marketDataMode -ne 'BINANCE' -or $settings.connections.aiMode -ne 'OPENAI_COMPATIBLE' -or $settings.connections.executionMode -ne 'READ_ONLY'){$failures+='production defaults must be real Binance public + OpenAI compatible + read-only'}
$generated=Get-ChildItem (Join-Path $workspace 'apps\dashboard\src') -Recurse -File -Include *.js,*.vue.js
if($generated){$failures+="generated Dashboard source files found: $($generated.FullName -join ', ')"}
if(!(Select-String -Quiet -Path 'apps\engine\src\runtime\appRuntime.ts' -Pattern 'createTestHarness')){$failures+='explicit test harness gate missing'}
if(!(Select-String -Quiet -Path 'apps\engine\src\adapters\exchange\ExternalTradeAdapter.ts' -Pattern 'production private writes disabled')){$failures+='production write guard missing'}
if($failures.Count){$failures | ForEach-Object {Write-Error $_};exit 1}
Write-Output 'PASS static acceptance: verify, proxy, AI topology, TESTNET write guard, no auto-stop path, no .env'

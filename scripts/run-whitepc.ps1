param([switch]$CheckOnly,[switch]$NoRestart)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
Write-Host '=== WildPlayer 26.3 / White PC ==='
Write-Host "Project: $root"
if(-not (Test-Path '.env')) { throw 'Missing .env. Run scripts/setup.ps1 and review .env before starting.' }
foreach($exe in @('node','npm','ollama')){
  if(-not (Get-Command $exe -ErrorAction SilentlyContinue)){throw "$exe is not in PATH"}
}
Write-Host "Node: $(node --version)"
try { nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader } catch { Write-Warning 'nvidia-smi unavailable' }
function Test-Port([int]$port){
  try {
    $tcp=New-Object Net.Sockets.TcpClient
    $result=$tcp.BeginConnect('127.0.0.1',$port,$null,$null)
    $ok=$result.AsyncWaitHandle.WaitOne(1500)
    if($ok) {$tcp.EndConnect($result)}
    $tcp.Close()
    return $ok
  } catch {return $false}
}
if(-not (Test-Port 25568)){ Write-Warning 'ViaProxy 127.0.0.1:25568 is not reachable. Start your EXISTING ViaProxy terminal first.' }
if(-not (Test-Port 11434)){ Write-Warning 'Ollama 127.0.0.1:11434 is not reachable. Start Ollama first.' }
if(-not (Test-Path 'node_modules')) {
  Write-Host 'Installing pinned npm dependencies...'
  & npm install
  if($LASTEXITCODE -ne 0){throw 'npm install failed'}
}
& npm run check
if($LASTEXITCODE -ne 0){throw 'Syntax check failed'}
& npm test
if($LASTEXITCODE -ne 0){throw 'Unit tests failed'}
if($CheckOnly){ Write-Host 'Checks completed (live server login NOT tested).';exit 0 }
Write-Host 'Running bot. Type quit to stop normally. On unexpected disconnect, bot restarts after 10 seconds.'
while($true){
  & node src/main.js
  $exit=$LASTEXITCODE
  if($exit -eq 0){Write-Host 'WildPlayer stopped normally.';break}
  Write-Warning "WildPlayer exited with code $exit. Retrying in 10 seconds. (Ctrl+C to stop.)"
  if($NoRestart){break}
  Start-Sleep -Seconds 10
}

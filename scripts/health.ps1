$ErrorActionPreference='Continue'
Write-Host '=== White PC ==='
node --version
ollama list
nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,power.draw --format=csv
Write-Host '=== Local listeners (adjust if your ports differ) ==='
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(25565,25568,11434,3007)} | Format-Table LocalAddress,LocalPort,OwningProcess
Write-Host '=== Latest WildPlayer trace ==='
$root=Split-Path $PSScriptRoot -Parent
$trace=Join-Path $root 'data/trace.jsonl'
if(Test-Path $trace){Get-Content $trace -Tail 12}else{Write-Host 'No trace yet'}

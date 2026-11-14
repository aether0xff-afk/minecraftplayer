param([string]$PreviousProject='',[switch]$CopyMemory)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
if(Test-Path '.env') {
  Write-Host 'Keeping existing .env (not overwriting).'
} elseif($PreviousProject -and (Test-Path (Join-Path $PreviousProject '.env'))) {
  Copy-Item (Join-Path $PreviousProject '.env') '.env'
  Write-Host 'Copied previous .env (server, account, and settings preserved).'
} else {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from safe defaults.'
}
# Only append missing keys; do not reset old allowlists/credentials/configuration.
$existing=Get-Content '.env' -Raw
foreach($line in (Get-Content '.env.example')){
  if($line -match '^([A-Z_]+)='){
    $key=$matches[1]
    if($existing -notmatch "(?m)^$key=") { Add-Content '.env' $line; Write-Host "New option added: $key" }
  }
}
if($PreviousProject){
  if($CopyMemory -and (Test-Path (Join-Path $PreviousProject 'data/memory.json'))){
    New-Item -ItemType Directory -Force -Path 'data' | Out-Null
    if(-not (Test-Path 'data/memory.json')){
      Copy-Item (Join-Path $PreviousProject 'data/memory.json') 'data/memory.json'
      Write-Host 'Copied persistent memory.json.'
    }
  }
  New-Item -ItemType Directory -Force -Path 'tools' | Out-Null
  Get-ChildItem -Path (Join-Path $PreviousProject 'tools') -Filter 'ViaProxy*.jar' -ErrorAction SilentlyContinue | ForEach-Object {
    if(-not (Test-Path (Join-Path 'tools' $_.Name))){Copy-Item $_.FullName (Join-Path 'tools' $_.Name)}
  }
}
Write-Host 'Done. Review .env and then run scripts/run-whitepc.ps1.'

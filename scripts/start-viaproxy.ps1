param([string]$ServerAddress='127.0.0.1:25565',[int]$AccountIndex=0)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$jar = Get-ChildItem -Path './tools' -Filter 'ViaProxy*.jar' | Select-Object -First 1
if(-not $jar) { throw 'Put a ViaProxy release jar in tools/. Existing running ViaProxy needs no restart.' }
Write-Host "ViaProxy: 26.1 bot -> Minecraft 26.3 $ServerAddress | saved account index $AccountIndex"
java -jar $jar.FullName cli --target-address $ServerAddress --target-version '26.3' --minecraft-account-index $AccountIndex

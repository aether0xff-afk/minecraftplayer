param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git CLI is required." }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = (Resolve-Path $SourcePath).Path
$required = @("package.json", ".env.example", "src/main.js", "src/motor.js", "tests/motor.test.js")
foreach ($item in $required) {
  if (-not (Test-Path (Join-Path $source $item))) { throw "Not a valid v0.4 project folder (missing $item): $source" }
}
# Explicit allow-list: do not copy local .env, session credentials, worlds, logs, data or binary JARs.
$files = @("package.json", ".env.example", "MOTOR_V04_README.md",
           "CHECK_WILDPLAYER.cmd", "START_WILDPLAYER.cmd")
foreach ($name in $files) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $repoRoot $name) -Force
}
foreach ($dir in @("src", "tests", "scripts")) {
  $srcDir = Join-Path $source $dir
  if (-not (Test-Path $srcDir)) { throw "Missing $srcDir" }
  $dstDir = Join-Path $repoRoot $dir
  New-Item -Type Directory -Force $dstDir | Out-Null
  $exts = if ($dir -eq "scripts") { @(".js", ".ps1") } else { @(".js") }
  Get-ChildItem -LiteralPath $srcDir -Recurse -File | Where-Object { $exts -contains $_.Extension } | ForEach-Object {
    $rel = $_.FullName.Substring($srcDir.Length).TrimStart([char]'\',[char]'/')
    $dst = Join-Path $dstDir $rel
    New-Item -Type Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
  }
}
Push-Location $repoRoot
try {
  git add -- package.json .env.example MOTOR_V04_README.md CHECK_WILDPLAYER.cmd START_WILDPLAYER.cmd src tests scripts
  if ($LASTEXITCODE -ne 0) { throw "git add failed" }
  $staged = @(git diff --cached --name-only)
  $disallowed = @($staged | Where-Object {
    ($_ -match '(^|/)(\.env$|data/|node_modules/|auth/|secrets/|credentials/|sessions/|world/|tools/)') -or
    ($_ -match '\.(jar|exe|gguf|safetensors|log)$')
  })
  if ($disallowed.Count -gt 0) { throw ("Unsafe staged paths: " + ($disallowed -join ", ")) }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw "git diff validation failed" }
  Write-Host "Staged source files: " $staged.Count
  Write-Host "Review staged changes with: git diff --cached --stat"
  Write-Host "No commit/push was performed. This script only stages the source for review."
} finally { Pop-Location }

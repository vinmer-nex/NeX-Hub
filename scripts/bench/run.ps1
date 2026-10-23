param(
  [string]$Label = 'baseline'
)

$ErrorActionPreference = 'Stop'

$benchDir = $PSScriptRoot
$root = (Resolve-Path (Join-Path $benchDir '..\..')).Path
Set-Location -LiteralPath $root

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron)) {
  throw "Electron binary not found: $electron"
}

$serverScript = Join-Path $benchDir 'server-bench.js'
$uiScript = Join-Path $benchDir 'ui-bench.js'
$serverResult = Join-Path $benchDir "results-$Label.json"
$uiResult = Join-Path $benchDir "ui-results-$Label.json"

Write-Host "== Server bench ($Label) =="
$serverOut = Join-Path $benchDir "server-$Label.stdout.log"
$serverErr = Join-Path $benchDir "server-$Label.stderr.log"
Remove-Item -LiteralPath $serverOut, $serverErr -Force -ErrorAction SilentlyContinue

# NOTE: electron.exe is a GUI-subsystem binary; the `&` operator does NOT wait
# for it. Start-Process -Wait is required for correct sequential measurement.
$env:ELECTRON_RUN_AS_NODE = '1'
$serverArgs = '"' + $serverScript + '" --label "' + $Label + '"'
$serverProc = Start-Process -FilePath $electron `
  -ArgumentList $serverArgs `
  -WorkingDirectory $root `
  -Wait -PassThru `
  -RedirectStandardOutput $serverOut `
  -RedirectStandardError $serverErr
$serverExit = $serverProc.ExitCode
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $serverOut) {
  Get-Content -LiteralPath $serverOut
}
if (Test-Path -LiteralPath $serverErr) {
  $serverErrText = Get-Content -LiteralPath $serverErr -Raw
  if ($serverErrText -and $serverErrText.Trim().Length -gt 0) {
    Write-Host "--- server stderr ---"
    Write-Host $serverErrText
  }
}

Write-Host ""
Write-Host "== UI bench ($Label) =="
$uiOut = Join-Path $benchDir "ui-$Label.stdout.log"
$uiErr = Join-Path $benchDir "ui-$Label.stderr.log"
Remove-Item -LiteralPath $uiOut, $uiErr -Force -ErrorAction SilentlyContinue

$uiArgs = '"' + $uiScript + '" --label "' + $Label + '"'
$uiProc = Start-Process -FilePath $electron `
  -ArgumentList $uiArgs `
  -WorkingDirectory $root `
  -Wait -PassThru `
  -RedirectStandardOutput $uiOut `
  -RedirectStandardError $uiErr
$uiExit = $uiProc.ExitCode

if (Test-Path -LiteralPath $uiOut) {
  Get-Content -LiteralPath $uiOut
}
if (Test-Path -LiteralPath $uiErr) {
  $errText = Get-Content -LiteralPath $uiErr -Raw
  if ($errText -and $errText.Trim().Length -gt 0) {
    Write-Host "--- ui stderr ---"
    Write-Host $errText
  }
}

Write-Host ""
Write-Host "Result files:"
Write-Host "  server: $serverResult"
Write-Host "  ui:     $uiResult"
Write-Host "Exit codes: server=$serverExit ui=$uiExit"

if (-not (Test-Path -LiteralPath $serverResult)) {
  throw "Server result file was not created: $serverResult"
}
if (-not (Test-Path -LiteralPath $uiResult)) {
  throw "UI result file was not created: $uiResult"
}

if ($serverExit -ne 0) { exit $serverExit }
if ($uiExit -ne 0) { exit $uiExit }
exit 0

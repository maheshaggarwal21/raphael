# Repo Keeper / Academy auto-resume launcher.
# Runs at logon (via a scheduled task). If — and only if — there is active,
# non-blocked Academy work, it opens a visible terminal in the raphael project and
# starts Claude Code with the resume prompt, so the build picks up where it stopped.
# It never runs when the build is done or paused at the owner boundary, and it
# throttles itself so it can't relaunch in a loop. Everything is logged.

$ErrorActionPreference = 'SilentlyContinue'

$raphael   = 'C:\Users\Mahesh\Desktop\Projects\raphael'
$project   = 'repo-keeper'
$statePath = Join-Path $env:USERPROFILE ".raphael\academy\$project\state.json"
$log       = Join-Path $raphael '.claude\academy\resume.log'
$stamp     = Join-Path $raphael '.claude\academy\.last-resume'

function Log($m) { "$([DateTime]::Now.ToString('s'))  $m" | Add-Content -Path $log }

if (-not (Test-Path $statePath)) { Log 'no academy state; nothing to resume'; exit 0 }

try { $state = Get-Content $statePath -Raw | ConvertFrom-Json } catch { Log 'state unreadable; skipping'; exit 0 }

$status = "$($state.status)"
if ($status -ne 'in-progress' -and $status -ne 'blocked-limit') {
    Log "status=$status -> not resuming (done or owner-boundary)"
    exit 0
}

# Throttle: never relaunch within 30 minutes (guards against logon loops / retries).
if (Test-Path $stamp) {
    $age = (New-TimeSpan -Start (Get-Item $stamp).LastWriteTime -End (Get-Date)).TotalMinutes
    if ($age -lt 30) { Log "throttled (last resume $([int]$age)m ago)"; exit 0 }
}
Set-Content -Path $stamp -Value (Get-Date).ToString('s')

$prompt = 'Resume the autonomous Academy build. First read .claude/academy/RESUME.md, then run: node bin/raph.js academy status repo-keeper — and continue from NEXT. Build and verify one milestone (tests must pass), checkpoint with raph academy checkpoint, and commit locally. Do NOT push, deploy, sign in, or spend. Stop at the autonomy boundary and record it.'

Log "resuming: status=$status"
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoExit', '-NoProfile', '-Command', "Set-Location '$raphael'; Write-Host 'Repo Keeper auto-resume...' -ForegroundColor Cyan; claude `"$prompt`"") `
    -WorkingDirectory $raphael
Log 'launched resume window'
exit 0

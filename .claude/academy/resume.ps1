# Academy auto-resume launcher (project-agnostic).
# Runs at logon. If — and only if — some Academy project is active (status
# in-progress or blocked-limit), it opens a visible terminal in the raphael project
# and starts Claude Code with a resume prompt, so the autonomous build picks up where
# it stopped after a reboot or a Claude usage-limit reset. It never runs when every
# project is done or paused at the owner boundary, and it throttles itself so it can't
# relaunch in a loop. Everything is logged.

$ErrorActionPreference = 'SilentlyContinue'

$raphael   = 'C:\Users\Mahesh\Desktop\Projects\raphael'
$academy   = Join-Path $env:USERPROFILE '.raphael\academy'
$log       = Join-Path $raphael '.claude\academy\resume.log'
$stamp     = Join-Path $raphael '.claude\academy\.last-resume'

function Log($m) { "$([DateTime]::Now.ToString('s'))  $m" | Add-Content -Path $log }

if (-not (Test-Path $academy)) { Log 'no academy dir; nothing to resume'; exit 0 }

# Find the first project that still needs work.
$active = $null
foreach ($dir in Get-ChildItem -Path $academy -Directory) {
    $sp = Join-Path $dir.FullName 'state.json'
    if (-not (Test-Path $sp)) { continue }
    try { $st = Get-Content $sp -Raw | ConvertFrom-Json } catch { continue }
    if ("$($st.status)" -eq 'in-progress' -or "$($st.status)" -eq 'blocked-limit') {
        $active = $dir.Name
        break
    }
}

if (-not $active) { Log 'no in-progress/blocked-limit project -> nothing to resume'; exit 0 }

# Throttle: never relaunch within 30 minutes (guards against logon loops / retries).
if (Test-Path $stamp) {
    $age = (New-TimeSpan -Start (Get-Item $stamp).LastWriteTime -End (Get-Date)).TotalMinutes
    if ($age -lt 30) { Log "throttled (last resume $([int]$age)m ago)"; exit 0 }
}
Set-Content -Path $stamp -Value (Get-Date).ToString('s')

$prompt = "Resume the autonomous Academy build. Read .claude/academy/RESUME.md, then run: node bin/raph.js academy status $active — and continue from NEXT. You are fully autonomous (the owner does not want to be asked to resume). For each milestone: build it, make tests pass, update docs, commit AND push, publish the product repo if the milestone is green, then checkpoint with raph academy checkpoint and continue to the next milestone. Write lessons back to the brain and approve them. Stop ONLY at a real boundary: deploy / host a running service / sign in / spend money / mutate production data — record it with raph academy boundary."

Log "resuming project=$active"
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoExit', '-NoProfile', '-Command', "Set-Location '$raphael'; Write-Host 'Academy auto-resume ($active)...' -ForegroundColor Cyan; claude `"$prompt`"") `
    -WorkingDirectory $raphael
Log "launched resume window for $active"
exit 0

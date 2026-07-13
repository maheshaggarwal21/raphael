# Register the logon auto-resume task (current user, no admin). Idempotent.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'resume.ps1'
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
schtasks /Create /TN 'RaphaelAcademyResume' /TR $action /SC ONLOGON /RL LIMITED /F
Write-Host 'Registered RaphaelAcademyResume (runs resume.ps1 at logon).' -ForegroundColor Green
Write-Host 'Disable with: schtasks /Change /TN RaphaelAcademyResume /DISABLE'

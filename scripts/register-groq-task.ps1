# Registers (or replaces) the "ShelfReady Groq eval" scheduled task: daily at 8 PM for 7 days,
# wakes the laptop to run, and runs as soon as possible if 8 PM was missed (laptop off/asleep).
# Run once: powershell -ExecutionPolicy Bypass -File scripts/register-groq-task.ps1

$script = Join-Path $PSScriptRoot "eval-groq-daily.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At "8:00 PM"
$trigger.EndBoundary = (Get-Date).AddDays(7).ToString("s")
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "ShelfReady Groq eval" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName "ShelfReady Groq eval" | Get-ScheduledTaskInfo | Select-Object NextRunTime, LastRunTime

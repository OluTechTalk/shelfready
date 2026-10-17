# Daily Groq eval session (Windows Task Scheduler). Groq's free tier allows ~200k tokens a day
# and a full before/after run needs ~960k, so this resumes the same labeled run once a day:
# finished tasks are skipped, and the runner's circuit breaker stops cleanly when the day's
# quota runs out. Safe to run after the eval is complete (it finds nothing to do).
#
# Logs go to evals/logs/ (git-ignored), not %TEMP%, so they survive restarts. Each session also
# appends one line to evals/logs/groq-summary.log: when, exit code, and how the run ended —
# a night that silently did nothing (asleep, VPN on, crash) is visible the next morning.
#
# Registered by: scripts/register-groq-task.ps1 (daily 8 PM, wakes the laptop, catches up if missed)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo "evals\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "groq-eval.log"
$summary = Join-Path $logDir "groq-summary.log"
Set-Location $repo

$start = Get-Date
"`n=== $(Get-Date -Format s) Groq eval session ===" | Out-File -FilePath $log -Append -Encoding utf8
$out = npx tsx --env-file=.env.local evals/run.ts --model backup --label 2026-09-29-groq-gpt-oss-120b 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
$out | Out-File -FilePath $log -Append -Encoding utf8

# How it ended: the runner prints "N to run (M already done)" per catalog and "Stopping: …" on a breaker.
$done = ($out | Select-String -Pattern "^\s+T\d+ (success|no_cart|wrong_product|wrong_variant)\b").Count
$errs = ($out | Select-String -Pattern "^\s+T\d+ error\b").Count
$progress = ($out | Select-String -Pattern "to run" | ForEach-Object { $_.Line.Trim() }) -join " | "
$stop = ($out | Select-String -Pattern "Stopping:|403|Access denied" | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() })
if (-not $stop) { $stop = if ($code -eq 0) { "finished normally" } else { "exited with an error (see groq-eval.log)" } }
if ($stop.Length -gt 160) { $stop = $stop.Substring(0, 160) + "..." }
$mins = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
"$(Get-Date -Format s)  exit=$code  ${mins}min  tasks_done=$done  errors=$errs  [$progress]  $stop" | Out-File -FilePath $summary -Append -Encoding utf8
exit $code

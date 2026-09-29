# Daily Groq eval session (Windows Task Scheduler). Groq's free tier allows ~200k tokens a day
# and a full before/after run needs ~960k, so this resumes the same labeled run once a day:
# finished tasks are skipped, and the runner's circuit breaker stops cleanly when the day's
# quota runs out. Safe to run after the eval is complete (it finds nothing to do).
#
# Registered by: schtasks /Create /TN "ShelfReady Groq eval" (see docs/sessions, Episode 06)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:TEMP "shelfready-groq-eval.log"
Set-Location $repo
"`n=== $(Get-Date -Format s) Groq eval session ===" | Out-File -FilePath $log -Append -Encoding utf8
npx tsx --env-file=.env.local evals/run.ts --model backup --label 2026-09-29-groq-gpt-oss-120b 2>&1 | Out-File -FilePath $log -Append -Encoding utf8

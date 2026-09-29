# Episode 06 — P5 Eval: 60 shopping tasks, before vs after, and the tools finding

- Date: 2026-09-28 → 2026-09-29
- Phase: P5 (Eval) of P0–P6 — demo mode and the shopper playground move to Episode 07
- Time spent: ~6 h across two days (much of it waiting on model outages and quotas)
- Recording: shelfready-ep06-eval.mp4

## Target
40 shopping tasks run by an AI agent through the MCP tools on the original messy catalog and the fixed one — same tasks, same model — with a before/after chart in the app.
Done when: both runs are stored; /eval shows success rate, wrong-product rate, steps and tokens per task, before vs after, with every task's transcript inspectable.

## Plan (approved at session start)
1. Clean catalog as ground truth. 2. Task set with verified answers. 3. "Before" catalog source. 4. Eval runner (agent loop over the MCP tools, recorded carts). 5. Runs. 6. /eval page.
Olu's calls: Gemini as the main model, Groq second; carts stubbed (recorded, not created); a UI clean-up before the playground; later — $5 of Gemini credit, fix the search tool and run 3×, add an attribute tier, run Groq free in the background.

## What got done
- **Ground truth:** the generator also writes `fixtures/catalog-clean.json` (products before defects); `catalog.json` regenerates byte-identical.
- **Tasks** (`evals/tasks.json`, `npm run eval:tasks`): 60 natural shopper requests with verified answers from the clean catalog — 40 standard (25 messy targets, 10 clean controls, 5 "nothing fits") + 20 attribute-tier (deciding fact only in a structured attribute: weight, fill power, waterproof rating, packed weight, shape, setup).
- **Runner** (`npm run eval`): AI SDK agent loop over the same tools and wording as the live MCP server (now shared constants); stock from each catalog's own data; carts recorded. Scored against the true data: success / wrong product / wrong size-color / no cart. Resumable by label, per-task saves, circuit breaker, `--repeat N`, by-kind and by-tier summaries, tool errors recorded in transcripts.
- **/eval**: before → after headline next to the readiness score, outcome bars with the run-to-run spread, efficiency, results by kind and tier, per-task pass counts and side-by-side transcripts.
- **MCP tool improvements** (live for real agents too): compact results (search −53%, product −29% size); numbers count in text search; attribute filters accept label or key; unknown attribute names return the valid names.
- **UI:** shared design tokens and the Geist font; header nav; a real landing page with live numbers; `/review` redesign (cards, score pills, status-colored fixes, tinted diffs); `/audit`, `/status`, `/eval` on the same style.
- **README** replaced with the project story, results, architecture and how to run.
- **Groq** scheduled: `scripts/eval-groq-daily.ps1`, Windows Task Scheduler, 8 PM daily for 6 days.

## Decisions made
- Compact MCP tool results; eval on free tiers only (DECISIONS.md).
- Gemini on the paid tier — Olu added $5 (DECISIONS.md).
- Fix the agent-facing search tool, not just the data (DECISIONS.md).
- Repeat each eval 3× and report the spread (DECISIONS.md).
- Gemini is the eval of record; Groq runs free in the background (DECISIONS.md).
- The eval runs the tools in-process with recorded carts and catalog-local stock (DECISIONS.md).
- Claude Pro can't drive the automated eval (no API access); used for a manual spot-check instead.

## What broke / still rough
- **Gemini free tier outage:** 115 s per call and "high demand" for hours; resolved by the paid tier.
- **Low-memory kill** of a background run left orphaned processes whose connections died ("session has been destroyed") — 74 of 80 tasks errored. Led to resumable runs, per-task saves and a circuit breaker.
- **Groq free tier:** 200k tokens/day vs ~960k per full run → compact tool results, then a daily background schedule.
- **Eval harness bug:** stand-in product ids for the messy catalog exceeded the tools' 80-char limit, so on long-named products the agent found the item but couldn't cart it — unfairly lowering "before". Found from a crash in transcript building (`JSON.stringify(undefined)`), fixed with short numeric ids; the flawed run was discarded.
- Several runs were discarded (tool output trimmed, search fixed, harness bug) so that before and after always ran on identical tool versions.
- **Limitation:** many tasks have 2–4 correct products, so an agent can route around one damaged listing; the attribute tier didn't separate the catalogs. Single-answer tasks would be sharper.
- Claude spot-check: 2 of 5 prompts appear in the MCP log (both correct); the other 3 weren't logged.

## Numbers (if any)
- **Eval of record — Gemini 3.5 Flash-Lite, 60 tasks × 3 runs per catalog (360 sessions):** success **98.9% → 99.4%**; standard tier 98.3% → 100%; attribute tier 100% → 98.3%; wrong product **0% / 0%**; tool calls 3.8 → 3.7; tokens per task 9,773 → 9,370 (−4%).
- **Tool fix effect:** first fair single run (old search) 95% → 92.5%; after the search fix 97.5–100% on both catalogs.
- Failures: messy catalog — T25 softshell jacket, T19 women's trail shoes (1 of 3 runs each, gave up); fixed catalog — T50 Lynx synthetic bag (1 of 3, declined: its weight is still a merchant gap).
- **Cost:** eval model calls logged $1.54 in total on Gemini paid (incl. discarded runs; a clean 3-run 60-task eval ≈ $1.00); Groq free.
- Claude (Pro, manual via connector): 6-person tent → correct product carted; 3-person tent under $210 → correctly declined.

## Next target
Episode 07 — Shopper playground + demo mode: a public chat where an AI agent shops the store through the MCP tools, rate-limited, with a cached demo-mode fallback. Add the Groq results to /eval when the background run completes (~Oct 4).

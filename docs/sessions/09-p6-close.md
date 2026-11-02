# Episode 09 — P6 close: Groq comparison finished

- Date: 2026-10-20 → 2026-11-02
- Phase: P6 (Ship) of P0–P6
- Time spent: ~1 h of attended work; the rest was nightly background runs
- Recording: none (Loom deferred; the project will be recorded later as a case presentation)

## Target
Finish the Groq comparison reliably, add it to /eval and the case study, close P6.

## What got done
- **Groq gpt-oss-120b comparison complete** (`0bbd9c0`): 60 tasks × 1 run on both catalogs, added to /eval (with an error row so every task is accounted for), README and case study.
- Nightly runs were observable this time (`evals/logs/groq-summary.log`, one line per night). They hit the free-tier rate limit and, on the last run, a tool-call schema rejection, but the runner resumed each night until all 120 task runs were stored.
- The scheduled task "ShelfReady Groq eval" is now disabled.
- Closing check (2026-11-02): last commit includes results JSON for both catalogs, case study text with caveats, and DECISIONS entry (2026-10-23). Working tree clean.

## Decisions made
- Count Groq's 5 rejected `limit: 20` search calls as failures rather than loosening the tool mid-comparison (DECISIONS.md, 2026-10-23).

## What broke / still rough
- One run per model for Groq (Gemini has three); the search sort option shipped after 34 of Groq's 60 "before" tasks, so that comparison is not perfectly clean (stated in the case study).
- The demo Shopify dev store is password-protected, so a public link to it shows a password page. Not addressed yet.
- The Loom recording is still not made.

## Numbers (if any)
Groq gpt-oss-120b, 60 tasks × 1 run: right product 86.7% → 88.3% (before → after); gave up 10% → 1.7%. See /eval for the Gemini run of record.

## Next target
None required — P6 is complete. Optional: link visitors to the store, record the case presentation.

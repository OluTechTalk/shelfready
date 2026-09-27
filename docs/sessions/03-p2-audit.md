# Episode 03 — P2 Audit: rubric v1, scoring, /audit page

- Date: 2026-09-27
- Phase: P2 (Audit) of P0–P6
- Time spent: ~1.5 h (plus ~20 min Groq key rotation and live key checks before the session)
- Recording: shelfready-ep03-audit.mp4

## Target
Score all 150 products 0–100 against the rubric and show the store score and worst offenders in the UI.
Done when: /audit shows store score, band %, and worst offenders, and messy products score clearly below clean ones against `fixtures/ground-truth.json`.

## Plan (approved at session start)
1. Finalize rubric v1 on the real catalog (open questions, category resolution).
2. Rule checks as pure functions + a self-test against the ground truth.
3. Model setup: `lib/ai/models.ts` + a wrapper that logs every call to `model_calls` (added `ai`, `@ai-sdk/google`, `@ai-sdk/groq` — approved).
4. One structured model call per product, cached by content hash (new tables).
5. `npm run audit`: score, store the run, report against the ground truth.
6. `/audit` page (read-only, no model calls).

## What got done
- **Pre-session:** Groq key rotated (the old one returned 401) and added to Vercel; `/status` now live-checks the Gemini and Groq keys against each provider's free model-list endpoint instead of only checking the env var is set.
- **Rubric v1** (`lib/audit/rubric.ts`, `docs/RUBRIC.md`): thresholds as constants, 0.5 credit for attributes stated only in the description, per-check sub-conditions written down, band gate.
- **Category resolution** (`lib/audit/category.ts`): product type → Shopify category → title → handle → description. 150/150 correct, without using fixture labels.
- **Seven checks** (`lib/audit/checks.ts`) returning a 0–1 score plus plain-language findings; `lib/audit/score.ts` for product score, band and store summary.
- **`npm run test:audit`**: each seeded defect lowers exactly the rule check it targets — 0 mismatches on 150 products.
- **`lib/ai/`**: pinned model ids; `generateStructured()` (AI SDK v7 `generateText` + `Output.object`, temperature 0) logs tokens and latency for every call, failed ones included.
- **`lib/audit/judge.ts`**: one call per product covers the 5 shopper questions, prose-only attributes and title content. Every claim must quote the source text, and the scorer rejects quotes that aren't in it. Cached in `audit_llm_cache` by (content hash, model, rubric version).
- **Migration 0001**: `audit_llm_cache`, `audit_runs`, `audit_scores`.
- **`npm run audit`**: paced to the free tier, never saves a partial run, prints bands, check averages, tokens, worst offenders and a ground-truth comparison.
- **`/audit`** page, live on Vercel: hero store score, band bar (status colors + icon + label), check averages, 10 worst offenders with expandable findings (marks checks that capped the band), all products.

## Decisions made
- Half credit for attributes found only in the description (DECISIONS.md).
- One model call per product for all judgments (DECISIONS.md).
- Category inferred from product data, never from fixture labels (DECISIONS.md).
- Default audit model `gemini-3.5-flash-lite`, paced to ~15 RPM (DECISIONS.md).
- Band gate: any check < 0.5 caps at Partial, 2+ make it Not ready — chosen by Olu over raising cutoffs, keeping v1, or regenerating a messier catalog (DECISIONS.md).
- `/status` makes live provider calls on every view (DECISIONS.md).
- Required-attributes weight stays 30 (RUBRIC.md; revisit only if accessories band wrongly).

## What broke / still rough
- **Gemini availability:** `gemini-3.5-flash` returned "high demand" 503s and 17–70 s calls; `gemini-2.5-flash` is closed to new keys. Switched to flash-lite.
- **Free-tier quota:** the first unpaced audit (4 concurrent) hit the per-minute limit after ~100 calls and left 45 products unscored — and saved a partial run. Fixed: calls start ≥ 4 s apart, 30 s backoff on quota errors, partial runs are never saved. Failed attempts are still in `model_calls` (0 tokens), which slightly inflates the call count for today.
- **Title judgment too lenient at first:** the model said "Cozy Layer!!!" named a product type and a distinguishing attribute. Fixed by making it quote the exact title words (as a list, so non-adjacent words like "Talus … Women's" work). Samples: clean 13/13 pass, vague 0/13.
- **Bands hid the defects:** without the gate, 89% of the store was Agent-ready and 0% Not ready. Fixed with the band gate.
- Deleted two audit runs created this session: #1 (partial, quota failure) and #2 (scored before the gate). Run #3 is the baseline.
- Clean products all score exactly 100 — the generator makes them perfect. Real catalogs won't; worth remembering when quoting the "before" number.
- The audit runs only as a local script; the page is read-only. No public route calls a model yet, so no rate limiting was needed this episode.
- `lib/audit` imports text helpers from `lib/catalog/defects.ts` (a seed-verification module). Fine for now; move them if the audit grows.

## Numbers (if any)
- **Baseline (run #3, rubric v1, gemini-3.5-flash-lite):** store score **94.1 / 100** — Agent-ready 117 (78%), Partial 22 (14.7%), Not ready 11 (7.3%).
- Check averages: required attributes 0.96 · answerability 0.90 · variants 0.95 · title 0.91 · price/stock 1.00 · images 0.94 · taxonomy 0.91.
- Clean 100.0 avg (100 products) vs messy 82.4 (50); by defect count: 1 → 89.2, 2 → 83.9, 3 → 76.5, 4 → 68.2.
- Defect → targeted check (with defect vs clean): vague title 0.00, prose-only attributes 0.74, missing attributes 0.69, option names 0.67, variant problems 0.62, alt text 0.28, marketing-only description 0.00, taxonomy 0.00 (clean = 1.00 everywhere).
- Model usage today (`model_calls`, route `audit.product`): 275 calls logged — 179 succeeded (150 for the baseline + 29 while tuning the title judgment), 96 failed on quota/overload with 0 tokens. 83.8k tokens in / 80.4k out; 4.4 s average per successful call. $0 on the free tier. A full cold audit is ~150 calls, ~41k tokens; re-runs on an unchanged catalog make 0 calls.

## Next target
Episode 04 — Fixer + review queue: structured fix proposals for failing checks, a queue where a human approves / edits / rejects, write-back through the Admin API, re-audit to show the score move.

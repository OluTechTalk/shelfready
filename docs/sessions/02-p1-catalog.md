# Episode 02 — P1 Catalog: generated demo catalog, seed, sync

- Date: 2026-09-26 → 2026-09-27 (interrupted by a laptop freeze, finished in a recovery run)
- Phase: P1 (Catalog) of P0–P6
- Time spent: ~1.5 h build + ~0.5 h recovery
- Recording: none (remote run, driven from phone)

## Target
~150 outdoor-gear products (about a third deliberately messy) seeded into the Shopify dev store and synced into Postgres.
Done when: ~150 products in Shopify and Postgres, and defect counts match the ground truth file.

## Plan (written before building; plan approval waived for this run)
1. `zod` + merge `origin/bg/rubric-v1`; reconcile `docs/RUBRIC.md` question wording with `lib/audit/rubric.ts` (code wins).
2. Deterministic generator `scripts/generate-catalog.ts` (seeded PRNG, no model calls) → checked-in `fixtures/catalog.json`. Metafield keys come from `REQUIRED_ATTRIBUTES` in `lib/audit/rubric.ts`.
3. Defect injection in the same generator: ~50 messy products using the 8 RUBRIC.md defects, mix of 1 and 3+ defects → `fixtures/ground-truth.json`.
4. `npm run seed`: metafield definitions, then idempotent `productSet` upsert by handle; throttle on GraphQL cost; resume via a local progress file.
5. `npm run sync`: page all products from the Admin API → `products` table (raw JSON + content hash), upsert on GID.
6. `npm run verify:catalog`: counts in Shopify + Postgres; re-detect each defect from synced raw data and compare with ground truth.

## What got done
- `zod` added, `bg/rubric-v1` merged, RUBRIC.md reconciled with `lib/audit/rubric.ts`.
- `npm run generate:catalog` — deterministic generator (seed `20260926`) → `fixtures/catalog.json` (150 products, 6 rubric categories) + `fixtures/ground-truth.json`. Self-checks the defect detectors against the ground truth before writing.
- `npm run seed` — creates the 19 `shelfready.*` metafield definitions (storefront-readable), upserts each product by handle with `productSet`, stamps a fixture hash in `shelfready_seed.hash` so re-runs skip unchanged products. `adminGraphQL` now backs off on THROTTLED / 429 / 5xx using Shopify's cost bucket.
- `npm run sync` — pages the full catalog into `products` (raw JSON + content hash, upsert on GID, deletes rows for products gone from Shopify).
- `npm run verify:catalog` — counts, duplicate check, per-product defect re-detection from the synced raw data.
- Placeholder product images from placehold.co (labelled with product name + color).

## Decisions made
- Deterministic generator instead of model-generated copy — reproducible, free, and the ground truth is exact (DECISIONS.md).
- Resume state lives in Shopify (hash metafield), not a local progress file — the freeze showed local state can't be trusted (DECISIONS.md).
- "Duplicate variants" are seeded as synonym values (`M` / `Medium`, `Black` / `Blk`) because Shopify rejects exact duplicate option combos (DECISIONS.md).
- Sync mirrors the store: rows for products deleted in Shopify are removed.

## What broke / still rough
- **The freeze.** The laptop froze mid-session, after the generator was committed and during the first seed run. Nothing was lost: steps 1–3 were committed (but not pushed — 5 commits ahead of origin), `seed.ts` / `products.ts` / the throttling change in `admin.ts` were complete on disk, uncommitted. No `index.lock`, `git fsck` clean, no empty or truncated files, fixtures valid JSON.
- **Partial seed.** 54 of 150 products had landed, all with fixture handles and seed hashes, 0 duplicates, all 19 metafield definitions present. Postgres had 0 rows. Re-running `npm run seed` skipped the 54 and created 96 (103 s, 0 failures); a third run skipped all 150. No deletions needed.
- **Recovery changes to the workflow:** push after every slice (this run pushed 4 times) so a freeze can cost at most one slice.
- **Groq key invalid.** `GROQ_API_KEY` is present with the right prefix but returns HTTP 401 — likely still the revoked key. Not needed for Episode 02 (no model calls); must be rotated in `.env.local` and Vercel before Episode 03.
- Two seeded vague titles are shared by two products each ("Cozy Layer!!!", "Untitled product") — intentional; `verify:catalog` excludes seeded vague titles from its duplicate-title check.
- Images are placeholders; fine for agents (alt text is what's scored) but plain in the UI.

## Numbers (if any)
- Catalog: 150 products — 100 clean, 50 messy (1 defect: 20, 2: 12, 3: 12, 4: 6). Each of the 8 defects appears on 13 products.
- Shopify 150 / Postgres 150 / ground truth 150; 0 duplicate handles; per-product defect sets match 150/150.
- Seed: 96 products in 103 s (~1.1 s each, synchronous `productSet` with images). Sync: 150 products in ~6 s.
- Model calls: 0 (no cost this episode).

## Next target
Episode 03 — Audit: finalize the rubric on the real catalog, implement the 7 checks + scoring, store score and worst offenders in the UI. First: rotate the Groq key.

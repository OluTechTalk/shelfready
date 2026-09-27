# Episode 02 — P1 Catalog: generated demo catalog, seed, sync

- Date: 2026-09-26
- Phase: P1 (Catalog) of P0–P6
- Time spent: in progress
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
-

## Decisions made
-

## What broke / still rough
-

## Numbers (if any)

## Next target
Episode 03 — Audit.

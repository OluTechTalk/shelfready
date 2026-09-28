# Episode 04 — P3 Fixer: proposals, review queue, write-back, before/after

- Date: 2026-09-27 → 2026-09-28
- Phase: P3 (Fixer) of P0–P6
- Time spent: ~4 h (04a build ~2 h; 04b review page + Olu's live review and UX iterations ~2 h)
- Recording: shelfready-ep04-fixer.mp4

## Target
Fix proposals for failing checks, a review queue where a human approves / edits / rejects, approved fixes written to Shopify, and a re-audit that shows the score move.
Done when: an approved fix is visible in Shopify admin and a re-audit shows the store score and band split change vs the run #3 baseline.

## Plan (approved at session start; split to save usage)
- **04a:** proposal model + table → rule proposers (self-tested) → model proposers (grounded) → `npm run propose` → write-back + CLI, tested on 2 products.
- **04b:** `/review` with admin passcode (Olu's call: anyone can view, only an admin can change) → approve, apply, re-audit, before/after on `/audit`.

## What got done
- **Proposal model** (`lib/fixer/types.ts`, `fix_proposals` table, migration 0002): one change type per Admin API write, plus `needs_merchant` for data only the merchant has. A partial unique index keeps one open fix per product + field.
- **Rule fixes** (`lib/fixer/rules.ts`): Size/Color option names, SKUs in the store's own pattern, alt text from title + color, and type/category/tags borrowed from the most similar well-classified product. Duplicate variants go to the merchant. `npm run test:fixer` simulates every rule fix: each rule-fixable defect clears, clean products get nothing, no check gets worse.
- **Model fixes** (`lib/fixer/model.ts`): one call per product that needs it. Attribute values need a verbatim quote from the product data and must parse as their type; rewritten titles may only use words already in the product data; drafted descriptions may only use numbers already in it. Anything that fails is dropped; unfindable attributes become `needs_merchant`.
- **`npm run propose`**: fills the queue from the latest audit; idempotent; paced to the free tier (pacing moved to `lib/ai/pace.ts`, shared with the audit).
- **Write-back** (`lib/shopify/apply.ts`, `lib/fixer/apply.ts`): only approved fixes; per-field conflict check; independent write steps with per-fix status; the product is re-synced after every apply. `npm run fix` CLI: list / approve / reject / retry / apply `--dry-run`.
- **`/review`** (public read-only, admin passcode for changes): HMAC-signed httpOnly session cookie, re-checked inside every Server Action. Product-centric cards with "Product at a glance", draft title in the header, all of a product's fixes with status chips, plain-language "why it matters" and source notes, per-tab "what happens next", edit-before-approve, move-back-to-pending, bulk select / approve / apply.
- **`/audit` before/after** vs the baseline run (same rubric + model): store delta, band table, every changed product with its old title.
- Olu reviewed the whole queue live: 101 fixes approved and applied (1 edited), 2 rejected.

## Decisions made
- Anyone can view the queue; only an admin can change it — Olu's call (DECISIONS.md).
- Model fixes must be grounded in the product's own data or they're dropped (DECISIONS.md).
- Duplicate variants go to the merchant, never auto-deleted (DECISIONS.md).
- Missing type/category borrowed from the most similar product in the store (DECISIONS.md).
- Writes are independent per change, checked per field, with per-fix status (DECISIONS.md).
- Review lifecycle: rejections stick, merchant gaps close themselves, the fixer requires a fresh audit (DECISIONS.md).
- Bulk apply works within a 45 s budget and asks to be clicked again (DECISIONS.md).

## What broke / still rough
- **Missing scope:** alt text needs `write_files`; the app didn't have it. Olu added it to a new app version, but the store only got it after accepting the updated permissions (released ≠ granted — check `currentAppInstallation.accessScopes`).
- **All-or-nothing apply was a fiction:** the first test landed 6 of 8 changes and marked all 8 failed. Fixed with per-step results; the 8 rows were reconciled against live Shopify.
- **Whole-product hash was too coarse:** after some fixes landed, the remaining fixes on that product were refused. Replaced with a per-field check.
- **My mistake — fixer on a stale audit:** I ran `propose` after Olu's bulk apply without re-auditing; it drafted 11 rewrites of already-fixed descriptions. Deleted before review; the fixer now refuses products whose latest audit doesn't match their content. Order is always sync → audit → propose.
- **Merchant gaps never closed / rejected fixes came back:** both found while writing the tab explanations; fixed in `propose`.
- **Review UX, driven by Olu's live review:** raw category ids ("aa-1-10-2-10"), raw attribute encodings (`capacity l: 47`, `{"value":1619,"unit":"GRAMS"}`), unexplained alt text built on a not-yet-approved title, a status-split view that hid approved fixes. All fixed; the alt-text/title dependency is now also enforced when applying.
- Still rough: drafted descriptions can only answer what the data covers (answerability 0.68 on the 13 seeded marketing-only products); "product photo N" fallback alt text when photos don't map to colors; a small risk that later extraction quotes an applied AI draft (logged).
- Bulk apply at full scale ran once, live, through Olu's click — worked (83 fixes, 44 products).

## Numbers (if any)
- **Before/after (same rubric v1, same model):** run #3 → run #5: store score **94.1 → 98.3**; Agent-ready **78% → 99.3%**; Partial 14.7% → 0.7%; Not ready **11 → 0**. Messy products 82.4 → 94.9 avg; clean products unchanged at 100.
- Intermediate run #4 (18 fixes on 6 products): 95.1; avg +23.5 per fixed product; 5 of 6 left Not ready.
- **Queue:** 120 proposals — 101 applied (1 edited by the reviewer), 2 rejected, 1 pending, 15 need the merchant (13 products). 0 failed.
- By defect after fixes (targeted check, clean = 1.00): vague title 1.00, alt text 1.00, taxonomy 1.00, option names 0.96, prose-only attributes 0.91, variant problems 0.85 (duplicates → merchant), missing attributes 0.78 (→ merchant), marketing-only description 0.68.
- **Model usage this episode:** fixer 74 calls, 23.8k in / 5.7k out tokens, 1.1 s avg (incl. 23 wasted on the stale-audit run); audit re-runs 50 calls, 22.8k / 22.4k tokens. $0 on the free tier.

## Next target
Episode 05 — MCP server: `search_products`, `get_product`, `check_availability`, `create_cart` (checkout URL only, no payment), served from a Vercel route, rate-limited.

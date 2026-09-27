# ShelfReady — Decision log

Newest first. Each entry feeds the "Key decisions" section of the case study.

## 2026-09-27 — Rubric v1: half credit for attributes stated only in the description
- Options: metafield or nothing (v0); half credit when the description states the value; full credit either way
- Chose: 0.5 per attribute found only in prose, judged by the model with a required verbatim quote
- Why: agents can read prose but match on it less reliably than on structured fields. Half credit separates "in the description" (fixable by extraction) from "missing" (needs merchant input), which is exactly the split the fixer will act on.
- Trade-offs: check 1 now depends on a model call; mitigated by requiring a quote that must appear in the description

## 2026-09-27 — One model call per product for all LLM judgments
- Options: separate calls for check 2, check 1 prose attributes, and check 4 title content; one combined structured call
- Chose: one call with a per-category Zod schema (`productAuditSchemaFor`)
- Why: 150 calls per full audit instead of ~450 — fits the free tier and keeps latency and cost numbers simple for the case study
- Trade-offs: a larger prompt per call; a malformed response affects three checks at once (retried, then the product is marked as failed rather than scored)

## 2026-09-27 — Audit infers the category from product data, not fixture labels
- Options: read `rubricCategory` from the fixture; infer from product type → Shopify category → title → handle → description
- Chose: infer (`lib/audit/category.ts`)
- Why: a real store has no ground-truth labels, and messy products often lack a product type. 150/150 correct on the seeded catalog.
- Trade-offs: keyword rules need extending for new product kinds; unmatched products are reported as unscored instead of guessed

## 2026-09-27 — Seed resume state lives in Shopify, not in a local progress file
- Options: local progress file listing finished handles; query the store and compare a per-product fixture hash stored in a `shelfready_seed.hash` metafield
- Chose: hash metafield, written in the same `productSet` mutation as the product
- Why: the Episode 02 laptop freeze showed local state can be lost or stale mid-run. The store itself is the only record that can't disagree with the store; a product either has the current hash or gets re-sent. It also makes the seed idempotent (a full re-run is a no-op) and picks up fixture edits.
- Trade-offs: one extra metafield per product, in a separate namespace that sync filters out so it never reaches the audit or agents

## 2026-09-27 — "Duplicate variants" seeded as synonym option values
- Options: exact duplicate option combos; synonym values (`M` / `Medium`, `Black` / `Blk`) that mean the same variant
- Chose: synonyms
- Why: Shopify's API rejects exact duplicate combos, so they can't exist in a real store. Synonyms are the form this defect actually takes in merchant catalogs, and they're what an agent trips over.
- Trade-offs: the audit's variant check has to normalize values to catch them (the detector in `lib/catalog/defects.ts` already does)

## 2026-09-26 — Deterministic catalog generator, no model calls
- Options: generate products with an LLM; hand-write a fixture; seeded-PRNG generator from templates
- Chose: seeded generator (`scripts/generate-catalog.ts`) with a checked-in `fixtures/catalog.json` and `fixtures/ground-truth.json`
- Why: reproducible byte-for-byte, free, and the ground truth is exact because the generator injects each defect itself — the audit and eval are then measured against known answers, not a model's guess
- Trade-offs: copy is more templated than LLM output; 150 products share a small set of phrase patterns

## 2026-09-25 — Neon HTTP driver (`drizzle-orm/neon-http`) for the app
- Options: Neon HTTP driver; Neon WebSocket driver (`neon-serverless` Pool); plain `pg` over TCP
- Chose: HTTP driver
- Why: one stateless HTTPS request per query suits Vercel serverless functions — no connection pool to manage or leak, fast cold starts
- Trade-offs: no interactive transactions (only batched non-interactive ones). If `npm run sync` needs multi-step transactions, use the WebSocket driver for that script only.

## 2026-09-25 — Secret-creating scripts write to `.env.local`, never stdout
- Options: print the new secret for manual copy; write it straight into `.env.local`
- Chose: write to `.env.local` and print only a confirmation (first case: `create-storefront-token.ts`)
- Why: sessions are recorded; a printed token ends up on video and in terminal history
- Trade-offs: the script edits a local file; it refuses to run if the key is already set, so it never overwrites a working token

## 2026-09-25 — Shopify Admin token cached in memory per server instance
- Options: request a token per call; in-memory cache per instance; shared cache in Upstash Redis
- Chose: in-memory cache with expiry, refreshed 5 min early; concurrent callers share one in-flight refresh; one retry with a fresh token on 401
- Why: simplest option that respects the ~24h token lifetime and never requests a token per API call. Redis adds a dependency on the hot path for no gain at demo traffic.
- Trade-offs: each Vercel cold start fetches its own token (a few extra token requests a day). Revisit with Redis if token requests get rate-limited.

## 2026-09-24 — Default model: Gemini free tier (compare models in P5)
- Options: Gemini (free tier); Groq-hosted open models (free tier); paid APIs (Claude, OpenAI); open-weight models run locally (Ollama)
- Chose: Gemini as the default, Groq as the backup, both set in `lib/ai/models.ts`
- Why: zero cost for a high-volume portfolio build (audits, fixes, repeated eval runs); solid structured output; the Vercel AI SDK makes swapping a one-line change. Local models can't serve the live demo (Vercel can't reach a laptop) and are weaker at tool use.
- Trade-offs: possibly lower quality than paid models; free-tier quotas can change; free tiers may use inputs for training (fine for a synthetic catalog)
- Follow-up (P5): run the same 40 eval tasks on Gemini, one Groq open model and Claude (paid API, separate from the Claude Pro plan). Report success rate vs cost per task in the case study.

## 2026-09-24 — Fixer proposes, human approves
- Options: auto-apply AI fixes; human review queue
- Chose: review queue
- Why: wrong product data causes returns and brand damage; approvals also create labeled data to improve the fixer

## 2026-09-24 — Agent never handles payment
- Options: full agent checkout; cart + checkout link
- Chose: `create_cart` returns a Shopify checkout URL
- Why: keeps payment and PII out of the agent path; the shopper confirms on Shopify

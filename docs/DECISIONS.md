# ShelfReady — Decision log

Newest first. Each entry feeds the "Key decisions" section of the case study.

## 2026-09-28 — Review lifecycle: rejections stick, merchant gaps close themselves, fixer needs a fresh audit
- Options: treat each fixer run as independent; carry review decisions forward
- Chose: carry them forward — a rejected fix isn't suggested again while the field it targets is unchanged (admin can move it back to pending); `needs_merchant` items are dropped once the product changes and re-flagged only if the gap is still there; the fixer skips any product whose latest audit doesn't match its current content
- Why: re-suggesting rejected fixes wastes reviewer time and erodes trust; merchant gaps must close without manual cleanup; and running the fixer on a stale audit drafted rewrites of descriptions that had already been fixed (caught and deleted — 11 proposals, never reviewed)
- Trade-offs: the fixed order is sync → audit → propose. Known risk: once an AI-drafted description is applied, later attribute extraction may quote it. Bounded because drafts may only use numbers already in the product data and every draft is human-approved; revisit if drafts start carrying new facts.

## 2026-09-27 — Anyone can view the review queue; only an admin can change it
- Options: public approve/reject; admin passcode on write actions; approvals only from the local CLI
- Chose (Olu): `/review` is read-only for visitors; approve / edit / reject need an admin passcode (`ADMIN_TOKEN`, checked server-side). Until the page ships (Episode 04b), approvals go through `npm run fix`, which needs database credentials.
- Why: the demo should show the queue to anyone, but a public approve button would let any visitor write to the Shopify store
- Trade-offs: a shared passcode, not real accounts — fine for a single-operator demo

## 2026-09-27 — Model fixes must be grounded in the product's own data, or they're dropped
- Options: trust structured model output; require evidence and check it in code
- Chose: check in code — attribute values need a verbatim quote from the product data and must parse as the metafield type; every title word must already appear in the product data; every number in a drafted description must exist in the product data
- Why: a confident wrong spec (a wrong waterproof rating, an invented weight) causes returns; a gap only costs a sale. Anything the data doesn't support goes to the merchant as `needs_merchant`.
- Trade-offs: some reasonable rewrites get dropped (e.g. a title with a synonym not in the data); 15 attribute gaps across 14 products are left for the merchant

## 2026-09-27 — Duplicate variants go to the merchant, never auto-deleted
- Options: auto-delete the synonym duplicate; merge inventory then delete; flag for the merchant
- Chose: flag (`needs_merchant`)
- Why: deleting a variant drops or moves inventory and can break existing orders and links — not a call the fixer should make
- Trade-offs: products with duplicates keep a variant-structure gap until the merchant acts

## 2026-09-27 — Missing product type/category borrowed from the most similar product in the store
- Options: model guesses the type; keyword rules; copy from the most similar well-classified product (shared handle words)
- Chose: nearest well-classified product; its tags are borrowed only when this product's own text contains them
- Why: uses the merchant's own taxonomy (their product types, their category mapping) instead of inventing one, with no model call
- Trade-offs: depends on handle naming; a product with no similar sibling gets no taxonomy proposal

## 2026-09-27 — Apply writes independently per change and records each result
- Options: all-or-nothing batch per product; independent steps with per-change status
- Chose: independent steps; the batch is still refused up front if the product changed since the proposals were made
- Why: Shopify has no transaction across mutations, so "all-or-nothing" was a fiction — the first test apply landed 6 of 8 changes but marked all 8 failed. Per-change status keeps the queue truthful.
- Trade-offs: a product can end up partly fixed; the queue shows exactly which fixes are applied and which failed

## 2026-09-27 — /status checks model keys live, not just presence
- Options: check the env var is set; call each provider's free model-list endpoint on every page view
- Chose: live call (Gemini + Groq `GET /models`, 5 s timeout, key in a header), showing only valid/rejected + HTTP status
- Why: a presence check stayed green while the revoked Groq key was in place; a live check catches revoked or mistyped keys in both `.env.local` and Vercel
- Trade-offs: each view of a public page makes two outbound requests (no tokens, no cost). If the page gets traffic, cache the result for a minute or rate-limit it.

## 2026-09-27 — Band gate: weak checks cap the band
- Options: keep 80/50 cutoffs as-is; raise cutoffs to 95/75; gate on weak checks; regenerate a messier catalog
- Chose: gate — any check < 0.5 caps at Partial, two or more make it Not ready (score cutoffs unchanged)
- Why: the first full audit ranked products correctly (clean 100 vs messy 82 avg) but banded 89% as Agent-ready and 0% Not ready, including products with marketing-only descriptions. The weighted sum lets strong checks hide a fatal gap; the gate encodes the rubric's question ("could an agent confidently match it?") directly. Result: 78% / 15% / 7%.
- Trade-offs: bands no longer follow from the score alone, so the UI must show which check capped a product. Raising cutoffs gave a similar split but with thresholds picked after seeing the data.

## 2026-09-27 — Default audit model: gemini-3.5-flash-lite, paced to 15 RPM
- Options: gemini-3.5-flash; gemini-3.5-flash-lite; Groq gpt-oss-120b
- Chose: flash-lite (Groq as backup), calls spaced 4 s apart with a 30 s backoff on quota errors
- Why: flash was intermittently overloaded (503s, 17–70 s calls) and 2.5 models are closed to new keys. Flash-lite matched the ground truth on every seeded defect (e.g. title content: clean 13/13 pass, vague 0/13). The first unpaced run hit the per-minute quota after ~100 calls.
- Trade-offs: a cold full audit takes ~10 min; re-runs are near-instant thanks to the content-hash cache

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

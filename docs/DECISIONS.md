# ShelfReady — Decision log

Newest first. Each entry feeds the "Key decisions" section of the case study.

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

# ShelfReady — an agent-ready storefront

AI shopping assistants are starting to buy on shoppers' behalf. They can only recommend what they can understand — and most product catalogs were written for people scrolling a page, not for agents filtering on facts. ShelfReady takes a Shopify store and makes it usable by those agents:

1. **Audit** — scores every product 0–100 on what an agent needs: structured attributes, descriptions that answer shoppers' questions, clean variants, specific titles, alt text, taxonomy.
2. **Fix, with a human in the loop** — proposes fixes grounded only in each product's own data (never invented), and a person approves every change before it reaches Shopify.
3. **Open the store to agents** — an MCP server lets Claude or any MCP client search the catalog, check live stock and hand the shopper a Shopify checkout link. It never takes payment.
4. **Measure** — the same shopping tasks run by an AI agent on the messy catalog and the fixed one.

**Live demo:** https://shelfready-ashen.vercel.app — [Audit](https://shelfready-ashen.vercel.app/audit) · [Review queue](https://shelfready-ashen.vercel.app/review) · [Eval](https://shelfready-ashen.vercel.app/eval) · [Status](https://shelfready-ashen.vercel.app/status)
**MCP server:** `https://shelfready-ashen.vercel.app/api/mcp` — add it to Claude (Settings → Connectors → Add custom connector) and ask for gear.

## Results

| | Before | After |
|---|---|---|
| Catalog agent-readiness (audit score) | 94.1 | **98.3** |
| Products "Agent-ready" | 78% | **99.3%** |
| Products "Not ready" | 11 | **0** |
| Agent shopping success (60 tasks × 3 runs, Gemini 3.5 Flash-Lite) | 98.9% | **99.4%** |
| Wrong product bought | 0% | 0% |
| Tokens per shopping task | 9,773 | **9,370** |

- **105 fixes** approved by a human and applied to Shopify; **2 rejected**; **15 gaps left for the merchant** because the information doesn't exist anywhere in the product data — the fixer refuses to invent it.
- A spec-drift audit (`npm run check:fixes`) found and corrected 3 fixes where a unit was lost ("30°F" → "30f"), traced to the fixer treating the URL handle as evidence. The handle is now never evidence.
- **Finding from the eval: agent-readiness is data *and* tools.** Fixing the agent-facing search tool moved the first fair run from 92.5–95% to 98–100% on both catalogs (it had dropped numbers — "6 person tent" returned the cheapest tents — and silently returned nothing for invented attribute names). With good tools a capable agent absorbs most catalog mess and never bought a wrong product in 360 sessions; the remaining failures all trace to missing or damaged facts — including one product whose weight is still a merchant gap, where the agent declined rather than guess.
- **Limitation:** many tasks have 2–4 correct products, so an agent can route around one damaged listing; single-answer tasks would separate the catalogs more sharply. A second model (Groq gpt-oss-120b, free tier) is running in the background and will be added to /eval.

## How it works

```
Shopify dev store ──sync──▶ Postgres (products, raw JSON + content hash)
      ▲                         │
      │                         ├─▶ audit: 7 rule/LLM checks ─▶ scores, bands ─▶ /audit
      │                         ├─▶ fixer: rule + grounded LLM proposals ─▶ review queue ─▶ /review
      │   approved fixes only ◀─┘         (admin approves / edits / rejects)
      │
      └──── Storefront API ◀── MCP server /api/mcp: search_products · get_product ·
                                check_availability · create_cart (checkout URL, no payment)
                                         ▲
                     AI agents (Claude, eval runner on Gemini / Groq)
```

- **Audit** (`lib/audit/`): rubric v1 in [`docs/RUBRIC.md`](docs/RUBRIC.md). One structured model call per product, cached by content hash, so re-audits only pay for what changed. A band gate stops strong scores elsewhere hiding a fatal gap.
- **Fixer** (`lib/fixer/`): rule fixes (option names, SKUs, alt text, taxonomy borrowed from the most similar product) and model fixes (attribute extraction, titles, descriptions). Every model fix is checked in code: attribute values need a verbatim quote, title words and numbers must exist in the product's own text, specs must keep their units.
- **Review** (`/review`): anyone can view; approve / edit / reject / apply need an admin passcode (HMAC-signed session, re-checked in every server action). Per-field conflict checks; each change records its own result.
- **MCP** (`mcp/`): compact, structured tool results; public, rate-limited (Upstash, 60 req/min/IP); every call logged.
- **Eval** (`evals/`): 40 shopper requests generated from ground truth (25 aimed at seeded-messy products, 10 clean controls, 5 where nothing fits), an AI SDK agent loop over the same tools, scored against the true product data; resumable, repeated runs.

Key decisions and their trade-offs are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md); each build session in [`docs/sessions/`](docs/sessions/).

## Stack

Next.js (App Router) + TypeScript + Tailwind on Vercel · Vercel AI SDK (Gemini 3.5 Flash-Lite default, Groq gpt-oss-120b backup) · Neon Postgres + Drizzle · Upstash Redis · Shopify Admin API (GraphQL) + Storefront API · MCP via `mcp-handler`.

## Run it yourself

Requires Node 20+, a Shopify dev store with a Dev Dashboard app (client-credentials grant), a Neon database, an Upstash Redis database and a Gemini and/or Groq API key.

```bash
npm install
cp .env.example .env.local          # fill in the values
npm run db:migrate                  # create tables
npm run create:storefront-token     # one-off: writes SHOPIFY_STOREFRONT_TOKEN into .env.local
npm run seed                        # load the 150-product demo catalog (idempotent) and publish it
npm run sync                        # pull it into Postgres
npm run audit                       # score it
npm run propose                     # fill the review queue, then review at /review
npm run eval -- --repeat 3          # agent shopping eval, before vs after
npm run dev
```

The full command list is in [`CLAUDE.md`](CLAUDE.md). Pipeline order is always **sync → audit → propose → review → check:fixes**.

## Guardrails

- Nothing writes to Shopify except `npm run seed` (demo data) and fixes a person approved.
- The MCP server never handles payment or customer data — `create_cart` returns a Shopify checkout URL and stops.
- Model output that becomes data is structured (Zod) and checked against the source text in code.
- Secrets live only in `.env.local` and Vercel environment variables.

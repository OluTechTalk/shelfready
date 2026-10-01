# Case study — Making a Shopify store usable by AI shopping agents

*A forward-deployed-engineering style engagement, built solo over eight episodes. Live: [shelfready-ashen.vercel.app](https://shelfready-ashen.vercel.app) · Code: this repo.*

## The customer problem

An outdoor-gear brand (150 products) hears that shoppers are starting to buy through AI assistants. Its catalog was written for people scrolling a page: vague titles ("Cozy Layer!!!", "NEW BOOTS 2024"), sizes and materials buried in prose or missing, inconsistent variant names ("Sz", "Colour"), marketing-only descriptions ("Adventure awaits!"), photos named `IMG_5999.jpg`. An agent asked for "waterproof hiking boots, men's 10, under $150" has to guess — or skip the store.

The brief: show the gap, close it without inventing product facts, and open the store to agents — then prove whether it mattered.

## Discovery: an audit agents would agree with

I wrote a rubric around one question — *could an agent, given only this product's data, confidently match it to a request and answer follow-ups?* — and scored every product 0–100 on seven checks: structured attributes, description answerability, variant structure, title specificity, price/stock, image alt text and taxonomy.

- Rule checks run in code; the three judgment calls (does the description answer the 5 shopper questions, is a fact only in prose, is the title specific) run in **one structured model call per product**, cached by content hash so re-audits only pay for what changed.
- Every model claim must quote the source text; a quote that isn't there doesn't count.
- The first audit banded 89% of products "Agent-ready" — including products whose whole description was "Adventure awaits!". A weighted sum let strong checks hide a fatal gap, so I added a **band gate**: any check below 0.5 caps a product at Partial. Baseline: **94.1 / 100, 78% agent-ready, 11 not ready.**

The demo catalog was generated deterministically with a known ground truth (which defects each product has, and the clean version of every product), so every later claim could be checked, not just asserted.

## Fixing it — without inventing facts

A fixer proposes changes; **a person approves every one** before anything reaches Shopify.

- **Rule fixes** for mechanical gaps: option names → Size/Color, SKUs in the store's own pattern, alt text from title + color, product type and category borrowed from the most similar product in the store.
- **Model fixes** for the rest: extract attributes stated in the text, rewrite vague titles, draft descriptions for marketing-only copy. Every value is **checked in code**: attribute values need a verbatim quote, title words must already exist in the product's text, numbers and units must match.
- What can't be fixed from the product's own data — 15 missing facts, 4 duplicate variants — goes to the merchant as **"needs merchant"**, never guessed.
- A review queue (`/review`) shows the product whole: the current state, every proposed change with why it matters to a shopper, and its status. Anyone can view; only an admin can approve, edit, reject or apply.

The client reviewed and applied **105 fixes** (2 rejected). Readiness went **94.1 → 98.3**, agent-ready **78% → 99.3%**, not ready **11 → 0**.

## Opening the store to agents

A public **MCP server** (`/api/mcp`) gives any agent four tools: `search_products` (text plus structured filters on the attributes we fixed), `get_product`, `check_availability` (live) and `create_cart`, which returns a Shopify checkout URL — the agent never handles payment. Rate-limited per IP; every call logged.

Claude, connected as a custom connector, was asked for "waterproof hiking boots, men's 10, under $150". It reported honestly that no *boot* fit the budget, offered a low-cut waterproof shoe as the closest match, and returned a working checkout link — possible only because product type and waterproofing were structured data.

## Did it matter? The eval

60 shopper requests with verified answers (25 aimed at seeded-messy products, 10 clean controls, 5 where nothing fits, 20 where the deciding fact lives only in a structured attribute), run by an agent through the same tools on the **original messy catalog** and the **fixed** one — same tasks, same model, 3 runs each (360 sessions, Gemini 3.5 Flash-Lite):

| | Before | After |
|---|---|---|
| Right product in the cart | 98.9% | **99.4%** |
| Wrong product bought | 0% | 0% |
| Tokens per task | 9,773 | **9,370** |

## What surprised me

1. **The tools mattered more than the data.** The first fair run scored 95% → 92.5% — *after* worse than before. The failures were the search tool, on both catalogs: it dropped numbers ("6 person tent" returned the cheapest tents) and silently returned nothing for invented attribute names. Keeping numbers and returning the valid names instead of zero results moved both catalogs to 98–100%. Agent-readiness is the data **and** the interface agents use.
2. **A capable agent absorbs most mess.** With good tools it never bought a wrong product in 360 sessions. What it can't get past is **missing facts** — every remaining failure traced to one, including a product whose weight is still a merchant gap, where the agent declined rather than guess.
3. **Grounding has holes you only find by auditing the output.** A live review spotted "Lynx **30f** Synthetic Sleeping Bag". Root cause: the fixer treated the URL handle (`lynx-30f-…`) as product text, so a bad attribute was "quoted" from the slug and then made the bad title look grounded. I added a spec check (numbers *and* units must match the product's own text; the handle is never evidence) and an audit of every fix already applied — 3 of 50 were wrong and were corrected through the queue.
4. **The eval harness needs as much scrutiny as the system.** An early "before" score was unfairly low because stand-in product ids exceeded the tools' 80-character limit — the agent found the right item but couldn't cart it. Found from a crash, fixed, and the run discarded.

## Key decisions

- **Human approval on every write**, and model output checked in code against the source — a confident wrong spec causes returns; a gap only costs a sale.
- **Fail closed when money or abuse is at stake**: the public chat (`/playground`) and the MCP server refuse to run unthrottled; the playground falls back to recorded replays of real sessions instead of erroring.
- **Measure before claiming**: a deterministic catalog with ground truth, repeated runs with spreads, and every number in this write-up traceable to a stored run.
- Full log with options and trade-offs: [DECISIONS.md](DECISIONS.md).

## Costs

All model calls are logged with tokens and cost. The free tiers carried the build until Gemini's free tier became unreliable under load; the paid tier (Gemini 3.5 Flash-Lite, $0.30 / $2.50 per million tokens) cost about **$1.50** for every eval run including discarded ones, about **$0.002** per playground answer, and the public playground is capped at **~$0.50/day**.

## What I'd do next

- **Range filters in search** — a recorded demo answer called 20°F bags the warmest because search returned top matches, not extremes; a `sort` option (cheapest, lightest, warmest, largest) now fixes superlatives. Numeric ranges ("under 1 kg", "at least 30 L") are next.
- **Single-answer eval tasks** — many tasks had 2–4 correct products, so an agent could route around one damaged listing; sharper tasks would separate the catalogs more.
- **A merchant input step** for the 15 gaps the fixer refused to invent.
- **A second model in the eval** — Groq gpt-oss-120b is running on the free tier and will be added to `/eval`.

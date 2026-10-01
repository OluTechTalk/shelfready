# Loom walkthrough — script and shot list (3–4 min)

Base URL: https://shelfready-ashen.vercel.app. Open every tab before recording; use a fresh browser profile (no extensions, light mode). Check `/status` says "All systems go" first.

| # | Time | Screen | Say (roughly) |
|---|---|---|---|
| 1 | 0:00–0:20 | `/` (home) | "AI assistants are starting to shop for people. They can only recommend what they can understand, and most catalogs were written for people scrolling a page. ShelfReady takes a Shopify store and makes it usable by agents. Here's a 150-product outdoor store, start to finish." |
| 2 | 0:20–0:55 | `/audit` → open one Not-ready product from the *before* run | "First, an audit. Every product scored 0–100 on what an agent needs: structured facts, descriptions that answer shopper questions, clean variants. This one says 'Adventure awaits!' and nothing else — an agent can't answer a single question about it. Baseline 94 out of 100, 11 products effectively invisible." |
| 3 | 0:55–1:40 | `/review` → one product card with several fixes | "Then fixes — but the AI only proposes. Every value has to be grounded in the product's own text: a quote for each attribute, no new words in titles, numbers and units checked in code. If the fact isn't there, it goes to the merchant instead of being guessed. A person approves every change before anything reaches Shopify. 105 applied; readiness 94 → 98, zero products left not ready." |
| 4 | 1:40–2:40 | `/playground` → click "What's the warmest down sleeping bag…", then "the Equinox, regular" | "Then I opened the store to agents over MCP: search, product details, live stock, cart. This is an agent shopping through exactly those tools. Watch it filter on structured data and sort for 'warmest' — that sort exists because an earlier demo answer got this wrong. … It checks live stock and hands back a real Shopify checkout link. It never touches payment." |
| 5 | 2:40–3:20 | `/eval` | "Did it matter? 60 shopping tasks, run by an agent on the messy catalog and the fixed one, three times each. 98.9 → 99.4% right product, zero wrong products. The bigger finding: my first run got *worse* after the fixes — the problem was my search tool, not the data. Agent-readiness is the data and the tools." |
| 6 | 3:20–3:45 | `/case-study` (scroll to "What surprised me") | "The full write-up — decisions, costs, what broke — is in the case study, and the code is public. Thanks for watching." |

**Backup:** if the playground shows "Recorded replay", say so — "the live budget is capped, so this is a recording of a real session" — and keep going.

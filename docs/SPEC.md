# ShelfReady — Spec

## Customer story
A mid-size outdoor-gear brand hears shoppers are starting to buy through AI assistants. Its catalog has vague titles, missing sizes and materials, and inconsistent variants, so agents skip its products. ShelfReady shows the gap and closes it.

## Demo setup
Shopify development store (created in the Dev Dashboard) seeded with ~150 outdoor-gear products; about a third deliberately messy (vague titles, missing attributes, broken variants, no alt text).

## MVP features
1. **Readiness audit** — score each product 0–100 against `docs/RUBRIC.md` (required attributes, structured variants, specific title, description answers common shopper questions, image alt text, price/stock present). Show a store-level score and the worst offenders.
2. **AI fixer + review queue** — model proposes structured fixes per product (fill attributes from description, rewrite title, normalize variants). Human approves / edits / rejects each; approved fixes are written back via the Admin API.
3. **MCP server** — tools: `search_products`, `get_product`, `check_availability`, `create_cart` (returns a Shopify checkout URL; no payment).
4. **Shopper playground** — chat panel where a demo agent shops the store through the MCP server.
5. **Demo safety** — Upstash rate limit on model routes; demo mode serves cached results.

## Out of scope (v1)
Real payments, multiple stores, non-Shopify platforms, OAuth app install flow.

## Eval
- 40 shopping tasks, each with the correct product(s), e.g. "waterproof hiking boots under $150 in men's 10".
- Metrics: task success (right product in cart), steps per task, wrong-product rate, tokens/cost per task.
- Run on the messy catalog (before) and the fixed catalog (after); same tasks, same model.
- Headline: "Catalog readiness X → Y; agent shopping success X% → Y%."

## Phases
| Phase | Goal | Done when |
|---|---|---|
| P0 Setup | Repo, Vercel, Shopify dev store, Neon | Live URL + API token returns products |
| P1 Catalog | 150 seeded products, ~1/3 messy | Catalog synced into Postgres |
| P2 Audit | Rubric + scoring + dashboard | Store score + worst offenders in UI |
| P3 Fixer | Proposals, review queue, write-back | Approved fix visible in Shopify admin |
| P4 MCP | 4 tools on Vercel | Claude can search and add to cart |
| P5 Eval + demo | Task set, before/after, rate limit, demo mode | Before/after chart in app |
| P6 Ship | Case study, Loom, launch post | README + post live |

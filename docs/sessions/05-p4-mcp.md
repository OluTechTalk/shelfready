# Episode 05 — P4 MCP: shopping tools, live endpoint, Claude buys a shoe

- Date: 2026-09-28
- Phase: P4 (MCP) of P0–P6
- Time spent: ~2.5 h (incl. two Shopify permission round-trips and the spec-drift fix)
- Recording: shelfready-ep05-mcp.mp4

## Target
An MCP server on Vercel with 4 tools — `search_products`, `get_product`, `check_availability`, `create_cart` (Shopify checkout URL, no payment).
Done when: Claude, connected to the live MCP URL, finds "waterproof hiking boots, men's 10, under $150" and returns a working Shopify checkout link.

## Plan (approved at session start)
1. Storefront API client (availability, `cartCreate` → checkout URL).
2. The four tools as plain functions over a swappable `ProductSource` (Postgres mirror now; the original messy fixture for the P5 "before" run).
3. MCP endpoint at `/api/mcp`.
4. Upstash rate limit, body-size limit, `mcp_calls` log.
5. Connect Claude end-to-end; `/status` check.
Packages approved: `mcp-handler` (v2) + `@modelcontextprotocol/server` (v2 — the handler's required SDK; `@modelcontextprotocol/sdk` 1.x doesn't fit), `@upstash/ratelimit`, `@upstash/redis`. Olu chose a public MCP URL; search reads the Postgres mirror (my recommendation, taken by default).

## What got done
- **`lib/shopify/storefront.ts`**: live variant availability and `cartCreate` → checkout URL. `npm run check:storefront` smoke test (throwaway cart, no order).
- **`mcp/tools.ts` + `mcp/source.ts`**: search with text + structured filters (type, gender, size, color, price, waterproof, any attribute) — structured data only, so a missing attribute means a missed match; `get_product`; live `check_availability`; `create_cart` (validates variant ids, returns the checkout URL, never payment).
- **`/api/mcp`** (`mcp/server.ts`): Streamable HTTP via `mcp-handler`, agent instructions for the search → details → availability → cart flow; Upstash sliding window 60 req/min/IP (429 + Retry-After); 413 over 64 KB; every tool call logged to `mcp_calls` (migration 0003).
- **Seed publishes to the Online Store channel** (idempotent) — products were Active but on no sales channel, so the Storefront API saw an empty store. `/status` gains a Storefront API check.
- **Live test in claude.ai (custom connector):** 7 tool calls; Claude found no *boot* under budget, offered the Cascade Low Waterproof Hiking Shoe ($115.95) as the closest match, and returned a working checkout link. Follow-up: instructions now say to ask for the variant before creating a cart (Claude had made one per color).
- **Spec-drift fix (from Olu's catch of "Lynx 30f"):** titles and attributes must match the product's own text in number and unit; the URL handle is never evidence. `npm run check:fixes` audits every fix already written against the original seeded text — 3 of 50 were wrong (Lynx attribute + title, Aspen "30 Degree"); corrections approved and applied (Olu edited the attribute to "30°F / -1°C"); re-check: 0 issues.

## Decisions made
- Search reads the Postgres mirror, not Shopify search; availability and carts stay live (DECISIONS.md).
- Public MCP URL, rate-limited, no auth — read-only plus carts, no payment or customer data (DECISIONS.md).
- Products are published to Online Store by the seed, not by hand (DECISIONS.md).
- Specs must survive a fix exactly; the handle is never evidence (DECISIONS.md).

## What broke / still rough
- **Store invisible to shoppers:** Active ≠ published. Needed `read_publications` / `write_publications` — second scope round-trip this project (release a version, then accept on the store).
- **`mcp-handler` 2.x needs MCP SDK v2** (`@modelcontextprotocol/server`), not `@modelcontextprotocol/sdk` 1.x — swapped after reading its README.
- **"Lynx 30f":** the fixer's evidence check accepted the URL handle as product text, so a bad attribute ("30F") was "quoted" from the slug and then grounded a bad title. Found by Olu in the live Claude session; root-caused, prevented, and audited across all fixes. A first version of the spec check was far too strict (45 false flags on "28L" / "3-Person") before unit normalization.
- **Gemini overload** made one re-audit take three attempts (partial runs are never saved — worked as designed).
- Text search is loose (any token scores); fine with structured filters, weaker for free-text-only queries. Revisit in P5 if the eval shows it.
- `get_product` latency logs as 0 ms (served from the per-instance cache) — fine, but not comparable with live tools.

## Numbers (if any)
- **Target task, live:** 1 structured search → 1 match; size 10 in stock (27); cart $115.95; checkout URL returned.
- **Claude's own session:** 7 tool calls (3 search, 1 get_product, 1 availability, 2 carts); tool latency: search ~270 ms, availability ~180 ms, cart ~430 ms.
- **Protection tested locally:** 60 requests/min then 429; 413 over 64 KB; forged/oversized inputs rejected.
- **Catalog:** run #6 — store 98.3, Agent-ready 99.3%, Not ready 0 (unchanged by the spec corrections, which fixed accuracy the score can't see). Fix queue: 105 applied, 2 rejected, 15 need the merchant, 0 pending. `check:fixes`: 0 issues across 50 live fixes.

## Next target
Episode 06 — Eval + demo: 40 shopping tasks through the MCP tools on the original messy catalog vs the fixed one (same model), success rate, steps, wrong-product rate, cost; before/after chart in the app; demo mode.

# Episode 01 — P0 setup: Shopify auth, Neon + Drizzle, health page, Vercel deploy

- Date: 2026-09-25
- Phase: P0 (Setup) of P0–P6
- Time spent: ~3 h
- Recording: shelfready-ep01-p0-setup.mp4

## Target
Shopify auth with token refresh, Neon + Drizzle connection, `/status` health page, deploy to Vercel.
Done when: the live `vercel.app` URL shows `/status` all green.

## What got done
- Deps: `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, `tsx`; added `npm run typecheck`
- Shopify auth (`lib/shopify/auth.ts`): client credentials grant, token cached with expiry, refreshed 5 min early, concurrent callers share one refresh
- Admin client (`lib/shopify/admin.ts`): typed `adminGraphQL<T>()`, retries once with a fresh token on 401; `getShopSummary()` for shop name + product count. Smoke test: `npm run check:shopify`
- Storefront token: `npm run create:storefront-token` creates it via `storefrontAccessTokenCreate` and writes it straight into `.env.local` (never printed)
- Database (`lib/db/`): `products` (GID, handle, raw JSON, content hash, synced_at) and `model_calls` (model, provider, route, tokens in/out, latency, cost, created_at). Migration `drizzle/0000_*` applied to Neon via `npm run db:migrate`
- `/status` page: live checks for Shopify, DB and model key (presence only), rendered per request via `connection()`; errors are length-capped and credential-scrubbed
- Deployed to Vercel: https://shelfready-ashen.vercel.app/status — all green
- Helper 1 finished `lib/audit/rubric.ts` (rubric v0 as typed constants + Zod schemas) on branch `bg/rubric-v1` (`85a2d63`) — pushed, not merged. Merge in Episode 03 after adding `zod`, then run `npm run lint && npm run typecheck`

## Decisions made
- Shopify token cached in memory per server instance, not Redis — simplest thing that respects the 24h lifetime (DECISIONS.md)
- Scripts that create secrets write them to `.env.local` instead of printing them — keeps secrets off camera and out of terminal history (DECISIONS.md)
- Neon HTTP driver over WebSocket/TCP — stateless per-query requests suit serverless; no interactive transactions (DECISIONS.md)
- DB client is created lazily so a missing `DATABASE_URL` shows as a red check instead of crashing the page

## What broke / still rough
- First Vercel deploy had no env vars; the domain returned `DEPLOYMENT_NOT_FOUND` until a redeploy, then `/status` surfaced each missing var by name (`SHOPIFY_CLIENT_ID`, then `SHOPIFY_API_VERSION`) until all were added
- `bg/rubric-v1` imports `zod`, which isn't installed on `main` yet — the branch won't typecheck until it's added (Episode 03)
- Root layout title still says "Create Next App"
- Stray old scaffold at `C:\Users\oluak\shelfready` (outside `Projects`) — safe to delete
- `/start-session` only loads when Claude Code is started inside the repo

## Numbers (if any)
- Shopify: 0 products; Postgres: 0 products synced; no model calls yet
- Cached token lookup: ~0 ms after the first request

## Next target
Episode 02 — generate the messy demo catalog (RUBRIC.md seeded defects) and seed it with `npm run seed`.

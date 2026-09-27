# ShelfReady — Agent-Ready Storefront

Portfolio project. ShelfReady audits a Shopify store's catalog for how well AI shopping agents can use it, fixes the gaps with AI + human approval, and exposes the store to agents through an MCP server. The goal is a live demo, a public repo, eval numbers, and a case study that reads like a forward-deployed-engineering engagement.

Detailed scope lives in @docs/SPEC.md. Scoring rules live in @docs/RUBRIC.md (v0 draft; finalized in Session 03).

## Current status
<!-- /end-session updates this block. Keep it to 5 lines. -->
- Phase: P2 Audit (done) — baseline run #3: store 94.1, 78% ready / 15% partial / 7% not ready; live at /audit
- Last session: 03 — rubric v1 + band gate, 7 checks, cached per-product model judgment, `npm run audit`, /audit page
- Next target: Episode 04 — Fixer + review queue (structured proposals, approve/edit/reject, Admin API write-back, re-audit)
- Blockers: none (Gemini free tier ~15 RPM — full cold audit ≈ 10 min)

## Stack
- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, deployed on Vercel Hobby
- Vercel AI SDK for all model calls; default model set in `lib/ai/models.ts` (free tier: Gemini / Groq / OpenRouter)
- Neon Postgres via Drizzle ORM; Upstash Redis for rate limiting
- Shopify Admin API (GraphQL) for catalog read/write; Storefront API for carts and checkout links

## Shopify auth (important — changed in 2026)
- The app is created in the Shopify **Dev Dashboard**, not the store admin (legacy admin-created custom apps can't be created after Jan 1, 2026).
- Admin API tokens come from the **client credentials grant**: `POST https://{SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token` with `grant_type=client_credentials`, `client_id`, `client_secret` (form-encoded).
- Tokens **expire after ~24 hours**. `lib/shopify/auth.ts` must cache the token with its expiry and refresh it a few minutes early. Never request a token per API call.
- Only works when the app and dev store are in the same Dev Dashboard organization.
- Storefront API token: create it once through the Admin API (`storefrontAccessTokenCreate`) and store it as `SHOPIFY_STOREFRONT_TOKEN`.
- MCP server in `mcp/`, served from a Vercel route
- Evals in `evals/`, run locally and in GitHub Actions

## Repo layout
- `app/` — UI pages and API routes
- `lib/shopify/` — Admin + Storefront API clients
- `lib/audit/` — rubric checks and scoring
- `lib/fixer/` — AI fix proposals (structured output only)
- `mcp/` — MCP tools: search_products, get_product, check_availability, create_cart
- `evals/` — shopping task set, runner, results
- `scripts/` — seed catalog, sync to Postgres
- `docs/` — spec, rubric, decisions, session logs

## Commands
- `npm run dev` — local app
- `npm run lint && npm run typecheck` — run before every commit
- `npm run check:shopify` — smoke test Shopify auth (shop name + product count)
- `npm run db:generate` / `npm run db:migrate` — create / apply Drizzle migrations
- `npm run create:storefront-token` — one-off; writes `SHOPIFY_STOREFRONT_TOKEN` into `.env.local`
- `npm run generate:catalog` — regenerate `fixtures/catalog.json` + `fixtures/ground-truth.json` (deterministic)
- `npm run seed` — push the demo catalog to the Shopify dev store (idempotent; re-run to resume)
- `npm run sync` — pull the catalog into Postgres
- `npm run verify:catalog` — check Shopify/Postgres counts and seeded defects against the ground truth
- `npm run test:audit` — rule checks vs the ground truth (no model calls)
- `npm run audit` — score the synced catalog and store the run (model calls cached by content hash)
- `npm run eval` — run the shopping task set and write results to `evals/results/`

## Rules
- Work in small slices. Propose a plan before writing code, and wait for my OK on anything touching more than 3 files.
- Never write to Shopify without going through the review queue. The fixer only proposes; a human approves. (Only exception: `npm run seed`, which loads the demo catalog.)
- The MCP server never handles payment. `create_cart` returns a Shopify checkout URL and stops there.
- All model output that becomes data must use structured output (Zod schemas), never free-text parsing.
- Secrets live only in `.env.local` and Vercel env vars. Never print, log or commit them. Keep `.env.example` up to date.
- Every public API route that calls a model is rate-limited (Upstash) and has a demo-mode fallback that serves cached results.
- Log tokens and latency for every model call to the `model_calls` table — the case study needs cost numbers.
- Keep dependencies minimal; ask before adding a new package.
- When you make a real tradeoff, add a dated entry to `docs/DECISIONS.md` (decision, options considered, why).

## Session workflow
- Start with `/start-session`: read this file, the latest file in `docs/sessions/`, and `docs/DECISIONS.md`, then restate today's target.
- End with `/end-session`: write the session log, update "Current status" above, and suggest a commit message.

## Next.js version notes
@AGENTS.md

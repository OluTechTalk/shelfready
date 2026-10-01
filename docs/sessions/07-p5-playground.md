# Episode 07 — P5 Demo: shopper playground with a budget and recorded replays

- Date: 2026-09-29 → 2026-09-30
- Phase: P5 (Eval + demo) of P0–P6 — closes P5
- Time spent: ~3 h
- Recording: shelfready-ep07-playground.mp4

## Target
A public /playground where anyone chats with an AI shopping agent that shops the store through the MCP tools — rate-limited, budget-capped, with a cached demo-mode fallback.
Done when: live chat finds products and returns a real checkout link; tool steps visible; over-limit or DEMO_MODE=true serves recorded replays; every model call logged with cost.

## Plan (approved at session start)
1. Chat API (same tools and wording as the MCP server, step/length caps, cost logging). 2. Protection (per-IP limit + daily budget, falling back to replays). 3. Demo mode (record real answers to suggested prompts, replay them). 4. Playground UI. 5. Test and ship.
Olu's calls: add `@ai-sdk/react`; real Shopify carts; 200 messages/day budget.

## What got done
- **`/api/chat`**: streams Gemini with the four MCP tools (real carts, checkout URL only); ≤ 8 steps, ≤ 500 chars, last 12 messages; every live call logged to `model_calls` (route `playground`) with cost.
- **Protection** (`lib/playground/config.ts`): Upstash sliding window 10 messages / 10 min per IP and a fixed window of 200 / day site-wide. Over either, in `DEMO_MODE`, or with no limiter configured → a recorded replay, never an error.
- **Demo replays** (`playground_replays`, migration 0005): the first live answer to each suggested prompt is saved as its exact UI-stream chunks and replayed with a "Recorded replay" label. Four recorded and checked against ground truth.
- **`/playground`** (`useChat`): tool steps as cards — search filters + product cards, live stock, cart with a "Go to Shopify checkout" button; suggested-prompt chips; `/playground?q=…` starts a conversation from a link; Markdown links render as labels. Linked from the nav and landing page.
- **`/status`** gains an Upstash check (rate limits active or not).
- Browser testing via a small Chrome DevTools-protocol script (no new packages): a live two-turn chat from "3-season tent for 2" to a real $292.95 cart; replay rendering in demo mode.

## Decisions made
- Live agent with a per-IP limit and a daily budget; recorded replays of real sessions as the fallback (DECISIONS.md).
- Real carts in the playground, like the MCP server (Olu).
- The playground fails closed (replays only) when no limiter is configured, because it spends money.

## What broke / still rough
- **Rate limit silently off:** a module-level variable named `global` shadowed Node's global in the Next bundle, so the per-IP limiter never blocked (11 of 11 requests went live). Works in a plain script, fails only when bundled. Renamed; the 11th request now replays.
- **A wrong answer almost became a demo replay:** "What's the warmest down sleeping bag?" → "20°F", but the store has 0°F bags. Search returns the 5 most relevant results, not the extreme, so superlatives ("warmest", "lightest", "cheapest") are unreliable. Replay deleted, prompt replaced with a verifiable one. **Follow-up: add a sort option to `search_products`.**
- **Replay label vanished** after replay: the recording carried per-chunk "live" metadata. Replays now strip it.
- **Production had no Upstash keys:** the playground correctly fell back to replays, but the MCP route — which fails open without a limiter — was unthrottled in production with nothing on /status saying so. Olu added the keys; /status now checks. **Follow-up: decide whether the MCP route should also fail closed.**
- **Groq blocked by a VPN** (HTTP 403 "check your network settings") on the first background evening; fine after the VPN was turned off.
- Headless screenshots can't show streaming (virtual time freezes timers); solved with the CDP script.

## Numbers (if any)
- Playground model calls so far: 28, 49k in / 1.6k out tokens, **$0.019** total, ~1.1 s average (incl. tests and replay recording). A typical first answer ≈ 3.3k tokens ≈ $0.0014.
- Worst-case spend: 200 messages/day ≈ $0.50/day.
- Groq background eval: 34 / 60 "before" tasks done after evening 2; finishes ~Oct 3.

## Next target
Episode 08 — P6 Ship: case study write-up, Loom walkthrough, launch post; add Groq to /eval when it completes; small follow-ups (search sort option, MCP fail-closed decision).

# Episode 08 — P6 Ship: public repo, case study, launch kit

- Date: 2026-09-30 → 2026-10-02 (log written 2026-10-17)
- Phase: P6 (Ship) of P0–P6
- Time spent: ~3 h across three short sessions (usage-limited)
- Recording: deferred (Olu chose to record the Loom later)

## Target
Turn the finished build into something a visitor understands in three minutes and can click through: case study, public-ready repo, README with screenshots, Loom script and launch posts.
Done when: case study in the repo and on the site, README shows the product, repo scanned clean, launch drafts ready.

## What got done
- **Public-ready repo** (`d4b29f9`): full git history scanned for secret-like strings (Groq, Google, Shopify, Upstash tokens, credentialed database URLs, admin token) — none; the only env file ever committed is `.env.example`, which covers every variable the code reads. MIT license. Unused create-next-app assets removed.
- **MCP fails closed** without a rate limiter in production (503), open in local dev.
- **Case study** (`docs/CASE_STUDY.md`, `e983378`): problem → audit → grounded fixes with human review → MCP → eval → what surprised me → key decisions → costs → what's next. Every number traces to a stored run.
- **Search sort** (`b4e1302`): `search_products` takes `sort` = price_low | price_high | lightest | warmest | largest; products missing the value sort last. The "warmest down sleeping bag" playground prompt is back, with a replay naming the three 0°F bags and their true weights.
- **`/case-study` page** (`4863c31`): static, prerendered from the same Markdown file with a small in-repo renderer (no new package). Mobile header fixed (logo mark + horizontally scrolling nav).
- **README** (`e6d6bd1`, `1145ff2`): screenshots (playground, audit, review, eval) from a production build, links to playground and case study, How-it-works covers the playground and sort; eval correctly described as 60 tasks.
- **Launch kit** (`docs/launch/`, `02393c9`): 3¾-minute Loom shot list with what to say per screen, a LinkedIn post and an X/Bluesky thread.
- Production verified: all pages 200, `/status` all green, repo publicly visible.

## Decisions made
- MCP fails closed; MIT license (DECISIONS.md, 2026-09-30).
- Sort puts products missing the value last — a listing without the fact can't win "lightest" by accident (DECISIONS.md, 2026-10-17).
- Case study lives in both the repo and the site, one Markdown source.
- Loom recording deferred by Olu; nothing on the site depends on it.

## What broke / still rough
- **Groq background eval stalled silently.** The scheduled task ran Oct 2–4 and reported success each time, but added no results (stuck at 50/60 "before", 0/60 "after"). The log lived in %TEMP% and was gone, so the cause can't be confirmed (likely VPN or sleep). Fixed in Episode 09: logs in the repo and a nightly one-line summary.
- The previous `/end-session` produced no log; this file was written afterwards from git history.
- Playground agent sometimes flattens numbered lists into bullets in the renderer — cosmetic.

## Numbers (if any)
- Playground: ~$0.002 per answer; worst case $0.50/day under the 200-message cap.
- Groq eval (gpt-oss-120b): 50/60 "before" tasks done, 44 successes; "after" not started.

## Next target
Episode 09 — finish the Groq comparison reliably (nightly runs with visible logs), add it to /eval and the case study, close P6.

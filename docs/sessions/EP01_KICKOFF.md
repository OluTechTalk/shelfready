# Episode 01 — kickoff (P0 Setup)

Prereq: everything in `docs/SETUP_CHECKLIST.md` is done.

## Before you hit record (Windows / PowerShell)
1. The starter kit (`CLAUDE.md`, `.claude\`, `docs\`, `.env.example`) already lives in `C:\Users\oluak\Projects\shelfready`, and `create-next-app` refuses a folder that has those files in it. So move the kit aside, scaffold, then copy it back (from `C:\Users\oluak\Projects`):
   ```powershell
   Rename-Item shelfready shelfready-kit
   npx create-next-app@latest shelfready
   ```
   Choose TypeScript, ESLint, Tailwind, App Router, `src/` = No, import alias default. (The folder name must be lowercase — npm rejects capital letters in project names.)
2. Copy the kit back in, overwriting any agent files the scaffold created, then check it landed and remove the spare copy:
   ```powershell
   Copy-Item shelfready-kit\* shelfready -Recurse -Force
   Get-ChildItem shelfready -Force   # should show CLAUDE.md, .claude, docs, .env.example
   Remove-Item shelfready-kit -Recurse
   cd shelfready
   ```
3. `Copy-Item .env.example .env.local` and paste your keys (off camera).
4. Git: `create-next-app` already ran `git init` and made an initial commit, so skip `git init`. Its `.gitignore` ignores `.env*`, which would hide `.env.example` — un-ignore it, confirm `.env.local` stays ignored, then commit and push:
   ```powershell
   Add-Content .gitignore "`n!.env.example"
   git status   # .env.example should appear; .env.local must NOT
   git add -A
   git commit -m "chore: scaffold + project docs"
   git remote add origin https://github.com/OluTechTalk/shelfready.git
   git branch -M main
   git push -u origin main
   ```

## On camera
Open Claude Code in the repo and run:

```
/start-session Episode 01 — P0 setup: Shopify auth with token refresh, Neon + Drizzle connection, health page, deploy to Vercel
```

Approve a plan that covers these slices (commit after each):

1. **Shopify auth** — `lib/shopify/auth.ts` (client credentials grant, cached token, refresh ~5 min before expiry) and `lib/shopify/admin.ts` (typed GraphQL fetch). Test: fetch shop name + product count.
2. **Storefront token** — one-off `scripts/create-storefront-token.ts` using `storefrontAccessTokenCreate`; you paste the result into `.env.local` (off camera).
3. **Database** — Drizzle + Neon, first tables: `products` (raw JSON + content hash) and `model_calls` (model, tokens in/out, latency, cost, created_at). Run the migration.
4. **Health page** — `/status` shows: Shopify connected (shop name, product count), DB connected, model key present (yes/no only — never the key).
5. **Deploy** — import the repo in Vercel, add env vars, confirm `/status` is green on the live URL.

Done when: the live `vercel.app` URL shows `/status` all green.

## Start helper 1 (second terminal, right after the plan is approved)

```
git worktree add ..\shelfready-bg -b bg/rubric-v1
cd ..\shelfready-bg
claude
```

Prompt: "Read CLAUDE.md and docs/RUBRIC.md. Turn the rubric into code-ready specs: create `lib/audit/rubric.ts` with the category → required-attributes map, the shopper-question lists, weights, and band thresholds as typed constants, plus Zod schemas for the LLM answerability check. No scoring logic yet. Commit on this branch; don't merge."

## Close
Run `/end-session`. Say on camera: what works (live URL, Shopify + DB connected), what's next (Episode 02: generate and seed the messy catalog).

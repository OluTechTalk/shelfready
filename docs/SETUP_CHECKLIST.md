# ShelfReady — Pre-session setup (do before recording Episode 01)

About 45–60 minutes of sign-ups and keys. Do this off camera so the recording starts with building, not forms. Save every key straight into a password manager; you'll paste them into `.env.local` during the session.

## Accounts and keys

- [x] **GitHub** — create an empty public repo named `shelfready` (no README; the scaffold adds one).
- [x] **Vercel** — sign up with GitHub (Hobby plan). Nothing to create yet; the repo gets imported in Episode 01.
- [x] **Shopify Dev Dashboard** (https://dev.shopify.com/dashboard/ — the bare dev.shopify.com goes to a Shopify-employee Okta login; ignore that) — sign up / log in.
  - [x] Create a **development store** from the Dev Dashboard (not from the store admin). Done Sep 24: `shelfready-demo-owtutqd5.myshopify.com`.
  - [x] Create an **app** in the same organization, named `ShelfReady`.
  - [x] Set Admin API scopes: `read_products`, `write_products`, `read_inventory`, `write_inventory`.
  - [x] Add Storefront scopes if offered: `unauthenticated_read_product_listings`, `unauthenticated_read_product_inventory`, `unauthenticated_write_checkouts`, `unauthenticated_read_checkouts`.
  - [x] Release an app version, then install the app on the dev store.
  - [x] Copy the **Client ID** and **Client secret**.
- [ ] **Neon** — create a project `shelfready`, copy the pooled `DATABASE_URL`.
- [ ] **Upstash** — create a Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- [ ] **AI model key** — Google AI Studio (Gemini) API key. Optional backup: Groq API key.
- [ ] **Local tools** — Node 20+, git, and Claude Code installed and logged in (`claude --version`).
- [ ] **Recording** — OBS or Loom ready; a browser profile with no personal bookmarks/tabs visible.

## Sanity check (2 minutes)

Passed Sep 24: token received, `expires_in` 86399. Shopify lists only 5 scopes because write scopes include the matching read scopes.

Run this in a terminal (fill in your values) to confirm Shopify auth works before you record:

PowerShell (one line; `curl.exe`, not `curl`, which PowerShell aliases to something else):

```powershell
curl.exe -s -X POST "https://shelfready-demo-owtutqd5.myshopify.com/admin/oauth/access_token" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=client_credentials&client_id=YOUR_ID&client_secret=YOUR_SECRET"
```

You should see JSON with an `access_token` and `expires_in` of about 86399. If you get "client credentials cannot be performed on this shop", the store and app are in different organizations — recreate the store from the same Dev Dashboard org.

Don't run that with your secret on camera.

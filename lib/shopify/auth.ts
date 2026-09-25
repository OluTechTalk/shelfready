// Admin API access tokens via the client credentials grant (Dev Dashboard apps).
// Tokens expire after ~24h. We cache one per server instance and refresh early.

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type CachedToken = { value: string; expiresAt: number };

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function requestToken(): Promise<CachedToken> {
  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requireEnv("SHOPIFY_CLIENT_ID"),
      client_secret: requireEnv("SHOPIFY_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    // Don't echo the body: it can contain request details. Status is enough to debug.
    throw new Error(`Shopify token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Shopify token response had no access_token");

  // Fall back to 24h if Shopify omits expires_in.
  const ttlMs = (data.expires_in ?? 86_400) * 1000;
  return { value: data.access_token, expiresAt: Date.now() + ttlMs };
}

/** Returns a valid Admin API token, refreshing it ~5 minutes before expiry. */
export async function getAdminToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) {
    return cached.value;
  }
  // Concurrent callers share one refresh instead of each requesting a token.
  inflight ??= requestToken().finally(() => {
    inflight = null;
  });
  cached = await inflight;
  return cached.value;
}

/** Drops the cached token so the next call fetches a fresh one (e.g. after a 401). */
export function invalidateAdminToken(): void {
  cached = null;
}

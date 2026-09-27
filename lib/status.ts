import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getShopSummary } from "@/lib/shopify/admin";

export type CheckResult = { name: string; ok: boolean; detail: string };

// Error messages are shown on a public page: cap length and strip any credentials in URLs.
function safeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/:\/\/[^@\s/]+@/g, "://***@").slice(0, 160);
}

async function run(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (err) {
    return { name, ok: false, detail: safeMessage(err) };
  }
}

/**
 * Live key check against a provider's free model-list endpoint (no tokens used). Reports
 * only the HTTP status, never the key or the response body.
 */
async function checkModelKey(envVar: string, url: string, header: (key: string) => Record<string, string>) {
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} not set`);
  const res = await fetch(url, { headers: header(key), signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!res.ok) throw new Error(`key rejected · HTTP ${res.status}`);
  return `key valid · HTTP ${res.status}`;
}

export function runStatusChecks(): Promise<CheckResult[]> {
  return Promise.all([
    run("Shopify Admin API", async () => {
      const shop = await getShopSummary();
      return `${shop.name} · ${shop.productCount} products`;
    }),
    run("Database (Neon)", async () => {
      const [row] = await getDb().select({ n: count() }).from(schema.products);
      return `connected · ${row.n} products synced`;
    }),
    run("Gemini API key", () =>
      checkModelKey("GOOGLE_GENERATIVE_AI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/models", (key) => ({
        "x-goog-api-key": key, // header, not ?key=, so the key never appears in a URL or error
      })),
    ),
    run("Groq API key", () =>
      checkModelKey("GROQ_API_KEY", "https://api.groq.com/openai/v1/models", (key) => ({
        Authorization: `Bearer ${key}`,
      })),
    ),
  ]);
}

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
    run("Model API key", async () => {
      // Presence only. Never render or log the key itself.
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");
      return "present";
    }),
  ]);
}

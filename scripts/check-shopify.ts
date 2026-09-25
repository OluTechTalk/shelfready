// Smoke test for Shopify auth: prints shop name and product count.
// Run: npm run check:shopify
import { getAdminToken } from "../lib/shopify/auth";
import { getShopSummary } from "../lib/shopify/admin";

async function main() {
  const summary = await getShopSummary();
  console.log(`Connected to "${summary.name}" — ${summary.productCount} products`);

  // Second call should hit the cache, not request a new token.
  const t0 = Date.now();
  await getAdminToken();
  console.log(`Cached token lookup: ${Date.now() - t0} ms`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

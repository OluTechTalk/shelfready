// Smoke test for the Storefront API: live availability for a few variants, then a cart with
// one item and its checkout URL. Creates a throwaway cart (no order, no payment).
// Run: npm run check:storefront

import { getDb, schema } from "../lib/db";
import type { ShopifyProduct } from "../lib/shopify/products";
import { createCart, variantAvailability } from "../lib/shopify/storefront";

async function main() {
  const [row] = await getDb().select().from(schema.products).limit(1);
  const p = row.raw as ShopifyProduct;
  const ids = p.variants.slice(0, 3).map((v) => v.id);
  const stock = await variantAvailability(ids);
  console.log(`Availability for ${p.title}:`);
  for (const s of stock) console.log(`  ${p.variants.find((v) => v.id === s.variantId)?.title}: ${s.available ? "in stock" : "sold out"} (${s.quantityAvailable ?? "?"} available)`);
  const inStock = stock.find((s) => s.available);
  if (!inStock) throw new Error("No in-stock variant to test a cart with");
  const cart = await createCart([{ variantId: inStock.variantId, quantity: 1 }]);
  console.log(`Cart: ${cart.lines.map((l) => `${l.quantity} × ${l.productTitle} (${l.title})`).join(", ")} — total ${cart.total.amount} ${cart.total.currencyCode}`);
  console.log(`Checkout URL host: ${new URL(cart.checkoutUrl).host} (path ${new URL(cart.checkoutUrl).pathname.split("/").slice(0, 3).join("/")}/…)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

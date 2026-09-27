// Mirrors the Shopify catalog into Postgres: one `products` row per product with the raw
// Admin API JSON and a content hash (the audit re-scores only when the hash changes).
// Read-only against Shopify.
//
// Run: npm run sync

import { notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { fetchAllProducts, productContentHash } from "../lib/shopify/products";

const CHUNK = 50;

async function main() {
  const t0 = Date.now();
  const products = await fetchAllProducts();
  console.log(`Fetched ${products.length} products from Shopify in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const db = getDb();
  const before = new Map(
    (await db.select({ id: schema.products.id, hash: schema.products.contentHash }).from(schema.products)).map((r) => [
      r.id,
      r.hash,
    ]),
  );

  const rows = products.map((p) => ({ id: p.id, handle: p.handle, raw: p, contentHash: productContentHash(p) }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(schema.products)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: schema.products.id,
        set: {
          handle: sql`excluded.handle`,
          raw: sql`excluded.raw`,
          contentHash: sql`excluded.content_hash`,
          syncedAt: sql`now()`,
        },
      });
  }

  // Products deleted in Shopify no longer belong in the mirror.
  const removed = rows.length
    ? await db
        .delete(schema.products)
        .where(notInArray(schema.products.id, rows.map((r) => r.id)))
        .returning({ id: schema.products.id })
    : [];

  const added = rows.filter((r) => !before.has(r.id)).length;
  const changed = rows.filter((r) => before.has(r.id) && before.get(r.id) !== r.contentHash).length;
  console.log(
    `Synced ${rows.length}: ${added} new, ${changed} changed, ${rows.length - added - changed} unchanged, ${removed.length} removed`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

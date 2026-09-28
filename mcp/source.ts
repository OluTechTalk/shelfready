// Where the MCP tools read the catalog from. Behind an interface so the P5 eval can run the
// same tools against the original messy catalog (fixtures) and the fixed live catalog.

import { getDb, schema } from "@/lib/db";
import type { ShopifyProduct } from "@/lib/shopify/products";

export interface ProductSource {
  all(): Promise<ShopifyProduct[]>;
}

const TTL_MS = 60_000;

/** The live catalog as last synced into Postgres, cached per server instance for a minute. */
export function postgresSource(): ProductSource {
  let cached: { at: number; products: ShopifyProduct[] } | null = null;
  return {
    async all() {
      if (cached && Date.now() - cached.at < TTL_MS) return cached.products;
      const rows = await getDb().select({ raw: schema.products.raw }).from(schema.products);
      cached = { at: Date.now(), products: rows.map((r) => r.raw as ShopifyProduct).filter((p) => p.status === "ACTIVE") };
      return cached.products;
    },
  };
}

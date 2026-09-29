// The "before" catalog for the eval: the original messy fixture (fixtures/catalog.json), shaped
// exactly like the synced Shopify products the MCP tools read. Ids are synthetic, stable and
// short like real Shopify ids (numeric, ~40 chars): handle-based ids ran past the tools' 80-char
// id limit and silently blocked carts on long-named products.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogSchema, METAFIELD_NAMESPACE, type CatalogProduct } from "../lib/catalog/schema";
import type { ShopifyProduct } from "../lib/shopify/products";
import type { ProductSource } from "../mcp/source";

export const FIXTURE_PRODUCT_PREFIX = "gid://shelfready-fixture/Product/";
const VARIANT_PREFIX = "gid://shelfready-fixture/ProductVariant/";

function toShopify(p: CatalogProduct, n: number, categoryNames: Record<string, string>): ShopifyProduct {
  return {
    id: `${FIXTURE_PRODUCT_PREFIX}${n}`,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    status: "ACTIVE",
    tags: p.tags,
    category: p.taxonomyCategoryId
      ? { id: `gid://shopify/TaxonomyCategory/${p.taxonomyCategoryId}`, fullName: categoryNames[p.taxonomyCategoryId] ?? p.taxonomyCategoryId }
      : null,
    options: p.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values })),
    variants: p.variants.map((v, i) => ({
      id: `${VARIANT_PREFIX}${n}${String(i + 1).padStart(3, "0")}`,
      title: v.optionValues.map((o) => o.name).join(" / "),
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      inventoryQuantity: v.inventory,
      inventoryItem: { tracked: true },
      selectedOptions: v.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
    })),
    media: p.images.map((img, i) => ({ id: `${p.handle}/image/${i + 1}`, alt: img.alt || null, status: "READY", image: { url: img.url } })),
    metafields: p.metafields.map((m) => ({ namespace: METAFIELD_NAMESPACE, key: m.key, type: m.type, value: m.value })),
  };
}

/** @param categoryNames taxonomy id → full name (the fixture only stores ids). */
export function fixtureSource(categoryNames: Record<string, string>): ProductSource {
  const catalog = CatalogSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "fixtures", "catalog.json"), "utf8")));
  const products = catalog.products.map((p, i) => toShopify(p, 1000 + i, categoryNames));
  return { all: async () => products };
}

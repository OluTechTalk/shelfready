// Applies fix proposals to an in-memory copy of a product — no Shopify writes. Used by the
// fixer self-test and to show a projected score before anything is approved.

import { METAFIELD_NAMESPACE } from "../catalog/schema";
import type { ShopifyProduct } from "../shopify/products";
import type { FixChange } from "./types";

export function simulateFixes(product: ShopifyProduct, changes: FixChange[], categoryNames?: Map<string, string>): ShopifyProduct {
  const p: ShopifyProduct = structuredClone(product);
  for (const c of changes) {
    switch (c.kind) {
      case "set_metafield": {
        p.metafields = p.metafields.filter((m) => !(m.namespace === METAFIELD_NAMESPACE && m.key === c.key));
        p.metafields.push({ namespace: METAFIELD_NAMESPACE, key: c.key, type: c.type, value: c.value });
        break;
      }
      case "set_title":
        p.title = c.title;
        break;
      case "set_description":
        p.descriptionHtml = c.descriptionHtml;
        break;
      case "rename_option":
        for (const o of p.options) if (o.name === c.from) o.name = c.to;
        for (const v of p.variants) for (const o of v.selectedOptions) if (o.name === c.from) o.name = c.to;
        break;
      case "set_variant_skus":
        for (const { variantId, sku } of c.variants) {
          const v = p.variants.find((x) => x.id === variantId);
          if (v) v.sku = sku;
        }
        break;
      case "set_alt_text":
        for (const { mediaId, alt } of c.images) {
          const m = p.media.find((x) => x.id === mediaId);
          if (m) m.alt = alt;
        }
        break;
      case "set_taxonomy":
        if (c.productType !== undefined) p.productType = c.productType;
        if (c.categoryId !== undefined) {
          p.category = { id: `gid://shopify/TaxonomyCategory/${c.categoryId}`, fullName: categoryNames?.get(c.categoryId) ?? c.categoryId };
        }
        if (c.tags !== undefined) p.tags = c.tags;
        break;
      case "needs_merchant":
        break;
    }
  }
  return p;
}

// The four shopping tools, as plain functions with Zod inputs. The MCP route registers them;
// the eval can call them directly. Search and product reads use the synced catalog (via a
// ProductSource); availability and carts are live from the Storefront API.
//
// Filters read structured data only — option names, attribute fields, prices. A product whose
// "waterproof" attribute is missing won't match a waterproof filter: that is exactly the gap
// the audit measures. The agent never handles payment: create_cart returns Shopify's checkout URL.

import { z } from "zod";
import { htmlToText, normalizeOptionValue } from "@/lib/catalog/defects";
import { METAFIELD_NAMESPACE } from "@/lib/catalog/schema";
import { attributeLabel, formatAttributeValue } from "@/lib/fixer/format";
import type { ShopifyProduct } from "@/lib/shopify/products";
import { createCart, variantAvailability } from "@/lib/shopify/storefront";
import type { ProductSource } from "./source";

// ---------------------------------------------------------------------------
// Shared views
// ---------------------------------------------------------------------------

const optionValue = (v: ShopifyProduct["variants"][number], name: string) => v.selectedOptions.find((o) => o.name === name)?.value;

function attributes(p: ShopifyProduct): Record<string, string> {
  return Object.fromEntries(
    p.metafields
      .filter((m) => m.namespace === METAFIELD_NAMESPACE)
      .map((m) => [attributeLabel(m.key), formatAttributeValue(m.key, m.type, m.value)]),
  );
}

const priceRange = (variants: ShopifyProduct["variants"]) => {
  const prices = variants.map((v) => Number(v.price));
  return { min: Math.min(...prices), max: Math.max(...prices), currency: "USD" };
};

// ---------------------------------------------------------------------------
// search_products
// ---------------------------------------------------------------------------

export const SearchInput = z.object({
  query: z.string().max(200).optional().describe("Free text, e.g. 'hiking boots' or 'down sleeping bag'. Matched against title, type, tags and description."),
  productType: z.string().max(60).optional().describe("Exact product type, e.g. 'Hiking Boots', 'Rain Jackets', 'Tents'."),
  gender: z.enum(["mens", "womens", "unisex"]).optional().describe("Matches the product's structured gender/fit attribute."),
  size: z.string().max(20).optional().describe("A variant size, e.g. '10' or 'M'. Only products with that size in their Size option match."),
  color: z.string().max(30).optional().describe("A variant color, e.g. 'Black'."),
  maxPrice: z.number().positive().optional().describe("Maximum price in USD for a matching variant."),
  minPrice: z.number().nonnegative().optional(),
  waterproof: z.boolean().optional().describe("Matches the product's structured waterproof attribute (footwear)."),
  attributes: z
    .record(z.string().max(40), z.string().max(60))
    .optional()
    .describe("Other structured attributes to match (case-insensitive contains), e.g. {\"Fill type\": \"down\", \"Season rating\": \"3-season\"}."),
  limit: z.number().int().min(1).max(20).default(10),
});
export type SearchInput = z.infer<typeof SearchInput>;

function textScore(p: ShopifyProduct, query: string): number {
  const tokens = query.toLowerCase().split(/[^a-z0-9°']+/).filter((t) => t.length > 1);
  if (!tokens.length) return 1;
  const fields: [string, number][] = [
    [p.title.toLowerCase(), 3],
    [p.productType.toLowerCase(), 3],
    [p.tags.join(" ").toLowerCase(), 2],
    [Object.values(attributes(p)).join(" ").toLowerCase(), 2],
    [htmlToText(p.descriptionHtml).toLowerCase(), 1],
  ];
  let score = 0;
  for (const t of tokens) {
    const stem = t.replace(/(es|s)$/, "");
    for (const [text, weight] of fields) if (text.includes(stem)) score += weight;
  }
  return score;
}

export async function searchProducts(source: ProductSource, input: SearchInput) {
  const products = await source.all();
  const want = (s: string) => normalizeOptionValue(s);
  const results = [];
  for (const p of products) {
    const attrs = attributes(p);
    if (input.productType && p.productType.toLowerCase() !== input.productType.toLowerCase()) continue;
    if (input.gender) {
      const g = (attrs["Gender / fit"] ?? "").toLowerCase();
      const ok = input.gender === "mens" ? /\bmen'?s\b/.test(g) && !/women/.test(g) : input.gender === "womens" ? /women/.test(g) : /unisex/.test(g);
      if (!ok) continue;
    }
    if (input.waterproof !== undefined && attrs["Waterproof"] !== (input.waterproof ? "Yes" : "No")) continue;
    if (input.attributes && !Object.entries(input.attributes).every(([k, v]) => (attrs[Object.keys(attrs).find((a) => a.toLowerCase() === k.toLowerCase()) ?? ""] ?? "").toLowerCase().includes(v.toLowerCase()))) continue;

    // Variants that satisfy size / color / price.
    const variants = p.variants.filter((v) => {
      if (input.size && want(optionValue(v, "Size") ?? "") !== want(input.size)) return false;
      if (input.color && !want(optionValue(v, "Color") ?? "").includes(want(input.color))) return false;
      const price = Number(v.price);
      if (input.maxPrice !== undefined && price > input.maxPrice) return false;
      if (input.minPrice !== undefined && price < input.minPrice) return false;
      return true;
    });
    if (!variants.length) continue;

    const score = input.query ? textScore(p, input.query) : 1;
    if (score === 0) continue;
    results.push({ p, variants, score });
  }
  results.sort((a, b) => b.score - a.score || Number(a.variants[0].price) - Number(b.variants[0].price));
  return {
    total: results.length,
    results: results.slice(0, input.limit).map(({ p, variants }) => ({
      productId: p.id,
      title: p.title,
      productType: p.productType || null,
      price: priceRange(variants),
      attributes: attributes(p),
      matchingVariants: variants.slice(0, 5).map((v) => ({ variantId: v.id, title: v.title, price: v.price, inStock: (v.inventoryQuantity ?? 0) > 0 })),
      moreVariants: Math.max(0, variants.length - 5),
    })),
  };
}

// ---------------------------------------------------------------------------
// get_product
// ---------------------------------------------------------------------------

export const GetProductInput = z.object({
  productId: z.string().max(80).describe("The productId from search_products (a gid://shopify/Product/… id) or the product handle."),
});

export async function getProduct(source: ProductSource, input: z.infer<typeof GetProductInput>) {
  const p = (await source.all()).find((x) => x.id === input.productId || x.handle === input.productId);
  if (!p) return { error: `No product with id or handle "${input.productId}"` };
  return {
    productId: p.id,
    title: p.title,
    productType: p.productType || null,
    category: p.category?.fullName ?? null,
    description: htmlToText(p.descriptionHtml),
    attributes: attributes(p),
    tags: p.tags,
    options: p.options.map((o) => ({ name: o.name, values: o.values })),
    price: priceRange(p.variants),
    variants: p.variants.map((v) => ({
      variantId: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
    })),
    images: p.media.map((m) => m.alt || null),
  };
}

// ---------------------------------------------------------------------------
// check_availability (live)
// ---------------------------------------------------------------------------

export const AvailabilityInput = z.object({
  variantIds: z.array(z.string().max(80)).min(1).max(25).describe("Variant ids from search_products or get_product."),
});

export async function checkAvailability(source: ProductSource, input: z.infer<typeof AvailabilityInput>) {
  const titles = new Map((await source.all()).flatMap((p) => p.variants.map((v) => [v.id, `${p.title} — ${v.title}`] as const)));
  const live = await variantAvailability(input.variantIds.filter((id) => titles.has(id)));
  const byId = new Map(live.map((l) => [l.variantId, l]));
  return {
    variants: input.variantIds.map((id) => {
      const l = byId.get(id);
      return titles.has(id)
        ? { variantId: id, title: titles.get(id)!, available: l?.available ?? false, quantityAvailable: l?.quantityAvailable ?? null }
        : { variantId: id, error: "Unknown variant id" };
    }),
  };
}

// ---------------------------------------------------------------------------
// create_cart (live) — returns a checkout URL; never takes payment
// ---------------------------------------------------------------------------

export const CartInput = z.object({
  lines: z
    .array(z.object({ variantId: z.string().max(80), quantity: z.number().int().min(1).max(10).default(1) }))
    .min(1)
    .max(10),
});

export async function createCartTool(source: ProductSource, input: z.infer<typeof CartInput>) {
  const known = new Set((await source.all()).flatMap((p) => p.variants.map((v) => v.id)));
  const unknown = input.lines.filter((l) => !known.has(l.variantId)).map((l) => l.variantId);
  if (unknown.length) return { error: `Unknown variant id(s): ${unknown.join(", ")}` };
  const cart = await createCart(input.lines);
  return {
    checkoutUrl: cart.checkoutUrl,
    total: cart.total,
    lines: cart.lines,
    note: "The shopper completes payment on Shopify's checkout page. This agent never handles payment.",
  };
}

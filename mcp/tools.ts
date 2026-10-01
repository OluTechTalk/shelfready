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
import { attributeLabel, formatAttributeValue, weightGrams } from "@/lib/fixer/format";
import type { ShopifyProduct } from "@/lib/shopify/products";
import { createCart, variantAvailability } from "@/lib/shopify/storefront";
import type { ProductSource } from "./source";
import { REQUIRED_ATTRIBUTES } from "@/lib/audit/rubric";

/** Every structured attribute an agent can filter on, by its display name. */
const ATTRIBUTE_NAMES = [...new Set(Object.values(REQUIRED_ATTRIBUTES).flatMap((attrs) => attrs.map((a) => attributeLabel(a.key))))];

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
    .describe(
      `Other structured attributes to match (case-insensitive contains), e.g. {"Fill type": "down", "Season rating": "3-season", "Capacity": "2 people"}. Use these names: ${ATTRIBUTE_NAMES.join(", ")}.`,
    ),
  sort: z
    .enum(["relevance", "price_low", "price_high", "lightest", "warmest", "largest"])
    .default("relevance")
    .describe(
      "Order of results. Use it for superlatives: cheapest → price_low, most expensive → price_high, lightest → lightest (weight or packed weight), warmest → warmest (sleeping bag temperature rating), biggest → largest (liters or people). Products without that value come last.",
    ),
  limit: z.number().int().min(1).max(10).default(5),
});
export type SearchInput = z.infer<typeof SearchInput>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** An attribute name the agent used → the real label, accepting the label or the field key. */
function resolveAttribute(name: string): string | null {
  const n = norm(name);
  for (const attrs of Object.values(REQUIRED_ATTRIBUTES)) {
    for (const a of attrs) if (norm(a.key) === n || norm(attributeLabel(a.key)) === n) return attributeLabel(a.key);
  }
  return null;
}

function textScore(p: ShopifyProduct, query: string): number {
  // Keep numbers ("6 person tent", "30°F"): they're often the whole point of the request.
  const tokens = query.toLowerCase().split(/[^a-z0-9°']+/).filter((t) => t.length > 1 || /\d/.test(t));
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
    // Numbers match as whole numbers: "6" finds "6-Person", not "16" or "650".
    const matches = /^\d/.test(t)
      ? (text: string) => new RegExp(`(^|[^0-9.])${t.replace(/[^0-9a-z°]/g, "")}([^0-9]|$)`).test(text)
      : (text: string) => text.includes(t.replace(/(es|s)$/, ""));
    for (const [text, weight] of fields) if (matches(text)) score += weight;
  }
  return score;
}

const minPrice = (variants: ShopifyProduct["variants"]) => Math.min(...variants.map((v) => Number(v.price)));
const metafield = (p: ShopifyProduct, key: string) => p.metafields.find((m) => m.namespace === METAFIELD_NAMESPACE && m.key === key)?.value;
const numberIn = (raw: string | undefined) => {
  const n = Number(raw?.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : null;
};

/** Sort keys, ascending (so "largest" and "price_high" negate). null = the product doesn't state it. */
const SORT_KEYS: Record<Exclude<SearchInput["sort"], "relevance">, (p: ShopifyProduct, variants: ShopifyProduct["variants"]) => number | null> = {
  price_low: (_p, v) => minPrice(v),
  price_high: (_p, v) => -minPrice(v),
  lightest: (p) => {
    const raw = metafield(p, "weight") ?? metafield(p, "packed_weight");
    return raw ? weightGrams(raw) : null;
  },
  warmest: (p) => numberIn(metafield(p, "temperature_rating")), // °F lower limit: lower is warmer
  largest: (p) => {
    const n = numberIn(metafield(p, "capacity_l") ?? metafield(p, "capacity_people"));
    return n === null ? null : -n;
  },
};

export async function searchProducts(source: ProductSource, input: SearchInput) {
  // An unknown attribute name would silently match nothing; say so, with the valid names.
  const unknown = Object.keys(input.attributes ?? {}).filter((k) => !resolveAttribute(k));
  if (unknown.length) {
    return { error: `Unknown attribute name(s): ${unknown.join(", ")}. Use one of: ${ATTRIBUTE_NAMES.join(", ")}.`, total: 0, results: [] };
  }
  const wanted = Object.entries(input.attributes ?? {}).map(([k, v]) => [resolveAttribute(k)!, v.toLowerCase()] as const);
  const products = await source.all();
  const want = (s: string) => normalizeOptionValue(s);
  const results: { p: ShopifyProduct; variants: ShopifyProduct["variants"]; score: number }[] = [];
  for (const p of products) {
    const attrs = attributes(p);
    if (input.productType && p.productType.toLowerCase() !== input.productType.toLowerCase()) continue;
    if (input.gender) {
      const g = (attrs["Gender / fit"] ?? "").toLowerCase();
      const ok = input.gender === "mens" ? /\bmen'?s\b/.test(g) && !/women/.test(g) : input.gender === "womens" ? /women/.test(g) : /unisex/.test(g);
      if (!ok) continue;
    }
    if (input.waterproof !== undefined && attrs["Waterproof"] !== (input.waterproof ? "Yes" : "No")) continue;
    if (!wanted.every(([label, v]) => (attrs[label] ?? "").toLowerCase().includes(v))) continue;

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
  const byRelevance = (a: (typeof results)[number], b: (typeof results)[number]) => b.score - a.score || minPrice(a.variants) - minPrice(b.variants);
  if (input.sort === "relevance") results.sort(byRelevance);
  else {
    // Missing values sort last, so a listing without the fact can't win a superlative by accident.
    const key = SORT_KEYS[input.sort];
    results.sort((a, b) => {
      const ka = key(a.p, a.variants);
      const kb = key(b.p, b.variants);
      if (ka === null || kb === null) return ka === null && kb === null ? byRelevance(a, b) : ka === null ? 1 : -1;
      return ka - kb || byRelevance(a, b);
    });
  }
  return {
    total: results.length,
    results: results.slice(0, input.limit).map(({ p, variants }) => ({
      productId: p.id,
      title: p.title,
      productType: p.productType || null,
      price: priceRange(variants),
      attributes: attributes(p),
      // Compact on purpose: agents re-read every tool result at every step, so size is cost.
      matchingVariants: variants.slice(0, 3).map((v) => ({ variantId: v.id, title: v.title, price: v.price, inStock: (v.inventoryQuantity ?? 0) > 0 })),
      moreVariants: Math.max(0, variants.length - 3),
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
    // The variant title already carries its option values ("10 / Black").
    variants: p.variants.map((v) => ({
      variantId: v.id,
      title: v.title,
      price: v.price,
      ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}),
    })),
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

// ---------------------------------------------------------------------------
// Wording agents see — shared by the live MCP server and the eval, so the eval measures
// exactly what a real agent gets.
// ---------------------------------------------------------------------------

export const MCP_INSTRUCTIONS = `Tools for shopping an outdoor-gear store (boots, jackets, packs, tents, sleeping bags, accessories).
Typical flow: search_products (use structured filters when the shopper gives them — size, gender, price, waterproof,
attributes) → get_product for details → check_availability for live stock → create_cart, which returns a Shopify
checkout URL for the shopper. Create one cart for the variant the shopper chose; if they haven't picked a size or
color yet, ask first instead of making a cart per option. You never take payment or personal details; the shopper
pays on Shopify.`;

export const TOOL_INFO = {
  search_products: {
    title: "Search products",
    description:
      "Find products by free text and/or structured filters. Returns matching products with price range, key attributes and up to 5 matching variants (with variantIds).",
  },
  get_product: {
    title: "Get product details",
    description: "Full details for one product: description, all structured attributes, options and every variant (with variantIds).",
  },
  check_availability: {
    title: "Check availability",
    description: "Live stock for specific variants. Check before creating a cart.",
  },
  create_cart: {
    title: "Create cart",
    description:
      "Create a cart with the variants the shopper chose and return a Shopify checkout URL to give them. Call it once the shopper has picked a size and color — ask rather than making a cart per option. Does not take payment; the shopper completes checkout on Shopify.",
  },
} as const;

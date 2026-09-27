// Rule-based fix proposals: fixes that follow mechanically from data the store already has,
// so no model is needed. Each proposer returns nothing when its check already passes.

import { htmlToText, isBadAlt, normalizeOptionValue } from "../catalog/defects";
import { METAFIELD_NAMESPACE } from "../catalog/schema";
import { resolveCategory } from "../audit/category";
import { MIN_TAGS, NON_MEANINGFUL_TAGS, STANDARD_OPTION_NAMES } from "../audit/rubric";
import type { ShopifyProduct } from "../shopify/products";
import type { FixProposal } from "./types";

/** What the rules may borrow from the rest of the store (built once per run). */
export type StoreContext = {
  /** productType → the taxonomy category id most products of that type use. */
  typeCategory: Map<string, { id: string; fullName: string }>;
  productTypes: string[];
  /** Well-classified products to borrow from (handle words after the model name). */
  references: { handle: string; words: string[]; productType: string; tags: string[] }[];
};

/** "harrier-30l-ultralight-pack" → ["30l", "ultralight", "pack"]: drops the model name. */
const handleWords = (handle: string) => handle.split("-").slice(1);

const TAXONOMY_PREFIX = "gid://shopify/TaxonomyCategory/";

export function buildStoreContext(products: ShopifyProduct[]): StoreContext {
  const counts = new Map<string, Map<string, { n: number; cat: { id: string; fullName: string } }>>();
  for (const p of products) {
    if (!p.productType.trim() || !p.category) continue;
    const byCat = counts.get(p.productType) ?? new Map();
    const entry = byCat.get(p.category.id) ?? { n: 0, cat: { id: p.category.id.replace(TAXONOMY_PREFIX, ""), fullName: p.category.fullName } };
    entry.n++;
    byCat.set(p.category.id, entry);
    counts.set(p.productType, byCat);
  }
  const typeCategory = new Map(
    [...counts].map(([type, byCat]) => [type, [...byCat.values()].sort((a, b) => b.n - a.n)[0].cat]),
  );
  const references = products
    .filter((p) => p.productType.trim() && p.category && p.tags.length >= MIN_TAGS)
    .map((p) => ({ handle: p.handle, words: handleWords(p.handle), productType: p.productType, tags: p.tags }));
  return { typeCategory, productTypes: [...typeCategory.keys()], references };
}

/** The most similar well-classified product: most shared handle words, at least two. */
function nearestReference(p: ShopifyProduct, ctx: StoreContext) {
  const mine = new Set(handleWords(p.handle));
  let best: { ref: StoreContext["references"][number]; shared: number } | null = null;
  for (const ref of ctx.references) {
    if (ref.handle === p.handle) continue;
    const shared = ref.words.filter((w) => mine.has(w)).length;
    if (shared >= 2 && (!best || shared > best.shared)) best = { ref, shared };
  }
  return best?.ref ?? null;
}

const base = (p: ShopifyProduct) => ({ productId: p.id, handle: p.handle, source: "rule" as const, evidence: null });

// Option names ---------------------------------------------------------------------------

const OPTION_SYNONYMS: [RegExp, string][] = [
  [/^(size|sizes|sz|shoe size|pack size)$/i, "Size"],
  [/^(color|colour|colors|colours|clr|color ?way|colou?rway)$/i, "Color"],
];

export function proposeOptionNames(p: ShopifyProduct): FixProposal[] {
  const out: FixProposal[] = [];
  for (const o of p.options) {
    if (STANDARD_OPTION_NAMES.includes(o.name)) continue;
    const to = OPTION_SYNONYMS.find(([re]) => re.test(o.name.trim()))?.[1];
    if (!to || p.options.some((x) => x.name === to)) continue; // unknown or would collide
    out.push({
      ...base(p),
      checkId: "variant_structure",
      target: o.name,
      change: { kind: "rename_option", from: o.name, to },
      before: o.name,
    });
  }
  return out;
}

// SKUs -----------------------------------------------------------------------------------

// Three characters per option value, matching the store's existing SKUs ("RL-FW017-7-BLA").
const skuPart = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "X";

export function proposeSkus(p: ShopifyProduct): FixProposal[] {
  const missing = p.variants.filter((v) => !v.sku?.trim());
  if (missing.length === 0) return [];
  // Reuse the product's own SKU prefix when a sibling has one ("RL-AP014-XS-CHA" → "RL-AP014").
  const sibling = p.variants.find((v) => v.sku?.trim())?.sku;
  const prefix = sibling
    ? sibling.split("-").slice(0, -p.options.length).join("-")
    : `SR-${p.handle.split("-").slice(0, 2).map(skuPart).join("")}`;
  const taken = new Set(p.variants.map((v) => v.sku?.trim()).filter(Boolean));
  const variants = missing.map((v) => {
    const stem = [prefix, ...v.selectedOptions.map((o) => skuPart(normalizeOptionValue(o.value)))].join("-");
    let sku = stem;
    for (let i = 2; taken.has(sku); i++) sku = `${stem}-${i}`;
    taken.add(sku);
    return { variantId: v.id, sku };
  });
  return [
    {
      ...base(p),
      checkId: "variant_structure",
      target: "skus",
      change: { kind: "set_variant_skus", variants },
      before: missing.map((v) => ({ variantId: v.id, title: v.title, sku: v.sku })),
    },
  ];
}

/** Duplicates need a merchant decision: deleting a variant moves or loses inventory. */
export function proposeDuplicateReview(p: ShopifyProduct): FixProposal[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const v of p.variants) {
    const key = v.selectedOptions.map((o) => normalizeOptionValue(o.value)).join("|");
    if (seen.has(key)) dupes.push(`"${v.title}" duplicates "${seen.get(key)}"`);
    else seen.set(key, v.title);
  }
  if (!dupes.length) return [];
  return [
    {
      ...base(p),
      checkId: "variant_structure",
      target: "duplicate_variants",
      change: { kind: "needs_merchant", reason: `Merge or delete duplicate variants: ${dupes.join("; ")}` },
      before: dupes,
    },
  ];
}

// Alt text -------------------------------------------------------------------------------

/**
 * Alt text from the product's (possibly fixed) title. Images are matched to colors only
 * when there is exactly one image per color value, which is how the catalog is shot.
 */
export function proposeAltText(p: ShopifyProduct, title = p.title): FixProposal[] {
  const bad = p.media.filter((m) => isBadAlt(m.alt ?? ""));
  if (!bad.length) return [];
  const colors = p.options.find((o) => /^colou?r/i.test(o.name))?.values ?? [];
  const images = bad.map((m) => {
    const i = p.media.indexOf(m);
    const color = colors.length === p.media.length ? colors[i] : null;
    return { mediaId: m.id, alt: color ? `${title} in ${color}, side view` : `${title}, product photo ${i + 1}` };
  });
  return [
    {
      ...base(p),
      checkId: "images_alt_text",
      target: "alt_text",
      change: { kind: "set_alt_text", images },
      before: bad.map((m) => ({ mediaId: m.id, alt: m.alt })),
    },
  ];
}

// Taxonomy -------------------------------------------------------------------------------

const TAG_ATTRIBUTES = ["use_case", "material", "upper_material", "fill_type", "shape", "season_rating", "setup_type", "frame_type"];

/** Good enough for product nouns: "bottles" → "bottle", "boxes" → "box", "shoes" → "shoe". */
function singular(word: string): string {
  const w = word.toLowerCase();
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ch|sh|x|ss)es$/.test(w)) return w.replace(/es$/, "");
  return w.replace(/s$/, "");
}

/** The store's own product type whose words all appear in the handle or title (longest wins). */
function inferProductType(p: ShopifyProduct, ctx: StoreContext): string | null {
  const text = new Set(`${p.handle.replace(/-/g, " ")} ${p.title}`.toLowerCase().split(/[^a-z0-9]+/).map(singular));
  const fits = ctx.productTypes.filter((t) => t.split(/\s+/).every((w) => text.has(singular(w))));
  return fits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function proposeTaxonomy(p: ShopifyProduct, ctx: StoreContext): FixProposal[] {
  const change: { productType?: string; categoryId?: string; tags?: string[] } = {};
  const reference = nearestReference(p, ctx);
  const productType = p.productType.trim() || reference?.productType || inferProductType(p, ctx);
  if (!p.productType.trim() && productType) change.productType = productType;
  if (!p.category && productType && ctx.typeCategory.has(productType)) change.categoryId = ctx.typeCategory.get(productType)!.id;

  const meaningful = p.tags.filter((t) => !NON_MEANINGFUL_TAGS.includes(t.trim().toLowerCase()));
  if (meaningful.length < MIN_TAGS) {
    const category = resolveCategory({ ...p, descriptionText: htmlToText(p.descriptionHtml) })?.category;
    // Attributes shoppers filter on make good tags ("3-season", "down"); sizes and dimensions don't.
    const attrTags = p.metafields
      .filter((m) => m.namespace === METAFIELD_NAMESPACE && TAG_ATTRIBUTES.includes(m.key) && m.value.length <= 30)
      .map((m) => m.value.toLowerCase());
    const gender = /\bwomens?\b/.test(p.handle) ? "women's" : /\bmens?\b/.test(p.handle) ? "men's" : null;
    // A sibling's tags count only when this product's own text says the same thing.
    const ownText = `${p.title} ${p.handle.replace(/-/g, " ")} ${htmlToText(p.descriptionHtml)}`.toLowerCase();
    const borrowed = (reference?.tags ?? []).map((t) => t.toLowerCase()).filter((t) => ownText.includes(t));
    const candidates = [category?.replace("_", " "), productType?.toLowerCase(), gender, ...attrTags, ...borrowed];
    const have = new Set(p.tags.map((t) => t.trim().toLowerCase()));
    const added = [...new Set(candidates.filter((t): t is string => !!t && !have.has(t)))];
    if (added.length) change.tags = [...p.tags, ...added];
  }
  if (!Object.keys(change).length) return [];
  return [
    {
      ...base(p),
      checkId: "taxonomy",
      target: "taxonomy",
      change: { kind: "set_taxonomy", ...change },
      before: { productType: p.productType, categoryId: p.category?.id.replace(TAXONOMY_PREFIX, "") ?? null, tags: p.tags },
    },
  ];
}

export function ruleProposals(p: ShopifyProduct, ctx: StoreContext, fixedTitle?: string): FixProposal[] {
  return [
    ...proposeOptionNames(p),
    ...proposeSkus(p),
    ...proposeDuplicateReview(p),
    ...proposeAltText(p, fixedTitle),
    ...proposeTaxonomy(p, ctx),
  ];
}

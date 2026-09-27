// Detectors for the seeded defects. They run on a minimal "facts" view that both the
// fixture and a synced Shopify product map onto, so the generator can self-check before
// seeding and `verify:catalog` can check what actually landed in Shopify.
// These confirm the seed, they are not the rubric scorer (that's Episode 03).

import { REQUIRED_ATTRIBUTES, type Category } from "../audit/rubric";
import type { CatalogProduct, DefectId, GroundTruthProduct } from "./schema";

export type ProductFacts = {
  title: string;
  descriptionHtml: string;
  productType: string;
  taxonomyCategoryId: string | null;
  tags: string[];
  optionNames: string[];
  variants: { sku: string | null; optionValues: string[] }[];
  imageAlts: string[];
  metafieldKeys: string[];
};

export const STANDARD_OPTION_NAMES = new Set(["Size", "Color"]);

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VAGUE_TITLE_WORDS = /\b(new|sale|copy|untitled|item|product|gear|stuff)\b/i;

export function isVagueTitle(title: string): boolean {
  const letters = title.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length >= 3 && letters === letters.toUpperCase();
  return title.length < 20 || title.length > 80 || allCaps || /!!/.test(title) || VAGUE_TITLE_WORDS.test(title);
}

export function isBadAlt(alt: string): boolean {
  const a = alt.trim();
  return a === "" || /\.(jpe?g|png|webp|gif)$/i.test(a) || /^(img|dsc|image|photo)[_-]?\d+/i.test(a);
}

const SIZE_SYNONYMS: Record<string, string> = {
  extrasmall: "xs",
  small: "s",
  medium: "m",
  large: "l",
  extralarge: "xl",
  "2xl": "xxl",
};
const COLOR_SYNONYMS: Record<string, string> = { blk: "black", gry: "grey", gray: "grey", nvy: "navy", grn: "green" };

/** Normalizes an option value so "M" / "Medium" and "Black" / "Blk" compare equal. */
export function normalizeOptionValue(value: string): string {
  let v = value.toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/^us/, "");
  v = v.replace(/\.0$/, "");
  return SIZE_SYNONYMS[v] ?? COLOR_SYNONYMS[v] ?? v;
}

export function hasVariantProblems(facts: ProductFacts): boolean {
  const skus = facts.variants.map((v) => v.sku?.trim() ?? "");
  if (skus.some((s) => s === "")) return true;
  if (new Set(skus).size !== skus.length) return true;
  const combos = facts.variants.map((v) => v.optionValues.map(normalizeOptionValue).join("|"));
  return new Set(combos).size !== combos.length;
}

export function missingRequiredKeys(facts: ProductFacts, category: Category): string[] {
  const present = new Set(facts.metafieldKeys);
  return REQUIRED_ATTRIBUTES[category].map((a) => a.key).filter((k) => !present.has(k));
}

/**
 * Detects which seeded defects a product has. The attribute defects (2, 3) need the
 * ground-truth evidence phrases to tell "value only in prose" from "value gone entirely".
 */
export function detectDefects(facts: ProductFacts, truth: Pick<GroundTruthProduct, "category" | "details">): DefectId[] {
  const found: DefectId[] = [];
  const text = htmlToText(facts.descriptionHtml).toLowerCase();

  if (isVagueTitle(facts.title)) found.push("vague_title");

  const missing = missingRequiredKeys(facts, truth.category);
  const evidence = new Map(
    [...(truth.details.attributesInDescriptionOnly ?? []), ...(truth.details.attributesMissing ?? [])].map((g) => [
      g.key,
      g.evidence.toLowerCase(),
    ]),
  );
  // A missing key with no recorded evidence counts as missing entirely.
  const inProse = missing.filter((k) => evidence.has(k) && text.includes(evidence.get(k)!));
  if (inProse.length > 0) found.push("attributes_in_description_only");
  if (inProse.length < missing.length) found.push("attributes_missing");

  if (facts.optionNames.some((n) => !STANDARD_OPTION_NAMES.has(n))) found.push("inconsistent_option_names");
  if (hasVariantProblems(facts)) found.push("variant_problems");
  if (facts.imageAlts.length === 0 || facts.imageAlts.some(isBadAlt)) found.push("bad_alt_text");
  // Clean descriptions always carry numeric specs; marketing copy never does.
  if (!/\d/.test(text)) found.push("marketing_only_description");
  if (facts.productType.trim() === "" || facts.taxonomyCategoryId === null || facts.tags.length <= 1) {
    found.push("missing_taxonomy");
  }
  return found;
}

export function factsFromCatalog(p: CatalogProduct): ProductFacts {
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    productType: p.productType,
    taxonomyCategoryId: p.taxonomyCategoryId,
    tags: p.tags,
    optionNames: p.options.map((o) => o.name),
    variants: p.variants.map((v) => ({ sku: v.sku, optionValues: v.optionValues.map((o) => o.name) })),
    imageAlts: p.images.map((i) => i.alt),
    metafieldKeys: p.metafields.map((m) => m.key),
  };
}

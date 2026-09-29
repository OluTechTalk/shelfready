// Ground truth for the eval: what a shopper asked for, as structured constraints, and which
// products truly satisfy them — judged on fixtures/catalog-clean.json (every product as it
// really is, before defects). The agent never sees these constraints; it sees the request text.

import { z } from "zod";
import { normalizeOptionValue } from "../lib/catalog/defects";
import type { CatalogProduct } from "../lib/catalog/schema";

export const ConstraintsSchema = z.object({
  productTypes: z.array(z.string()).optional(), // any of these types
  gender: z.enum(["mens", "womens"]).optional(),
  size: z.string().optional(), // a Size option value the chosen variant must have
  color: z.string().optional(),
  maxPrice: z.number().optional(), // for the chosen variant
  waterproof: z.boolean().optional(),
  attrIncludes: z.array(z.object({ key: z.string(), text: z.string() })).optional(), // case-insensitive contains
  attrRange: z.array(z.object({ key: z.string(), min: z.number(), max: z.number() })).optional(), // numeric attribute
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  request: z.string(),
  kind: z.enum(["messy_target", "clean_target", "no_match"]),
  // standard: facts a title or description usually carries; attribute: the deciding fact lives
  // only in a structured attribute (weight, fill, width…) — where messy data should hurt most.
  tier: z.enum(["standard", "attribute"]).default("standard"),
  target: z.string().nullable(), // the product the task was written around
  targetDefects: z.array(z.string()),
  constraints: ConstraintsSchema,
  acceptable: z.array(z.string()), // handles of every product that truly satisfies the constraints
});
export type Task = z.infer<typeof TaskSchema>;

const mf = (p: CatalogProduct, key: string) => p.metafields.find((m) => m.key === key)?.value;
const opt = (v: CatalogProduct["variants"][number], name: string) => v.optionValues.find((o) => o.optionName === name)?.name;

/** A numeric attribute; weights are stored as {"value":771,"unit":"GRAMS"} → grams. */
export function numericValue(raw: string | undefined): number {
  if (!raw) return NaN;
  try {
    const j = JSON.parse(raw) as { value?: number };
    if (typeof j === "object" && j && typeof j.value === "number") return j.value;
  } catch {
    // not JSON
  }
  return Number(raw);
}

export function genderOf(p: CatalogProduct): "mens" | "womens" | null {
  const g = (mf(p, "gender_fit") ?? "").toLowerCase();
  return g.startsWith("women") ? "womens" : g.startsWith("men") ? "mens" : null;
}

/** Variants of a truly-matching product that satisfy the variant-level constraints. */
export function matchingVariants(p: CatalogProduct, c: Constraints) {
  return p.variants.filter(
    (v) =>
      (!c.size || normalizeOptionValue(opt(v, "Size") ?? "") === normalizeOptionValue(c.size)) &&
      (!c.color || normalizeOptionValue(opt(v, "Color") ?? "") === normalizeOptionValue(c.color)) &&
      (c.maxPrice === undefined || Number(v.price) <= c.maxPrice),
  );
}

export function truthMatches(p: CatalogProduct, c: Constraints): boolean {
  if (c.productTypes && !c.productTypes.includes(p.productType)) return false;
  if (c.gender && genderOf(p) !== c.gender) return false;
  if (c.waterproof !== undefined && mf(p, "waterproof") !== String(c.waterproof)) return false;
  for (const a of c.attrIncludes ?? []) if (!(mf(p, a.key) ?? "").toLowerCase().includes(a.text.toLowerCase())) return false;
  for (const r of c.attrRange ?? []) {
    const n = numericValue(mf(p, r.key));
    if (!(n >= r.min && n <= r.max)) return false;
  }
  return matchingVariants(p, c).length > 0;
}

export const acceptableHandles = (catalog: CatalogProduct[], c: Constraints) => catalog.filter((p) => truthMatches(p, c)).map((p) => p.handle);

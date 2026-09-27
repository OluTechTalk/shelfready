// Shape of the checked-in demo catalog (fixtures/catalog.json) and its ground truth
// (fixtures/ground-truth.json). Produced by scripts/generate-catalog.ts, consumed by
// `npm run seed` and `npm run verify:catalog`.

import { z } from "zod";
import { CategorySchema } from "../audit/rubric";

export const METAFIELD_NAMESPACE = "shelfready";

// ---------------------------------------------------------------------------
// Seeded defects (docs/RUBRIC.md, "Seeded defects")
// ---------------------------------------------------------------------------

export const DEFECT_IDS = [
  "vague_title", // 1
  "attributes_in_description_only", // 2
  "attributes_missing", // 3
  "inconsistent_option_names", // 4
  "variant_problems", // 5 duplicate variants / missing SKUs
  "bad_alt_text", // 6
  "marketing_only_description", // 7
  "missing_taxonomy", // 8
] as const;

export type DefectId = (typeof DEFECT_IDS)[number];

export const DefectIdSchema = z.enum(DEFECT_IDS);

// ---------------------------------------------------------------------------
// Catalog fixture
// ---------------------------------------------------------------------------

export const METAFIELD_TYPES = ["single_line_text_field", "number_integer", "boolean", "weight"] as const;

export const CatalogMetafieldSchema = z.object({
  key: z.string(),
  type: z.enum(METAFIELD_TYPES),
  value: z.string(), // Shopify's string encoding (weight is JSON: {"value":…,"unit":"GRAMS"})
});

export const CatalogVariantSchema = z.object({
  optionValues: z.array(z.object({ optionName: z.string(), name: z.string() })).min(1),
  sku: z.string().nullable(),
  price: z.string(),
  compareAtPrice: z.string().nullable(),
  inventory: z.number().int().min(0),
});

export const CatalogProductSchema = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/),
  rubricCategory: CategorySchema, // our label; never sent to Shopify
  title: z.string().min(1),
  descriptionHtml: z.string(),
  vendor: z.string(),
  productType: z.string(), // "" when the taxonomy defect removed it
  taxonomyCategoryId: z.string().nullable(), // e.g. "aa-8-3"; null when removed
  tags: z.array(z.string()),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()).min(1) })).min(1),
  variants: z.array(CatalogVariantSchema).min(1),
  images: z.array(z.object({ url: z.url(), alt: z.string() })).min(1),
  metafields: z.array(CatalogMetafieldSchema),
});

export type CatalogProduct = z.infer<typeof CatalogProductSchema>;
export type CatalogVariant = z.infer<typeof CatalogVariantSchema>;
export type CatalogMetafield = z.infer<typeof CatalogMetafieldSchema>;

export const CatalogSchema = z.object({
  version: z.number().int(),
  generatorSeed: z.number().int(),
  products: z.array(CatalogProductSchema),
});

export type Catalog = z.infer<typeof CatalogSchema>;

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------

// For the attribute defects, `evidence` is the exact phrase that carried the value in the
// clean description (still present for defect 2, removed for defect 3).
export const AttributeGapSchema = z.object({ key: z.string(), evidence: z.string() });

export const GroundTruthProductSchema = z.object({
  handle: z.string(),
  category: CategorySchema,
  defects: z.array(DefectIdSchema),
  details: z.object({
    originalTitle: z.string().optional(),
    attributesInDescriptionOnly: z.array(AttributeGapSchema).optional(),
    attributesMissing: z.array(AttributeGapSchema).optional(),
    renamedOptions: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    variantProblem: z.enum(["missing_skus", "duplicate_variant", "both"]).optional(),
    badAltImages: z.number().int().optional(),
  }),
});

export type GroundTruthProduct = z.infer<typeof GroundTruthProductSchema>;

export const GroundTruthSchema = z.object({
  version: z.number().int(),
  summary: z.object({
    products: z.number().int(),
    messy: z.number().int(),
    byDefect: z.record(DefectIdSchema, z.number().int()),
    byDefectCount: z.record(z.string(), z.number().int()), // "0" | "1" | "2" | … → products
  }),
  products: z.array(GroundTruthProductSchema),
});

export type GroundTruth = z.infer<typeof GroundTruthSchema>;

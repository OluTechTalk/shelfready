// Fix proposals: what the fixer suggests, what a human approves, what gets written to
// Shopify. The fixer only proposes; nothing is applied without an approved proposal
// (CLAUDE.md). Every change type maps to one Admin API write in lib/shopify/apply.ts.

import { z } from "zod";
import { CHECK_IDS } from "../audit/rubric";
import { METAFIELD_TYPES } from "../catalog/schema";

export const FixChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_metafield"),
    key: z.string(),
    type: z.enum(METAFIELD_TYPES),
    value: z.string(), // Shopify string encoding, as in the catalog fixture
  }),
  z.object({ kind: z.literal("set_title"), title: z.string().min(1) }),
  z.object({ kind: z.literal("set_description"), descriptionHtml: z.string().min(1) }),
  z.object({ kind: z.literal("rename_option"), from: z.string(), to: z.string() }),
  z.object({
    kind: z.literal("set_variant_skus"),
    variants: z.array(z.object({ variantId: z.string(), sku: z.string().min(1) })).min(1),
  }),
  z.object({
    kind: z.literal("set_alt_text"),
    images: z.array(z.object({ mediaId: z.string(), alt: z.string().min(1) })).min(1),
  }),
  z.object({
    kind: z.literal("set_taxonomy"),
    productType: z.string().optional(),
    categoryId: z.string().optional(), // taxonomy id, e.g. "aa-8-3"
    tags: z.array(z.string()).optional(),
  }),
  // Not a write: the data doesn't exist in the product, so only the merchant can supply it.
  z.object({ kind: z.literal("needs_merchant"), reason: z.string() }),
]);

export type FixChange = z.infer<typeof FixChangeSchema>;
export type FixKind = FixChange["kind"];

export const FIX_STATUSES = ["pending", "approved", "rejected", "applied", "failed", "needs_merchant"] as const;
export type FixStatus = (typeof FIX_STATUSES)[number];

export const FixProposalSchema = z.object({
  productId: z.string(),
  handle: z.string(),
  checkId: z.enum(CHECK_IDS),
  /** Distinguishes proposals of the same kind on one product (metafield key, option name…). */
  target: z.string(),
  change: FixChangeSchema,
  before: z.unknown(), // the current value, shown in the review diff
  source: z.enum(["rule", "model"]),
  /** For model proposals: the quote from the product's own data that supports the change. */
  evidence: z.string().nullable(),
});

export type FixProposal = z.infer<typeof FixProposalSchema>;

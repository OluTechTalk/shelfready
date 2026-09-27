// Combines the seven checks into a product score (0–100) and band, and products into a
// store summary. See docs/RUBRIC.md for the weights and bands.

import { htmlToText } from "../catalog/defects";
import type { ShopifyProduct } from "../shopify/products";
import { resolveCategory, type CategorySignal } from "./category";
import * as checks from "./checks";
import { BAND_GATE_THRESHOLD, BANDS, CHECK_IDS, CHECKS, type BandId, type Category, type CheckId, type ProductAuditLlmResult } from "./rubric";

export type ProductScore = {
  productId: string;
  handle: string;
  title: string;
  category: Category;
  categorySignal: CategorySignal;
  checks: Record<CheckId, checks.CheckOutcome>;
  score: number; // 0–100, one decimal
  band: BandId;
  llmJudged: boolean;
};

/** Band from the score, then capped by the gate: weak checks limit how high a product can rank. */
export function bandFor(score: number, results: Record<CheckId, checks.CheckOutcome>): BandId {
  const byScore = (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).id;
  const weak = CHECK_IDS.filter((id) => results[id].score < BAND_GATE_THRESHOLD).length;
  if (weak >= 2) return "not_ready";
  if (weak === 1 && byScore === "agent_ready") return "partial";
  return byScore;
}

/** Returns null when the category can't be worked out (reported as unscored, never guessed). */
export function scoreProduct(p: ShopifyProduct, llm: ProductAuditLlmResult | null): ProductScore | null {
  const resolved = resolveCategory({ ...p, descriptionText: htmlToText(p.descriptionHtml) });
  if (!resolved) return null;
  const { category } = resolved;

  const results: Record<CheckId, checks.CheckOutcome> = {
    required_attributes: checks.requiredAttributes(p, category, llm),
    description_answerability: checks.descriptionAnswerability(p, category, llm),
    variant_structure: checks.variantStructure(p),
    title_specificity: checks.titleSpecificity(p, llm),
    price_availability: checks.priceAvailability(p),
    images_alt_text: checks.imagesAltText(p),
    taxonomy: checks.taxonomy(p),
  };
  const total = CHECK_IDS.reduce((sum, id) => sum + results[id].score * CHECKS[id].weight, 0);
  const score = Math.round(total * 10) / 10;

  return {
    productId: p.id,
    handle: p.handle,
    title: p.title,
    category,
    categorySignal: resolved.signal,
    checks: results,
    score,
    band: bandFor(score, results),
    llmJudged: llm !== null,
  };
}

export type StoreSummary = {
  products: number;
  score: number; // mean product score
  bands: Record<BandId, { count: number; pct: number }>;
  checkAverages: Record<CheckId, number>; // mean 0–1 per check
};

export function summarizeStore(scores: ProductScore[]): StoreSummary {
  const n = scores.length || 1;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / n;
  const bands = Object.fromEntries(
    BANDS.map((b) => {
      const count = scores.filter((s) => s.band === b.id).length;
      return [b.id, { count, pct: Math.round((count / n) * 1000) / 10 }];
    }),
  ) as StoreSummary["bands"];
  const checkAverages = Object.fromEntries(
    CHECK_IDS.map((id) => [id, Math.round(mean(scores.map((s) => s.checks[id].score)) * 1000) / 1000]),
  ) as StoreSummary["checkAverages"];
  return { products: scores.length, score: Math.round(mean(scores.map((s) => s.score)) * 10) / 10, bands, checkAverages };
}

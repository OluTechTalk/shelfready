// The seven rubric checks (docs/RUBRIC.md, v1) as pure functions over a synced Shopify
// product. Rule parts run on their own; the LLM parts take the per-product model result
// and score as "not met" when it isn't available yet. Each check returns a 0–1 score plus
// findings — plain-language reasons the UI shows and the fixer (Episode 04) acts on.

import { htmlToText, isBadAlt, normalizeOptionValue } from "../catalog/defects";
import { METAFIELD_NAMESPACE } from "../catalog/schema";
import type { ShopifyProduct } from "../shopify/products";
import {
  MIN_TAGS,
  NON_MEANINGFUL_TAGS,
  PROSE_ATTRIBUTE_CREDIT,
  REQUIRED_ATTRIBUTES,
  SHOPPER_QUESTIONS,
  STANDARD_OPTION_NAMES,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  TITLE_PLACEHOLDER_PATTERN,
  type Category,
  type ProductAuditLlmResult,
} from "./rubric";

export type CheckOutcome = { score: number; findings: string[] };

const fraction = (met: boolean[]) => met.filter(Boolean).length / met.length;

/** Lowercase, straight quotes, plain dashes, single spaces — for matching model quotes. */
function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the model's evidence is a real quote from the description (the anti-hallucination rule). */
export function quoteAppearsIn(evidence: string | null, descriptionText: string): boolean {
  if (!evidence?.trim()) return false;
  return normalizeForQuote(descriptionText).includes(normalizeForQuote(evidence));
}

// 1 — Required attributes --------------------------------------------------------------

export function requiredAttributes(
  p: ShopifyProduct,
  category: Category,
  llm: ProductAuditLlmResult | null,
): CheckOutcome {
  const text = htmlToText(p.descriptionHtml);
  const present = new Set(p.metafields.filter((m) => m.namespace === METAFIELD_NAMESPACE && m.value.trim()).map((m) => m.key));
  const required = REQUIRED_ATTRIBUTES[category];
  const findings: string[] = [];
  let credit = 0;
  for (const attr of required) {
    if (present.has(attr.key)) {
      credit += 1;
      continue;
    }
    const prose = llm?.attributes.find((a) => a.key === attr.key);
    if (prose?.stated && quoteAppearsIn(prose.evidence, text)) {
      credit += PROSE_ATTRIBUTE_CREDIT;
      findings.push(`${attr.label} is only in the description ("${prose.evidence}"), not a structured field`);
    } else {
      findings.push(`${attr.label} is missing`);
    }
  }
  return { score: credit / required.length, findings };
}

// 2 — Description answerability ----------------------------------------------------------

export function descriptionAnswerability(
  p: ShopifyProduct,
  category: Category,
  llm: ProductAuditLlmResult | null,
): CheckOutcome {
  const questions = SHOPPER_QUESTIONS[category];
  if (!llm) return { score: 0, findings: ["Not judged yet (model result missing)"] };
  const text = htmlToText(p.descriptionHtml);
  const findings: string[] = [];
  let answered = 0;
  for (const q of questions) {
    const a = llm.answers.find((x) => x.questionId === q.id);
    if (a?.answered && quoteAppearsIn(a.evidence, text)) answered++;
    else findings.push(`Doesn't answer "${q.text}"`);
  }
  return { score: answered / questions.length, findings };
}

// 3 — Variant structure ------------------------------------------------------------------

export function variantStructure(p: ShopifyProduct): CheckOutcome {
  const findings: string[] = [];

  const odd = p.options.map((o) => o.name).filter((n) => !STANDARD_OPTION_NAMES.includes(n));
  const standardNames = odd.length === 0;
  if (!standardNames) findings.push(`Non-standard option names: ${odd.map((n) => `"${n}"`).join(", ")}`);

  const combos = p.variants.map((v) => v.selectedOptions.map((o) => normalizeOptionValue(o.value)).join("|"));
  const dupes = combos.length - new Set(combos).size;
  if (dupes) findings.push(`${dupes} duplicate variant(s) (same option values under different spellings)`);

  const skus = p.variants.map((v) => v.sku?.trim() ?? "");
  const missingSkus = skus.filter((s) => !s).length;
  const repeatedSkus = skus.filter((s) => s).length - new Set(skus.filter((s) => s)).size;
  if (missingSkus) findings.push(`${missingSkus} variant(s) without a SKU`);
  if (repeatedSkus) findings.push(`${repeatedSkus} repeated SKU(s)`);

  const unpriced = p.variants.filter((v) => !v.price || Number(v.price) <= 0).length;
  if (unpriced) findings.push(`${unpriced} variant(s) without a price`);

  return { score: fraction([standardNames, dupes === 0, missingSkus + repeatedSkus === 0, unpriced === 0]), findings };
}

// 4 — Title specificity ------------------------------------------------------------------

/** The rule half of check 4. Exported for the self-test. */
export function titleFormatProblems(title: string): string[] {
  const problems: string[] = [];
  const t = title.trim();
  if (t.length < TITLE_MIN_LENGTH || t.length > TITLE_MAX_LENGTH) {
    problems.push(`Title is ${t.length} characters (want ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH})`);
  }
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) problems.push("Title is ALL CAPS");
  if (TITLE_PLACEHOLDER_PATTERN.test(t)) problems.push("Title has placeholder or promo text");
  return problems;
}

export function titleSpecificity(p: ShopifyProduct, llm: ProductAuditLlmResult | null): CheckOutcome {
  const findings = titleFormatProblems(p.title);
  const formatOk = findings.length === 0;
  const namesType = !!llm && quoteAppearsIn(llm.title.productTypeWords, p.title);
  const distinguishes = !!llm && llm.title.distinguishingWords.some((w) => quoteAppearsIn(w, p.title));
  const contentOk = namesType && distinguishes;
  if (!llm) findings.push("Title content not judged yet (model result missing)");
  else {
    if (!namesType) findings.push("Title doesn't say what kind of product it is");
    if (!distinguishes) findings.push("Title has no distinguishing attribute (model, gender, size…)");
  }
  return { score: (formatOk ? 0.5 : 0) + (contentOk ? 0.5 : 0), findings };
}

// 5 — Price & availability ---------------------------------------------------------------

export function priceAvailability(p: ShopifyProduct): CheckOutcome {
  const findings: string[] = [];
  const v = p.variants;
  const priced = v.every((x) => Number(x.price) > 0);
  const compareOk = v.every((x) => x.compareAtPrice === null || Number(x.compareAtPrice) >= Number(x.price));
  const tracked = v.every((x) => x.inventoryItem.tracked);
  const stockKnown = v.every((x) => x.inventoryQuantity !== null);
  if (!priced) findings.push("Some variants have no price");
  if (!compareOk) findings.push("Compare-at price is below the selling price");
  if (!tracked) findings.push("Inventory isn't tracked on every variant");
  if (!stockKnown) findings.push("Stock level unknown on some variants");
  return { score: fraction([priced, compareOk, tracked, stockKnown]), findings };
}

// 6 — Images & alt text ------------------------------------------------------------------

export function imagesAltText(p: ShopifyProduct): CheckOutcome {
  if (p.media.length === 0) return { score: 0, findings: ["No images"] };
  const bad = p.media.filter((m) => isBadAlt(m.alt ?? ""));
  const findings = bad.length ? [`${bad.length} of ${p.media.length} image(s) have empty or filename alt text`] : [];
  return { score: (p.media.length - bad.length) / p.media.length, findings };
}

// 7 — Taxonomy ---------------------------------------------------------------------------

export function taxonomy(p: ShopifyProduct): CheckOutcome {
  const findings: string[] = [];
  const hasType = p.productType.trim() !== "";
  const hasCategory = p.category !== null;
  const meaningful = p.tags.filter((t) => !NON_MEANINGFUL_TAGS.includes(t.trim().toLowerCase()));
  const enoughTags = meaningful.length >= MIN_TAGS;
  if (!hasType) findings.push("No product type");
  if (!hasCategory) findings.push("No Shopify standard category");
  if (!enoughTags) findings.push(`${meaningful.length} meaningful tag(s) (want ≥ ${MIN_TAGS})`);
  return { score: fraction([hasType, hasCategory, enoughTags]), findings };
}

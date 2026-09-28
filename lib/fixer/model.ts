// Model-based fix proposals: attribute extraction from prose, title rewrite, description
// draft — one structured call per product that needs any of them. Model output is never
// trusted as-is: each value is checked against the product's own data before it becomes a
// proposal, and anything that fails the check is dropped (the merchant sees a gap instead).

import { z } from "zod";
import { generateStructured } from "../ai/generate";
import type { ModelSpec } from "../ai/models";
import { quoteAppearsIn, titleFormatProblems } from "../audit/checks";
import { REQUIRED_ATTRIBUTES, type Category } from "../audit/rubric";
import type { ProductScore } from "../audit/score";
import { htmlToText } from "../catalog/defects";
import { METAFIELD_NAMESPACE, type CatalogMetafield } from "../catalog/schema";
import type { ShopifyProduct } from "../shopify/products";
import type { FixProposal } from "./types";

type MetafieldType = CatalogMetafield["type"];

/** Descriptions answering this share of shopper questions or less get a drafted rewrite. */
const REWRITE_DESCRIPTION_BELOW = 0.4;

const TYPE_HINT: Record<MetafieldType, string> = {
  single_line_text_field: "short text, e.g. 'Nubuck leather'",
  boolean: "'true' or 'false'",
  number_integer: "a whole number, digits only",
  weight: "the weight in grams, digits only",
};

/** Match the format the store's clean products already use. */
const KEY_HINT: Record<string, string> = {
  size_range: "the smallest to largest size as a range, e.g. 'XS–XXL' or 'US 7–13'",
  gender_fit: "e.g. \"Men's\", \"Women's\" or \"Unisex\"",
};

export type ModelFixNeeds = {
  missingKeys: string[]; // required attributes with no metafield
  title: boolean;
  description: boolean;
};

export function modelFixNeeds(p: ShopifyProduct, score: ProductScore): ModelFixNeeds {
  const present = new Set(p.metafields.filter((m) => m.namespace === METAFIELD_NAMESPACE).map((m) => m.key));
  return {
    missingKeys: REQUIRED_ATTRIBUTES[score.category].map((a) => a.key).filter((k) => !present.has(k)),
    title: score.checks.title_specificity.score < 1,
    description: score.checks.description_answerability.score <= REWRITE_DESCRIPTION_BELOW,
  };
}

export const needsModel = (n: ModelFixNeeds) => n.missingKeys.length > 0 || n.title || n.description;

function schemaFor(needs: ModelFixNeeds) {
  const keys = needs.missingKeys as [string, ...string[]];
  return z.object({
    attributes: needs.missingKeys.length
      ? z
          .array(
            z.object({
              key: z.enum(keys),
              value: z.string().nullable().describe("The value in the requested format, or null if the description doesn't state it"),
              evidence: z.string().nullable().describe("Verbatim quote from the PRODUCT DATA stating the value, or null"),
            }),
          )
          .length(keys.length)
      : z.array(z.never()).length(0),
    title: z.string().nullable().describe(needs.title ? "The rewritten title" : "Always null"),
    descriptionHtml: z.string().nullable().describe(needs.description ? "The drafted description as simple HTML (<p> only)" : "Always null"),
  });
}

/** Everything the product itself says, for the grounding checks. */
function productFacts(p: ShopifyProduct): string {
  return [
    p.title,
    p.handle.replace(/-/g, " "),
    p.productType,
    htmlToText(p.descriptionHtml),
    ...p.tags,
    ...p.options.flatMap((o) => o.values),
    ...p.metafields.filter((m) => m.namespace === METAFIELD_NAMESPACE).map((m) => `${m.key.replace(/_/g, " ")}: ${m.value}`),
  ].join("\n");
}

const tokens = (s: string) =>
  s.toLowerCase().replace(/[''`]/g, "").split(/[^a-z0-9°.]+/).filter(Boolean).map((t) => t.replace(/\.$/, ""));

/** Title words must all come from the product's own data (joining words excepted). */
export function ungroundedTitleWords(title: string, facts: string): string[] {
  const known = new Set(tokens(facts));
  const allowed = new Set(["and", "with", "for", "the", "a", "in", "of", "&"]);
  return tokens(title).filter((w) => !known.has(w) && !allowed.has(w));
}

/** A number with the unit or symbol that follows it: "30°F", "28L", "28 liters", "400-Lumen", "3-Person". */
const SPEC_TOKEN = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?-?\s?(°\s?[FC]|degrees?\s+(?:Fahrenheit|Celsius)|[A-Za-z]+))?/gi;

// Temperature written without its scale: fine only if the text never gives the precise form.
const IMPRECISE_UNITS = new Set(["f", "c", "degree"]);

// Spellings that mean the same unit. A bare "f"/"c" or "degree" is NOT °F/°C: it drops the scale,
// so those count as their own (wrong) units. Any other word after a number ("5 to 11") isn't a unit.
const UNIT_ALIASES: Record<string, string> = {
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  person: "person", persons: "person", people: "person",
  lumen: "lumen", lumens: "lumen",
  g: "g", gram: "g", grams: "g", kg: "kg", oz: "oz", lb: "lb", lbs: "lb",
  ml: "ml", mm: "mm", cm: "cm",
  f: "f", c: "c", degree: "degree", degrees: "degree",
};

function specs(text: string): { raw: string; num: string; unit: string }[] {
  return [...text.matchAll(SPEC_TOKEN)].map((m) => {
    const u = (m[2] ?? "").toLowerCase().replace(/\s+/g, "");
    const unit = u.startsWith("°") ? u : u.startsWith("degree") && u.endsWith("fahrenheit") ? "°f" : u.startsWith("degree") && u.endsWith("celsius") ? "°c" : (UNIT_ALIASES[u] ?? "");
    // "771.0", "771" and "1,868" / "1868" are the same numbers.
    return { raw: unit ? m[0] : m[1], num: String(Number(m[1].replace(/,/g, ""))), unit };
  });
}

/**
 * The product's own written text, for checking specs: title, type, description, tags and option
 * values. Not the handle (a URL slug: "30f") and not attribute values (the fixer may have
 * written those, and a fix must never be grounded in an earlier fix).
 */
export function readableFacts(p: ShopifyProduct): string {
  return [p.title, p.productType, htmlToText(p.descriptionHtml), ...p.tags, ...p.options.flatMap((o) => o.values)].join("\n");
}

/**
 * Every spec in a title must match the product's readable data in number AND unit — "28L" matches
 * "28 liters", but "30f" or "30 Degree" don't match "30°F". Returns the offending tokens.
 */
export function unfaithfulSpecs(title: string, readable: string): string[] {
  const known = specs(readable);
  return specs(title)
    .filter(({ num, unit }) => {
      const matched = known.some((k) => k.num === num && (unit === "" || k.unit === unit));
      // "30 Degree" or "30f" where the text says "30°F": the scale was dropped.
      const vaguer = IMPRECISE_UNITS.has(unit) && known.some((k) => k.num === num && k.unit.startsWith("°"));
      return !matched || vaguer;
    })
    .map((s) => s.raw.trim());
}

/** Numbers in a drafted description must all appear in the product's own data. */
export function ungroundedNumbers(text: string, facts: string): string[] {
  const known = new Set(facts.match(/\d+(?:\.\d+)?/g) ?? []);
  return [...new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])].filter((n) => !known.has(n));
}

function encodeValue(type: MetafieldType, raw: string): string | null {
  const v = raw.trim();
  switch (type) {
    case "boolean":
      return /^(true|false)$/i.test(v) ? v.toLowerCase() : null;
    case "number_integer":
      return /^\d+$/.test(v) ? v : null;
    case "weight":
      return /^\d+(\.\d+)?$/.test(v) ? JSON.stringify({ value: Number(v), unit: "GRAMS" }) : null;
    case "single_line_text_field":
      return v && v.length <= 120 ? v : null;
  }
}

const SYSTEM = `You fix product listings for an outdoor-gear store so AI shopping agents can use them.
Use ONLY facts present in the product data you are given. Never add specs, materials, numbers
or claims that are not there — a missing fact must stay missing (return null).`;

function buildPrompt(p: ShopifyProduct, category: Category, needs: ModelFixNeeds, types: Map<string, MetafieldType>) {
  const labels = new Map(REQUIRED_ATTRIBUTES[category].map((a) => [a.key, a.label]));
  const parts = [`PRODUCT DATA\n${productFacts(p)}`];
  if (needs.missingKeys.length) {
    parts.push(
      `ATTRIBUTES — for each key, the value stated anywhere in the product data (title, description, options, other attributes), in the given format, with a verbatim quote from the product data as evidence. Null if not stated anywhere.\n` +
        needs.missingKeys
          .map((k) => `- ${k} (${labels.get(k)}): ${KEY_HINT[k] ?? TYPE_HINT[types.get(k) ?? "single_line_text_field"]}`)
          .join("\n"),
    );
  }
  if (needs.title) {
    parts.push(
      `TITLE — rewrite as "<Model name> <specific product type> - <Men's/Women's if known>" or with one key spec (capacity, temperature, person count). Title Case, 20–80 characters, no ALL CAPS, no promo words ("New", "Sale", years, "!!"). Use only words from the product data.`,
    );
  }
  if (needs.description) {
    parts.push(
      `DESCRIPTION — write 2–4 short factual sentences in <p> tags from the attribute values and facts above (fit, materials, use, weather protection, weight/capacity). No marketing language, no facts that aren't in the data.`,
    );
  }
  return parts.join("\n\n");
}

export async function modelProposals(
  p: ShopifyProduct,
  score: ProductScore,
  needs: ModelFixNeeds,
  types: Map<string, MetafieldType>,
  model: ModelSpec,
): Promise<FixProposal[]> {
  const out = await generateStructured({
    route: "fixer.product",
    model,
    schema: schemaFor(needs),
    system: SYSTEM,
    prompt: buildPrompt(p, score.category, needs, types),
    temperature: 0,
  });

  const base = { productId: p.id, handle: p.handle, source: "model" as const };
  const facts = productFacts(p);
  const proposals: FixProposal[] = [];
  const found = new Set<string>();

  for (const a of out.attributes) {
    const type = types.get(a.key) ?? "single_line_text_field";
    const value = a.value ? encodeValue(type, a.value) : null;
    // The quote must come from text a shopper can read — never the URL handle ("lynx-30f-…").
    if (!value || !quoteAppearsIn(a.evidence, readableFacts(p))) continue;
    // Specs in the value must match the quote exactly: "30°F" from "30°F", never "30F".
    if (type === "single_line_text_field" && unfaithfulSpecs(value, `${a.evidence}
${readableFacts(p)}`).length) continue;
    found.add(a.key);
    proposals.push({
      ...base,
      checkId: "required_attributes",
      target: a.key,
      change: { kind: "set_metafield", key: a.key, type, value },
      before: null,
      evidence: a.evidence,
    });
  }
  // Whatever the description doesn't state, only the merchant can supply.
  const labels = new Map(REQUIRED_ATTRIBUTES[score.category].map((x) => [x.key, x.label]));
  for (const key of needs.missingKeys.filter((k) => !found.has(k))) {
    proposals.push({
      ...base,
      source: "rule",
      checkId: "required_attributes",
      target: key,
      change: { kind: "needs_merchant", reason: `${labels.get(key)} isn't stated anywhere in the product data` },
      before: null,
      evidence: null,
    });
  }

  if (needs.title && out.title) {
    const title = out.title.trim();
    if (
      title !== p.title &&
      titleFormatProblems(title).length === 0 &&
      ungroundedTitleWords(title, facts).length === 0 &&
      unfaithfulSpecs(title, readableFacts(p)).length === 0
    ) {
      proposals.push({ ...base, checkId: "title_specificity", target: "title", change: { kind: "set_title", title }, before: p.title, evidence: null });
    }
  }

  if (needs.description && out.descriptionHtml) {
    const html = out.descriptionHtml.trim();
    if (ungroundedNumbers(htmlToText(html), facts).length === 0 && htmlToText(html).length >= 80) {
      proposals.push({
        ...base,
        checkId: "description_answerability",
        target: "description",
        change: { kind: "set_description", descriptionHtml: html },
        before: p.descriptionHtml,
        evidence: null,
      });
    }
  }
  return proposals;
}

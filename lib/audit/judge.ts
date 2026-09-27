// The per-product model call for the audit: check 2 (answerability), the prose half of
// check 1, and the content half of check 4, in one structured call. Cached by product
// content hash + model + rubric version, so unchanged products are never re-judged.

import { and, eq } from "drizzle-orm";
import { generateStructured } from "../ai/generate";
import type { ModelSpec } from "../ai/models";
import { htmlToText } from "../catalog/defects";
import { getDb, schema } from "../db";
import type { ShopifyProduct } from "../shopify/products";
import {
  ANSWERABILITY_TEMPERATURE,
  productAuditSchemaFor,
  REQUIRED_ATTRIBUTES,
  RUBRIC_VERSION,
  SHOPPER_QUESTIONS,
  type Category,
  type ProductAuditLlmResult,
} from "./rubric";

const SYSTEM = `You audit product listings for an outdoor-gear store. You judge only what the given
text literally says — never what the product probably is, and never from general knowledge.

Rules:
- A question is answered, or an attribute is stated, only if the DESCRIPTION says it.
- Every "evidence" must be a short verbatim quote copied character-for-character from the
  DESCRIPTION (one phrase or sentence). If you cannot quote it, answered/stated is false and
  evidence is null.
- Marketing language ("built for adventure", "you'll love it") answers nothing.
- For the title: judge the TITLE text alone.`;

export function buildPrompt(p: ShopifyProduct, category: Category): string {
  const questions = SHOPPER_QUESTIONS[category].map((q) => `- ${q.id}: ${q.text}`).join("\n");
  const attributes = REQUIRED_ATTRIBUTES[category].map((a) => `- ${a.key}: ${a.label}`).join("\n");
  return `TITLE: ${p.title}

DESCRIPTION:
${htmlToText(p.descriptionHtml) || "(empty)"}

SHOPPER QUESTIONS — for each id, does the description answer it?
${questions}

ATTRIBUTES — for each key, does the description state its value?
${attributes}

TITLE CONTENT — copy the exact TITLE words that name a specific product type (null if none), and
list each TITLE phrase that distinguishes it (model name, gender, capacity, material, season,
size) as a separate item (empty list if none). Vague nouns and marketing or promo words don't count.`;
}

export type JudgeResult = { result: ProductAuditLlmResult; cached: boolean };

export async function judgeProduct(
  p: ShopifyProduct,
  category: Category,
  contentHash: string,
  model: ModelSpec,
  /** Awaited before a real model call (not on a cache hit) — lets batch callers pace requests. */
  beforeCall?: () => Promise<void>,
): Promise<JudgeResult> {
  const db = getDb();
  const key = and(
    eq(schema.auditLlmCache.contentHash, contentHash),
    eq(schema.auditLlmCache.model, model.id),
    eq(schema.auditLlmCache.rubricVersion, RUBRIC_VERSION),
  );
  const [hit] = await db.select({ result: schema.auditLlmCache.result }).from(schema.auditLlmCache).where(key);
  if (hit) return { result: hit.result as ProductAuditLlmResult, cached: true };

  await beforeCall?.();
  const result = await generateStructured({
    route: "audit.product",
    model,
    schema: productAuditSchemaFor(category),
    system: SYSTEM,
    prompt: buildPrompt(p, category),
    temperature: ANSWERABILITY_TEMPERATURE,
  });
  await db
    .insert(schema.auditLlmCache)
    .values({ contentHash, model: model.id, rubricVersion: RUBRIC_VERSION, result })
    .onConflictDoNothing();
  return { result, cached: false };
}

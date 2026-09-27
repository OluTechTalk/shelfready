// Agent-readiness rubric as typed constants. Source of truth for the prose is docs/RUBRIC.md;
// keep the two in sync and log weight/check changes in docs/DECISIONS.md.
// No scoring logic lives here — only the specs the checks and the LLM call are built from.

import { z } from "zod";

export const RUBRIC_VERSION = "v1";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  "footwear",
  "apparel",
  "backpacks",
  "tents",
  "sleeping_bags",
  "accessories",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

// ---------------------------------------------------------------------------
// Checks and weights (sum to 100)
// ---------------------------------------------------------------------------

export type CheckType = "rule" | "llm" | "rule+llm";

export type CheckSpec = {
  id: CheckId;
  label: string;
  weight: number;
  type: CheckType;
};

export const CHECK_IDS = [
  "required_attributes",
  "description_answerability",
  "variant_structure",
  "title_specificity",
  "price_availability",
  "images_alt_text",
  "taxonomy",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export const CHECKS: Record<CheckId, CheckSpec> = {
  // rule+llm: the model only reports which missing attributes the description states (half credit).
  required_attributes: { id: "required_attributes", label: "Required attributes", weight: 30, type: "rule+llm" },
  description_answerability: {
    id: "description_answerability",
    label: "Description answerability",
    weight: 20,
    type: "llm",
  },
  variant_structure: { id: "variant_structure", label: "Variant structure", weight: 15, type: "rule" },
  title_specificity: { id: "title_specificity", label: "Title specificity", weight: 10, type: "rule+llm" },
  price_availability: { id: "price_availability", label: "Price & availability", weight: 10, type: "rule" },
  images_alt_text: { id: "images_alt_text", label: "Images & alt text", weight: 10, type: "rule" },
  taxonomy: { id: "taxonomy", label: "Taxonomy", weight: 5, type: "rule" },
};

export const TOTAL_WEIGHT = 100;

// ---------------------------------------------------------------------------
// Rule thresholds (v1)
// ---------------------------------------------------------------------------

/** Check 1: an attribute stated only in the description (not a metafield) earns this much. */
export const PROSE_ATTRIBUTE_CREDIT = 0.5;

/** Check 3: option names an agent can map without guessing. */
export const STANDARD_OPTION_NAMES: readonly string[] = ["Size", "Color"];

/** Check 4: title length bounds (inclusive). */
export const TITLE_MIN_LENGTH = 20;
export const TITLE_MAX_LENGTH = 80;

/** Check 4: placeholder or promo text that says nothing about the product. */
export const TITLE_PLACEHOLDER_PATTERN = /\b(untitled|new|sale|copy|item|product|stuff|20\d\d)\b|!!/i;

/** Check 7: minimum tag count, and tags that don't count toward it (promo/status, not product facts). */
export const MIN_TAGS = 3;
export const NON_MEANINGFUL_TAGS: readonly string[] = ["new", "sale", "bestseller", "featured", "clearance", "hot"];

// ---------------------------------------------------------------------------
// Bands (score is 0–100; a band covers [min, next band's min))
// ---------------------------------------------------------------------------

export const BAND_IDS = ["agent_ready", "partial", "not_ready"] as const;

export type BandId = (typeof BAND_IDS)[number];

export type BandSpec = { id: BandId; label: string; min: number; meaning: string };

// Ordered highest first so the first band with score >= min wins.
export const BANDS: readonly BandSpec[] = [
  { id: "agent_ready", label: "Agent-ready", min: 80, meaning: "An agent can match and recommend it confidently" },
  { id: "partial", label: "Partial", min: 50, meaning: "Findable, but agents will guess or skip on specific requests" },
  { id: "not_ready", label: "Not ready", min: 0, meaning: "Effectively invisible to agents on anything but its name" },
];

// ---------------------------------------------------------------------------
// Required attributes by category (check 1)
// `key` is the stable id we expect as a metafield key; `label` is for UI and prompts.
// ---------------------------------------------------------------------------

export type RequiredAttribute = { key: string; label: string };

export const REQUIRED_ATTRIBUTES: Record<Category, readonly RequiredAttribute[]> = {
  footwear: [
    { key: "size_range", label: "Size range" },
    { key: "width", label: "Width" },
    { key: "gender_fit", label: "Gender / fit" },
    { key: "upper_material", label: "Upper material" },
    { key: "waterproof", label: "Waterproof (y/n)" },
    { key: "use_case", label: "Use case (trail, hiking, casual)" },
  ],
  apparel: [
    { key: "size_range", label: "Size range" },
    { key: "gender_fit", label: "Gender / fit" },
    { key: "material", label: "Material" },
    { key: "weather_rating", label: "Waterproof / insulation rating" },
    { key: "use_case", label: "Use case" },
  ],
  backpacks: [
    { key: "capacity_l", label: "Capacity (L)" },
    { key: "weight", label: "Weight" },
    { key: "frame_type", label: "Frame type" },
    { key: "use_case", label: "Use case (daypack, multi-day)" },
  ],
  tents: [
    { key: "capacity_people", label: "Capacity (people)" },
    { key: "season_rating", label: "Season rating" },
    { key: "packed_weight", label: "Packed weight" },
    { key: "setup_type", label: "Setup type" },
  ],
  sleeping_bags: [
    { key: "temperature_rating", label: "Temperature rating" },
    { key: "fill_type", label: "Fill type" },
    { key: "weight", label: "Weight" },
    { key: "shape", label: "Shape" },
  ],
  accessories: [
    { key: "material", label: "Material" },
    { key: "dimensions", label: "Size / dimensions" },
    { key: "use_case", label: "Use case" },
  ],
};

// ---------------------------------------------------------------------------
// Standard shopper questions by category (check 2) — exactly 5 per category.
// Ids are `<category>.<slug>` so they stay unique across categories and stable across runs.
// ---------------------------------------------------------------------------

export type ShopperQuestion = { id: string; text: string };

type FiveQuestions = readonly [ShopperQuestion, ShopperQuestion, ShopperQuestion, ShopperQuestion, ShopperQuestion];

export const QUESTIONS_PER_CATEGORY = 5;

export const SHOPPER_QUESTIONS: Record<Category, FiveQuestions> = {
  footwear: [
    { id: "footwear.waterproof", text: "Is it waterproof?" },
    { id: "footwear.fit", text: "How does it fit (true to size, wide)?" },
    { id: "footwear.terrain", text: "What terrain is it for?" },
    { id: "footwear.upper_material", text: "What is the upper made of?" },
    { id: "footwear.weight", text: "How heavy is it?" },
  ],
  apparel: [
    { id: "apparel.weather", text: "Is it waterproof / warm enough for the conditions?" },
    { id: "apparel.fit", text: "How does it fit?" },
    { id: "apparel.material", text: "What's it made of?" },
    { id: "apparel.care", text: "How do I care for it?" },
    { id: "apparel.activity", text: "What activity is it for?" },
  ],
  backpacks: [
    { id: "backpacks.capacity", text: "How many liters?" },
    { id: "backpacks.weight", text: "How heavy is it?" },
    { id: "backpacks.laptop_hydration", text: "Will it fit a laptop / hydration bladder?" },
    { id: "backpacks.multi_day", text: "Is it good for multi-day trips?" },
    { id: "backpacks.carry_on", text: "Is it carry-on size?" },
  ],
  tents: [
    { id: "tents.capacity", text: "How many people does it fit?" },
    { id: "tents.seasons", text: "Which seasons is it for?" },
    { id: "tents.packed_weight", text: "What is the packed weight?" },
    { id: "tents.setup", text: "How hard is setup?" },
    { id: "tents.freestanding", text: "Is it freestanding?" },
  ],
  sleeping_bags: [
    { id: "sleeping_bags.temperature", text: "What is the temperature rating?" },
    { id: "sleeping_bags.fill", text: "Is it down or synthetic?" },
    { id: "sleeping_bags.packed", text: "What is the packed size / weight?" },
    { id: "sleeping_bags.shape", text: "What shape is it?" },
    { id: "sleeping_bags.side_sleepers", text: "Is it good for side sleepers?" },
  ],
  accessories: [
    { id: "accessories.material", text: "What's it made of?" },
    { id: "accessories.size", text: "What size is it?" },
    { id: "accessories.purpose", text: "What's it for?" },
    { id: "accessories.care", text: "How do I care for it?" },
    { id: "accessories.compatibility", text: "What is it compatible with?" },
  ],
};

// ---------------------------------------------------------------------------
// LLM answerability check (check 2) — settings and structured-output schemas
// ---------------------------------------------------------------------------

// Same model + temperature 0 on every audit run so before/after scores are comparable.
// Results are cached by product content hash (caching lives with the scoring code).
export const ANSWERABILITY_TEMPERATURE = 0;

// One verdict per question. `evidence` must be a verbatim quote from the description.
// The "no quote = not answered" rule is enforced by the scorer, not by a refinement here,
// so a slightly-off model response is scored as unanswered instead of failing the call.
export const QuestionAnswerSchema = z.object({
  questionId: z.string().describe("The id of the shopper question being judged, copied exactly"),
  answered: z.boolean().describe("True only if the description itself answers the question"),
  evidence: z
    .string()
    .nullable()
    .describe("A verbatim quote from the description that answers the question, or null if not answered"),
});

export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const AnswerabilityResultSchema = z.object({
  answers: z.array(QuestionAnswerSchema).length(QUESTIONS_PER_CATEGORY),
});

export type AnswerabilityResult = z.infer<typeof AnswerabilityResultSchema>;

// Tighter per-category schema for the model call: questionId is constrained to that
// category's five ids, so the model can't invent or misspell one.
export function answerabilitySchemaFor(category: Category) {
  const ids = SHOPPER_QUESTIONS[category].map((q) => q.id) as [string, ...string[]];
  return z.object({
    answers: z
      .array(QuestionAnswerSchema.extend({ questionId: z.enum(ids) }))
      .length(QUESTIONS_PER_CATEGORY),
  });
}

// ---------------------------------------------------------------------------
// Single per-product model call (v1): check 2 answers, check 1 prose attributes, check 4
// title content. One call per product keeps the free-tier budget at ~150 calls per audit.
// Evidence rules match check 2: no verbatim quote = not stated.
// ---------------------------------------------------------------------------

export const AttributeInProseSchema = z.object({
  key: z.string().describe("The attribute key, copied exactly"),
  stated: z.boolean().describe("True only if the description states this attribute's value"),
  evidence: z.string().nullable().describe("A verbatim quote from the description stating the value, or null"),
});

export type AttributeInProse = z.infer<typeof AttributeInProseSchema>;

// Each verdict carries the exact title words it relied on; the scorer rejects words that
// aren't in the title, the same no-quote-no-credit rule as check 2.
export const TitleContentSchema = z.object({
  productTypeWords: z
    .string()
    .nullable()
    .describe(
      "The words in the title that name a specific product type a shopper would search for, e.g. 'Rain Jacket', 'Hiking Boot', 'Daypack', 'Sleeping Bag'. Null if the title only uses a vague word ('Layer', 'Gear', 'Item', 'Accessory', 'Bag' alone).",
    ),
  distinguishingWords: z
    .array(z.string())
    .describe(
      "Each title phrase, copied exactly and listed separately, that distinguishes this product from others of its type: a model name, gender, capacity, material, season or size. Marketing adjectives ('Cozy', 'Awesome', 'Great', 'Warm') and dates/promo words ('New', '2024', 'Sale') do NOT count. Empty if none.",
    ),
});

export type TitleContent = z.infer<typeof TitleContentSchema>;

export function productAuditSchemaFor(category: Category) {
  const keys = REQUIRED_ATTRIBUTES[category].map((a) => a.key) as [string, ...string[]];
  return answerabilitySchemaFor(category).extend({
    attributes: z
      .array(AttributeInProseSchema.extend({ key: z.enum(keys) }))
      .length(keys.length),
    title: TitleContentSchema,
  });
}

export type ProductAuditLlmResult = {
  answers: QuestionAnswer[];
  attributes: AttributeInProse[];
  title: TitleContent;
};

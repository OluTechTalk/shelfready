// Agent-readiness rubric as typed constants. Source of truth for the prose is docs/RUBRIC.md;
// keep the two in sync and log weight/check changes in docs/DECISIONS.md.
// No scoring logic lives here — only the specs the checks and the LLM call are built from.

import { z } from "zod";

export const RUBRIC_VERSION = "v0";

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
  required_attributes: { id: "required_attributes", label: "Required attributes", weight: 30, type: "rule" },
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

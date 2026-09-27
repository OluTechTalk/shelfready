// Model choices live here and only here (see DECISIONS.md, "Default model").
// Pin exact model ids — never "-latest" — so audit runs before and after fixes are comparable.

import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

export type ModelSpec = {
  provider: "google" | "groq";
  id: string;
  /** USD per 1M tokens; 0 on the free tier. Tokens are always logged, so cost can be recomputed. */
  pricePerMTokIn: number;
  pricePerMTokOut: number;
};

export const MODELS = {
  // flash-lite, not flash: in Sep 2026 gemini-3.5-flash was intermittently overloaded (503s,
  // 17–70 s calls) while flash-lite answered in < 1 s; gemini-2.5-* is closed to new keys.
  default: { provider: "google", id: "gemini-3.5-flash-lite", pricePerMTokIn: 0, pricePerMTokOut: 0 },
  backup: { provider: "groq", id: "openai/gpt-oss-120b", pricePerMTokIn: 0, pricePerMTokOut: 0 },
} as const satisfies Record<string, ModelSpec>;

export function languageModel(spec: ModelSpec): LanguageModel {
  return spec.provider === "google" ? google(spec.id) : groq(spec.id);
}

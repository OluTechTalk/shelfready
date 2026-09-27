// The one way this app calls a model for data: structured output against a Zod schema,
// with tokens, latency and cost logged to `model_calls` for every call — including failed
// ones, so the case study's cost numbers include retries.

import { generateText, NoObjectGeneratedError, Output, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import { getDb, schema as db } from "../db";
import { languageModel, type ModelSpec } from "./models";

type Args<S extends z.ZodType> = {
  route: string; // what triggered the call, e.g. "audit.product"
  model: ModelSpec;
  schema: S;
  system: string;
  prompt: string;
  temperature?: number;
};

async function logCall(route: string, model: ModelSpec, usage: LanguageModelUsage | undefined, latencyMs: number) {
  const tokensIn = usage?.inputTokens ?? 0;
  const tokensOut = usage?.outputTokens ?? 0;
  const cost = (tokensIn * model.pricePerMTokIn + tokensOut * model.pricePerMTokOut) / 1_000_000;
  try {
    await getDb().insert(db.modelCalls).values({
      model: model.id,
      provider: model.provider,
      route,
      tokensIn,
      tokensOut,
      latencyMs,
      costUsd: cost.toFixed(6),
    });
  } catch (err) {
    // Never fail a model call because logging failed; say so without leaking details.
    console.warn(`model_calls log failed: ${err instanceof Error ? err.name : "unknown"}`);
  }
}

export async function generateStructured<S extends z.ZodType>(args: Args<S>): Promise<z.infer<S>> {
  const t0 = Date.now();
  try {
    const result = await generateText({
      model: languageModel(args.model),
      output: Output.object({ schema: args.schema }),
      system: args.system,
      prompt: args.prompt,
      temperature: args.temperature ?? 0,
    });
    await logCall(args.route, args.model, result.usage, Date.now() - t0);
    return result.output as z.infer<S>;
  } catch (err) {
    await logCall(args.route, args.model, NoObjectGeneratedError.isInstance(err) ? err.usage : undefined, Date.now() - t0);
    throw err;
  }
}

// Read-side queries for the /eval page: before/after eval runs and their per-task results.

import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";

export type EvalSummary = {
  tasks: number;
  successRate: number;
  wrongProductRate: number;
  wrongVariantRate: number;
  noCartRate: number;
  errorRate: number;
  avgSteps: number;
  avgToolCalls: number;
  avgTokens: number;
  avgLatencyMs: number;
  byKind: Record<"messy_target" | "clean_target" | "no_match", { tasks: number; successRate: number | null }>;
};

export type EvalTaskRow = {
  taskId: string;
  outcome: string;
  success: boolean;
  toolCalls: number;
  tokens: number;
  transcript: {
    steps: { text: string; calls: { tool: string; input: unknown; output: string }[] }[];
    cart: { variantId: string; quantity: number }[];
    answer: string;
    error?: string;
  };
};

export type EvalPair = {
  label: string;
  model: string;
  createdAt: Date;
  before: { summary: EvalSummary; results: Map<string, EvalTaskRow> };
  after: { summary: EvalSummary; results: Map<string, EvalTaskRow> };
};

/** Labels that have both a before and an after run, newest first. */
export async function listEvalPairs(): Promise<{ label: string; model: string; createdAt: Date }[]> {
  // Only finished runs: an interrupted run has no summary yet.
  const runs = (await getDb().select().from(schema.evalRuns).orderBy(desc(schema.evalRuns.id))).filter((r) => typeof (r.summary as { tasks?: number }).tasks === "number");
  const out: { label: string; model: string; createdAt: Date }[] = [];
  for (const r of runs) {
    if (out.some((o) => o.label === r.label)) continue;
    if (runs.some((x) => x.label === r.label && x.catalog === "before") && runs.some((x) => x.label === r.label && x.catalog === "after")) {
      out.push({ label: r.label, model: r.model, createdAt: r.createdAt });
    }
  }
  return out;
}

export async function getEvalPair(label: string): Promise<EvalPair | null> {
  const db = getDb();
  const runs = await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.label, label)).orderBy(desc(schema.evalRuns.id));
  const before = runs.find((r) => r.catalog === "before");
  const after = runs.find((r) => r.catalog === "after");
  if (!before || !after) return null;
  const rows = await db
    .select()
    .from(schema.evalResults)
    .where(inArray(schema.evalResults.runId, [before.id, after.id]))
    .orderBy(asc(schema.evalResults.taskId));
  const toMap = (runId: number) =>
    new Map(
      rows
        .filter((r) => r.runId === runId)
        .map((r) => [
          r.taskId,
          {
            taskId: r.taskId,
            outcome: r.outcome,
            success: r.success,
            toolCalls: r.toolCalls,
            tokens: r.tokensIn + r.tokensOut,
            transcript: r.transcript as EvalTaskRow["transcript"],
          },
        ]),
    );
  return {
    label,
    model: after.model,
    createdAt: after.createdAt,
    before: { summary: before.summary as EvalSummary, results: toMap(before.id) },
    after: { summary: after.summary as EvalSummary, results: toMap(after.id) },
  };
}

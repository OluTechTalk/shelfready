import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Raw Shopify products, synced by `npm run sync`. `contentHash` drives re-audits. */
export const products = pgTable("products", {
  id: text("id").primaryKey(), // Shopify GID, e.g. gid://shopify/Product/123
  handle: text("handle").notNull(),
  raw: jsonb("raw").notNull(),
  contentHash: text("content_hash").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per model call, for the case study's cost and latency numbers. */
export const modelCalls = pgTable("model_calls", {
  id: serial("id").primaryKey(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  route: text("route").notNull(), // what triggered the call, e.g. "audit.answerability"
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cached model judgments for the audit, keyed by what was judged: re-scoring an unchanged
 * product with the same model and rubric never calls the model again.
 */
export const auditLlmCache = pgTable(
  "audit_llm_cache",
  {
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    result: jsonb("result").notNull(), // ProductAuditLlmResult
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.model, t.rubricVersion] })],
);

/** One row per `npm run audit`. Kept forever so before/after scores can be compared. */
export const auditRuns = pgTable("audit_runs", {
  id: serial("id").primaryKey(),
  rubricVersion: text("rubric_version").notNull(),
  model: text("model").notNull(),
  storeScore: real("store_score").notNull(),
  summary: jsonb("summary").notNull(), // StoreSummary
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-product result of an audit run. */
export const auditScores = pgTable(
  "audit_scores",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    score: real("score").notNull(),
    band: text("band").notNull(),
    checks: jsonb("checks").notNull(), // Record<CheckId, CheckOutcome>
    contentHash: text("content_hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.productId] })],
);

/**
 * Fix proposals and their review state. The fixer inserts `pending` (or `needs_merchant`)
 * rows; only an approved row is ever written to Shopify. `contentHash` is the product
 * version the proposal was made against — apply refuses if the product changed since.
 */
export const fixProposals = pgTable(
  "fix_proposals",
  {
    id: serial("id").primaryKey(),
    productId: text("product_id").notNull(),
    handle: text("handle").notNull(),
    checkId: text("check_id").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    change: jsonb("change").notNull(), // FixChange (possibly edited by the reviewer)
    before: jsonb("before"),
    source: text("source").notNull(), // "rule" | "model"
    evidence: text("evidence"),
    status: text("status").notNull(), // FixStatus
    contentHash: text("content_hash").notNull(),
    auditRunId: integer("audit_run_id").references(() => auditRuns.id, { onDelete: "set null" }),
    edited: boolean("edited").notNull().default(false), // the reviewer changed `change`
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  // One open proposal per (product, kind, target): re-running the fixer never duplicates.
  (t) => [
    uniqueIndex("fix_proposals_open_uq")
      .on(t.productId, t.kind, t.target)
      .where(sql`${t.status} in ('pending', 'approved', 'needs_merchant')`),
  ],
);

/** One row per MCP tool call: what agents ask for, how often it works, how long it takes. */
export const mcpCalls = pgTable("mcp_calls", {
  id: serial("id").primaryKey(),
  tool: text("tool").notNull(),
  input: jsonb("input").notNull(),
  ok: boolean("ok").notNull(),
  error: text("error"),
  resultCount: integer("result_count"),
  latencyMs: integer("latency_ms").notNull(),
  source: text("source").notNull().default("live"), // "live" (the MCP route) or an eval run label
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One eval run: a model shopping every task against one catalog ("before" or "after"). */
export const evalRuns = pgTable("eval_runs", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(), // groups a before/after pair, e.g. "2026-09-28-gemini"
  catalog: text("catalog").notNull(), // "before" (messy fixture) | "after" (fixed live catalog)
  model: text("model").notNull(),
  summary: jsonb("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One task in an eval run, with its outcome and full transcript. */
export const evalResults = pgTable(
  "eval_results",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    outcome: text("outcome").notNull(), // success | wrong_product | no_cart | wrong_variant | error
    success: boolean("success").notNull(),
    steps: integer("steps").notNull(),
    toolCalls: integer("tool_calls").notNull(),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    transcript: jsonb("transcript").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.taskId] })],
);

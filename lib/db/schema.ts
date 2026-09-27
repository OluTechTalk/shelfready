import { integer, jsonb, numeric, pgTable, primaryKey, real, serial, text, timestamp } from "drizzle-orm/pg-core";

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

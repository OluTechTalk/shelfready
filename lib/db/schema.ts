import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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

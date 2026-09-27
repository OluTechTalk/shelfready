// Read-side queries for the audit UI. No model calls; everything comes from stored runs.

import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { CheckOutcome } from "./checks";
import type { BandId, Category, CheckId } from "./rubric";
import type { StoreSummary } from "./score";

export type AuditRunView = {
  id: number;
  rubricVersion: string;
  model: string;
  createdAt: Date;
  summary: StoreSummary;
  products: {
    productId: string;
    handle: string;
    title: string;
    category: Category;
    score: number;
    band: BandId;
    checks: Record<CheckId, CheckOutcome>;
  }[]; // worst first
};

export async function getLatestAuditRun(): Promise<AuditRunView | null> {
  const db = getDb();
  const [run] = await db.select().from(schema.auditRuns).orderBy(desc(schema.auditRuns.id)).limit(1);
  if (!run) return null;
  const rows = await db
    .select()
    .from(schema.auditScores)
    .where(eq(schema.auditScores.runId, run.id))
    .orderBy(asc(schema.auditScores.score), asc(schema.auditScores.title));
  return {
    id: run.id,
    rubricVersion: run.rubricVersion,
    model: run.model,
    createdAt: run.createdAt,
    summary: run.summary as StoreSummary,
    products: rows.map((r) => ({
      productId: r.productId,
      handle: r.handle,
      title: r.title,
      category: r.category as Category,
      score: r.score,
      band: r.band as BandId,
      checks: r.checks as Record<CheckId, CheckOutcome>,
    })),
  };
}

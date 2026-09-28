// Read-side queries for the audit UI. No model calls; everything comes from stored runs.

import { and, asc, desc, eq } from "drizzle-orm";
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

export type BaselineComparison = {
  baseline: { id: number; createdAt: Date; summary: StoreSummary };
  changed: { productId: string; titleBefore: string; titleAfter: string; scoreBefore: number; scoreAfter: number; bandBefore: BandId; bandAfter: BandId }[]; // biggest gain first
};

/**
 * Compares a run with the baseline: the first run on the same rubric version and model, so
 * every difference comes from catalog changes, not from scoring changes.
 */
export async function getBaselineComparison(run: AuditRunView): Promise<BaselineComparison | null> {
  const db = getDb();
  const [baseline] = await db
    .select()
    .from(schema.auditRuns)
    .where(and(eq(schema.auditRuns.rubricVersion, run.rubricVersion), eq(schema.auditRuns.model, run.model)))
    .orderBy(asc(schema.auditRuns.id))
    .limit(1);
  if (!baseline || baseline.id === run.id) return null;
  const before = new Map(
    (await db.select().from(schema.auditScores).where(eq(schema.auditScores.runId, baseline.id))).map((s) => [s.productId, s]),
  );
  const changed = run.products
    .flatMap((p) => {
      const b = before.get(p.productId);
      return b && b.score !== p.score
        ? [{ productId: p.productId, titleBefore: b.title, titleAfter: p.title, scoreBefore: b.score, scoreAfter: p.score, bandBefore: b.band as BandId, bandAfter: p.band }]
        : [];
    })
    .sort((a, b) => b.scoreAfter - b.scoreBefore - (a.scoreAfter - a.scoreBefore));
  return { baseline: { id: baseline.id, createdAt: baseline.createdAt, summary: baseline.summary as StoreSummary }, changed };
}

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

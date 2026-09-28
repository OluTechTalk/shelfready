// Read-side queries for the review queue UI. No writes, no model calls.

import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { ShopifyProduct } from "../shopify/products";
import { FIX_STATUSES, FixChangeSchema, type FixChange, type FixStatus } from "./types";

export type ReviewItem = {
  id: number;
  checkId: string;
  kind: FixChange["kind"];
  change: FixChange;
  before: unknown;
  source: string;
  evidence: string | null;
  status: FixStatus;
  edited: boolean;
  error: string | null;
};

export type ReviewProduct = {
  productId: string;
  handle: string;
  title: string;
  score: number | null; // from the latest audit run
  items: ReviewItem[];
};

export const isFixStatus = (s: string | undefined): s is FixStatus => FIX_STATUSES.includes(s as FixStatus);

/** Shopify taxonomy id ("aa-1-10-2-10") → full name, from the categories the store already uses. */
async function categoryNames(): Promise<Record<string, string>> {
  const rows = await getDb().select({ raw: schema.products.raw }).from(schema.products);
  const names: Record<string, string> = {};
  for (const { raw } of rows) {
    const c = (raw as ShopifyProduct).category;
    if (c) names[c.id.replace("gid://shopify/TaxonomyCategory/", "")] = c.fullName;
  }
  return names;
}

export async function getReviewQueue(
  status: FixStatus,
): Promise<{ products: ReviewProduct[]; counts: Record<FixStatus, number>; categoryNames: Record<string, string> }> {
  const db = getDb();
  const names = await categoryNames();
  const all = await db.select({ status: schema.fixProposals.status }).from(schema.fixProposals);
  const counts = Object.fromEntries(FIX_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<FixStatus, number>;

  const rows = await db
    .select()
    .from(schema.fixProposals)
    .where(eq(schema.fixProposals.status, status))
    .orderBy(schema.fixProposals.handle, schema.fixProposals.id);
  if (!rows.length) return { products: [], counts, categoryNames: names };

  const ids = [...new Set(rows.map((r) => r.productId))];
  const products = await db.select({ id: schema.products.id, raw: schema.products.raw }).from(schema.products).where(inArray(schema.products.id, ids));
  const titles = new Map(products.map((p) => [p.id, (p.raw as ShopifyProduct).title]));
  const [run] = await db.select({ id: schema.auditRuns.id }).from(schema.auditRuns).orderBy(desc(schema.auditRuns.id)).limit(1);
  const scores = run
    ? new Map(
        (await db.select({ productId: schema.auditScores.productId, score: schema.auditScores.score }).from(schema.auditScores).where(eq(schema.auditScores.runId, run.id))).map((s) => [s.productId, s.score]),
      )
    : new Map<string, number>();

  const byProduct = new Map<string, ReviewProduct>();
  for (const r of rows) {
    const entry = byProduct.get(r.productId) ?? {
      productId: r.productId,
      handle: r.handle,
      title: titles.get(r.productId) ?? r.handle,
      score: scores.get(r.productId) ?? null,
      items: [],
    };
    const change = FixChangeSchema.parse(r.change);
    entry.items.push({
      id: r.id,
      checkId: r.checkId,
      kind: change.kind,
      change,
      before: r.before,
      source: r.source,
      evidence: r.evidence,
      status: r.status as FixStatus,
      edited: r.edited,
      error: r.error,
    });
    byProduct.set(r.productId, entry);
  }
  // Worst-scoring products first: that's where a reviewer's time matters most.
  return { products: [...byProduct.values()].sort((a, b) => (a.score ?? 100) - (b.score ?? 100)), counts, categoryNames: names };
}

// Applies approved fix proposals to Shopify — the only path from the fixer to the store.
// Rules: only `approved` rows are applied; a product's approved fixes go out as one batch;
// if the product changed since the proposals were made, nothing is written (re-propose).
// After writing, the product is re-synced into Postgres so the next audit sees it.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { applyProductChanges } from "../shopify/apply";
import { fetchProduct, productContentHash } from "../shopify/products";
import { FixChangeSchema } from "./types";

export type ApplyResult = { productId: string; handle: string; applied: number; failed: number; error?: string };

async function resync(productId: string) {
  const p = await fetchProduct(productId);
  if (!p) return;
  await getDb()
    .insert(schema.products)
    .values({ id: p.id, handle: p.handle, raw: p, contentHash: productContentHash(p) })
    .onConflictDoUpdate({
      target: schema.products.id,
      set: { handle: p.handle, raw: p, contentHash: productContentHash(p), syncedAt: sql`now()` },
    });
}

/** Lists the change set that would be written for a product — nothing is sent. */
export async function approvedChanges(productId: string) {
  const rows = await getDb()
    .select()
    .from(schema.fixProposals)
    .where(and(eq(schema.fixProposals.productId, productId), eq(schema.fixProposals.status, "approved")));
  return rows.map((r) => ({ id: r.id, contentHash: r.contentHash, change: FixChangeSchema.parse(r.change) }));
}

export async function applyApprovedForProduct(productId: string): Promise<ApplyResult> {
  const db = getDb();
  const rows = await approvedChanges(productId);
  const handle = (await db.select({ handle: schema.products.handle }).from(schema.products).where(eq(schema.products.id, productId)))[0]?.handle ?? productId;
  if (!rows.length) return { productId, handle, applied: 0, failed: 0 };

  const ids = rows.map((r) => r.id);
  const fail = async (error: string) => {
    await db.update(schema.fixProposals).set({ status: "failed", error }).where(inArray(schema.fixProposals.id, ids));
    return { productId, handle, applied: 0, failed: ids.length, error };
  };

  const live = await fetchProduct(productId);
  if (!live) return fail("Product no longer exists in Shopify");
  const liveHash = productContentHash(live);
  if (rows.some((r) => r.contentHash !== liveHash)) {
    return fail("Product changed in Shopify since these fixes were proposed — re-run `npm run propose`");
  }

  // Each step reports on its own, so one rejected write doesn't hide the ones that landed.
  const errors = await applyProductChanges(productId, rows.map((r) => r.change).filter((c) => c.kind !== "needs_merchant"));
  const failedRows = rows.filter((r) => errors[r.change.kind]);
  const appliedIds = rows.filter((r) => !errors[r.change.kind]).map((r) => r.id);
  if (appliedIds.length) {
    await db
      .update(schema.fixProposals)
      .set({ status: "applied", appliedAt: sql`now()`, error: null })
      .where(inArray(schema.fixProposals.id, appliedIds));
  }
  for (const r of failedRows) {
    await db.update(schema.fixProposals).set({ status: "failed", error: errors[r.change.kind] }).where(eq(schema.fixProposals.id, r.id));
  }
  await resync(productId);
  return {
    productId,
    handle,
    applied: appliedIds.length,
    failed: failedRows.length,
    ...(failedRows.length ? { error: [...new Set(failedRows.map((r) => errors[r.change.kind]))].join("; ") } : {}),
  };
}

// Applies approved fix proposals to Shopify — the only path from the fixer to the store.
// Rules: only `approved` rows are applied; each fix is first checked against the live
// product (the field it changes must still hold the value it was proposed against), so a
// fix never overwrites something a person changed in Shopify since. After writing, the
// product is re-synced into Postgres so the next audit sees it.

import { and, eq, inArray, sql } from "drizzle-orm";
import { METAFIELD_NAMESPACE } from "../catalog/schema";
import { getDb, schema } from "../db";
import { applyProductChanges } from "../shopify/apply";
import { fetchProduct, productContentHash, type ShopifyProduct } from "../shopify/products";
import { FixChangeSchema, type FixChange } from "./types";

export type ApplyResult = { productId: string; handle: string; applied: number; failed: number; error?: string };

const TAXONOMY_PREFIX = "gid://shopify/TaxonomyCategory/";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Optimistic concurrency per field: true when the part of the product this fix changes
 * still looks the way it did when the fix was proposed (`before`), or already has the
 * fix's value. Other fields may have changed — including other applied fixes.
 */
export function stillCurrent(p: ShopifyProduct, change: FixChange, before: unknown): boolean {
  switch (change.kind) {
    case "set_metafield": {
      const live = p.metafields.find((m) => m.namespace === METAFIELD_NAMESPACE && m.key === change.key)?.value ?? null;
      return live === null || live === change.value;
    }
    case "set_title":
      return p.title === before || p.title === change.title;
    case "set_description":
      return p.descriptionHtml === before || p.descriptionHtml === change.descriptionHtml;
    case "rename_option":
      return p.options.some((o) => o.name === change.from || o.name === change.to);
    case "set_variant_skus":
      return (before as { variantId: string; sku: string | null }[]).every((b) => {
        const v = p.variants.find((x) => x.id === b.variantId);
        return v !== undefined && (v.sku ?? null) === (b.sku ?? null);
      });
    case "set_alt_text":
      return (before as { mediaId: string; alt: string | null }[]).every((b) => {
        const m = p.media.find((x) => x.id === b.mediaId);
        return m !== undefined && (m.alt ?? "") === (b.alt ?? "");
      });
    case "set_taxonomy": {
      const b = before as { productType: string; categoryId: string | null; tags: string[] };
      return (
        (change.productType === undefined || p.productType === b.productType) &&
        (change.categoryId === undefined || same(p.category?.id.replace(TAXONOMY_PREFIX, "") ?? null, b.categoryId)) &&
        (change.tags === undefined || same(p.tags, b.tags))
      );
    }
    case "needs_merchant":
      return false;
  }
}

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

/** The approved change set for a product — nothing is sent. */
export async function approvedChanges(productId: string) {
  const rows = await getDb()
    .select()
    .from(schema.fixProposals)
    .where(and(eq(schema.fixProposals.productId, productId), eq(schema.fixProposals.status, "approved")));
  return rows.map((r) => ({ id: r.id, before: r.before, change: FixChangeSchema.parse(r.change) }));
}

export async function applyApprovedForProduct(productId: string): Promise<ApplyResult> {
  const db = getDb();
  const rows = await approvedChanges(productId);
  const handle = (await db.select({ handle: schema.products.handle }).from(schema.products).where(eq(schema.products.id, productId)))[0]?.handle ?? productId;
  if (!rows.length) return { productId, handle, applied: 0, failed: 0 };

  const errors = new Map<number, string>();
  const live = await fetchProduct(productId);
  if (!live) for (const r of rows) errors.set(r.id, "Product no longer exists in Shopify");
  else {
    for (const r of rows) {
      if (!stillCurrent(live, r.change, r.before)) errors.set(r.id, "Changed in Shopify since this fix was proposed — re-run `npm run propose`");
    }
    // Each step reports on its own, so one rejected write doesn't hide the ones that landed.
    const toSend = rows.filter((r) => !errors.has(r.id));
    const stepErrors = await applyProductChanges(productId, toSend.map((r) => r.change));
    for (const r of toSend) if (stepErrors[r.change.kind]) errors.set(r.id, stepErrors[r.change.kind]!);
  }

  const appliedIds = rows.filter((r) => !errors.has(r.id)).map((r) => r.id);
  if (appliedIds.length) {
    await db
      .update(schema.fixProposals)
      .set({ status: "applied", appliedAt: sql`now()`, error: null })
      .where(inArray(schema.fixProposals.id, appliedIds));
  }
  for (const [id, error] of errors) {
    await db.update(schema.fixProposals).set({ status: "failed", error }).where(eq(schema.fixProposals.id, id));
  }
  if (live) await resync(productId);
  return {
    productId,
    handle,
    applied: appliedIds.length,
    failed: errors.size,
    ...(errors.size ? { error: [...new Set(errors.values())].join("; ") } : {}),
  };
}

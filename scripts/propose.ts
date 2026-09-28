// Fills the review queue: for every product that loses points in the latest audit run,
// proposes fixes (model first, so alt text can use a fixed title; then rules) and stores
// them as `pending` — or `needs_merchant` when only the merchant can supply the data.
// Never writes to Shopify. Idempotent: products whose open proposals were made against the
// current content hash are skipped; unapproved proposals for older versions are replaced.
// Fixes a reviewer rejected are not suggested again while the field they target is unchanged,
// and needs_merchant items close once the product changes (re-flagged if still missing).
//
// Run: npm run sync && npm run audit && npm run propose

import { and, eq, inArray, ne } from "drizzle-orm";
import { MODELS } from "../lib/ai/models";
import { backOffForQuota, isQuotaError, paceModelCall, pool } from "../lib/ai/pace";
import { getLatestAuditRun } from "../lib/audit/queries";
import { scoreProduct } from "../lib/audit/score";
import type { CatalogMetafield } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import { modelFixNeeds, modelProposals, needsModel } from "../lib/fixer/model";
import { buildStoreContext, ruleProposals } from "../lib/fixer/rules";
import type { FixProposal } from "../lib/fixer/types";
import type { ShopifyProduct } from "../lib/shopify/products";

const CONCURRENCY = 3;
const ATTEMPTS = 3;
const OPEN = ["pending", "approved", "needs_merchant"];

async function main() {
  const db = getDb();
  const run = await getLatestAuditRun();
  if (!run) throw new Error("No audit run yet — run `npm run audit` first");
  const scores = new Map(run.products.map((s) => [s.productId, s]));

  const rows = await db.select().from(schema.products);
  const products = rows.map((r) => r.raw as ShopifyProduct);
  const ctx = buildStoreContext(products);
  const types = new Map<string, CatalogMetafield["type"]>();
  for (const p of products) for (const m of p.metafields) types.set(m.key, m.type as CatalogMetafield["type"]);

  const hashOf = new Map(rows.map((r) => [r.id, r.contentHash]));

  // Merchant gaps close themselves: once a product has changed (e.g. the merchant added the
  // missing detail), drop its old needs_merchant items; they're re-flagged below if still missing.
  const stale = (
    await db.select({ id: schema.fixProposals.id, productId: schema.fixProposals.productId, contentHash: schema.fixProposals.contentHash }).from(schema.fixProposals).where(eq(schema.fixProposals.status, "needs_merchant"))
  ).filter((r) => hashOf.has(r.productId) && hashOf.get(r.productId) !== r.contentHash);
  if (stale.length) await db.delete(schema.fixProposals).where(inArray(schema.fixProposals.id, stale.map((r) => r.id)));

  // A product is up to date if it already has proposals (open or rejected) for its current version.
  const current = await db
    .select({ productId: schema.fixProposals.productId, contentHash: schema.fixProposals.contentHash })
    .from(schema.fixProposals)
    .where(inArray(schema.fixProposals.status, [...OPEN, "rejected"]));
  const upToDate = new Set(current.filter((c) => hashOf.get(c.productId) === c.contentHash).map((c) => c.productId));
  const rejected = await db
    .select({ productId: schema.fixProposals.productId, kind: schema.fixProposals.kind, target: schema.fixProposals.target, before: schema.fixProposals.before })
    .from(schema.fixProposals)
    .where(eq(schema.fixProposals.status, "rejected"));
  /** A reviewer turned this exact fix down and the field hasn't changed since: don't suggest it again. */
  const wasRejected = (f: FixProposal) =>
    rejected.some((r) => r.productId === f.productId && r.kind === f.change.kind && r.target === f.target && JSON.stringify(r.before ?? null) === JSON.stringify(f.before ?? null));

  // Proposals are only as good as the audit behind them: a product that changed since the
  // latest audit (e.g. fixes were just applied) must be re-audited before it gets new fixes.
  const auditedHash = new Map(
    (await db.select({ productId: schema.auditScores.productId, contentHash: schema.auditScores.contentHash }).from(schema.auditScores).where(eq(schema.auditScores.runId, run.id))).map(
      (s) => [s.productId, s.contentHash],
    ),
  );
  const unaudited = rows.filter((r) => auditedHash.get(r.id) !== r.contentHash);
  if (unaudited.length) {
    console.warn(`Skipping ${unaudited.length} product(s) that changed since audit run #${run.id} — run \`npm run audit\` first.`);
  }
  const todo = rows.filter((r) => (scores.get(r.id)?.score ?? 100) < 100 && !upToDate.has(r.id) && auditedHash.get(r.id) === r.contentHash);
  console.log(`Audit run #${run.id}: ${run.products.filter((s) => s.score < 100).length} products lose points; ${todo.length} need proposals`);

  const counts: Record<string, number> = {};
  const failed: string[] = [];
  let modelCalls = 0;
  let skippedRejected = 0;

  await pool(todo, CONCURRENCY, async (row) => {
    const p = row.raw as ShopifyProduct;
    const stored = scores.get(p.id)!;
    // Stored checks carry the model-judged parts; category comes from the same resolver.
    const score = { ...scoreProduct(p, null)!, checks: stored.checks };
    const proposals: FixProposal[] = [];

    const needs = modelFixNeeds(p, score);
    if (needsModel(needs)) {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          await paceModelCall();
          modelCalls++;
          proposals.push(...(await modelProposals(p, score, needs, types, MODELS.default)));
          break;
        } catch (err) {
          if (attempt === ATTEMPTS) {
            failed.push(`${p.handle}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
            return; // store nothing for this product so a re-run retries it whole
          }
          if (isQuotaError(err)) backOffForQuota();
        }
      }
    }
    const fixedTitle = proposals.find((f) => f.change.kind === "set_title");
    proposals.push(...ruleProposals(p, ctx, fixedTitle?.change.kind === "set_title" ? fixedTitle.change.title : undefined));
    const kept = proposals.filter((f) => !wasRejected(f));
    skippedRejected += proposals.length - kept.length;
    proposals.splice(0, proposals.length, ...kept);
    if (!proposals.length) return;

    // Replace unapproved proposals made against an older version of this product.
    await db
      .delete(schema.fixProposals)
      .where(
        and(
          eq(schema.fixProposals.productId, p.id),
          inArray(schema.fixProposals.status, ["pending", "needs_merchant"]),
          ne(schema.fixProposals.contentHash, row.contentHash),
        ),
      );
    await db
      .insert(schema.fixProposals)
      .values(
        proposals.map((f) => ({
          productId: f.productId,
          handle: f.handle,
          checkId: f.checkId,
          kind: f.change.kind,
          target: f.target,
          change: f.change,
          before: f.before ?? null,
          source: f.source,
          evidence: f.evidence,
          status: f.change.kind === "needs_merchant" ? "needs_merchant" : "pending",
          contentHash: row.contentHash,
          auditRunId: run.id,
        })),
      )
      .onConflictDoNothing();
    for (const f of proposals) counts[f.change.kind] = (counts[f.change.kind] ?? 0) + 1;
  });

  const queue = await db
    .select({ status: schema.fixProposals.status, productId: schema.fixProposals.productId })
    .from(schema.fixProposals)
    .where(inArray(schema.fixProposals.status, OPEN));
  const pending = queue.filter((q) => q.status === "pending");
  const merchant = queue.filter((q) => q.status === "needs_merchant");

  console.log(
    `\nProposed this run (${modelCalls} model calls; ${skippedRejected} skipped as previously rejected; ${stale.length} merchant gaps closed):`,
  );
  for (const [kind, n] of Object.entries(counts).sort()) console.log(`  ${kind.padEnd(18)} ${n}`);
  console.log(
    `Queue: ${pending.length} pending across ${new Set(pending.map((q) => q.productId)).size} products · ` +
      `${merchant.length} need the merchant across ${new Set(merchant.map((q) => q.productId)).size} products`,
  );
  if (failed.length) {
    console.error(`\n${failed.length} product(s) failed — re-run to retry:\n  ${failed.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

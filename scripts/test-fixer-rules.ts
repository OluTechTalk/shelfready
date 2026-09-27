// Self-test for the rule-based fixer: on the synced catalog, simulated rule fixes must clear
// the defects they target, propose nothing for clean products, and never make a check worse.
// No model calls, no Shopify writes.
//
// Run: npm run sync && npm run test:fixer

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as checks from "../lib/audit/checks";
import { CHECK_IDS } from "../lib/audit/rubric";
import { scoreProduct } from "../lib/audit/score";
import { GroundTruthSchema } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import { buildStoreContext, ruleProposals } from "../lib/fixer/rules";
import { simulateFixes } from "../lib/fixer/simulate";
import type { ShopifyProduct } from "../lib/shopify/products";

async function main() {
  const truth = GroundTruthSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "fixtures", "ground-truth.json"), "utf8")));
  const gt = new Map(truth.products.map((t) => [t.handle, t]));
  const products = (await getDb().select().from(schema.products)).map((r) => r.raw as ShopifyProduct);
  const ctx = buildStoreContext(products);
  const failures: string[] = [];
  const counts: Record<string, number> = {};

  for (const p of products) {
    const t = gt.get(p.handle)!;
    const has = (d: string) => t.defects.includes(d as never);
    const proposals = ruleProposals(p, ctx);
    for (const f of proposals) counts[f.change.kind] = (counts[f.change.kind] ?? 0) + 1;
    if (t.defects.length === 0 && proposals.length) failures.push(`${p.handle}: clean but got ${proposals.map((f) => f.change.kind).join(", ")}`);

    const after = simulateFixes(p, proposals.map((f) => f.change));
    const before = scoreProduct(p, null)!;
    const fixed = scoreProduct(after, null)!;
    for (const id of CHECK_IDS) {
      if (fixed.checks[id].score < before.checks[id].score) failures.push(`${p.handle}: ${id} got worse`);
    }

    // Each rule-fixable defect must be gone after the simulated fix.
    if (has("inconsistent_option_names") && checks.variantStructure(after).findings.some((f) => f.startsWith("Non-standard")))
      failures.push(`${p.handle}: option names not fixed`);
    // Repeated SKUs sit on duplicate variants and clear when the merchant merges them.
    if (has("variant_problems") && checks.variantStructure(after).findings.some((f) => /without a SKU/.test(f)))
      failures.push(`${p.handle}: SKUs not fixed`);
    if (t.details.variantProblem && t.details.variantProblem !== "missing_skus" && !proposals.some((f) => f.change.kind === "needs_merchant"))
      failures.push(`${p.handle}: duplicate variants not flagged for the merchant`);
    if (has("bad_alt_text") && fixed.checks.images_alt_text.score < 1) failures.push(`${p.handle}: alt text not fixed`);
    if (has("missing_taxonomy") && fixed.checks.taxonomy.score < 1)
      failures.push(`${p.handle}: taxonomy not fixed (${fixed.checks.taxonomy.findings.join("; ")})`);
    if (fixed.category !== before.category) failures.push(`${p.handle}: fix changed category ${before.category} → ${fixed.category}`);
  }

  console.log("Proposals by kind:", counts);
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Rule fixes clear every rule-fixable defect on ${products.length} products; clean products get no proposals.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

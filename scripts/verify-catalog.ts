// Confirms the seed landed as intended: product counts in Shopify and Postgres, no duplicate
// handles or titles, and — re-detected from the synced raw data — every product carries
// exactly the defects listed in fixtures/ground-truth.json. Read-only.
//
// Run: npm run sync && npm run verify:catalog

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, schema } from "../lib/db";
import { detectDefects, type ProductFacts } from "../lib/catalog/defects";
import { DEFECT_IDS, GroundTruthSchema, METAFIELD_NAMESPACE, type DefectId } from "../lib/catalog/schema";
import { getShopSummary } from "../lib/shopify/admin";
import type { ShopifyProduct } from "../lib/shopify/products";

const TAXONOMY_PREFIX = "gid://shopify/TaxonomyCategory/";

function factsFromShopify(p: ShopifyProduct): ProductFacts {
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    productType: p.productType,
    taxonomyCategoryId: p.category ? p.category.id.replace(TAXONOMY_PREFIX, "") : null,
    tags: p.tags,
    optionNames: p.options.map((o) => o.name),
    variants: p.variants.map((v) => ({ sku: v.sku, optionValues: v.selectedOptions.map((o) => o.value) })),
    imageAlts: p.media.map((m) => m.alt ?? ""),
    metafieldKeys: p.metafields.filter((m) => m.namespace === METAFIELD_NAMESPACE).map((m) => m.key),
  };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((v) => (seen.has(v) ? true : (seen.add(v), false))))];
}

async function main() {
  const truth = GroundTruthSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "fixtures", "ground-truth.json"), "utf8")),
  );
  const problems: string[] = [];

  const shop = await getShopSummary();
  const rows = await getDb().select().from(schema.products);
  const synced = rows.map((r) => r.raw as ShopifyProduct);
  console.log(`Ground truth: ${truth.products.length} | Shopify: ${shop.productCount} | Postgres: ${rows.length}`);
  if (shop.productCount !== truth.products.length) problems.push(`Shopify has ${shop.productCount} products`);
  if (rows.length !== truth.products.length) problems.push(`Postgres has ${rows.length} products`);

  // Seeded vague titles ("Untitled product") repeat on purpose; any other repeated title
  // means the same product was created twice under a new handle.
  const vague = new Set(truth.products.filter((t) => t.defects.includes("vague_title")).map((t) => t.handle));
  const dupHandles = duplicates(synced.map((p) => p.handle));
  const dupTitles = duplicates(synced.filter((p) => !vague.has(p.handle)).map((p) => p.title));
  if (dupHandles.length) problems.push(`duplicate handles: ${dupHandles.join(", ")}`);
  if (dupTitles.length) problems.push(`duplicate titles: ${dupTitles.join(", ")}`);
  console.log(`Duplicates: ${dupHandles.length} handles, ${dupTitles.length} titles (seeded vague titles excluded)`);

  const byHandle = new Map(synced.map((p) => [p.handle, p]));
  const counts = Object.fromEntries(DEFECT_IDS.map((d) => [d, 0])) as Record<DefectId, number>;
  let messy = 0;
  let mismatched = 0;
  for (const t of truth.products) {
    const p = byHandle.get(t.handle);
    if (!p) {
      problems.push(`${t.handle}: not in Postgres`);
      continue;
    }
    const found = detectDefects(factsFromShopify(p), t);
    for (const d of found) counts[d]++;
    if (found.length) messy++;
    const want = [...t.defects].sort().join(",");
    const got = [...found].sort().join(",");
    if (want !== got) {
      mismatched++;
      problems.push(`${t.handle}: expected [${want}] found [${got}]`);
    }
  }

  console.log(`Messy products: ${messy} (ground truth ${truth.summary.messy})`);
  for (const d of DEFECT_IDS) {
    const flag = counts[d] === truth.summary.byDefect[d] ? "ok" : "MISMATCH";
    console.log(`  ${d.padEnd(32)} ${String(counts[d]).padStart(3)} / ${truth.summary.byDefect[d]}  ${flag}`);
  }
  console.log(`Per-product defect sets matching ground truth: ${truth.products.length - mismatched}/${truth.products.length}`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nCatalog verified.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

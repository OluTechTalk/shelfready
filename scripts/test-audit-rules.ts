// Self-test for the rule checks: on the synced catalog, each seeded defect must lower the
// rule check it targets, and nothing else may. No model calls (LLM parts are left out).
//
// Run: npm run sync && npm run test:audit

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as checks from "../lib/audit/checks";
import { resolveCategory } from "../lib/audit/category";
import { htmlToText } from "../lib/catalog/defects";
import { GroundTruthSchema, type DefectId } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import type { ShopifyProduct } from "../lib/shopify/products";

// Rule check → the seeded defects that should (and alone should) make it fall below 1.
const EXPECT: [string, (p: ShopifyProduct, cat: NonNullable<ReturnType<typeof resolveCategory>>["category"]) => boolean, DefectId[]][] = [
  ["required_attributes (rule part)", (p, c) => checks.requiredAttributes(p, c, null).score < 1, ["attributes_in_description_only", "attributes_missing"]],
  ["variant_structure", (p) => checks.variantStructure(p).score < 1, ["inconsistent_option_names", "variant_problems"]],
  ["title_specificity (format part)", (p) => checks.titleFormatProblems(p.title).length > 0, ["vague_title"]],
  ["price_availability", (p) => checks.priceAvailability(p).score < 1, []],
  ["images_alt_text", (p) => checks.imagesAltText(p).score < 1, ["bad_alt_text"]],
  ["taxonomy", (p) => checks.taxonomy(p).score < 1, ["missing_taxonomy"]],
];

async function main() {
  const truth = GroundTruthSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "fixtures", "ground-truth.json"), "utf8")));
  const defects = new Map(truth.products.map((t) => [t.handle, new Set(t.defects)]));
  const rows = await getDb().select().from(schema.products);
  const failures: string[] = [];

  for (const [name, fails, causes] of EXPECT) {
    let hits = 0;
    let wrong = 0;
    for (const { raw } of rows) {
      const p = raw as ShopifyProduct;
      const cat = resolveCategory({ ...p, descriptionText: htmlToText(p.descriptionHtml) });
      if (!cat) {
        failures.push(`${p.handle}: category unresolved`);
        continue;
      }
      const expected = causes.some((d) => defects.get(p.handle)?.has(d));
      const actual = fails(p, cat.category);
      if (actual) hits++;
      if (actual !== expected) {
        wrong++;
        failures.push(`${name} · ${p.handle}: expected ${expected ? "< 1" : "full marks"}, got ${actual ? "< 1" : "full marks"}`);
      }
    }
    console.log(`${wrong ? "FAIL" : "ok  "} ${name.padEnd(34)} flagged ${String(hits).padStart(3)}  mismatches ${wrong}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} mismatch(es):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nAll rule checks agree with the ground truth on ${rows.length} products.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

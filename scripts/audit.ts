// Scores every synced product against the rubric and stores the run (audit_runs +
// audit_scores). Model judgments are cached by content hash, so a re-run only calls the
// model for products that changed. If fixtures/ground-truth.json exists, also reports how
// the scores line up with the seeded defects.
//
// Run: npm run sync && npm run audit            (--model backup to use the backup model)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gte } from "drizzle-orm";
import { MODELS } from "../lib/ai/models";
import { backOffForQuota, isQuotaError, paceModelCall, pool } from "../lib/ai/pace";
import { judgeProduct } from "../lib/audit/judge";
import { BANDS, CHECK_IDS, CHECKS, RUBRIC_VERSION, type CheckId } from "../lib/audit/rubric";
import { scoreProduct, summarizeStore, type ProductScore } from "../lib/audit/score";
import { GroundTruthSchema, type DefectId } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import type { ShopifyProduct } from "../lib/shopify/products";

const CONCURRENCY = 4;
const ATTEMPTS = 3; // on top of the AI SDK's own retries

// Which check each seeded defect should pull down (for the ground-truth report).
const DEFECT_CHECK: Record<DefectId, CheckId> = {
  vague_title: "title_specificity",
  attributes_in_description_only: "required_attributes",
  attributes_missing: "required_attributes",
  inconsistent_option_names: "variant_structure",
  variant_problems: "variant_structure",
  bad_alt_text: "images_alt_text",
  marketing_only_description: "description_answerability",
  missing_taxonomy: "taxonomy",
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x: number, d = 1) => (Number.isNaN(x) ? "—" : x.toFixed(d));

function groundTruthReport(scores: ProductScore[]) {
  const file = join(process.cwd(), "fixtures", "ground-truth.json");
  if (!existsSync(file)) return;
  const truth = GroundTruthSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const defects = new Map(truth.products.map((t) => [t.handle, t.defects]));
  const of = (s: ProductScore) => defects.get(s.handle) ?? [];

  console.log("\nGround truth comparison");
  const clean = scores.filter((s) => of(s).length === 0);
  const messy = scores.filter((s) => of(s).length > 0);
  console.log(`  clean  ${String(clean.length).padStart(3)} products  avg ${fmt(avg(clean.map((s) => s.score)))}  min ${fmt(Math.min(...clean.map((s) => s.score)))}`);
  console.log(`  messy  ${String(messy.length).padStart(3)} products  avg ${fmt(avg(messy.map((s) => s.score)))}  max ${fmt(Math.max(...messy.map((s) => s.score)))}`);
  for (const n of [1, 2, 3, 4]) {
    const group = scores.filter((s) => of(s).length === n);
    if (group.length) console.log(`  ${n} defect(s): ${String(group.length).padStart(3)} products  avg ${fmt(avg(group.map((s) => s.score)))}`);
  }
  console.log("  defect → targeted check (avg 0–1 with the defect vs clean products)");
  for (const [defect, check] of Object.entries(DEFECT_CHECK) as [DefectId, CheckId][]) {
    const withD = scores.filter((s) => of(s).includes(defect)).map((s) => s.checks[check].score);
    const cleanC = clean.map((s) => s.checks[check].score);
    console.log(`    ${defect.padEnd(32)} ${check.padEnd(26)} ${fmt(avg(withD), 2)} vs ${fmt(avg(cleanC), 2)}`);
  }
}

async function main() {
  const model = process.argv.includes("--model") && process.argv[process.argv.indexOf("--model") + 1] === "backup"
    ? MODELS.backup
    : MODELS.default;
  const db = getDb();
  const rows = await db.select().from(schema.products);
  console.log(`Auditing ${rows.length} products · rubric ${RUBRIC_VERSION} · ${model.id}`);

  const startedAt = new Date();
  const scores: ProductScore[] = [];
  const hashes = new Map<string, string>();
  const unscored: string[] = [];
  let calls = 0;
  let cached = 0;
  let done = 0;

  await pool(rows, CONCURRENCY, async (row) => {
    const p = row.raw as ShopifyProduct;
    const rulesOnly = scoreProduct(p, null);
    if (!rulesOnly) {
      unscored.push(`${p.handle}: category unresolved`);
      return;
    }
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const judged = await judgeProduct(p, rulesOnly.category, row.contentHash, model, paceModelCall);
        if (judged.cached) cached++;
        else calls++;
        scores.push(scoreProduct(p, judged.result)!);
        hashes.set(p.id, row.contentHash);
        break;
      } catch (err) {
        if (attempt === ATTEMPTS) unscored.push(`${p.handle}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
        else if (isQuotaError(err)) {
          backOffForQuota();
        }
      }
    }
    if (++done % 25 === 0) console.log(`  ${done}/${rows.length}`);
  });

  // Never store a partial run: store scores would be computed over a different product set.
  // Judgments that did succeed are cached, so a re-run only redoes the failures.
  if (unscored.length) {
    console.error(`\n${unscored.length} product(s) not scored — run not saved. Re-run to resume:\n  ${unscored.join("\n  ")}`);
    process.exit(1);
  }
  const summary = summarizeStore(scores);
  const [run] = await db
    .insert(schema.auditRuns)
    .values({ rubricVersion: RUBRIC_VERSION, model: model.id, storeScore: summary.score, summary })
    .returning({ id: schema.auditRuns.id });
  await db.insert(schema.auditScores).values(
    scores.map((s) => ({
      runId: run.id,
      productId: s.productId,
      handle: s.handle,
      title: s.title,
      category: s.category,
      score: s.score,
      band: s.band,
      checks: s.checks,
      contentHash: hashes.get(s.productId)!,
    })),
  );

  const usage = await db
    .select({ tokensIn: schema.modelCalls.tokensIn, tokensOut: schema.modelCalls.tokensOut, latencyMs: schema.modelCalls.latencyMs })
    .from(schema.modelCalls)
    .where(gte(schema.modelCalls.createdAt, startedAt));

  console.log(`\nRun #${run.id}: store score ${summary.score} / 100 over ${summary.products} products`);
  for (const b of BANDS) console.log(`  ${b.label.padEnd(12)} ${String(summary.bands[b.id].count).padStart(3)}  (${summary.bands[b.id].pct}%)`);
  console.log("  Check averages (0–1):");
  for (const id of CHECK_IDS) console.log(`    ${CHECKS[id].label.padEnd(28)} ${summary.checkAverages[id].toFixed(2)}`);
  console.log(
    `  Model: ${calls} calls, ${cached} cached · ${usage.reduce((a, u) => a + u.tokensIn, 0)} in / ${usage.reduce((a, u) => a + u.tokensOut, 0)} out tokens · avg ${fmt(avg(usage.map((u) => u.latencyMs)), 0)} ms`,
  );
  const worst = [...scores].sort((a, b) => a.score - b.score).slice(0, 5);
  console.log("  Worst offenders:");
  for (const s of worst) console.log(`    ${fmt(s.score).padStart(5)}  ${s.title} (${s.handle})`);

  groundTruthReport(scores);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// Audits what the fixer has written (titles, attribute values, drafted descriptions) for specs
// that changed on the way — "30°F" becoming "30f" or "30 Degree". The source of truth is the
// original seeded product text (fixtures/catalog.json), never a value the fixer produced.
//
// Run: npm run check:fixes                 report only
//      npm run check:fixes -- --queue      also queue corrections as pending fixes for review

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { quoteAppearsIn } from "../lib/audit/checks";
import { htmlToText } from "../lib/catalog/defects";
import { CatalogSchema } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import { formatAttributeValue } from "../lib/fixer/format";
import { unfaithfulSpecs } from "../lib/fixer/model";
import { FixChangeSchema, type FixChange } from "../lib/fixer/types";
import type { ShopifyProduct } from "../lib/shopify/products";

const CHECKED = ["applied", "approved", "pending"];

/** The first spec in `source` with this number and a real unit/symbol — the correct spelling. */
function canonical(num: string, source: string): string | null {
  const m = source.match(new RegExp(`(?<![\\d.])${num.replace(".", "\\.")}\\s?(°\\s?[FC]|[A-Za-z]+)`));
  return m ? m[0].replace(/°\s+/, "°") : null;
}

function correct(text: string, bad: string[], source: string): string | null {
  let out = text;
  for (const token of bad.filter((b) => !b.startsWith("evidence"))) {
    const num = token.match(/\d+(?:\.\d+)?/)?.[0];
    const fix = num ? canonical(num, source) : null;
    if (!fix) return null;
    out = out.replace(token, fix);
  }
  return out === text ? null : out;
}

async function main() {
  const queue = process.argv.includes("--queue");
  const db = getDb();
  const fixture = CatalogSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "fixtures", "catalog.json"), "utf8")));
  const original = new Map(
    fixture.products.map((p) => [
      p.handle,
      [
        p.title,
        htmlToText(p.descriptionHtml),
        ...p.tags,
        ...p.options.flatMap((o) => o.values),
        ...p.metafields.map((m) => formatAttributeValue(m.key, m.type, m.value)),
      ].join("\n"),
    ]),
  );

  const rows = await db
    .select()
    .from(schema.fixProposals)
    .where(and(inArray(schema.fixProposals.status, CHECKED), inArray(schema.fixProposals.kind, ["set_title", "set_metafield", "set_description"])));
  const products = new Map((await db.select().from(schema.products)).map((r) => [r.id, r]));

  const flagged: { row: (typeof rows)[number]; change: FixChange; bad: string[]; corrected: FixChange | null }[] = [];
  for (const row of rows) {
    const change = FixChangeSchema.parse(row.change);
    const source = original.get(row.handle) ?? "";
    let bad: string[] = [];
    let corrected: FixChange | null = null;
    if (change.kind === "set_title") {
      bad = unfaithfulSpecs(change.title, source);
      const t = bad.length ? correct(change.title, bad, source) : null;
      if (t) corrected = { ...change, title: t };
    } else if (change.kind === "set_metafield" && change.type === "single_line_text_field") {
      // Against the original text, not only its own quote (which may have come from the handle).
      bad = unfaithfulSpecs(change.value, source);
      // Evidence must be readable product text, not the URL handle.
      if (!quoteAppearsIn(row.evidence, source)) bad.push(`evidence not in product text ("${row.evidence}")`);
      const v = bad.length ? correct(change.value, bad, source) : null;
      if (v) corrected = { ...change, value: v };
    } else if (change.kind === "set_description") {
      bad = unfaithfulSpecs(htmlToText(change.descriptionHtml), source);
      let html = change.descriptionHtml;
      for (const token of bad) {
        const num = token.match(/\d+(?:\.\d+)?/)?.[0];
        const fix = num ? canonical(num, source) : null;
        if (fix) html = html.replace(token, fix);
      }
      if (bad.length && html !== change.descriptionHtml) corrected = { ...change, descriptionHtml: html };
    }
    if (bad.length) flagged.push({ row, change, bad, corrected });
  }

  console.log(`Checked ${rows.length} fixes (titles, attributes, descriptions) against the original product text.`);
  for (const f of flagged) {
    const what = f.change.kind === "set_title" ? f.change.title : f.change.kind === "set_metafield" ? `${f.change.key} = ${f.change.value}` : "description";
    const to =
      f.corrected?.kind === "set_title" ? f.corrected.title : f.corrected?.kind === "set_metafield" ? f.corrected.value : f.corrected ? "(corrected draft)" : "(no automatic correction)";
    console.log(`  #${f.row.id} ${f.row.status.padEnd(8)} ${f.row.handle.padEnd(38)} ${what} — bad: ${f.bad.join(", ")} → ${to}`);
  }
  if (!flagged.length) console.log("  No spec drift found.");

  if (!queue || !flagged.length) return;
  let queued = 0;
  for (const f of flagged) {
    if (!f.corrected) continue;
    if (f.row.status !== "applied") {
      // Not live yet: correct the proposal itself and send it back for review.
      await db.update(schema.fixProposals).set({ change: f.corrected, status: "pending", edited: true, decidedAt: null }).where(eq(schema.fixProposals.id, f.row.id));
      queued++;
      continue;
    }
    // Live in Shopify: queue a new correction against the current value.
    const product = products.get(f.row.productId);
    if (!product) continue;
    const p = product.raw as ShopifyProduct;
    const corr = f.corrected;
    const before =
      corr.kind === "set_title"
        ? p.title
        : corr.kind === "set_description"
          ? p.descriptionHtml
          : corr.kind === "set_metafield"
            ? (p.metafields.find((m) => m.namespace === "shelfready" && m.key === corr.key)?.value ?? null)
            : null;
    await db
      .insert(schema.fixProposals)
      .values({
        productId: f.row.productId,
        handle: f.row.handle,
        checkId: f.row.checkId,
        kind: f.corrected.kind,
        target: f.row.target,
        change: f.corrected,
        before,
        source: "rule",
        evidence: `Corrects #${f.row.id}: ${f.bad.join(", ")} doesn't match the product's own text`,
        status: "pending",
        contentHash: product.contentHash,
      })
      .onConflictDoNothing();
    queued++;
  }
  console.log(`\nQueued ${queued} correction(s) as pending — review them on /review.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

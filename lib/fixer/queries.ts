// Read-side queries for the review queue UI. No writes, no model calls.

import { desc, eq, inArray } from "drizzle-orm";
import { resolveCategory } from "../audit/category";
import { REQUIRED_ATTRIBUTES } from "../audit/rubric";
import { htmlToText } from "../catalog/defects";
import { METAFIELD_NAMESPACE } from "../catalog/schema";
import { getDb, schema } from "../db";
import type { ShopifyProduct } from "../shopify/products";
import { attributeLabel, formatAttributeValue } from "./format";
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
  decidedAt: Date | null;
  appliedAt: Date | null;
};

/** One line of "product at a glance": what it is now, and what an open fix would make it. */
export type GlanceRow = {
  label: string;
  current: string | null;
  proposed: { value: string; status: FixStatus; id: number } | null;
};

export type ReviewProduct = {
  productId: string;
  handle: string;
  title: string;
  score: number | null; // from the latest audit run
  /** Every fix for this product, whatever its status: the card shows the product whole. */
  items: ReviewItem[];
  statusCounts: Partial<Record<FixStatus, number>>;
  glance: GlanceRow[];
  /** The title fix for this product, if any: other fixes (alt text) may be built on it. */
  titleFix: { id: number; title: string; status: FixStatus } | null;
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

// Open fixes first, then what already happened; rejected last.
const STATUS_ORDER: FixStatus[] = ["pending", "approved", "failed", "needs_merchant", "applied", "rejected"];

const lastTwo = (fullName: string) => fullName.split(" > ").slice(-2).join(" > ");

function buildGlance(p: ShopifyProduct, items: ReviewItem[], names: Record<string, string>): GlanceRow[] {
  // Latest non-rejected proposal per field: rejected ones don't describe the product's future.
  const live = items.filter((i) => i.status !== "rejected").sort((a, b) => b.id - a.id);
  const pick = (test: (c: FixChange) => boolean) => live.find((i) => test(i.change)) ?? null;
  const proposed = (i: ReviewItem | null, value: string | null | undefined) =>
    i && value != null ? { value, status: i.status, id: i.id } : null;

  const title = pick((c) => c.kind === "set_title");
  const taxonomy = pick((c) => c.kind === "set_taxonomy");
  const description = pick((c) => c.kind === "set_description");
  const tax = taxonomy?.change.kind === "set_taxonomy" ? taxonomy.change : null;
  const text = htmlToText(p.descriptionHtml);

  const rows: GlanceRow[] = [
    { label: "Title", current: p.title, proposed: proposed(title, title?.change.kind === "set_title" ? title.change.title : null) },
    { label: "Product type", current: p.productType || null, proposed: proposed(taxonomy, tax?.productType) },
    {
      label: "Category",
      current: p.category ? lastTwo(p.category.fullName) : null,
      proposed: proposed(taxonomy, tax?.categoryId ? lastTwo(names[tax.categoryId] ?? tax.categoryId) : null),
    },
    {
      label: "Description",
      current: text ? text.slice(0, 90) + (text.length > 90 ? "…" : "") : null,
      proposed: proposed(description, description ? "Rewritten from the product's facts (see below)" : null),
    },
  ];

  const category = resolveCategory({ ...p, descriptionText: text })?.category;
  for (const attr of category ? REQUIRED_ATTRIBUTES[category] : []) {
    const mf = p.metafields.find((m) => m.namespace === METAFIELD_NAMESPACE && m.key === attr.key);
    const fix = pick((c) => c.kind === "set_metafield" && c.key === attr.key);
    const gap = pick((c) => c.kind === "needs_merchant" && c.reason.startsWith(attr.label));
    rows.push({
      label: attributeLabel(attr.key),
      current: mf ? formatAttributeValue(mf.key, mf.type, mf.value) : null,
      proposed:
        fix?.change.kind === "set_metafield"
          ? proposed(fix, formatAttributeValue(fix.change.key, fix.change.type, fix.change.value))
          : proposed(gap, gap ? "Missing — only the merchant can add it" : null),
    });
  }
  return rows;
}

export async function getReviewQueue(
  status: FixStatus,
): Promise<{ products: ReviewProduct[]; counts: Record<FixStatus, number>; categoryNames: Record<string, string> }> {
  const db = getDb();
  const names = await categoryNames();
  const all = await db.select({ status: schema.fixProposals.status, productId: schema.fixProposals.productId }).from(schema.fixProposals);
  const counts = Object.fromEntries(FIX_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<FixStatus, number>;

  // The tab picks products (any with a fix in this status); each card then shows all its fixes.
  const ids = [...new Set(all.filter((r) => r.status === status).map((r) => r.productId))];
  if (!ids.length) return { products: [], counts, categoryNames: names };
  const rows = await db.select().from(schema.fixProposals).where(inArray(schema.fixProposals.productId, ids)).orderBy(schema.fixProposals.id);

  const products = await db.select({ id: schema.products.id, raw: schema.products.raw }).from(schema.products).where(inArray(schema.products.id, ids));
  const raws = new Map(products.map((p) => [p.id, p.raw as ShopifyProduct]));
  const [run] = await db.select({ id: schema.auditRuns.id }).from(schema.auditRuns).orderBy(desc(schema.auditRuns.id)).limit(1);
  const scores = run
    ? new Map(
        (await db.select({ productId: schema.auditScores.productId, score: schema.auditScores.score }).from(schema.auditScores).where(eq(schema.auditScores.runId, run.id))).map((s) => [s.productId, s.score]),
      )
    : new Map<string, number>();

  const byProduct = new Map<string, ReviewItem[]>();
  for (const r of rows) {
    const change = FixChangeSchema.parse(r.change);
    const list = byProduct.get(r.productId) ?? [];
    list.push({
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
      decidedAt: r.decidedAt,
      appliedAt: r.appliedAt,
    });
    byProduct.set(r.productId, list);
  }

  const out: ReviewProduct[] = [];
  for (const [productId, items] of byProduct) {
    const raw = raws.get(productId);
    if (!raw) continue;
    // This tab's fixes first, then the rest in workflow order.
    items.sort(
      (a, b) =>
        Number(b.status === status) - Number(a.status === status) ||
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.id - b.id,
    );
    const statusCounts: Partial<Record<FixStatus, number>> = {};
    for (const i of items) statusCounts[i.status] = (statusCounts[i.status] ?? 0) + 1;
    const titleItem = items.filter((i) => i.change.kind === "set_title" && i.status !== "rejected").sort((a, b) => b.id - a.id)[0];
    out.push({
      productId,
      handle: raw.handle,
      title: raw.title,
      score: scores.get(productId) ?? null,
      items,
      statusCounts,
      glance: buildGlance(raw, items, names),
      titleFix: titleItem?.change.kind === "set_title" ? { id: titleItem.id, title: titleItem.change.title, status: titleItem.status } : null,
    });
  }
  // Worst-scoring products first: that's where a reviewer's time matters most.
  return { products: out.sort((a, b) => (a.score ?? 100) - (b.score ?? 100)), counts, categoryNames: names };
}

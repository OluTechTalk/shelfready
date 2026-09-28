"use server";

// Review queue write actions. Every one checks the admin session itself: Server Actions are
// reachable by direct POST, so hiding buttons from visitors is not the protection.

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPasscode, endAdminSession, requireAdmin, startAdminSession } from "@/lib/admin/session";
import { getDb, schema } from "@/lib/db";
import { applyApprovedForProduct } from "@/lib/fixer/apply";
import { FixChangeSchema, type FixChange } from "@/lib/fixer/types";

const done = () => revalidatePath("/review");

export async function login(formData: FormData) {
  const passcode = String(formData.get("passcode") ?? "");
  if (!checkPasscode(passcode)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    redirect("/review?login=failed");
  }
  await startAdminSession();
  redirect("/review");
}

export async function logout() {
  await endAdminSession();
  done();
}

const idFrom = (formData: FormData) => {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Bad proposal id");
  return id;
};

export async function decide(formData: FormData) {
  await requireAdmin();
  const db = getDb();
  const id = idFrom(formData);
  const decision = formData.get("decision");

  if (decision === "reopen") {
    // Rejected → pending, unless a newer open fix for the same field already exists.
    const [row] = await db.select().from(schema.fixProposals).where(and(eq(schema.fixProposals.id, id), eq(schema.fixProposals.status, "rejected")));
    if (!row) return done();
    const [open] = await db
      .select({ id: schema.fixProposals.id })
      .from(schema.fixProposals)
      .where(
        and(
          eq(schema.fixProposals.productId, row.productId),
          eq(schema.fixProposals.kind, row.kind),
          eq(schema.fixProposals.target, row.target),
          inArray(schema.fixProposals.status, ["pending", "approved", "needs_merchant"]),
        ),
      );
    if (!open) await db.update(schema.fixProposals).set({ status: "pending", decidedAt: null }).where(eq(schema.fixProposals.id, id));
    return done();
  }

  const status = decision === "approve" ? "approved" : "rejected";
  await db
    .update(schema.fixProposals)
    .set({ status, decidedAt: sql`now()` })
    .where(and(eq(schema.fixProposals.id, id), inArray(schema.fixProposals.status, ["pending", "approved"])));
  done();
}

/** Applies the reviewer's edits to the proposed value, then approves it. */
function editedChange(change: FixChange, formData: FormData): FixChange {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  switch (change.kind) {
    case "set_title":
      return { ...change, title: text("title") };
    case "set_description":
      return { ...change, descriptionHtml: text("descriptionHtml") };
    case "set_metafield": {
      const value = text("value");
      // Same encodings the fixer validates: weight is edited as grams, booleans as true/false.
      if (change.type === "weight") {
        const grams = Number(value);
        if (!Number.isFinite(grams) || grams <= 0) throw new Error("Weight must be a positive number of grams");
        return { ...change, value: JSON.stringify({ value: grams, unit: "GRAMS" }) };
      }
      if (change.type === "boolean" && !["true", "false"].includes(value)) throw new Error("Must be Yes or No");
      if (change.type === "number_integer" && !/^\d+$/.test(value)) throw new Error("Must be a whole number");
      return { ...change, value };
    }
    case "set_alt_text":
      return { ...change, images: change.images.map((img, i) => ({ ...img, alt: text(`alt-${i}`) })) };
    default:
      throw new Error("This kind of fix can't be edited");
  }
}

export async function editAndApprove(formData: FormData) {
  await requireAdmin();
  const db = getDb();
  const id = idFrom(formData);
  const [row] = await db.select().from(schema.fixProposals).where(eq(schema.fixProposals.id, id));
  if (!row || !["pending", "approved"].includes(row.status)) throw new Error("Only pending or approved fixes can be edited");
  const change = FixChangeSchema.parse(editedChange(FixChangeSchema.parse(row.change), formData)); // re-validated
  await db
    .update(schema.fixProposals)
    .set({ change, edited: true, status: "approved", decidedAt: sql`now()` })
    .where(eq(schema.fixProposals.id, id));
  done();
}

/** Writes this product's approved fixes to Shopify (same checked path as `npm run fix -- apply`). */
export async function applyProduct(formData: FormData) {
  await requireAdmin();
  const productId = String(formData.get("productId") ?? "");
  if (!productId.startsWith("gid://shopify/Product/")) throw new Error("Bad product id");
  await applyApprovedForProduct(productId);
  done();
}

// ---------------------------------------------------------------------------
// Bulk actions over the products ticked on the page
// ---------------------------------------------------------------------------

const APPLY_BUDGET_MS = 45_000; // stays inside the page's maxDuration (60 s)
const APPLY_CONCURRENCY = 3;

function selectedProducts(formData: FormData): string[] {
  const ids = formData.getAll("productIds").map(String);
  if (ids.some((id) => !id.startsWith("gid://shopify/Product/"))) throw new Error("Bad product id");
  return [...new Set(ids)];
}

function backTo(formData: FormData, notice: string): never {
  const status = String(formData.get("status") ?? "pending").replace(/[^a-z_]/g, "");
  redirect(`/review?status=${status}&notice=${encodeURIComponent(notice)}`);
}

/** Approves every pending fix on the selected products (merchant gaps aren't approvable). */
export async function bulkApprove(formData: FormData) {
  await requireAdmin();
  const ids = selectedProducts(formData);
  if (!ids.length) backTo(formData, "No products selected.");
  const updated = await getDb()
    .update(schema.fixProposals)
    .set({ status: "approved", decidedAt: sql`now()` })
    .where(and(inArray(schema.fixProposals.productId, ids), eq(schema.fixProposals.status, "pending")))
    .returning({ id: schema.fixProposals.id });
  backTo(formData, `Approved ${updated.length} fix${updated.length === 1 ? "" : "es"} on ${ids.length} product${ids.length === 1 ? "" : "s"}. Nothing is in Shopify until you apply them.`);
}

/**
 * Applies approved fixes for the selected products, a few at a time, until the time budget
 * runs out. Products not reached keep their approved fixes, so clicking again continues.
 */
export async function bulkApply(formData: FormData) {
  await requireAdmin();
  const ids = selectedProducts(formData);
  if (!ids.length) backTo(formData, "No products selected.");
  const started = Date.now();
  const queue = [...ids];
  let applied = 0;
  let failed = 0;
  let products = 0;
  await Promise.all(
    Array.from({ length: APPLY_CONCURRENCY }, async () => {
      while (queue.length && Date.now() - started < APPLY_BUDGET_MS) {
        const r = await applyApprovedForProduct(queue.shift()!);
        if (r.applied || r.failed) products++;
        applied += r.applied;
        failed += r.failed;
      }
    }),
  );
  revalidatePath("/audit");
  const parts = [`Applied ${applied} fix${applied === 1 ? "" : "es"} on ${products} product${products === 1 ? "" : "s"}.`];
  if (failed) parts.push(`${failed} failed — see the Failed tab.`);
  if (queue.length) parts.push(`${queue.length} product${queue.length === 1 ? "" : "s"} still waiting — click Apply again to continue.`);
  backTo(formData, parts.join(" "));
}

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
  const status = formData.get("decision") === "approve" ? "approved" : "rejected";
  await getDb()
    .update(schema.fixProposals)
    .set({ status, decidedAt: sql`now()` })
    .where(and(eq(schema.fixProposals.id, idFrom(formData)), inArray(schema.fixProposals.status, ["pending", "approved"])));
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
    case "set_metafield":
      return { ...change, value: text("value") };
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

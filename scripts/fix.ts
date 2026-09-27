// Review queue from the command line (until the /review page exists). Approving here is a
// human decision made by whoever holds the database credentials — the same authority as the
// admin passcode on /review.
//
//   npm run fix -- list [handle]          pending / approved proposals (optionally one product)
//   npm run fix -- approve <id> [id…]     mark proposals approved (no Shopify write yet)
//   npm run fix -- reject <id> [id…]
//   npm run fix -- apply [--dry-run]      write every approved proposal to Shopify

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { applyApprovedForProduct, approvedChanges } from "../lib/fixer/apply";

const db = getDb();

async function list(handle?: string) {
  const rows = await db
    .select()
    .from(schema.fixProposals)
    .where(
      and(
        inArray(schema.fixProposals.status, ["pending", "approved", "needs_merchant", "failed"]),
        handle ? eq(schema.fixProposals.handle, handle) : undefined,
      ),
    )
    .orderBy(schema.fixProposals.handle, schema.fixProposals.id);
  for (const r of rows) {
    const change = JSON.stringify(r.change);
    console.log(`#${String(r.id).padEnd(4)} ${r.status.padEnd(14)} ${r.handle.padEnd(38)} ${r.kind.padEnd(16)} ${change.slice(0, 110)}${change.length > 110 ? "…" : ""}`);
  }
  console.log(`${rows.length} proposal(s)`);
}

async function decide(status: "approved" | "rejected", ids: number[]) {
  if (!ids.length || ids.some(Number.isNaN)) throw new Error("Give one or more numeric proposal ids");
  const updated = await db
    .update(schema.fixProposals)
    .set({ status, decidedAt: sql`now()` })
    .where(and(inArray(schema.fixProposals.id, ids), eq(schema.fixProposals.status, "pending")))
    .returning({ id: schema.fixProposals.id });
  console.log(`${status}: ${updated.map((u) => `#${u.id}`).join(", ") || "none"} (only pending proposals can be decided)`);
}

async function apply(dryRun: boolean) {
  const products = await db
    .selectDistinct({ productId: schema.fixProposals.productId, handle: schema.fixProposals.handle })
    .from(schema.fixProposals)
    .where(eq(schema.fixProposals.status, "approved"));
  if (!products.length) return console.log("Nothing approved.");
  for (const p of products) {
    if (dryRun) {
      const rows = await approvedChanges(p.productId);
      console.log(`[dry run] ${p.handle}: would apply ${rows.map((r) => `#${r.id} ${r.change.kind}`).join(", ")}`);
      continue;
    }
    const r = await applyApprovedForProduct(p.productId);
    console.log(r.error ? `FAILED ${r.handle}: ${r.error}` : `applied ${r.applied} fix(es) to ${r.handle}`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "list") return list(args[0]);
  if (cmd === "approve" || cmd === "reject") return decide(cmd === "approve" ? "approved" : "rejected", args.map(Number));
  if (cmd === "apply") return apply(args.includes("--dry-run"));
  console.log("Usage: npm run fix -- list [handle] | approve <id…> | reject <id…> | apply [--dry-run]");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

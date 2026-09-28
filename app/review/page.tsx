import type { Metadata } from "next";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin/session";
import { CHECKS, type CheckId } from "@/lib/audit/rubric";
import { htmlToText } from "@/lib/catalog/defects";
import { attributeLabel, formatAttributeValue, weightGrams } from "@/lib/fixer/format";
import { getReviewQueue, isFixStatus, type ReviewItem, type ReviewProduct } from "@/lib/fixer/queries";
import type { FixStatus } from "@/lib/fixer/types";
import { applyProduct, decide, editAndApprove, login, logout } from "./actions";

export const metadata: Metadata = { title: "Review queue · ShelfReady" };

const TABS: { status: FixStatus; label: string; meaning: string }[] = [
  { status: "pending", label: "Pending", meaning: "Suggested fixes waiting for a person to review. Nothing here has changed the store." },
  { status: "approved", label: "Approved", meaning: "Signed off by a reviewer, but not sent to Shopify yet." },
  { status: "applied", label: "Applied", meaning: "Approved and live in the Shopify store." },
  {
    status: "needs_merchant",
    label: "Needs merchant",
    meaning: "Information that doesn't exist anywhere in the product data. The fixer won't invent it — only the merchant can supply it.",
  },
  { status: "failed", label: "Failed", meaning: "Approved, but Shopify rejected the change or the product changed since. The reason is shown on each fix." },
  { status: "rejected", label: "Rejected", meaning: "Turned down by a reviewer. Never sent to Shopify." },
];

const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  set_metafield: "Add a product detail",
  set_title: "Rewrite the title",
  set_description: "Rewrite the description",
  rename_option: "Rename a variant option",
  set_variant_skus: "Add missing SKUs",
  set_alt_text: "Describe the photos",
  set_taxonomy: "Set product type, category & tags",
  needs_merchant: "Missing information",
};

/** Why a fix matters, from a shopper's point of view — the case for approving it. */
function whyItMatters(item: ReviewItem): string {
  const c = item.change;
  switch (c.kind) {
    case "set_metafield":
      return `Gives AI shopping assistants a clear "${attributeLabel(c.key).toLowerCase()}" to filter and compare on, instead of guessing from the description.`;
    case "set_title":
      return "Lets an AI shopping assistant tell what this is — and which model — from the title alone.";
    case "set_description":
      return "Lets an assistant answer shoppers' common questions (fit, materials, use, weather) straight from the description.";
    case "rename_option":
      return 'Assistants look for "Size" and "Color"; other names make them miss the right variant.';
    case "set_variant_skus":
      return "Each variant needs its own SKU so an assistant can put the exact size and color in a cart.";
    case "set_alt_text":
      return "Describes each photo for AI assistants and screen readers, instead of a file name.";
    case "set_taxonomy":
      return "Files the product under the right type and category, so it shows up when assistants browse or filter.";
    case "needs_merchant":
      return "Until the merchant adds this, an assistant will skip this product or guess.";
  }
}

function sourceNote(item: ReviewItem): string {
  if (item.change.kind === "needs_merchant") return "Flagged automatically";
  return item.source === "model" ? "Suggested by AI, checked against this product's own data" : "Automatic fix from the store's own data";
}

const shortDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

const button = "rounded-md border px-3 py-1 text-sm font-medium";
const quiet = "border-black/15 hover:bg-black/[.04] dark:border-white/20 dark:hover:bg-white/[.06]";
const primary = "border-transparent bg-foreground text-background hover:opacity-90";

function Diff({ before, after }: { before: string | null; after: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="break-words">
        <span className="mr-2 text-xs uppercase tracking-wide opacity-50">Before</span>
        {before ? <span className="line-through decoration-black/30 dark:decoration-white/40">{before}</span> : <span className="opacity-50">(none)</span>}
      </p>
      <p className="break-words">
        <span className="mr-2 text-xs uppercase tracking-wide opacity-50">After</span>
        {after}
      </p>
    </div>
  );
}

function ChangeView({ item, names }: { item: ReviewItem; names: Record<string, string> }) {
  const c = item.change;
  switch (c.kind) {
    case "set_title":
      return <Diff before={String(item.before ?? "")} after={c.title} />;
    case "set_description":
      return <Diff before={htmlToText(String(item.before ?? ""))} after={htmlToText(c.descriptionHtml)} />;
    case "set_metafield":
      return <Diff before={null} after={`${attributeLabel(c.key)}: ${formatAttributeValue(c.key, c.type, c.value)}`} />;
    case "rename_option":
      return <Diff before={c.from} after={c.to} />;
    case "set_variant_skus":
      return (
        <ul className="text-sm">
          {c.variants.map((v) => (
            <li key={v.variantId} className="tabular-nums">
              {(item.before as { variantId: string; title: string }[]).find((b) => b.variantId === v.variantId)?.title}: <span className="opacity-50">(none)</span> → {v.sku}
            </li>
          ))}
        </ul>
      );
    case "set_alt_text":
      return (
        <div className="grid gap-2">
          {c.images.map((img) => (
            <Diff key={img.mediaId} before={(item.before as { mediaId: string; alt: string | null }[]).find((b) => b.mediaId === img.mediaId)?.alt || null} after={img.alt} />
          ))}
        </div>
      );
    case "set_taxonomy": {
      const b = item.before as { productType: string; categoryId: string | null; tags: string[] };
      return (
        <div className="grid gap-2">
          {c.productType !== undefined && <Diff before={b.productType || null} after={`Type: ${c.productType}`} />}
          {c.categoryId !== undefined && (
            <Diff before={b.categoryId ? (names[b.categoryId] ?? b.categoryId) : null} after={`Category: ${names[c.categoryId] ?? c.categoryId}`} />
          )}
          {c.tags !== undefined && <Diff before={b.tags.join(", ") || null} after={`Tags: ${c.tags.join(", ")}`} />}
        </div>
      );
    }
    case "needs_merchant":
      return <p className="text-sm">{c.reason}</p>;
  }
}

function EditForm({ item }: { item: ReviewItem }) {
  const c = item.change;
  const field = "w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20";
  if (!["set_title", "set_description", "set_metafield", "set_alt_text"].includes(c.kind)) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm opacity-70">Edit before approving</summary>
      <form action={editAndApprove} className="mt-2 grid gap-2">
        <input type="hidden" name="id" value={item.id} />
        {c.kind === "set_title" && <input name="title" defaultValue={c.title} className={field} aria-label="Title" />}
        {c.kind === "set_description" && <textarea name="descriptionHtml" defaultValue={c.descriptionHtml} rows={5} className={field} aria-label="Description HTML" />}
        {c.kind === "set_metafield" && c.type === "weight" && (
          <label className="grid gap-1 text-sm">
            {attributeLabel(c.key)} in grams
            <input name="value" type="number" min="1" defaultValue={Math.round(weightGrams(c.value) ?? 0)} className={field} />
          </label>
        )}
        {c.kind === "set_metafield" && c.type === "boolean" && (
          <select name="value" defaultValue={c.value} className={field} aria-label={attributeLabel(c.key)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        )}
        {c.kind === "set_metafield" && c.type !== "weight" && c.type !== "boolean" && (
          <input name="value" defaultValue={c.value} className={field} aria-label={attributeLabel(c.key)} />
        )}
        {c.kind === "set_alt_text" &&
          c.images.map((img, i) => <input key={img.mediaId} name={`alt-${i}`} defaultValue={img.alt} className={field} aria-label={`Alt text ${i + 1}`} />)}
        <div>
          <button className={`${button} ${primary}`}>Save & approve</button>
        </div>
      </form>
    </details>
  );
}

function ItemRow({ item, admin, names }: { item: ReviewItem; admin: boolean; names: Record<string, string> }) {
  const decidable = admin && (item.status === "pending" || item.status === "approved");
  return (
    <li className="grid gap-2 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{KIND_LABEL[item.kind]}</p>
        <span className="text-xs opacity-50">
          {CHECKS[item.checkId as CheckId]?.label ?? item.checkId} · #{item.id}
        </span>
      </div>
      <p className="text-sm opacity-70">{whyItMatters(item)}</p>
      <ChangeView item={item} names={names} />
      <p className="text-xs opacity-60">
        {sourceNote(item)}
        {item.evidence && <> · based on: “{item.evidence}”</>}
        {item.edited && " · edited by reviewer"}
        {item.status === "applied" && item.appliedAt && ` · applied ${shortDate(item.appliedAt)}`}
        {(item.status === "approved" || item.status === "rejected") && item.decidedAt && ` · ${item.status} ${shortDate(item.decidedAt)}`}
      </p>
      {item.error && <p className="text-sm text-red-600 dark:text-red-400">{item.error}</p>}
      {decidable && (
        <>
          <form action={decide} className="flex gap-2">
            <input type="hidden" name="id" value={item.id} />
            {item.status === "pending" && (
              <button name="decision" value="approve" className={`${button} ${primary}`}>
                Approve
              </button>
            )}
            <button name="decision" value="reject" className={`${button} ${quiet}`}>
              Reject
            </button>
          </form>
          <EditForm item={item} />
        </>
      )}
    </li>
  );
}

function ProductCard({
  product,
  admin,
  status,
  names,
}: {
  product: ReviewProduct;
  admin: boolean;
  status: FixStatus;
  names: Record<string, string>;
}) {
  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{product.title}</h2>
          <p className="truncate text-xs opacity-60">
            {product.handle}
            {product.score !== null && ` · readiness score ${product.score.toFixed(1)} / 100`}
          </p>
        </div>
        {admin && status === "approved" && (
          <form action={applyProduct}>
            <input type="hidden" name="productId" value={product.productId} />
            <button className={`${button} ${primary}`}>Apply {product.items.length} to Shopify</button>
          </form>
        )}
      </header>
      <ul className="divide-y divide-black/10 dark:divide-white/15">
        {product.items.map((item) => (
          <ItemRow key={item.id} item={item} admin={admin} names={names} />
        ))}
      </ul>
    </section>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection(); // always read the live queue
  const params = await searchParams;
  const status: FixStatus = isFixStatus(params.status) ? params.status : "pending";
  const [admin, { products, counts, categoryNames }] = await Promise.all([isAdmin(), getReviewQueue(status)]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <p className="mt-1 text-sm opacity-70">Suggested fixes that make products easier for AI shopping assistants to find and recommend.</p>
        </div>
        {admin ? (
          <form action={logout} className="flex items-center gap-2 text-sm">
            <span className="opacity-70">Admin</span>
            <button className={`${button} ${quiet}`}>Sign out</button>
          </form>
        ) : (
          <form action={login} className="flex items-center gap-2">
            <input
              type="password"
              name="passcode"
              placeholder="Admin passcode"
              autoComplete="current-password"
              className="w-40 rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              aria-label="Admin passcode"
            />
            <button className={`${button} ${quiet}`}>Sign in</button>
          </form>
        )}
      </div>
      {params.login === "failed" && !admin && <p className="mt-2 text-sm text-red-600 dark:text-red-400">Wrong passcode.</p>}
      {!admin && (
        <div className="mt-6 rounded-lg border border-black/10 px-4 py-3 text-sm dark:border-white/15">
          <p className="font-medium">How this works</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 opacity-80">
            <li>The audit finds gaps that stop AI shopping assistants from understanding a product.</li>
            <li>The fixer suggests a fix for each gap — using only facts already in the product&apos;s data, never invented ones.</li>
            <li>A person reviews every fix. Nothing changes in the store until it&apos;s approved and applied.</li>
          </ol>
          <p className="mt-2 opacity-60">You&apos;re viewing read-only. Reviewing needs the admin passcode.</p>
        </div>
      )}

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter by status">
        {TABS.map((t) => (
          <a
            key={t.status}
            href={`/review?status=${t.status}`}
            aria-current={t.status === status ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${t.status === status ? "border-transparent bg-foreground text-background" : quiet}`}
          >
            {t.label} <span className="tabular-nums opacity-70">{counts[t.status]}</span>
          </a>
        ))}
      </nav>
      <p className="mt-3 text-sm opacity-70">{TABS.find((t) => t.status === status)!.meaning}</p>

      <div className="mt-6 grid gap-4">
        {products.length === 0 ? (
          <p className="opacity-70">Nothing here.</p>
        ) : (
          products.map((p) => <ProductCard key={p.productId} product={p} admin={admin} status={status} names={categoryNames} />)
        )}
      </div>
    </main>
  );
}

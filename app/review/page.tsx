import type { Metadata } from "next";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin/session";
import { CHECKS, type CheckId } from "@/lib/audit/rubric";
import { htmlToText } from "@/lib/catalog/defects";
import { attributeLabel, formatAttributeValue, weightGrams } from "@/lib/fixer/format";
import { getReviewQueue, isFixStatus, type ReviewItem, type ReviewProduct } from "@/lib/fixer/queries";
import type { FixStatus } from "@/lib/fixer/types";
import { applyProduct, bulkApply, bulkApprove, decide, editAndApprove, login, logout } from "./actions";
import { SelectAll } from "./select-all";

export const metadata: Metadata = { title: "Review queue · ShelfReady" };

// Server Actions on this page (bulk apply) may run up to a minute; bulkApply stops at 45 s.
export const maxDuration = 60;

const BULK_FORM = "bulk-form";

// What each status means, and what happens to a fix from here — shown above the list.
const TABS: { status: FixStatus; label: string; meaning: string; next: string }[] = [
  {
    status: "pending",
    label: "Pending",
    meaning: "Suggested by the fixer, not reviewed yet. Nothing has changed in the store.",
    next: "An admin approves it (optionally editing first) or rejects it.",
  },
  {
    status: "approved",
    label: "Approved",
    meaning: "Signed off by a reviewer, but not sent to Shopify yet.",
    next: "Apply sends it to Shopify: it moves to Applied, or to Failed if Shopify refuses it.",
  },
  {
    status: "applied",
    label: "Applied",
    meaning: "Live in the Shopify store.",
    next: "Nothing more to do. The next audit counts it in the product's score.",
  },
  {
    status: "needs_merchant",
    label: "Needs merchant",
    meaning: "The information doesn't exist anywhere in the product's data, so the fixer won't invent it.",
    next: "The merchant adds it in Shopify. On the next sync and fixer run, the item closes by itself because the gap is gone.",
  },
  {
    status: "failed",
    label: "Failed",
    meaning: "Approved, but the change didn't land — the reason is shown on each fix.",
    next: "Retry once the cause is fixed, or the fixer suggests a new version if the product changed.",
  },
  {
    status: "rejected",
    label: "Rejected",
    meaning: "Turned down by a reviewer. Never sent to Shopify; the gap stays and still counts in the audit.",
    next: "The fixer won't suggest the same fix again unless the product changes. An admin can move it back to pending.",
  },
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

const button = "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";
const quiet = "border border-line bg-surface hover:bg-surface-muted";
const primary = "bg-accent text-white hover:opacity-90";
const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";

// Workflow status colors: each chip also carries its label, so color is never the only cue.
const STATUS_COLOR: Record<FixStatus, string> = {
  pending: "#2a78d6",
  approved: "#0ca30c",
  applied: "#6b6b66",
  needs_merchant: "#d98a00",
  failed: "#d03b3b",
  rejected: "#8a8a85",
};

function Diff({ before, after }: { before: string | null; after: string }) {
  const tag = "w-12 shrink-0 pt-px text-[11px] font-medium uppercase tracking-wide text-muted";
  return (
    <div className="grid gap-1.5 text-sm">
      <div className="flex gap-2 rounded-lg bg-bad-soft px-2.5 py-1.5">
        <span className={tag}>Before</span>
        {before ? <span className="min-w-0 break-words line-through decoration-1 opacity-75">{before}</span> : <span className="text-muted">(none)</span>}
      </div>
      <div className="flex gap-2 rounded-lg bg-good-soft px-2.5 py-1.5">
        <span className={tag}>After</span>
        <span className="min-w-0 break-words">{after}</span>
      </div>
    </div>
  );
}

/** Readiness score pill, colored by band (with the band word, not color alone). */
function ScorePill({ score }: { score: number }) {
  const [label, color] = score >= 80 ? ["Agent-ready", "#0ca30c"] : score >= 50 ? ["Partial", "#d98a00"] : ["Not ready", "#d03b3b"];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}1f`, color }}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {score.toFixed(1)} · {label}
    </span>
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
      return (
        <Diff
          before={typeof item.before === "string" ? `${attributeLabel(c.key)}: ${formatAttributeValue(c.key, c.type, item.before)}` : null}
          after={`${attributeLabel(c.key)}: ${formatAttributeValue(c.key, c.type, c.value)}`}
        />
      );
    case "rename_option":
      return <Diff before={c.from} after={c.to} />;
    case "set_variant_skus":
      return (
        <ul className="grid gap-1 rounded-lg bg-good-soft px-2.5 py-1.5 text-sm">
          {c.variants.map((v) => (
            <li key={v.variantId} className="tabular-nums">
              {(item.before as { variantId: string; title: string }[]).find((b) => b.variantId === v.variantId)?.title}
              <span className="text-muted"> — no SKU → </span>
              <span className="font-mono text-xs">{v.sku}</span>
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
      return <p className="rounded-lg bg-surface-muted px-2.5 py-1.5 text-sm">{c.reason}</p>;
  }
}

function EditForm({ item }: { item: ReviewItem }) {
  const c = item.change;
  if (!["set_title", "set_description", "set_metafield", "set_alt_text"].includes(c.kind)) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-accent">Edit before approving</summary>
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

function ItemRow({ item, admin, names, product }: { item: ReviewItem; admin: boolean; names: Record<string, string>; product: ReviewProduct }) {
  const dependsOnTitle = titleDependency(item, product);
  const decidable = admin && (item.status === "pending" || item.status === "approved");
  return (
    <li className="grid gap-2.5 border-l-4 px-4 py-4" style={{ borderLeftColor: STATUS_COLOR[item.status] }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {KIND_LABEL[item.kind]} <StatusChip status={item.status} />
        </p>
        <span className="text-xs text-muted">
          {CHECKS[item.checkId as CheckId]?.label ?? item.checkId} · #{item.id}
        </span>
      </div>
      <p className="text-sm text-muted">{whyItMatters(item)}</p>
      <ChangeView item={item} names={names} />
      {dependsOnTitle && (
        <p className="rounded-lg px-2.5 py-1.5 text-sm" style={{ backgroundColor: "#d98a001f" }}>
          Uses the new title from the &ldquo;Rewrite the title&rdquo; fix (#{dependsOnTitle.id}, {dependsOnTitle.status.replace("_", " ")}). It will only be applied together with or after that title.
        </p>
      )}
      <p className="text-xs text-muted">
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
      {admin && item.status === "rejected" && (
        <form action={decide}>
          <input type="hidden" name="id" value={item.id} />
          <button name="decision" value="reopen" className={`${button} ${quiet}`}>
            Move back to pending
          </button>
        </form>
      )}
    </li>
  );
}

const STATUS_PHRASE: Record<FixStatus, string> = {
  pending: "pending review",
  approved: "approved, waiting to apply",
  applied: "live in Shopify",
  needs_merchant: "needs the merchant",
  failed: "failed to apply",
  rejected: "rejected",
};

function StatusChip({ status }: { status: FixStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}1f`, color }}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {TABS.find((t) => t.status === status)!.label}
    </span>
  );
}

/** The product as it is now, and what each open fix would change — before the fix-by-fix detail. */
function Glance({ rows }: { rows: ReviewProduct["glance"] }) {
  return (
    <details open className="border-b border-line bg-surface-muted px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">Product at a glance</summary>
      <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted">{r.label}</dt>
            <dd className="min-w-0 break-words">
              {r.proposed ? (
                <>
                  {r.current && r.proposed.status !== "applied" && <span className="mr-1.5 line-through opacity-50">{r.current}</span>}
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${r.proposed.status === "needs_merchant" ? "" : "bg-good-soft"}`}
                    style={r.proposed.status === "needs_merchant" ? { backgroundColor: `${STATUS_COLOR.needs_merchant}1f` } : undefined}
                  >
                    {r.proposed.status === "applied" ? r.current : r.proposed.value}
                  </span>{" "}
                  <span className="text-xs text-muted">
                    {STATUS_PHRASE[r.proposed.status]} · #{r.proposed.id}
                  </span>
                </>
              ) : (
                (r.current ?? <span className="text-muted">(not set)</span>)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ProductCard({
  product,
  admin,
  names,
}: {
  product: ReviewProduct;
  admin: boolean;
  names: Record<string, string>;
}) {
  const approved = product.statusCounts.approved ?? 0;
  const draft = product.titleFix && product.titleFix.status !== "applied" && product.titleFix.title !== product.title ? product.titleFix : null;
  const tally = TABS.filter((t) => product.statusCounts[t.status]).map((t) => `${product.statusCounts[t.status]} ${t.label.toLowerCase()}`);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          {admin && (
            <input
              type="checkbox"
              name="productIds"
              value={product.productId}
              form={BULK_FORM}
              aria-label={`Select ${product.title}`}
              className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
            />
          )}
          <div className="min-w-0">
            <h2 className="font-semibold leading-snug">
              {product.title}
              {draft && (
                <span className="ml-2 text-sm font-normal italic text-muted">
                  (draft title: “{draft.title}” — {STATUS_PHRASE[draft.status]})
                </span>
              )}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {product.score !== null && <ScorePill score={product.score} />}
              <span>{tally.join(" · ")}</span>
              <span className="font-mono">{product.handle}</span>
            </p>
          </div>
        </div>
        {admin && approved > 0 && (
          <form action={applyProduct}>
            <input type="hidden" name="productId" value={product.productId} />
            <button className={`${button} ${primary}`}>
              Apply {approved} approved to Shopify
            </button>
          </form>
        )}
      </header>
      <Glance rows={product.glance} />
      <ul className="divide-y divide-line">
        {product.items.map((item) => (
          <ItemRow key={item.id} item={item} admin={admin} names={names} product={product} />
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
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="mt-1 text-sm text-muted">Suggested fixes that make products easier for AI shopping assistants to find and recommend.</p>
        </div>
        {admin ? (
          <form action={logout} className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" /> Admin
            </span>
            <button className={`${button} ${quiet}`}>Sign out</button>
          </form>
        ) : (
          <form action={login} className="flex items-center gap-2">
            <input type="password" name="passcode" placeholder="Admin passcode" autoComplete="current-password" className={`${field} w-40`} aria-label="Admin passcode" />
            <button className={`${button} ${quiet}`}>Sign in</button>
          </form>
        )}
      </div>
      {params.login === "failed" && !admin && <p className="mt-2 text-sm text-red-600 dark:text-red-400">Wrong passcode.</p>}
      {params.notice && admin && (
        <p role="status" className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          {params.notice}
        </p>
      )}
      {!admin && (
        <div className="mt-6">
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              "The audit finds gaps that stop AI shopping assistants from understanding a product.",
              "The fixer suggests a fix for each gap — using only facts already in the product’s data, never invented ones.",
              "A person reviews every fix. Nothing changes in the store until it’s approved and applied.",
            ].map((text, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
                <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                <span className="text-muted">{text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted">You&apos;re viewing read-only. Reviewing needs the admin passcode.</p>
        </div>
      )}

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter by status">
        {TABS.map((t) => {
          const active = t.status === status;
          return (
            <a
              key={t.status}
              href={`/review?status=${t.status}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-transparent bg-foreground text-background" : "border-line bg-surface hover:bg-surface-muted"}`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-background/20" : "bg-surface-muted text-muted"}`}>{counts[t.status]}</span>
            </a>
          );
        })}
      </nav>
      <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <p>{TABS.find((t) => t.status === status)!.meaning}</p>
        <p className="mt-0.5 text-muted">What happens next: {TABS.find((t) => t.status === status)!.next}</p>
      </div>

      {admin && products.length > 0 && (
        <form id={BULK_FORM} className="sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
          <input type="hidden" name="status" value={status} />
          <span className="text-sm font-medium">Selected products:</span>
          <SelectAll form={BULK_FORM} />
          <span className="ml-auto flex flex-wrap gap-2">
            <button formAction={bulkApprove} className={`${button} ${quiet}`}>
              Approve pending fixes
            </button>
            <button formAction={bulkApply} className={`${button} ${primary}`}>
              Apply approved to Shopify
            </button>
          </span>
        </form>
      )}

      <div className="mt-6 grid gap-4">
        {products.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          products.map((p) => <ProductCard key={p.productId} product={p} admin={admin} names={categoryNames} />)
        )}
      </div>
    </main>
  );
}

/** Alt text written with a proposed (not yet live) title depends on that title fix. */
function titleDependency(item: ReviewItem, product: ReviewProduct) {
  const fix = product.titleFix;
  if (item.change.kind !== "set_alt_text" || !fix || fix.title === product.title || fix.status === "applied") return null;
  return item.change.images.some((img) => img.alt.includes(fix.title)) ? fix : null;
}

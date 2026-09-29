import type { Metadata } from "next";
import { connection } from "next/server";
import { getBaselineComparison, getLatestAuditRun, type AuditRunView, type BaselineComparison } from "@/lib/audit/queries";
import { BAND_GATE_THRESHOLD, BANDS, CHECK_IDS, CHECKS, type BandId } from "@/lib/audit/rubric";

export const metadata: Metadata = { title: "Catalog audit · ShelfReady" };

// Status colors (good / warning / critical) always ship with an icon + label, never alone.
const BAND_STYLE: Record<BandId, { color: string; icon: string }> = {
  agent_ready: { color: "#0ca30c", icon: "✓" },
  partial: { color: "#fab219", icon: "!" },
  not_ready: { color: "#d03b3b", icon: "✕" },
};

const bandLabel = (id: BandId) => BANDS.find((b) => b.id === id)!.label;
const WORST_COUNT = 10;

function BandBadge({ band }: { band: BandId }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span
        aria-hidden
        className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: BAND_STYLE[band].color }}
      >
        {BAND_STYLE[band].icon}
      </span>
      {bandLabel(band)}
    </span>
  );
}

function BandBar({ summary }: { summary: AuditRunView["summary"] }) {
  return (
    <div>
      {/* 2px surface gap between segments; each segment has a hover title. */}
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label="Products by band">
        {BANDS.filter((b) => summary.bands[b.id].count > 0).map((b) => (
          <div
            key={b.id}
            title={`${b.label}: ${summary.bands[b.id].count} products (${summary.bands[b.id].pct}%)`}
            style={{ width: `${summary.bands[b.id].pct}%`, backgroundColor: BAND_STYLE[b.id].color }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {BANDS.map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <BandBadge band={b.id} />
            <span className="text-sm tabular-nums text-muted">
              {summary.bands[b.id].count} · {summary.bands[b.id].pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckBars({ summary }: { summary: AuditRunView["summary"] }) {
  return (
    <ul className="space-y-3">
      {CHECK_IDS.map((id) => {
        const avg = summary.checkAverages[id];
        return (
          <li key={id} title={`${CHECKS[id].label}: average ${(avg * 100).toFixed(0)}% · weight ${CHECKS[id].weight}`}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span>
                {CHECKS[id].label} <span className="text-muted">· weight {CHECKS[id].weight}</span>
              </span>
              <span className="tabular-nums">{(avg * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded bg-[#2a78d6]/15 dark:bg-[#3987e5]/20">
              <div className="h-2 rounded bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${avg * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProductRow({ p }: { p: AuditRunView["products"][number] }) {
  const failing = CHECK_IDS.filter((id) => p.checks[id].score < 1);
  return (
    <details className="group border-b border-line last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-muted">
        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{p.score.toFixed(1)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{p.title}</span>
          <span className="block truncate text-xs text-muted">
            {p.handle} · {p.category.replace("_", " ")}
          </span>
        </span>
        <span className="hidden sm:inline">
          <BandBadge band={p.band} />
        </span>
      </summary>
      <div className="space-y-3 px-4 pb-4 pl-[4.75rem] text-sm">
        {failing.length === 0 ? (
          <p className="text-muted">Passes every check.</p>
        ) : (
          failing.map((id) => (
            <div key={id}>
              <p className="font-medium">
                {CHECKS[id].label}{" "}
                <span className="font-normal tabular-nums text-muted">
                  {(p.checks[id].score * 100).toFixed(0)}% · −{((1 - p.checks[id].score) * CHECKS[id].weight).toFixed(1)} pts
                  {p.checks[id].score < BAND_GATE_THRESHOLD && " · caps the band"}
                </span>
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {p.checks[id].findings.map((f) => (
                  <li key={f} className="break-words">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

function BeforeAfter({ comparison, summary }: { comparison: BaselineComparison; summary: AuditRunView["summary"] }) {
  const before = comparison.baseline.summary;
  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Before → after fixes</h2>
      <p className="mb-4 text-sm text-muted">
        Baseline run #{comparison.baseline.id} vs this run, same rubric and model — every change comes from approved fixes applied in Shopify.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 font-normal">Band</th>
            <th className="py-1 text-right font-normal">Before</th>
            <th className="py-1 text-right font-normal">After</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {BANDS.map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td className="py-2">
                <BandBadge band={b.id} />
              </td>
              <td className="py-2 text-right">
                {before.bands[b.id].count} <span className="text-muted">({before.bands[b.id].pct}%)</span>
              </td>
              <td className="py-2 text-right">
                {summary.bands[b.id].count} <span className="text-muted">({summary.bands[b.id].pct}%)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mt-6 font-medium">
        {comparison.changed.length} product{comparison.changed.length === 1 ? "" : "s"} changed
      </h3>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {comparison.changed.map((c) => (
          <li key={c.productId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <span className="w-28 shrink-0 font-semibold tabular-nums">
              {c.scoreBefore.toFixed(1)} → {c.scoreAfter.toFixed(1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.titleAfter}</span>
              {c.titleBefore !== c.titleAfter && <span className="block truncate text-xs text-muted">was “{c.titleBefore}”</span>}
            </span>
            <span className="flex w-full items-center gap-1 text-sm sm:w-auto">
              <BandBadge band={c.bandBefore} /> <span aria-hidden className="text-muted">→</span> <BandBadge band={c.bandAfter} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AuditPage() {
  await connection(); // always read the latest run, never prerender
  const run = await getLatestAuditRun();

  if (!run) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Catalog audit</h1>
        <p className="mt-4 text-muted">
          No audit has run yet. Run <code>npm run sync && npm run audit</code>.
        </p>
      </main>
    );
  }

  const { summary } = run;
  const worst = run.products.slice(0, WORST_COUNT);
  const comparison = await getBaselineComparison(run);
  const delta = comparison ? summary.score - comparison.baseline.summary.score : 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Catalog audit</h1>
      <p className="mt-1 text-sm text-muted">
        Run #{run.id} · rubric {run.rubricVersion} · {run.model} · {run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
      </p>

      <section className="mt-8 grid gap-8 rounded-xl border border-line bg-surface p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div>
          <p className="text-sm text-muted">Store agent-readiness</p>
          <p className="text-6xl font-semibold">
            {summary.score.toFixed(1)}
            <span className="text-2xl font-normal text-muted"> / 100</span>
          </p>
          <p className="mt-1 text-sm text-muted">mean of {summary.products} products</p>
          {comparison && (
            <p className="mt-1 text-sm">
              <span className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
              </span>{" "}
              <span className="text-muted">
                vs baseline run #{comparison.baseline.id} ({comparison.baseline.summary.score.toFixed(1)})
              </span>
            </p>
          )}
        </div>
        <BandBar summary={summary} />
      </section>

      {comparison && <BeforeAfter comparison={comparison} summary={summary} />}

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Where points are lost</h2>
        <p className="mb-4 text-sm text-muted">Average score per check across the catalog.</p>
        <CheckBars summary={summary} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Worst offenders</h2>
        <p className="mb-4 text-sm text-muted">Tap a product to see what an agent can&apos;t tell from it.</p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {worst.map((p) => (
            <ProductRow key={p.productId} p={p} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <details>
          <summary className="cursor-pointer text-lg font-semibold">All {run.products.length} products</summary>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
            {run.products.map((p) => (
              <ProductRow key={p.productId} p={p} />
            ))}
          </div>
        </details>
      </section>
    </main>
  );
}

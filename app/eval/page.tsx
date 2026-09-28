import type { Metadata } from "next";
import { connection } from "next/server";
import tasksFile from "@/evals/tasks.json";
import { getBaselineComparison, getLatestAuditRun } from "@/lib/audit/queries";
import { getEvalPair, listEvalPairs, type EvalPair, type EvalTaskRow } from "@/lib/eval/queries";

export const metadata: Metadata = { title: "Agent shopping eval · ShelfReady" };

type Task = (typeof tasksFile.tasks)[number];

// Categorical slots 1–2 (validated palette): After = blue (the fixed catalog), Before = orange.
const SERIES = {
  before: { label: "Before fixes", light: "#eb6834", dark: "#d95926" },
  after: { label: "After fixes", light: "#2a78d6", dark: "#3987e5" },
} as const;

// Outcome status: color always paired with an icon and a label.
const OUTCOME: Record<string, { label: string; icon: string; color: string }> = {
  success: { label: "Success", icon: "✓", color: "#0ca30c" },
  wrong_product: { label: "Wrong product", icon: "✕", color: "#d03b3b" },
  wrong_variant: { label: "Wrong size/color", icon: "!", color: "#ec835a" },
  no_cart: { label: "No cart", icon: "–", color: "#fab219" },
  error: { label: "Error", icon: "?", color: "#8a8a85" },
};

const KIND_LABEL: Record<string, string> = {
  messy_target: "Product was messy",
  clean_target: "Product was clean (control)",
  no_match: "Nothing fits (should not buy)",
};

function Swatch({ series }: { series: keyof typeof SERIES }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 rounded-sm bg-[var(--c-light)] dark:bg-[var(--c-dark)]"
      style={{ "--c-light": SERIES[series].light, "--c-dark": SERIES[series].dark } as React.CSSProperties}
    />
  );
}

function OutcomeChip({ outcome }: { outcome: string | undefined }) {
  const o = OUTCOME[outcome ?? "error"] ?? OUTCOME.error;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: o.color }}>
        {o.icon}
      </span>
      {o.label}
    </span>
  );
}

/** Paired horizontal bars: one row per metric, before and after, each with a direct value label. */
function RateBars({ pair }: { pair: EvalPair }) {
  const rows: { label: string; key: "successRate" | "wrongProductRate" | "wrongVariantRate" | "noCartRate"; goodUp: boolean }[] = [
    { label: "Right product in the cart", key: "successRate", goodUp: true },
    { label: "Wrong product", key: "wrongProductRate", goodUp: false },
    { label: "Right product, wrong size/color", key: "wrongVariantRate", goodUp: false },
    { label: "Gave up — no cart", key: "noCartRate", goodUp: false },
  ];
  return (
    <div className="grid gap-5">
      {rows.map((r) => (
        <div key={r.key}>
          <p className="mb-1.5 text-sm">{r.label}</p>
          {(["before", "after"] as const).map((s) => {
            const v = pair[s].summary[r.key];
            return (
              <div key={s} className="flex items-center gap-2" title={`${SERIES[s].label}: ${v}%`}>
                <div className="h-3 flex-1 rounded-sm bg-black/[.05] dark:bg-white/[.07]">
                  <div
                    className="h-3 rounded-sm bg-[var(--c-light)] dark:bg-[var(--c-dark)]"
                    style={{ width: `${Math.max(v, 0.5)}%`, "--c-light": SERIES[s].light, "--c-dark": SERIES[s].dark } as React.CSSProperties}
                  />
                </div>
                <span className="w-14 text-right text-sm tabular-nums">{v}%</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Transcript({ row }: { row: EvalTaskRow | undefined }) {
  if (!row) return <p className="text-sm opacity-60">Not run.</p>;
  return (
    <div className="grid gap-2 text-sm">
      <OutcomeChip outcome={row.outcome} />
      <ol className="grid gap-1.5">
        {row.transcript.steps.flatMap((s, i) =>
          s.calls.map((c, j) => (
            <li key={`${i}-${j}`} className="break-words rounded bg-black/[.03] px-2 py-1 font-mono text-xs dark:bg-white/[.05]">
              <span className="font-semibold">{c.tool}</span> {JSON.stringify(c.input)}
            </li>
          )),
        )}
      </ol>
      {row.transcript.answer && <p className="whitespace-pre-wrap opacity-80">{row.transcript.answer.slice(0, 600)}</p>}
      {row.transcript.error && <p className="text-red-600 dark:text-red-400">{row.transcript.error}</p>}
      <p className="text-xs opacity-60">
        {row.toolCalls} tool calls · {row.tokens.toLocaleString("en-US")} tokens
      </p>
    </div>
  );
}

export default async function EvalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  const params = await searchParams;
  const pairs = await listEvalPairs();
  const label = params.label && pairs.some((p) => p.label === params.label) ? params.label : pairs[0]?.label;
  const pair = label ? await getEvalPair(label) : null;

  if (!pair) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-semibold">Agent shopping eval</h1>
        <p className="mt-4 opacity-70">
          No eval has run yet. Run <code>npm run eval</code>.
        </p>
      </main>
    );
  }

  const run = await getLatestAuditRun();
  const audit = run ? await getBaselineComparison(run) : null;
  const tasks = tasksFile.tasks as Task[];
  const delta = pair.after.summary.successRate - pair.before.summary.successRate;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Agent shopping eval</h1>
      <p className="mt-1 text-sm opacity-60">
        {tasks.length} shopper requests · {pair.model} · {pair.createdAt.toISOString().slice(0, 10)} · same tasks, same model, same tools on both catalogs
      </p>
      {pairs.length > 1 && (
        <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Eval run">
          {pairs.map((p) => (
            <a
              key={p.label}
              href={`/eval?label=${encodeURIComponent(p.label)}`}
              aria-current={p.label === pair.label ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${p.label === pair.label ? "border-transparent bg-foreground text-background" : "border-black/15 dark:border-white/20"}`}
            >
              {p.model}
            </a>
          ))}
        </nav>
      )}

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-sm opacity-70">An AI agent found the right product</p>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold opacity-60">{pair.before.summary.successRate}%</span>
            <span aria-hidden className="text-2xl opacity-40">→</span>
            <span className="text-6xl font-semibold">{pair.after.summary.successRate}%</span>
          </p>
          <p className="mt-1 text-sm">
            <span className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 10) / 10)} points
            </span>{" "}
            <span className="opacity-70">after fixing the catalog</span>
          </p>
        </div>
        {audit && (
          <div>
            <p className="text-sm opacity-70">Catalog agent-readiness</p>
            <p className="mt-1 flex items-baseline gap-3">
              <span className="text-3xl font-semibold opacity-60">{audit.baseline.summary.score.toFixed(1)}</span>
              <span aria-hidden className="text-2xl opacity-40">→</span>
              <span className="text-6xl font-semibold">{run!.summary.score.toFixed(1)}</span>
            </p>
            <p className="mt-1 text-sm opacity-70">audit score out of 100 (see /audit)</p>
          </div>
        )}
      </section>

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">What the agent ended up doing</h2>
          <p className="flex gap-4 text-sm">
            {(["before", "after"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <Swatch series={s} /> {SERIES[s].label}
              </span>
            ))}
          </p>
        </div>
        <p className="mb-4 text-sm opacity-70">Share of the {tasks.length} tasks. Judged against the true product data, not what the catalog said.</p>
        <RateBars pair={pair} />
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        {[
          { label: "Tool calls per task", key: "avgToolCalls" as const },
          { label: "Tokens per task", key: "avgTokens" as const },
        ].map((m) => (
          <div key={m.key} className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
            <p className="text-sm opacity-70">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold">
              <span className="opacity-60">{pair.before.summary[m.key].toLocaleString("en-US")}</span>
              <span aria-hidden className="mx-2 text-lg opacity-40">→</span>
              {pair.after.summary[m.key].toLocaleString("en-US")}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">By kind of task</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left opacity-60">
              <th className="py-1 font-normal">Task</th>
              <th className="py-1 text-right font-normal">Tasks</th>
              <th className="py-1 text-right font-normal">Before</th>
              <th className="py-1 text-right font-normal">After</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {(["messy_target", "clean_target", "no_match"] as const).map((k) => (
              <tr key={k} className="border-t border-black/10 dark:border-white/15">
                <td className="py-2">{KIND_LABEL[k]}</td>
                <td className="py-2 text-right">{pair.after.summary.byKind[k].tasks}</td>
                <td className="py-2 text-right">{pair.before.summary.byKind[k].successRate ?? "—"}%</td>
                <td className="py-2 text-right font-medium">{pair.after.summary.byKind[k].successRate ?? "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Every task</h2>
        <p className="mb-3 text-sm opacity-70">Tap a task to see what the agent searched for and bought, before and after.</p>
        <div className="rounded-lg border border-black/10 dark:border-white/15">
          {tasks.map((t) => {
            const b = pair.before.results.get(t.id);
            const a = pair.after.results.get(t.id);
            return (
              <details key={t.id} className="border-b border-black/10 last:border-0 dark:border-white/15">
                <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 hover:bg-black/[.03] sm:grid-cols-[1fr_auto] dark:hover:bg-white/[.05]">
                  <span className="min-w-0">
                    <span className="block">{t.request}</span>
                    <span className="block text-xs opacity-60">
                      {t.id} · {KIND_LABEL[t.kind]}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <OutcomeChip outcome={b?.outcome} /> <span aria-hidden className="opacity-40">→</span> <OutcomeChip outcome={a?.outcome} />
                  </span>
                </summary>
                <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                      <Swatch series="before" /> {SERIES.before.label}
                    </p>
                    <Transcript row={b} />
                  </div>
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                      <Swatch series="after" /> {SERIES.after.label}
                    </p>
                    <Transcript row={a} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </main>
  );
}

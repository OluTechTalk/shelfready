import type { Metadata } from "next";
import { connection } from "next/server";
import tasksFile from "@/evals/tasks.json";
import { getBaselineComparison, getLatestAuditRun } from "@/lib/audit/queries";
import { across, acrossKind, getEvalGroup, listEvalGroups, type EvalGroup, type EvalTaskRow } from "@/lib/eval/queries";

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
  no_cart: { label: "No cart", icon: "–", color: "#d98a00" },
  error: { label: "Error", icon: "?", color: "#8a8a85" },
};

const KIND_LABEL: Record<string, string> = {
  messy_target: "Product was messy",
  clean_target: "Product was clean (control)",
  no_match: "Nothing fits (should not buy)",
};

const seriesVars = (s: keyof typeof SERIES) => ({ "--c-light": SERIES[s].light, "--c-dark": SERIES[s].dark }) as React.CSSProperties;

function Swatch({ series }: { series: keyof typeof SERIES }) {
  return <span aria-hidden className="inline-block size-2.5 rounded-sm bg-[var(--c-light)] dark:bg-[var(--c-dark)]" style={seriesVars(series)} />;
}

function OutcomeChip({ outcome }: { outcome: string | undefined }) {
  const o = OUTCOME[outcome ?? "error"] ?? OUTCOME.error;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${o.color}1f`, color: o.color }}>
      <span aria-hidden>{o.icon}</span>
      {o.label}
    </span>
  );
}

/** How many of the repeats passed a task, e.g. "3/3". */
function PassCount({ passed, total }: { passed: number; total: number }) {
  const o = passed === total ? OUTCOME.success : passed === 0 ? OUTCOME.wrong_product : OUTCOME.no_cart;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums" style={{ backgroundColor: `${o.color}1f`, color: o.color }}>
      <span aria-hidden>{o.icon}</span>
      {passed}/{total}
    </span>
  );
}

const pct = (x: { mean: number; min: number; max: number }, reps: number) => (reps > 1 && x.min !== x.max ? `${x.mean}% (${x.min}–${x.max})` : `${x.mean}%`);

function RateBars({ group }: { group: EvalGroup }) {
  const rows = [
    { label: "Right product in the cart", key: "successRate" as const },
    { label: "Wrong product", key: "wrongProductRate" as const },
    { label: "Right product, wrong size/color", key: "wrongVariantRate" as const },
    { label: "Gave up — no cart", key: "noCartRate" as const },
  ];
  return (
    <div className="grid gap-5">
      {rows.map((r) => (
        <div key={r.key}>
          <p className="mb-1.5 text-sm">{r.label}</p>
          {(["before", "after"] as const).map((s) => {
            const v = across(group, s, r.key);
            return (
              <div key={s} className="flex items-center gap-2" title={`${SERIES[s].label}: ${pct(v, group.reps.length)}`}>
                <div className="relative h-3 flex-1 rounded-sm bg-surface-muted">
                  <div className="h-3 rounded-sm bg-[var(--c-light)] dark:bg-[var(--c-dark)]" style={{ width: `${Math.max(v.mean, 0.5)}%`, ...seriesVars(s) }} />
                  {group.reps.length > 1 && v.min !== v.max && (
                    // Spread across repeats: a thin line from the lowest to the highest run.
                    <div aria-hidden className="absolute top-1/2 h-px -translate-y-1/2 bg-foreground/60" style={{ left: `${v.min}%`, width: `${v.max - v.min}%` }} />
                  )}
                </div>
                <span className="w-24 text-right text-sm tabular-nums">{pct(v, group.reps.length)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Transcript({ row }: { row: EvalTaskRow | undefined }) {
  if (!row) return <p className="text-sm text-muted">Not run.</p>;
  return (
    <div className="grid gap-2 text-sm">
      <OutcomeChip outcome={row.outcome} />
      <ol className="grid gap-1.5">
        {row.transcript.steps.flatMap((s, i) =>
          s.calls.map((c, j) => (
            <li key={`${i}-${j}`} className="break-words rounded-md bg-surface-muted px-2 py-1 font-mono text-xs">
              <span className="font-semibold">{c.tool}</span> {JSON.stringify(c.input)}
            </li>
          )),
        )}
      </ol>
      {row.transcript.answer && <p className="whitespace-pre-wrap text-muted">{row.transcript.answer.slice(0, 600)}</p>}
      {row.transcript.error && <p className="text-red-600 dark:text-red-400">{row.transcript.error}</p>}
      <p className="text-xs text-muted">
        {row.toolCalls} tool calls · {row.tokens.toLocaleString("en-US")} tokens
      </p>
    </div>
  );
}

export default async function EvalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  const params = await searchParams;
  const groups = await listEvalGroups();
  const base = params.run && groups.some((g) => g.base === params.run) ? params.run : groups[0]?.base;
  const group = base ? await getEvalGroup(base) : null;

  if (!group) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Agent shopping eval</h1>
        <p className="mt-4 text-muted">
          No eval has run yet. Run <code>npm run eval</code>.
        </p>
      </main>
    );
  }

  const run = await getLatestAuditRun();
  const audit = run ? await getBaselineComparison(run) : null;
  const tasks = tasksFile.tasks as Task[];
  const n = group.reps.length;
  const before = across(group, "before", "successRate");
  const after = across(group, "after", "successRate");
  const delta = Math.round((after.mean - before.mean) * 10) / 10;
  const passes = (side: "before" | "after", taskId: string) => group.reps.filter((r) => r[side].results.get(taskId)?.success).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Agent shopping eval</h1>
      <p className="mt-1 text-sm text-muted">
        {tasks.length} shopper requests · {group.model} · {n > 1 ? `average of ${n} runs` : "1 run"} · same tasks, model and tools on both catalogs
      </p>
      {groups.length > 1 && (
        <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Eval run">
          {groups.map((g) => (
            <a
              key={g.base}
              href={`/eval?run=${encodeURIComponent(g.base)}`}
              aria-current={g.base === group.base ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${g.base === group.base ? "border-transparent bg-foreground text-background" : "border-line bg-surface hover:bg-surface-muted"}`}
            >
              {g.model} · {g.reps > 1 ? `${g.reps} runs` : "1 run"}
            </a>
          ))}
        </nav>
      )}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">An AI agent found the right product</p>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-muted">{before.mean}%</span>
            <span aria-hidden className="text-xl text-muted">→</span>
            <span className="text-5xl font-semibold">{after.mean}%</span>
          </p>
          <p className="mt-1 text-sm">
            <span className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} points
            </span>{" "}
            <span className="text-muted">{n > 1 ? `(runs ranged ${before.min}–${before.max}% → ${after.min}–${after.max}%)` : "after fixing the catalog"}</span>
          </p>
        </div>
        {audit && run && (
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-muted">Catalog agent-readiness</p>
            <p className="mt-1 flex items-baseline gap-3">
              <span className="text-2xl font-semibold text-muted">{audit.baseline.summary.score.toFixed(1)}</span>
              <span aria-hidden className="text-xl text-muted">→</span>
              <span className="text-5xl font-semibold">{run.summary.score.toFixed(1)}</span>
            </p>
            <p className="mt-1 text-sm text-muted">audit score out of 100 (see Audit)</p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
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
        <p className="mb-5 text-sm text-muted">
          Share of the {tasks.length} tasks{n > 1 ? `, averaged over ${n} runs (line = lowest to highest run)` : ""}. Judged against the true product data, not what the catalog said.
        </p>
        <RateBars group={group} />
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        {[
          { label: "Tool calls per task", key: "avgToolCalls" as const },
          { label: "Tokens per task", key: "avgTokens" as const },
        ].map((m) => (
          <div key={m.key} className="rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-muted">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              <span className="text-muted">{across(group, "before", m.key).mean.toLocaleString("en-US")}</span>
              <span aria-hidden className="mx-2 text-lg text-muted">→</span>
              {across(group, "after", m.key).mean.toLocaleString("en-US")}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">By kind of task</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">Task</th>
              <th className="py-1 text-right font-normal">Tasks</th>
              <th className="py-1 text-right font-normal">Before</th>
              <th className="py-1 text-right font-normal">After</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {(["messy_target", "clean_target", "no_match"] as const).map((k) => (
              <tr key={k} className="border-t border-line">
                <td className="py-2">{KIND_LABEL[k]}</td>
                <td className="py-2 text-right">{group.reps[0].after.summary.byKind[k].tasks}</td>
                <td className="py-2 text-right">{acrossKind(group, "before", k) ?? "—"}%</td>
                <td className="py-2 text-right font-medium">{acrossKind(group, "after", k) ?? "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Every task</h2>
        <p className="mb-3 text-sm text-muted">
          {n > 1 ? `Runs passed out of ${n}, before → after. ` : ""}Tap a task to see what the agent searched for and bought{n > 1 ? " (first run)" : ""}.
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {tasks.map((t) => (
            <details key={t.id} className="border-b border-line last:border-0">
              <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 hover:bg-surface-muted sm:grid-cols-[1fr_auto]">
                <span className="min-w-0">
                  <span className="block">{t.request}</span>
                  <span className="block text-xs text-muted">
                    {t.id} · {KIND_LABEL[t.kind]}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  {n > 1 ? (
                    <>
                      <PassCount passed={passes("before", t.id)} total={n} /> <span aria-hidden className="text-muted">→</span>{" "}
                      <PassCount passed={passes("after", t.id)} total={n} />
                    </>
                  ) : (
                    <>
                      <OutcomeChip outcome={group.reps[0].before.results.get(t.id)?.outcome} /> <span aria-hidden className="text-muted">→</span>{" "}
                      <OutcomeChip outcome={group.reps[0].after.results.get(t.id)?.outcome} />
                    </>
                  )}
                </span>
              </summary>
              <div className="grid gap-4 border-t border-line bg-surface-muted/40 px-4 py-4 sm:grid-cols-2">
                {(["before", "after"] as const).map((s) => (
                  <div key={s}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <Swatch series={s} /> {SERIES[s].label}
                    </p>
                    <Transcript row={group.reps[0][s].results.get(t.id)} />
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

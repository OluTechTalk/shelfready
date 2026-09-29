import Link from "next/link";
import { connection } from "next/server";
import { getBaselineComparison, getLatestAuditRun } from "@/lib/audit/queries";
import { across, getEvalGroup, listEvalGroups } from "@/lib/eval/queries";

const MCP_URL = "https://shelfready-ashen.vercel.app/api/mcp";

const STEPS = [
  {
    href: "/audit",
    step: "1",
    title: "Audit",
    body: "Scores every product 0–100 on what an AI shopping agent needs: structured attributes, answerable descriptions, clean variants, specific titles.",
  },
  {
    href: "/review",
    step: "2",
    title: "Review fixes",
    body: "The fixer proposes fixes grounded in each product's own data. A person approves every change before it reaches Shopify.",
  },
  {
    href: "/eval",
    step: "3",
    title: "Measure with agents",
    body: "The store is open to agents over MCP. The same shopping tasks run on the messy and the fixed catalog to measure the difference.",
  },
];

export default async function Home() {
  await connection();
  const run = await getLatestAuditRun();
  const audit = run ? await getBaselineComparison(run) : null;
  const groups = await listEvalGroups();
  const evalGroup = groups[0] ? await getEvalGroup(groups[0].base) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14">
      <p className="text-sm font-medium text-accent">Agent-ready storefront</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Make a store&apos;s catalog usable by AI shopping agents.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        ShelfReady audits a Shopify catalog, fixes the gaps with AI and human approval, and opens the store to agents through an MCP
        server — then measures whether agents actually shop better.
      </p>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        {run && (
          <Link href="/audit" className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent">
            <p className="text-sm text-muted">Catalog agent-readiness</p>
            <p className="mt-1 flex items-baseline gap-2">
              {audit && <span className="text-2xl font-semibold text-muted">{audit.baseline.summary.score.toFixed(1)} →</span>}
              <span className="text-4xl font-semibold">{run.summary.score.toFixed(1)}</span>
              <span className="text-muted">/ 100</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {run.summary.bands.agent_ready.pct}% of {run.summary.products} products agent-ready
            </p>
          </Link>
        )}
        <Link href="/eval" className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent">
          <p className="text-sm text-muted">Agent shopping success</p>
          {evalGroup ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-muted">{across(evalGroup, "before", "successRate").mean}% →</span>
                <span className="text-4xl font-semibold">{across(evalGroup, "after", "successRate").mean}%</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                {evalGroup.reps[0].after.summary.tasks} shopping tasks · {evalGroup.model}{evalGroup.reps.length > 1 ? ` · average of ${evalGroup.reps.length} runs` : ""}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">Eval in progress — results appear here when it finishes.</p>
          )}
        </Link>
      </section>

      <section className="mt-12 grid gap-3">
        {STEPS.map((s) => (
          <Link key={s.href} href={s.href} className="group flex gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent">
            <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {s.step}
            </span>
            <span>
              <span className="font-semibold group-hover:text-accent">{s.title} →</span>
              <span className="mt-1 block text-sm text-muted">{s.body}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="mt-12 rounded-xl border border-line bg-surface-muted p-5">
        <p className="font-semibold">Shop it with your own agent</p>
        <p className="mt-1 text-sm text-muted">
          Add this MCP server to Claude (Settings → Connectors → Add custom connector) and ask for gear. It can search, check stock and
          hand you a Shopify checkout link — it never takes payment.
        </p>
        <code className="mt-3 block break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm">{MCP_URL}</code>
        <p className="mt-3 text-sm text-muted">
          No agent handy?{" "}
          <Link href="/playground" className="font-medium text-accent underline">
            Try the shopper playground
          </Link>{" "}
          — chat with one right here.
        </p>
      </section>
    </main>
  );
}

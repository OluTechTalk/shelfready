import type { Metadata } from "next";
import { connection } from "next/server";
import { runStatusChecks } from "@/lib/status";

export const metadata: Metadata = { title: "Status · ShelfReady" };

export default async function StatusPage() {
  await connection(); // always check live, never prerender
  const checks = await runStatusChecks();
  const allOk = checks.every((c) => c.ok);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">ShelfReady status</h1>
      <p className={`mt-2 text-sm ${allOk ? "text-green-600" : "text-red-600"}`}>
        {allOk ? "All systems go" : "Some checks are failing"}
      </p>

      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {checks.map((check) => (
          <li key={check.name} className="flex items-start gap-3 px-4 py-3">
            <span
              aria-hidden
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${check.ok ? "bg-green-500" : "bg-red-500"}`}
            />
            <div className="min-w-0">
              <p className="font-medium">
                {check.name} <span className="sr-only">{check.ok ? "(ok)" : "(failing)"}</span>
              </p>
              <p className="break-words text-sm text-muted">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-muted">Checked at {new Date().toISOString()}</p>
    </main>
  );
}

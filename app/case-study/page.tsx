import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { Markdown } from "./markdown";

export const metadata: Metadata = {
  title: "Case study · ShelfReady",
  description: "Making a Shopify store usable by AI shopping agents — the engagement, results and what surprised me.",
};

// Static: rendered at build time from docs/CASE_STUDY.md (one source of truth for repo and site).
export default function CaseStudyPage() {
  const source = readFileSync(join(process.cwd(), "docs", "CASE_STUDY.md"), "utf8");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <article className="rounded-xl border border-line bg-surface p-6 sm:p-8">
        <Markdown source={source} />
      </article>
    </main>
  );
}

// A small Markdown renderer for our own docs (headings, paragraphs, lists, tables, emphasis,
// inline code, links) — enough for docs/CASE_STUDY.md without adding a Markdown package.

import type { ReactNode } from "react";

const REPO_DOCS = "https://github.com/OluTechTalk/shelfready/blob/main/docs/";

function href(target: string): string {
  if (/^https?:\/\//.test(target) || target.startsWith("/")) return target;
  return REPO_DOCS + target; // relative doc links point at the file on GitHub
}

function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g);
  return parts.map((s, i) => {
    const k = `${key}-${i}`;
    if (s.startsWith("**") && s.endsWith("**")) return <strong key={k}>{inline(s.slice(2, -2), k)}</strong>;
    if (s.startsWith("`") && s.endsWith("`")) return <code key={k} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">{s.slice(1, -1)}</code>;
    if (s.startsWith("[")) {
      const label = s.slice(1, s.indexOf("]"));
      const url = s.slice(s.indexOf("(") + 1, -1);
      return (
        <a key={k} href={href(url)} className="text-accent underline underline-offset-2">
          {inline(label, k)}
        </a>
      );
    }
    if (s.startsWith("*") && s.endsWith("*") && s.length > 2) return <em key={k}>{inline(s.slice(1, -1), k)}</em>;
    return s;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = String(i);
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("# ")) {
      out.push(<h1 key={key} className="text-3xl font-semibold tracking-tight">{inline(line.slice(2), key)}</h1>);
      i++;
    } else if (line.startsWith("## ")) {
      out.push(<h2 key={key} className="mt-6 text-xl font-semibold tracking-tight">{inline(line.slice(3), key)}</h2>);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={key} className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                {head.map((c, j) => (
                  <th key={j} className={`px-4 py-2 font-normal ${j ? "text-right" : ""}`}>
                    {inline(c, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {body.map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className={`px-4 py-2 ${j ? "text-right" : ""}`}>
                      {inline(c, `${key}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^(\d+\.|-) /.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.|-) /.test(lines[i])) {
        items.push(lines[i].replace(/^(\d+\.|-) /, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key} className={`grid gap-2 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}-${j}`)}</li>
          ))}
        </List>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||\d+\. |- )/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    }
  }
  return <div className="grid gap-4 leading-relaxed">{out}</div>;
}

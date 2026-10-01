"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

type Meta = { replay?: boolean; reason?: string };
type ToolPart = { type: string; state: string; input?: Record<string, unknown>; output?: unknown; errorText?: string };

const REASON: Record<string, string> = {
  demo_mode: "demo mode",
  rate_limited: "you've hit the message limit for a few minutes",
  daily_budget: "today's live budget is used up",
  no_limiter: "live agent unavailable",
};

/** Just enough Markdown for agent replies: **bold**, bullet/numbered lists, links. */
function Rich({ text }: { text: string }) {
  const link = "text-accent underline";
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/\S+)/g).map((seg, i) =>
      seg.startsWith("**") ? (
        <strong key={`${key}-${i}`}>{seg.slice(2, -2)}</strong>
      ) : /^\[[^\]]+\]\(/.test(seg) ? (
        // [label](url) — show the label, not a long URL
        <a key={`${key}-${i}`} href={seg.slice(seg.indexOf("(") + 1, -1)} target="_blank" rel="noreferrer" className={link}>
          {seg.slice(1, seg.indexOf("]"))}
        </a>
      ) : /^https?:\/\//.test(seg) ? (
        <a key={`${key}-${i}`} href={seg.replace(/[).,]+$/, "")} target="_blank" rel="noreferrer" className="break-all text-accent underline">
          {seg.replace(/[).,]+$/, "")}
        </a>
      ) : (
        seg
      ),
    );
  return (
    <div className="grid gap-1.5">
      {text
        .split("\n")
        .filter((l) => l.trim())
        .map((line, i) => {
          const item = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
          return item ? (
            <p key={i} className="pl-4 -indent-3">
              • {inline(item[1], String(i))}
            </p>
          ) : (
            <p key={i}>{inline(line, String(i))}</p>
          );
        })}
    </div>
  );
}

const money = (x: unknown) => (typeof x === "number" ? `$${x.toFixed(2).replace(/\.00$/, "")}` : String(x));

function ToolCard({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const done = part.state === "output-available";
  const out = (part.output ?? {}) as Record<string, unknown>;
  const box = "rounded-xl border border-line bg-surface-muted px-3 py-2.5 text-sm";

  if (part.state === "output-error") return <div className={box}>Tool error: {part.errorText}</div>;

  if (name === "search_products") {
    const filters = Object.entries(part.input ?? {}).filter(([k, v]) => k !== "limit" && v !== undefined && !(k === "sort" && v === "relevance"));
    const results = (out.results as { title: string; price: { min: number; max: number }; attributes: Record<string, string>; matchingVariants: { title: string; inStock: boolean }[] }[]) ?? [];
    return (
      <div className={box}>
        <p className="flex flex-wrap items-center gap-1.5 text-muted">
          <span className="font-medium text-foreground">{done ? `Searched the catalog — ${out.total ?? 0} match${out.total === 1 ? "" : "es"}` : "Searching the catalog…"}</span>
          {filters.map(([k, v]) => (
            <span key={k} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
              {k}: {typeof v === "object" ? Object.entries(v as object).map(([a, b]) => `${a}=${b}`).join(", ") : String(v)}
            </span>
          ))}
        </p>
        {typeof out.error === "string" && <p className="mt-1 text-xs text-muted">{out.error}</p>}
        {results.length > 0 && (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {results.slice(0, 4).map((r) => (
              <li key={r.title} className="rounded-lg border border-line bg-surface p-2.5">
                <p className="font-medium leading-snug">{r.title}</p>
                <p className="text-xs text-muted">
                  {r.price.min === r.price.max ? money(r.price.min) : `${money(r.price.min)}–${money(r.price.max)}`} ·{" "}
                  {r.matchingVariants.filter((v) => v.inStock).length} matching in stock
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted">
                  {Object.entries(r.attributes)
                    .slice(0, 3)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (name === "get_product") {
    return <div className={box}>{done ? <>Read the details of <span className="font-medium">{String(out.title ?? "a product")}</span></> : "Reading product details…"}</div>;
  }
  if (name === "check_availability") {
    const variants = (out.variants as { title?: string; available?: boolean; quantityAvailable?: number | null }[]) ?? [];
    return (
      <div className={box}>
        <p className="font-medium">{done ? "Checked live stock" : "Checking stock…"}</p>
        {variants.map((v, i) => (
          <p key={i} className="text-xs text-muted">
            {v.title}: {v.available ? `in stock${v.quantityAvailable != null ? ` (${v.quantityAvailable})` : ""}` : "sold out"}
          </p>
        ))}
      </div>
    );
  }
  if (name === "create_cart") {
    if (!done) return <div className={box}>Creating the cart…</div>;
    if (typeof out.error === "string") return <div className={box}>Cart not created: {out.error}</div>;
    const lines = (out.lines as { productTitle: string; title: string; quantity: number }[]) ?? [];
    const total = out.total as { amount: string; currencyCode: string } | undefined;
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-3 text-sm">
        <p className="font-medium">Cart ready</p>
        {lines.map((l, i) => (
          <p key={i} className="text-muted">
            {l.quantity} × {l.productTitle} ({l.title})
          </p>
        ))}
        {total && <p className="mt-1 font-medium">Total {money(Number(total.amount))} {total.currencyCode}</p>}
        <a href={String(out.checkoutUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90">
          Go to Shopify checkout →
        </a>
        <p className="mt-2 text-xs text-muted">The agent never takes payment — you pay on Shopify. This is a demo store (password-protected checkout).</p>
      </div>
    );
  }
  return null;
}

function Message({ m }: { m: UIMessage }) {
  const meta = (m.metadata ?? {}) as Meta;
  if (m.role === "user") {
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return <div className="w-fit max-w-[85%] justify-self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">{text}</div>;
  }
  return (
    <div className="grid max-w-full gap-2">
      {meta.replay && (
        <span className="w-fit rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-muted">Recorded replay · {REASON[meta.reason ?? ""] ?? "demo"}</span>
      )}
      {m.parts.map((p, i) =>
        p.type === "text" ? (
          <div key={i} className="text-sm leading-relaxed">
            <Rich text={p.text} />
          </div>
        ) : p.type.startsWith("tool-") ? (
          <ToolCard key={i} part={p as unknown as ToolPart} />
        ) : null,
      )}
    </div>
  );
}

export function Chat({ suggestions, maxChars, initialPrompt }: { suggestions: readonly string[]; maxChars: number; initialPrompt?: string }) {
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({ transport: new DefaultChatTransport({ api: "/api/chat" }) });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text: text.trim() });
    setInput("");
  };
  // /playground?q=… starts the conversation (shareable example links).
  const started = useRef(false);
  useEffect(() => {
    if (initialPrompt && !started.current) {
      started.current = true;
      sendMessage({ text: initialPrompt.slice(0, maxChars) });
    }
  }, [initialPrompt, maxChars, sendMessage]);

  return (
    <div className="grid gap-4">
      <div className="grid min-h-[16rem] content-start gap-5 rounded-xl border border-line bg-surface p-4">
        {messages.length === 0 ? (
          <div className="grid content-center gap-3 text-center">
            <p className="text-sm text-muted">Ask for outdoor gear the way you&apos;d ask a store clerk — or try one of these:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm hover:border-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} m={m} />)
        )}
        {status === "submitted" && <p className="text-sm text-muted">The agent is thinking…</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">Something went wrong. Try again, or pick a suggested prompt.</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, maxChars))}
          placeholder="e.g. A 2-person tent under $300"
          aria-label="Message the shopping agent"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        {busy ? (
          <button type="button" onClick={() => stop()} className="rounded-xl border border-line bg-surface px-4 text-sm font-medium">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40">
            Send
          </button>
        )}
        {messages.length > 0 && !busy && (
          <button type="button" onClick={() => setMessages([])} className="rounded-xl border border-line bg-surface px-3 text-sm">
            New chat
          </button>
        )}
      </form>
    </div>
  );
}

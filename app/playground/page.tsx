import type { Metadata } from "next";
import { LIMITS, SUGGESTED_PROMPTS } from "@/lib/playground/config";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Shopper playground · ShelfReady" };

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { q } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Shopper playground</h1>
      <p className="mt-1 text-sm text-muted">
        Chat with an AI shopping agent. It shops this store through the same MCP tools any agent can use — searching on the
        structured product data, checking live stock, and handing you a real Shopify checkout link. It never takes payment.
      </p>
      <div className="mt-6">
        <Chat suggestions={SUGGESTED_PROMPTS} maxChars={LIMITS.maxInputChars} initialPrompt={q} />
      </div>
      <p className="mt-4 text-xs text-muted">
        Runs on Gemini 3.5 Flash-Lite. To keep this demo free to visit it&apos;s limited to {LIMITS.perIp.requests} messages per{" "}
        {LIMITS.perIp.window.replace(" m", " minutes")} per visitor and a daily budget; past that, or in demo mode, you&apos;ll see recorded
        replays of real sessions.
      </p>
    </main>
  );
}

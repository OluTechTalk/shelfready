// Shopper playground chat: an AI agent shops the live store with the same four tools and
// wording as the public MCP server (real carts, checkout URL only — never payment).
// Protected by a per-IP rate limit and a site-wide daily budget; demo mode, a limit hit or no
// limiter all serve a recorded replay instead of calling the model. Every live call is logged.

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  simulateReadableStream,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { eq } from "drizzle-orm";
import { languageModel, MODELS } from "@/lib/ai/models";
import { getDb, schema } from "@/lib/db";
import { isSuggestedPrompt, LIMITS, liveOrReplay, normalizePrompt, SUGGESTED_PROMPTS, type LiveDecision } from "@/lib/playground/config";
import { postgresSource } from "@/mcp/source";
import {
  AvailabilityInput,
  CartInput,
  checkAvailability,
  createCartTool,
  getProduct,
  GetProductInput,
  MCP_INSTRUCTIONS,
  SearchInput,
  searchProducts,
  TOOL_INFO,
} from "@/mcp/tools";

export const maxDuration = 60;

const source = postgresSource();
const model = MODELS.default;

const INSTRUCTIONS = `${MCP_INSTRUCTIONS}

You are the shopping assistant on the ShelfReady demo store, talking with a shopper in a chat.
Keep replies short and concrete: name products with their price and the details that match the
request. Ask one question when you need a choice (size, color). When the shopper has chosen,
check stock and create the cart, then give them the checkout link.`;

const tools = {
  search_products: tool({ ...TOOL_INFO.search_products, inputSchema: SearchInput, execute: (args) => searchProducts(source, args) }),
  get_product: tool({ ...TOOL_INFO.get_product, inputSchema: GetProductInput, execute: (args) => getProduct(source, args) }),
  check_availability: tool({ ...TOOL_INFO.check_availability, inputSchema: AvailabilityInput, execute: (args) => checkAvailability(source, args) }),
  create_cart: tool({ ...TOOL_INFO.create_cart, inputSchema: CartInput, execute: (args) => createCartTool(source, args) }),
};

const REASON_TEXT: Record<Exclude<LiveDecision, { live: true }>["reason"], string> = {
  demo_mode: "The live agent is switched off (demo mode).",
  rate_limited: "You've sent a lot of messages in a short time, so the live agent is paused for a few minutes.",
  daily_budget: "Today's budget for the live agent is used up.",
  no_limiter: "The live agent is unavailable right now.",
};

const textOf = (m: UIMessage | undefined) =>
  m?.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim() ?? "";

function streamChunks(chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({ stream: simulateReadableStream({ chunks, initialDelayInMs: 200, chunkDelayInMs: 25 }) });
}

/** A recorded answer to a suggested prompt, or a short explanation when there isn't one. */
async function replay(prompt: string, reason: Exclude<LiveDecision, { live: true }>["reason"]) {
  const [row] = isSuggestedPrompt(prompt)
    ? await getDb().select().from(schema.playgroundReplays).where(eq(schema.playgroundReplays.prompt, normalizePrompt(prompt)))
    : [];
  const meta = { replay: true, reason };
  if (row) {
    const chunks = (row.chunks as UIMessageChunk[]).map((c) => (c.type === "start" ? { ...c, messageMetadata: meta } : c));
    return streamChunks(chunks);
  }
  const text = `${REASON_TEXT[reason]} You can still watch a recorded session — try one of these:\n\n${SUGGESTED_PROMPTS.map((p) => `• ${p}`).join("\n")}`;
  return streamChunks([
    { type: "start", messageMetadata: meta },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish" },
  ] as UIMessageChunk[]);
}

export async function POST(req: Request) {
  let messages: UIMessage[];
  try {
    ({ messages } = (await req.json()) as { messages: UIMessage[] });
    if (!Array.isArray(messages) || !messages.length) throw new Error("no messages");
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const last = messages[messages.length - 1];
  const prompt = textOf(last);
  if (last.role !== "user" || !prompt) return new Response("Bad request", { status: 400 });
  if (prompt.length > LIMITS.maxInputChars) {
    return streamChunks([
      { type: "start" },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: `That message is a bit long — please keep it under ${LIMITS.maxInputChars} characters.` },
      { type: "text-end", id: "t" },
      { type: "finish" },
    ] as UIMessageChunk[]);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const decision = await liveOrReplay(ip);
  if (!decision.live) return replay(prompt, decision.reason);

  const t0 = Date.now();
  const history = messages.slice(-LIMITS.maxMessages);
  const result = streamText({
    model: languageModel(model),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(history),
    tools,
    stopWhen: isStepCount(LIMITS.maxSteps),
    temperature: 0.2,
    onEnd: async ({ totalUsage }) => {
      const tokensIn = totalUsage.inputTokens ?? 0;
      const tokensOut = totalUsage.outputTokens ?? 0;
      try {
        await getDb()
          .insert(schema.modelCalls)
          .values({
            model: model.id,
            provider: model.provider,
            route: "playground",
            tokensIn,
            tokensOut,
            latencyMs: Date.now() - t0,
            costUsd: ((tokensIn * model.pricePerMTokIn + tokensOut * model.pricePerMTokOut) / 1_000_000).toFixed(6),
          });
      } catch {
        // logging must never break the chat
      }
    },
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    messageMetadata: ({ part }) => (part.type === "start" ? { replay: false } : undefined),
  });

  // First live answer to a suggested prompt becomes its demo-mode replay.
  const recordable = history.length === 1 && isSuggestedPrompt(prompt);
  if (!recordable) return createUIMessageStreamResponse({ stream });
  const [toClient, toRecord] = stream.tee();
  void (async () => {
    const chunks: UIMessageChunk[] = [];
    const reader = toRecord.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as UIMessageChunk);
    }
    const complete = chunks.some((c) => c.type === "finish") && !chunks.some((c) => c.type === "error");
    if (complete) {
      await getDb()
        .insert(schema.playgroundReplays)
        .values({ prompt: normalizePrompt(prompt), chunks, model: model.id })
        .onConflictDoNothing()
        .catch(() => undefined);
    }
  })();
  return createUIMessageStreamResponse({ stream: toClient });
}

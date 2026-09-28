// Runs the shopping task set: an AI agent gets each shopper request and the four MCP tools,
// shops a catalog, and is scored against ground truth. Same tasks, same model, same tool
// wording on both catalogs:
//   before — the original messy fixture (fixtures/catalog.json)
//   after  — the fixed live catalog (Postgres mirror of Shopify)
// Availability comes from each catalog's own stock data and carts are recorded, not created,
// so the eval never touches the real store. Results go to eval_runs / eval_results and
// evals/results/<label>-<catalog>.json.
//
// Resumable: re-running with the same --label skips finished tasks and retries errored ones.
//
// Run: npm run eval [-- --catalog before|after|both] [--model default|backup] [--tasks T01,T02] [--label name]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { MODELS, languageModel, type ModelSpec } from "../lib/ai/models";
import { backOffForQuota, isQuotaError, paceModelCall, pool } from "../lib/ai/pace";
import { normalizeOptionValue } from "../lib/catalog/defects";
import { CatalogSchema, type CatalogProduct } from "../lib/catalog/schema";
import { getDb, schema } from "../lib/db";
import type { ShopifyProduct } from "../lib/shopify/products";
import { postgresSource, type ProductSource } from "../mcp/source";
import {
  AvailabilityInput,
  CartInput,
  getProduct,
  GetProductInput,
  MCP_INSTRUCTIONS,
  SearchInput,
  searchProducts,
  TOOL_INFO,
} from "../mcp/tools";
import { fixtureSource } from "./fixture-source";
import { TaskSchema, type Task } from "./truth";

const MAX_STEPS = 10;
const CONCURRENCY = 2;
const ATTEMPTS = 3;
const MAX_ERROR_STREAK = 5;

// The eval has no human to answer follow-up questions, so the agent must decide.
const EVAL_INSTRUCTIONS = `${MCP_INSTRUCTIONS}

You are shopping on behalf of a customer who cannot answer follow-up questions. Complete the request yourself:
if a product fits every stated requirement, create one cart with a matching in-stock variant (pick any color or
option the customer didn't specify). If nothing fits every requirement, don't create a cart — say so briefly.`;

type Catalog = "before" | "after";
type Line = { variantId: string; quantity: number };
type Outcome = "success" | "wrong_product" | "wrong_variant" | "no_cart" | "error";

type TaskResult = {
  taskId: string;
  outcome: Outcome;
  success: boolean;
  steps: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  transcript: { steps: { text: string; calls: { tool: string; input: unknown; output: string }[] }[]; cart: Line[]; answer: string; error?: string };
};

function toolsFor(source: ProductSource, cart: Line[][]) {
  return {
    search_products: tool({ ...TOOL_INFO.search_products, inputSchema: SearchInput, execute: (args) => searchProducts(source, args) }),
    get_product: tool({ ...TOOL_INFO.get_product, inputSchema: GetProductInput, execute: (args) => getProduct(source, args) }),
    // Stock from the catalog's own data (same method on both sides; no live Storefront calls).
    check_availability: tool({
      ...TOOL_INFO.check_availability,
      inputSchema: AvailabilityInput,
      execute: async ({ variantIds }) => {
        const variants = new Map((await source.all()).flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)));
        return {
          variants: variantIds.map((id) => {
            const hit = variants.get(id);
            return hit
              ? { variantId: id, title: `${hit.p.title} — ${hit.v.title}`, available: (hit.v.inventoryQuantity ?? 0) > 0, quantityAvailable: hit.v.inventoryQuantity }
              : { variantId: id, error: "Unknown variant id" };
          }),
        };
      },
    }),
    // Recorded, not created: the eval never makes real Shopify carts.
    create_cart: tool({
      ...TOOL_INFO.create_cart,
      inputSchema: CartInput,
      execute: async ({ lines }) => {
        const known = new Set((await source.all()).flatMap((p) => p.variants.map((v) => v.id)));
        const unknown = lines.filter((l) => !known.has(l.variantId));
        if (unknown.length) return { error: `Unknown variant id(s): ${unknown.map((l) => l.variantId).join(", ")}` };
        cart.push(lines);
        return { checkoutUrl: `https://checkout.example/eval/${cart.length}`, lines, note: "Eval cart (recorded, not created)." };
      },
    }),
  };
}

/** Judges the agent's cart(s) against ground truth (the clean catalog), not the shopped catalog. */
function score(task: Task, carts: Line[][], source: ShopifyProduct[], clean: Map<string, CatalogProduct>): Outcome {
  const lines = carts.flat();
  if (task.kind === "no_match") return lines.length ? "wrong_product" : "success";
  if (!lines.length) return "no_cart";

  const byVariant = new Map(source.flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)));
  let variantOk = false;
  for (const line of lines) {
    const hit = byVariant.get(line.variantId);
    if (!hit || !task.acceptable.includes(hit.p.handle)) return "wrong_product";
    // Find the true variant by its option values (messy data may call "Size" something else).
    const values = hit.v.selectedOptions.map((o) => normalizeOptionValue(o.value)).sort().join("|");
    const truth = clean.get(hit.p.handle)!.variants.find((v) => v.optionValues.map((o) => normalizeOptionValue(o.name)).sort().join("|") === values);
    const c = task.constraints;
    const opt = (name: string) => truth?.optionValues.find((o) => o.optionName === name)?.name ?? "";
    if (
      truth &&
      (!c.size || normalizeOptionValue(opt("Size")) === normalizeOptionValue(c.size)) &&
      (!c.color || normalizeOptionValue(opt("Color")) === normalizeOptionValue(c.color)) &&
      (c.maxPrice === undefined || Number(truth.price) <= c.maxPrice)
    ) {
      variantOk = true;
    }
  }
  return variantOk ? "success" : "wrong_variant";
}

const brief = (x: unknown) => {
  const s = JSON.stringify(x);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

async function runTask(task: Task, source: ProductSource, model: ModelSpec, clean: Map<string, CatalogProduct>): Promise<TaskResult> {
  const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    const carts: Line[][] = [];
    try {
      const result = await generateText({
        model: languageModel(model),
        instructions: EVAL_INSTRUCTIONS,
        prompt: task.request,
        tools: toolsFor(source, carts),
        stopWhen: isStepCount(MAX_STEPS),
        temperature: 0,
        prepareStep: async () => {
          await paceModelCall();
          return {};
        },
      });
      const outcome = score(task, carts, await source.all(), clean);
      const steps = result.steps.map((s) => ({
        text: s.text,
        calls: s.toolCalls.map((c) => ({
          tool: c.toolName,
          input: c.input,
          output: brief(s.toolResults.find((r) => r.toolCallId === c.toolCallId)?.output),
        })),
      }));
      return {
        taskId: task.id,
        outcome,
        success: outcome === "success",
        steps: result.steps.length,
        toolCalls: steps.reduce((n, s) => n + s.calls.length, 0),
        tokensIn: result.totalUsage.inputTokens ?? 0,
        tokensOut: result.totalUsage.outputTokens ?? 0,
        latencyMs: Date.now() - t0,
        transcript: { steps, cart: carts.flat(), answer: result.text },
      };
    } catch (err) {
      if (attempt < ATTEMPTS && isQuotaError(err)) {
        backOffForQuota();
        continue;
      }
      const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
      return {
        taskId: task.id,
        outcome: "error",
        success: false,
        steps: 0,
        toolCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - t0,
        transcript: { steps: [], cart: carts.flat(), answer: "", error: message },
      };
    }
  }
}

function summarize(results: TaskResult[], tasks: Task[]) {
  const n = results.length || 1;
  const rate = (o: Outcome) => Math.round((results.filter((r) => r.outcome === o).length / n) * 1000) / 10;
  const avg = (f: (r: TaskResult) => number) => Math.round((results.reduce((a, r) => a + f(r), 0) / n) * 10) / 10;
  const kinds = ["messy_target", "clean_target", "no_match"] as const;
  return {
    tasks: results.length,
    successRate: rate("success"),
    wrongProductRate: rate("wrong_product"),
    wrongVariantRate: rate("wrong_variant"),
    noCartRate: rate("no_cart"),
    errorRate: rate("error"),
    avgSteps: avg((r) => r.steps),
    avgToolCalls: avg((r) => r.toolCalls),
    avgTokens: avg((r) => r.tokensIn + r.tokensOut),
    avgLatencyMs: avg((r) => r.latencyMs),
    byKind: Object.fromEntries(
      kinds.map((k) => {
        const ids = new Set(tasks.filter((t) => t.kind === k).map((t) => t.id));
        const group = results.filter((r) => ids.has(r.taskId));
        return [k, { tasks: group.length, successRate: group.length ? Math.round((group.filter((r) => r.success).length / group.length) * 1000) / 10 : null }];
      }),
    ),
  };
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const model = arg("model") === "backup" ? MODELS.backup : MODELS.default;
  const catalogs: Catalog[] = arg("catalog") === "before" ? ["before"] : arg("catalog") === "after" ? ["after"] : ["before", "after"];
  const only = arg("tasks")?.split(",");
  const label = arg("label") ?? `${new Date().toISOString().slice(0, 10)}-${model.id.replace(/[^a-z0-9.-]/gi, "_")}`;

  const root = process.cwd();
  const tasks = z
    .array(TaskSchema)
    .parse(JSON.parse(readFileSync(join(root, "evals", "tasks.json"), "utf8")).tasks)
    .filter((t) => !only || only.includes(t.id));
  const clean = new Map(CatalogSchema.parse(JSON.parse(readFileSync(join(root, "fixtures", "catalog-clean.json"), "utf8"))).products.map((p) => [p.handle, p]));

  const db = getDb();
  const categoryNames: Record<string, string> = {};
  for (const { raw } of await db.select({ raw: schema.products.raw }).from(schema.products)) {
    const c = (raw as ShopifyProduct).category;
    if (c) categoryNames[c.id.replace("gid://shopify/TaxonomyCategory/", "")] = c.fullName;
  }

  for (const catalog of catalogs) {
    const source = catalog === "before" ? fixtureSource(categoryNames) : postgresSource();

    // Resumable: the run row exists from the start, each task is saved as it finishes, and a
    // re-run with the same label skips finished tasks and retries errored ones.
    let [run] = await db
      .select({ id: schema.evalRuns.id })
      .from(schema.evalRuns)
      .where(and(eq(schema.evalRuns.label, label), eq(schema.evalRuns.catalog, catalog)));
    run ??= (await db.insert(schema.evalRuns).values({ label, catalog, model: model.id, summary: {} }).returning({ id: schema.evalRuns.id }))[0];
    await db.delete(schema.evalResults).where(and(eq(schema.evalResults.runId, run.id), eq(schema.evalResults.outcome, "error")));
    const done = new Set((await db.select({ taskId: schema.evalResults.taskId }).from(schema.evalResults).where(eq(schema.evalResults.runId, run.id))).map((r) => r.taskId));
    const todo = tasks.filter((t) => !done.has(t.id));
    console.log(`\n${label} · ${catalog} catalog · ${model.id} · ${todo.length} to run${done.size ? ` (${done.size} already done)` : ""}`);

    const ranNow: TaskResult[] = [];
    let errorStreak = 0;
    let aborted = false;
    await pool(todo, CONCURRENCY, async (task) => {
      if (aborted) return;
      const r = await runTask(task, source, model, clean);
      ranNow.push(r);
      await db
        .insert(schema.evalResults)
        .values({ runId: run.id, ...r })
        .onConflictDoUpdate({ target: [schema.evalResults.runId, schema.evalResults.taskId], set: { ...r } });
      console.log(`  ${r.taskId} ${r.outcome.padEnd(13)} ${String(r.toolCalls).padStart(2)} calls  ${task.request}`);
      // Circuit breaker: a dead connection or exhausted quota fails every task — stop, don't burn the set.
      errorStreak = r.outcome === "error" ? errorStreak + 1 : 0;
      if (errorStreak >= MAX_ERROR_STREAK && !aborted) {
        aborted = true;
        console.error(`  Stopping: ${MAX_ERROR_STREAK} errors in a row (last: ${r.transcript.error}). Re-run the same command to resume.`);
      }
    });

    const tokensIn = ranNow.reduce((a, r) => a + r.tokensIn, 0);
    const tokensOut = ranNow.reduce((a, r) => a + r.tokensOut, 0);
    if (ranNow.length) {
      await db.insert(schema.modelCalls).values({
        model: model.id,
        provider: model.provider,
        route: `eval.${catalog}`,
        tokensIn,
        tokensOut,
        latencyMs: ranNow.reduce((a, r) => a + r.latencyMs, 0),
        costUsd: ((tokensIn * model.pricePerMTokIn + tokensOut * model.pricePerMTokOut) / 1_000_000).toFixed(6),
      });
    }
    if (aborted) process.exit(1);

    // Summary over everything saved for this run (earlier sessions included).
    const results = (await db.select().from(schema.evalResults).where(eq(schema.evalResults.runId, run.id)))
      .map((r) => ({ ...r, outcome: r.outcome as Outcome, transcript: r.transcript as TaskResult["transcript"] }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
    const summary = summarize(results, tasks);
    await db.update(schema.evalRuns).set({ summary }).where(eq(schema.evalRuns.id, run.id));

    mkdirSync(join(root, "evals", "results"), { recursive: true });
    writeFileSync(join(root, "evals", "results", `${label}-${catalog}.json`), JSON.stringify({ label, catalog, model: model.id, summary, results }, null, 2) + "\n");
    console.log(
      `  → success ${summary.successRate}% · wrong product ${summary.wrongProductRate}% · wrong variant ${summary.wrongVariantRate}% · no cart ${summary.noCartRate}% · errors ${summary.errorRate}%`,
    );
    console.log(`    avg ${summary.avgToolCalls} tool calls, ${summary.avgTokens} tokens per task · by kind ${JSON.stringify(summary.byKind)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// MCP server definition: registers the four shopping tools, logs every call to mcp_calls,
// and tells agents how to use them. The route in app/api/mcp adds rate limiting on top.

import { createMcpHandler } from "mcp-handler";
import { getDb, schema } from "@/lib/db";
import { postgresSource } from "./source";
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
} from "./tools";


const source = postgresSource();

/** Result size for the log: how many things the tool returned. */
function countOf(result: unknown): number | null {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.total === "number") return r.total;
    if (Array.isArray(r.variants)) return r.variants.length;
    if (Array.isArray(r.lines)) return r.lines.length;
    if ("error" in r) return 0;
    return 1;
  }
  return null;
}

async function logged<T>(tool: string, input: unknown, run: () => Promise<T>) {
  const t0 = Date.now();
  let result: T | undefined;
  let error: string | null = null;
  try {
    result = await run();
    const r = result as Record<string, unknown>;
    if (r && typeof r === "object" && typeof r.error === "string") error = r.error;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }
  try {
    await getDb()
      .insert(schema.mcpCalls)
      .values({ tool, input: input ?? {}, ok: error === null, error, resultCount: countOf(result), latencyMs: Date.now() - t0 });
  } catch {
    // Logging must never break a shopper's request.
  }
  const body = error !== null && result === undefined ? { error } : result;
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }], isError: error !== null };
}

export const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_products",
      { ...TOOL_INFO.search_products, inputSchema: SearchInput },
      (args) => logged("search_products", args, () => searchProducts(source, args)),
    );
    server.registerTool(
      "get_product",
      { ...TOOL_INFO.get_product, inputSchema: GetProductInput },
      (args) => logged("get_product", args, () => getProduct(source, args)),
    );
    server.registerTool(
      "check_availability",
      { ...TOOL_INFO.check_availability, inputSchema: AvailabilityInput },
      (args) => logged("check_availability", args, () => checkAvailability(source, args)),
    );
    server.registerTool(
      "create_cart",
      { ...TOOL_INFO.create_cart, inputSchema: CartInput },
      (args) => logged("create_cart", args, () => createCartTool(source, args)),
    );
  },
  { serverInfo: { name: "shelfready-store", version: "1.0.0" }, instructions: MCP_INSTRUCTIONS },
);

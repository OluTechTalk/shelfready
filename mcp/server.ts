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
  SearchInput,
  searchProducts,
} from "./tools";

const INSTRUCTIONS = `Tools for shopping an outdoor-gear store (boots, jackets, packs, tents, sleeping bags, accessories).
Typical flow: search_products (use structured filters when the shopper gives them — size, gender, price, waterproof,
attributes) → get_product for details → check_availability for live stock → create_cart, which returns a Shopify
checkout URL for the shopper. Create one cart for the variant the shopper chose; if they haven't picked a size or
color yet, ask first instead of making a cart per option. You never take payment or personal details; the shopper
pays on Shopify.`;

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
      {
        title: "Search products",
        description:
          "Find products by free text and/or structured filters. Returns matching products with price range, key attributes and up to 5 matching variants (with variantIds).",
        inputSchema: SearchInput,
      },
      (args) => logged("search_products", args, () => searchProducts(source, args)),
    );
    server.registerTool(
      "get_product",
      {
        title: "Get product details",
        description: "Full details for one product: description, all structured attributes, options and every variant (with variantIds).",
        inputSchema: GetProductInput,
      },
      (args) => logged("get_product", args, () => getProduct(source, args)),
    );
    server.registerTool(
      "check_availability",
      {
        title: "Check availability",
        description: "Live stock for specific variants. Check before creating a cart.",
        inputSchema: AvailabilityInput,
      },
      (args) => logged("check_availability", args, () => checkAvailability(source, args)),
    );
    server.registerTool(
      "create_cart",
      {
        title: "Create cart",
        description:
          "Create a cart with the variants the shopper chose and return a Shopify checkout URL to give them. Call it once the shopper has picked a size and color — ask rather than making a cart per option. Does not take payment; the shopper completes checkout on Shopify.",
        inputSchema: CartInput,
      },
      (args) => logged("create_cart", args, () => createCartTool(source, args)),
    );
  },
  { serverInfo: { name: "shelfready-store", version: "1.0.0" }, instructions: INSTRUCTIONS },
);

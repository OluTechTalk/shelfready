// Public MCP endpoint for shopping agents (Streamable HTTP). Read-only apart from creating
// carts; no payment, no customer data. Rate-limited per IP with Upstash; oversized bodies
// are refused before they reach the MCP server.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { mcpHandler } from "@/mcp/server";

export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;

// 60 requests per minute per IP. Without Upstash configured (local dev), requests pass.
const limiter =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(60, "1 m"), prefix: "shelfready:mcp" })
    : null;

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

function jsonError(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function handle(req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return jsonError(413, "Request too large");
  if (limiter) {
    const { success, reset } = await limiter.limit(clientIp(req));
    if (!success) {
      return jsonError(429, "Rate limit exceeded — try again shortly", { "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))) });
    }
  }
  return mcpHandler(req);
}

export { handle as GET, handle as POST, handle as DELETE };

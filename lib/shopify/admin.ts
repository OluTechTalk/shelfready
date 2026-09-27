import { getAdminToken, invalidateAdminToken } from "./auth";

type GraphQLError = { message: string; path?: (string | number)[]; extensions?: { code?: string } };
type ThrottleStatus = { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } };
};

const MAX_ATTEMPTS = 6;
// Keep this much of the cost bucket in reserve so bursts of big mutations don't get throttled.
const LOW_WATER_MARK = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait long enough for the leaky bucket to refill `needed` points. */
function refillDelayMs(status: ThrottleStatus | undefined, needed: number): number {
  if (!status) return 1000;
  const missing = Math.max(0, needed - status.currentlyAvailable);
  return Math.ceil((missing / status.restoreRate) * 1000) + 100;
}

export class ShopifyGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphQLError[] = [],
  ) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

function endpoint(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION;
  if (!domain || !version) {
    throw new Error("Missing env var SHOPIFY_STORE_DOMAIN or SHOPIFY_API_VERSION");
  }
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

async function post(query: string, variables: unknown, token: string) {
  return fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
}

/**
 * Typed Admin GraphQL call. Retries once with a fresh token on 401, and backs off on
 * rate limits (THROTTLED errors, HTTP 429) and transient 5xx responses.
 */
export async function adminGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let res = await post(query, variables, await getAdminToken());

    if (res.status === 401) {
      invalidateAdminToken();
      res = await post(query, variables, await getAdminToken());
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      throw new ShopifyGraphQLError(`Shopify Admin API ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GraphQLResponse<T>;
    const cost = body.extensions?.cost;
    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < MAX_ATTEMPTS) {
      await sleep(refillDelayMs(cost?.throttleStatus, cost?.requestedQueryCost ?? LOW_WATER_MARK));
      continue;
    }
    if (body.errors?.length) {
      throw new ShopifyGraphQLError(body.errors.map((e) => e.message).join("; "), body.errors);
    }
    if (!body.data) throw new ShopifyGraphQLError("Shopify Admin API returned no data");

    // Running low: pause before returning so the next call doesn't hit the limit.
    if (cost?.throttleStatus && cost.throttleStatus.currentlyAvailable < LOW_WATER_MARK) {
      await sleep(refillDelayMs(cost.throttleStatus, LOW_WATER_MARK));
    }
    return body.data;
  }
}

export type ShopSummary = { name: string; productCount: number };

export async function getShopSummary(): Promise<ShopSummary> {
  const data = await adminGraphQL<{
    shop: { name: string };
    productsCount: { count: number };
  }>(`#graphql
    query ShopSummary {
      shop { name }
      productsCount { count }
    }
  `);
  return { name: data.shop.name, productCount: data.productsCount.count };
}

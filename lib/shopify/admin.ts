import { getAdminToken, invalidateAdminToken } from "./auth";

type GraphQLError = { message: string; path?: (string | number)[] };
type GraphQLResponse<T> = { data?: T; errors?: GraphQLError[] };

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

/** Typed Admin GraphQL call. Retries once with a fresh token on 401. */
export async function adminGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let res = await post(query, variables, await getAdminToken());

  if (res.status === 401) {
    invalidateAdminToken();
    res = await post(query, variables, await getAdminToken());
  }

  if (!res.ok) {
    throw new ShopifyGraphQLError(`Shopify Admin API ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new ShopifyGraphQLError(body.errors.map((e) => e.message).join("; "), body.errors);
  }
  if (!body.data) throw new ShopifyGraphQLError("Shopify Admin API returned no data");
  return body.data;
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

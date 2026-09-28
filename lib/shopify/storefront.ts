// Storefront API client: what a shopper (or a shopping agent) can do — live availability
// and carts. Never handles payment: create a cart, return Shopify's checkout URL, stop there.

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export class StorefrontError extends Error {}

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION;
  if (!domain || !token || !version) throw new StorefrontError("Storefront API is not configured");
  return { url: `https://${domain}/api/${version}/graphql.json`, token };
}

async function storefrontGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new StorefrontError(`Storefront API ${res.status}`);
  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) throw new StorefrontError(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new StorefrontError("Storefront API returned no data");
  return body.data;
}

export type VariantAvailability = {
  variantId: string;
  available: boolean;
  quantityAvailable: number | null; // null when the store hides exact stock
};

/** Live stock for up to 100 variants. Unknown ids are simply left out. */
export async function variantAvailability(variantIds: string[]): Promise<VariantAvailability[]> {
  if (!variantIds.length) return [];
  const data = await storefrontGraphQL<{ nodes: ({ id: string; availableForSale: boolean; quantityAvailable: number | null } | null)[] }>(
    `#graphql
    query Availability($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProductVariant { id availableForSale quantityAvailable } }
    }`,
    { ids: variantIds.slice(0, 100) },
  );
  return data.nodes
    .filter((n): n is NonNullable<typeof n> => !!n && "id" in n)
    .map((n) => ({ variantId: n.id, available: n.availableForSale, quantityAvailable: n.quantityAvailable ?? null }));
}

export type CartResult = {
  cartId: string;
  checkoutUrl: string;
  total: { amount: string; currencyCode: string };
  lines: { variantId: string; title: string; productTitle: string; quantity: number }[];
};

/** Creates a cart and returns Shopify's hosted checkout URL. The shopper pays on Shopify, not here. */
export async function createCart(lines: { variantId: string; quantity: number }[]): Promise<CartResult> {
  const data = await storefrontGraphQL<{
    cartCreate: {
      cart: {
        id: string;
        checkoutUrl: string;
        cost: { totalAmount: { amount: string; currencyCode: string } };
        lines: { nodes: { quantity: number; merchandise: { id: string; title: string; product: { title: string } } }[] };
      } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `#graphql
    mutation Cart($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id checkoutUrl
          cost { totalAmount { amount currencyCode } }
          lines(first: 20) { nodes { quantity merchandise { ... on ProductVariant { id title product { title } } } } }
        }
        userErrors { field message }
      }
    }`,
    { input: { lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })) } },
  );
  const { cart, userErrors } = data.cartCreate;
  if (userErrors.length || !cart) throw new StorefrontError(userErrors.map((e) => e.message).join("; ") || "Cart not created");
  return {
    cartId: cart.id,
    checkoutUrl: cart.checkoutUrl,
    total: cart.cost.totalAmount,
    lines: cart.lines.nodes.map((l) => ({
      variantId: l.merchandise.id,
      title: l.merchandise.title,
      productTitle: l.merchandise.product.title,
      quantity: l.quantity,
    })),
  };
}

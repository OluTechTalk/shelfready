// Full product reads from the Admin API. The shape returned here is what `npm run sync`
// stores as `products.raw`, so the audit (Episode 03) reads exactly this.

import { createHash } from "node:crypto";
import { adminGraphQL } from "./admin";

/** Our seed bookkeeping lives here; it is not catalog data and is dropped from synced products. */
export const SEED_NAMESPACE = "shelfready_seed";

export type ShopifyProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  category: { id: string; fullName: string } | null;
  options: { name: string; position: number; values: string[] }[];
  variants: {
    id: string;
    title: string;
    sku: string | null;
    price: string;
    compareAtPrice: string | null;
    inventoryQuantity: number | null;
    inventoryItem: { tracked: boolean };
    selectedOptions: { name: string; value: string }[];
  }[];
  media: { id: string; alt: string | null; status: string; image: { url: string } | null }[];
  metafields: { namespace: string; key: string; type: string; value: string }[];
};

type Connection<T> = { nodes: T[] };
type ProductNode = Omit<ShopifyProduct, "variants" | "media" | "metafields"> & {
  variants: Connection<ShopifyProduct["variants"][number]>;
  media: Connection<ShopifyProduct["media"][number]>;
  metafields: Connection<ShopifyProduct["metafields"][number]>;
};

// Keep page size × nested connection sizes under Shopify's 1,000-point query cost limit.
const PAGE_SIZE = 8;

const PRODUCT_FIELDS = `#graphql
  fragment SyncedProduct on Product {
    id handle title descriptionHtml vendor productType status tags
    category { id fullName }
    options { name position values }
    variants(first: 60) {
      nodes {
        id title sku price compareAtPrice inventoryQuantity
        inventoryItem { tracked }
        selectedOptions { name value }
      }
    }
    media(first: 10) {
      nodes { id alt status ... on MediaImage { image { url } } }
    }
    metafields(first: 30) { nodes { namespace key type value } }
  }
`;

const PRODUCTS_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ...SyncedProduct }
    }
  }
`;

const PRODUCT_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query Product($id: ID!) { product(id: $id) { ...SyncedProduct } }
`;

function toProduct(n: ProductNode): ShopifyProduct {
  return {
    ...n,
    variants: n.variants.nodes,
    media: n.media.nodes.map((m) => ({ ...m, image: m.image ?? null })),
    metafields: n.metafields.nodes.filter((m) => m.namespace !== SEED_NAMESPACE),
  };
}

/** Pages through every product in the store. */
export async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] };
    } = await adminGraphQL(PRODUCTS_QUERY, { first: PAGE_SIZE, after });
    out.push(...data.products.nodes.map(toProduct));
    if (!data.products.pageInfo.hasNextPage) return out;
    after = data.products.pageInfo.endCursor;
  }
}

/** One product in the same shape `npm run sync` stores; null if it no longer exists. */
export async function fetchProduct(id: string): Promise<ShopifyProduct | null> {
  const data = await adminGraphQL<{ product: ProductNode | null }>(PRODUCT_QUERY, { id });
  return data.product ? toProduct(data.product) : null;
}

/** JSON.stringify with sorted object keys, so equal content always hashes the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Hash of everything an agent or the audit can see. Media status and image URLs are
 * left out: they change while Shopify processes uploads, not when the content changes.
 */
export function productContentHash(p: ShopifyProduct): string {
  const { media, ...rest } = p;
  return sha256(stableStringify({ ...rest, media: media.map((m) => ({ alt: m.alt })) }));
}

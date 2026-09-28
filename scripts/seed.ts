// Loads fixtures/catalog.json into the Shopify dev store. The only script allowed to write
// to Shopify without the review queue (see CLAUDE.md).
//
// - Idempotent: products are upserted by handle via `productSet`.
// - Resumable: each product stores a hash of its fixture entry in the `shelfready_seed.hash`
//   metafield, written in the same mutation. Re-running skips products whose hash matches,
//   so an interrupted run picks up where it stopped.
// - Rate limits: handled in adminGraphQL (cost-based backoff); products go one at a time.
// - Sales channel: every fixture product is published to Online Store so the Storefront API
//   (MCP availability, carts, checkout) can see it.
//
// Run: npm run seed            (--force re-sends every product; --limit N stops after N)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_ATTRIBUTES } from "../lib/audit/rubric";
import { CatalogSchema, METAFIELD_NAMESPACE, type CatalogProduct } from "../lib/catalog/schema";
import { adminGraphQL } from "../lib/shopify/admin";
import { SEED_NAMESPACE, sha256, stableStringify } from "../lib/shopify/products";

// Bump when the fixture → productSet mapping changes, so every product is re-sent.
const SEED_FORMAT = 1;

type UserError = { field: string[] | null; message: string; code?: string };

function loadCatalog() {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "catalog.json"), "utf8"));
  return CatalogSchema.parse(raw);
}

const seedHash = (p: CatalogProduct) => sha256(stableStringify({ format: SEED_FORMAT, p })).slice(0, 32);

// ---------------------------------------------------------------------------
// Metafield definitions (one per attribute key, shared across categories)
// ---------------------------------------------------------------------------

function definitionName(key: string): string {
  for (const attrs of Object.values(REQUIRED_ATTRIBUTES)) {
    const found = attrs.find((a) => a.key === key);
    if (found) return found.label.replace(/\s*\(.*\)$/, "");
  }
  return key;
}

async function ensureMetafieldDefinitions(products: CatalogProduct[]) {
  const types = new Map<string, string>();
  for (const p of products) {
    for (const m of p.metafields) {
      const seen = types.get(m.key);
      if (seen && seen !== m.type) throw new Error(`Metafield ${m.key} used with types ${seen} and ${m.type}`);
      types.set(m.key, m.type);
    }
  }

  const existing = await adminGraphQL<{ metafieldDefinitions: { nodes: { key: string; type: { name: string } }[] } }>(
    `#graphql
    query Defs($namespace: String!) {
      metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: $namespace) { nodes { key type { name } } }
    }`,
    { namespace: METAFIELD_NAMESPACE },
  );
  const have = new Map(existing.metafieldDefinitions.nodes.map((d) => [d.key, d.type.name]));

  let created = 0;
  for (const [key, type] of types) {
    if (have.has(key)) {
      if (have.get(key) !== type) throw new Error(`Definition ${key} exists with type ${have.get(key)}, fixture wants ${type}`);
      continue;
    }
    const res = await adminGraphQL<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(
      `#graphql
      mutation CreateDef($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) { userErrors { field message code } }
      }`,
      {
        definition: {
          name: definitionName(key),
          namespace: METAFIELD_NAMESPACE,
          key,
          type,
          ownerType: "PRODUCT",
          access: { storefront: "PUBLIC_READ" }, // the MCP server reads these via the Storefront API
        },
      },
    );
    const errs = res.metafieldDefinitionCreate.userErrors;
    if (errs.length) throw new Error(`metafieldDefinitionCreate ${key}: ${errs.map((e) => e.message).join("; ")}`);
    created++;
  }
  console.log(`Metafield definitions: ${types.size} needed, ${created} created, ${types.size - created} already there`);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

async function primaryLocationId(): Promise<string> {
  const data = await adminGraphQL<{ locations: { nodes: { id: string }[] } }>(`{ locations(first: 1) { nodes { id } } }`);
  const id = data.locations.nodes[0]?.id;
  if (!id) throw new Error("Store has no locations");
  return id;
}

/** handle → { id, seed hash } for every product already in the store. */
async function existingProducts(): Promise<Map<string, { id: string; hash: string | null }>> {
  const out = new Map<string, { id: string; hash: string | null }>();
  let after: string | null = null;
  for (;;) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { id: string; handle: string; metafield: { value: string } | null }[];
      };
    } = await adminGraphQL(
      `#graphql
      query Existing($after: String, $namespace: String!) {
        products(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle metafield(namespace: $namespace, key: "hash") { value } }
        }
      }`,
      { after, namespace: SEED_NAMESPACE },
    );
    for (const n of data.products.nodes) out.set(n.handle, { id: n.id, hash: n.metafield?.value ?? null });
    if (!data.products.pageInfo.hasNextPage) return out;
    after = data.products.pageInfo.endCursor;
  }
}

function toProductSetInput(p: CatalogProduct, hash: string, locationId: string, existingId: string | null) {
  return {
    ...(existingId ? { id: existingId } : {}),
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    status: "ACTIVE",
    tags: p.tags,
    category: p.taxonomyCategoryId ? `gid://shopify/TaxonomyCategory/${p.taxonomyCategoryId}` : null,
    productOptions: p.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((name) => ({ name })) })),
    variants: p.variants.map((v) => ({
      optionValues: v.optionValues,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      inventoryItem: { tracked: true, sku: v.sku ?? "" },
      inventoryQuantities: [{ locationId, name: "available", quantity: v.inventory }],
    })),
    files: p.images.map((img) => ({ originalSource: img.url, alt: img.alt, contentType: "IMAGE" })),
    metafields: [
      ...p.metafields.map((m) => ({ namespace: METAFIELD_NAMESPACE, key: m.key, type: m.type, value: m.value })),
      { namespace: SEED_NAMESPACE, key: "hash", type: "single_line_text_field", value: hash },
    ],
  };
}

type ProductSetResult = {
  productSet: {
    product: { id: string; metafields: { nodes: { key: string }[] } } | null;
    userErrors: UserError[];
  };
};

async function upsertProduct(p: CatalogProduct, hash: string, locationId: string, existingId: string | null) {
  const res = await adminGraphQL<ProductSetResult>(
    `#graphql
    mutation Seed($input: ProductSetInput!, $namespace: String!) {
      productSet(input: $input, synchronous: true) {
        product { id metafields(first: 30, namespace: $namespace) { nodes { key } } }
        userErrors { field message code }
      }
    }`,
    { input: toProductSetInput(p, hash, locationId, existingId), namespace: METAFIELD_NAMESPACE },
  );
  const { product, userErrors } = res.productSet;
  if (userErrors.length || !product) {
    throw new Error(userErrors.map((e) => `${e.field?.join(".") ?? ""} ${e.message}`.trim()).join("; ") || "no product returned");
  }

  // productSet adds/updates the metafields we send but leaves others alone. On an update,
  // remove attribute metafields the fixture no longer has (a seeded "missing attribute").
  const keep = new Set(p.metafields.map((m) => m.key));
  const stale = product.metafields.nodes.filter((m) => !keep.has(m.key));
  if (stale.length) {
    const del = await adminGraphQL<{ metafieldsDelete: { userErrors: UserError[] } }>(
      `#graphql
      mutation Del($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { field message } }
      }`,
      { metafields: stale.map((m) => ({ ownerId: product.id, namespace: METAFIELD_NAMESPACE, key: m.key })) },
    );
    if (del.metafieldsDelete.userErrors.length) {
      throw new Error(`metafieldsDelete: ${del.metafieldsDelete.userErrors.map((e) => e.message).join("; ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Sales channel: products are only visible to the Storefront API (availability, carts,
// checkout) once published to the Online Store channel. Publishing doesn't change content.
// ---------------------------------------------------------------------------

const STOREFRONT_CHANNEL = "Online Store";

async function ensurePublished(handles: Set<string>) {
  const pubs = await adminGraphQL<{ publications: { nodes: { id: string; name: string }[] } }>(`{ publications(first: 20) { nodes { id name } } }`);
  const publication = pubs.publications.nodes.find((p) => p.name === STOREFRONT_CHANNEL);
  if (!publication) throw new Error(`No "${STOREFRONT_CHANNEL}" sales channel in this store`);

  const unpublished: { id: string; handle: string }[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; handle: string; publishedOnPublication: boolean }[] };
    } = await adminGraphQL(
      `#graphql
      query Published($after: String, $pub: ID!) {
        products(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle publishedOnPublication(publicationId: $pub) }
        }
      }`,
      { after, pub: publication.id },
    );
    for (const n of data.products.nodes) if (handles.has(n.handle) && !n.publishedOnPublication) unpublished.push(n);
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  for (const p of unpublished) {
    const res = await adminGraphQL<{ publishablePublish: { userErrors: UserError[] } }>(
      `#graphql
      mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`,
      { id: p.id, input: [{ publicationId: publication.id }] },
    );
    if (res.publishablePublish.userErrors.length) {
      throw new Error(`publishablePublish ${p.handle}: ${res.publishablePublish.userErrors.map((e) => e.message).join("; ")}`);
    }
  }
  console.log(`Sales channel "${STOREFRONT_CHANNEL}": ${unpublished.length} published, ${handles.size - unpublished.length} already there`);
}

async function main() {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const { products } = loadCatalog();
  console.log(`Fixture: ${products.length} products`);

  await ensureMetafieldDefinitions(products);
  const locationId = await primaryLocationId();
  const existing = await existingProducts();

  const fixtureHandles = new Set(products.map((p) => p.handle));
  const extras = [...existing.keys()].filter((h) => !fixtureHandles.has(h));
  if (extras.length) console.log(`Note: ${extras.length} products in the store are not in the fixture (left alone)`);

  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];
  const t0 = Date.now();

  for (const [i, p] of products.slice(0, limit).entries()) {
    const hash = seedHash(p);
    const prior = existing.get(p.handle);
    const tag = `[${String(i + 1).padStart(3)}/${products.length}]`;
    if (prior && prior.hash === hash && !force) {
      counts.skipped++;
      continue;
    }
    try {
      await upsertProduct(p, hash, locationId, prior?.id ?? null);
      counts[prior ? "updated" : "created"]++;
      console.log(`${tag} ${prior ? "updated" : "created"} ${p.handle} (${p.variants.length} variants)`);
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${p.handle}: ${msg}`);
      console.error(`${tag} FAILED ${p.handle}: ${msg}`);
    }
  }

  await ensurePublished(fixtureHandles);

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `Done in ${secs}s — created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped} (unchanged), failed ${counts.failed}`,
  );
  if (failures.length) {
    console.error("Re-run `npm run seed` to retry; finished products are skipped.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

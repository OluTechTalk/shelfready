// Admin API writes for approved fixes. Called only from lib/fixer/apply.ts, which checks
// that every change was approved in the review queue (CLAUDE.md: the fixer only proposes).
// All of one product's changes go out together: one productUpdate for the product fields,
// one metafieldsSet, then option renames, SKUs and alt text.

import { METAFIELD_NAMESPACE } from "../catalog/schema";
import type { FixChange } from "../fixer/types";
import { adminGraphQL } from "./admin";

type UserError = { field: string[] | null; message: string };

function check(op: string, errors: UserError[]) {
  if (errors.length) throw new Error(`${op}: ${errors.map((e) => `${e.field?.join(".") ?? ""} ${e.message}`.trim()).join("; ")}`);
}

export async function applyProductChanges(productId: string, changes: FixChange[]): Promise<void> {
  // Product fields (title, description, type, category, tags) in a single update.
  const product: Record<string, unknown> = {};
  for (const c of changes) {
    if (c.kind === "set_title") product.title = c.title;
    if (c.kind === "set_description") product.descriptionHtml = c.descriptionHtml;
    if (c.kind === "set_taxonomy") {
      if (c.productType !== undefined) product.productType = c.productType;
      if (c.categoryId !== undefined) product.category = `gid://shopify/TaxonomyCategory/${c.categoryId}`;
      if (c.tags !== undefined) product.tags = c.tags;
    }
  }
  if (Object.keys(product).length) {
    const res = await adminGraphQL<{ productUpdate: { userErrors: UserError[] } }>(
      `#graphql
      mutation Update($product: ProductUpdateInput!) {
        productUpdate(product: $product) { userErrors { field message } }
      }`,
      { product: { id: productId, ...product } },
    );
    check("productUpdate", res.productUpdate.userErrors);
  }

  const metafields = changes.flatMap((c) =>
    c.kind === "set_metafield" ? [{ ownerId: productId, namespace: METAFIELD_NAMESPACE, key: c.key, type: c.type, value: c.value }] : [],
  );
  if (metafields.length) {
    const res = await adminGraphQL<{ metafieldsSet: { userErrors: UserError[] } }>(
      `#graphql
      mutation Meta($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      { metafields },
    );
    check("metafieldsSet", res.metafieldsSet.userErrors);
  }

  const renames = changes.filter((c) => c.kind === "rename_option");
  if (renames.length) {
    const data = await adminGraphQL<{ product: { options: { id: string; name: string }[] } | null }>(
      `query Options($id: ID!) { product(id: $id) { options { id name } } }`,
      { id: productId },
    );
    for (const r of renames) {
      const option = data.product?.options.find((o) => o.name === r.from);
      if (!option) throw new Error(`productOptionUpdate: option "${r.from}" not found`);
      const res = await adminGraphQL<{ productOptionUpdate: { userErrors: UserError[] } }>(
        `#graphql
        mutation Rename($productId: ID!, $option: OptionUpdateInput!) {
          productOptionUpdate(productId: $productId, option: $option) { userErrors { field message } }
        }`,
        { productId, option: { id: option.id, name: r.to } },
      );
      check("productOptionUpdate", res.productOptionUpdate.userErrors);
    }
  }

  const skus = changes.flatMap((c) => (c.kind === "set_variant_skus" ? c.variants : []));
  if (skus.length) {
    const res = await adminGraphQL<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(
      `#graphql
      mutation Skus($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
      }`,
      { productId, variants: skus.map((v) => ({ id: v.variantId, inventoryItem: { sku: v.sku } })) },
    );
    check("productVariantsBulkUpdate", res.productVariantsBulkUpdate.userErrors);
  }

  const alts = changes.flatMap((c) => (c.kind === "set_alt_text" ? c.images : []));
  if (alts.length) {
    const res = await adminGraphQL<{ fileUpdate: { userErrors: UserError[] } }>(
      `#graphql
      mutation Alt($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) { userErrors { field message } }
      }`,
      { files: alts.map((a) => ({ id: a.mediaId, alt: a.alt })) },
    );
    check("fileUpdate", res.fileUpdate.userErrors);
  }
}

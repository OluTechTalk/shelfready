// One-off: creates a Storefront API access token via the Admin API and writes it
// into .env.local as SHOPIFY_STOREFRONT_TOKEN. The token is never printed.
// Run: npm run create:storefront-token
import { readFileSync, writeFileSync } from "node:fs";
import { adminGraphQL } from "../lib/shopify/admin";

const ENV_FILE = ".env.local";
const KEY = "SHOPIFY_STOREFRONT_TOKEN";

async function main() {
  if (process.env[KEY]) {
    console.log(`${KEY} is already set in ${ENV_FILE}. Clear it first to create a new one.`);
    return;
  }

  const data = await adminGraphQL<{
    storefrontAccessTokenCreate: {
      storefrontAccessToken: { accessToken: string; title: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `#graphql
    mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
      storefrontAccessTokenCreate(input: $input) {
        storefrontAccessToken { accessToken title }
        userErrors { field message }
      }
    }`,
    { input: { title: "ShelfReady" } },
  );

  const { storefrontAccessToken, userErrors } = data.storefrontAccessTokenCreate;
  if (userErrors.length || !storefrontAccessToken) {
    throw new Error(`storefrontAccessTokenCreate failed: ${userErrors.map((e) => e.message).join("; ")}`);
  }

  const env = readFileSync(ENV_FILE, "utf8");
  const line = `${KEY}=${storefrontAccessToken.accessToken}`;
  const pattern = new RegExp(`^${KEY}=.*$`, "m");
  const updated = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, updated);

  console.log(`Created storefront token "${storefrontAccessToken.title}" and wrote ${KEY} to ${ENV_FILE}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

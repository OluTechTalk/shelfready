// Works out which rubric category a Shopify product belongs to, from the data an agent can
// see. Messy products may have no product type, category or tags, so this falls back
// through progressively weaker signals: product type → Shopify category → title → handle →
// description. The first signal that matches a keyword wins.

import type { Category } from "./rubric";

// Order matters within a signal: more specific phrases first ("sleeping bag" before "bag",
// "backpack" before "pack"), and footwear before apparel so "boot sock" isn't a boot.
const KEYWORDS: readonly [Category, RegExp][] = [
  ["sleeping_bags", /sleeping[\s-]bags?|\bquilt\b|mummy bag/i],
  ["tents", /\btents?\b|shelter|bivy/i],
  ["backpacks", /back[\s-]?packs?|day[\s-]?packs?|\bpacks?\b|rucksack|\bbag\b/i],
  ["accessories", /headlamp|trekking[\s-]poles?|bottles?|\bhats?\b|beanie|\bcap\b|socks?|cookware|cook[\s-]?set|\bpot\b|accessor/i],
  ["footwear", /boots?\b|shoes?\b|sneakers?|sandals?|footwear|trail[\s-]runners?/i],
  ["apparel", /jackets?|\bvests?\b|fleece|softshell|parka|hoodie|\blayers?\b|shell|pullover|clothing|outerwear/i],
];

export type CategorySignal = "productType" | "category" | "title" | "handle" | "description";

export type ResolvedCategory = { category: Category; signal: CategorySignal } | null;

type Input = {
  productType: string;
  category: { fullName: string } | null;
  title: string;
  handle: string;
  descriptionText: string;
};

function match(text: string): Category | null {
  if (!text.trim()) return null;
  for (const [category, re] of KEYWORDS) if (re.test(text)) return category;
  return null;
}

export function resolveCategory(p: Input): ResolvedCategory {
  const signals: [CategorySignal, string][] = [
    ["productType", p.productType],
    // Only the leaf of "Apparel & Accessories > … > Coats & Jackets" is specific enough.
    ["category", p.category?.fullName.split(">").pop() ?? ""],
    ["title", p.title],
    ["handle", p.handle.replace(/-/g, " ")],
    ["description", p.descriptionText],
  ];
  for (const [signal, text] of signals) {
    const category = match(text);
    if (category) return { category, signal };
  }
  return null;
}

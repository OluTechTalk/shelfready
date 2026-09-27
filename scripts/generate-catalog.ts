// Generates the demo catalog deterministically (seeded PRNG, no model calls) and writes
// fixtures/catalog.json + fixtures/ground-truth.json. About a third of the products get
// seeded defects from docs/RUBRIC.md. Run: npm run generate:catalog

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category } from "../lib/audit/rubric";
import { detectDefects, factsFromCatalog, isVagueTitle } from "../lib/catalog/defects";
import {
  CatalogSchema,
  DEFECT_IDS,
  GroundTruthSchema,
  type CatalogProduct,
  type CatalogVariant,
  type DefectId,
  type GroundTruthProduct,
} from "../lib/catalog/schema";
import { createRng, type Rng } from "./catalog/rng";
import {
  ACCESSORY_KINDS,
  APPAREL_KINDS,
  BAG_KINDS,
  COLOR_HEX,
  COLOR_OPTION_ALIASES,
  FOOTWEAR_KINDS,
  MARKETING_COPY,
  PACK_KINDS,
  SIZE_OPTION_ALIASES,
  TENT_KINDS,
  VAGUE_TITLES,
  VALUE_SYNONYMS,
  VENDOR,
  accessoryDraft,
  apparelDraft,
  bagDraft,
  footwearDraft,
  packDraft,
  tentDraft,
  type Draft,
} from "./catalog/templates";

const SEED = 20260926;
const VERSION = 1;
const MESSY_SHARE = 1 / 3;
// How many defects each messy product gets (shuffled). 20×1, 12×2, 12×3, 6×4 = 50 products.
const DEFECT_COUNT_BAG = [...Array(20).fill(1), ...Array(12).fill(2), ...Array(12).fill(3), ...Array(6).fill(4)];

const MODEL_NAMES = [
  "Talus", "Scree", "Cirrus", "Ridgeback", "Cascade", "Tamarack", "Juniper", "Basalt", "Granite", "Cedar",
  "Aspen", "Kestrel", "Harrier", "Larch", "Moraine", "Cairn", "Couloir", "Arete", "Cornice", "Serac",
  "Tundra", "Mesa", "Canyon", "Sage", "Yarrow", "Lupine", "Hemlock", "Spruce", "Alder", "Boulder",
  "Flint", "Quartz", "Shale", "Ember", "Drift", "Squall", "Zephyr", "Nimbus", "Stratus", "Solstice",
  "Equinox", "Traverse", "Switchback", "Headwall", "Saddle", "Tarn", "Fjord", "Pika", "Marten", "Lynx",
];

const CATEGORY_CODE: Record<Category, string> = {
  footwear: "FW",
  apparel: "AP",
  backpacks: "BP",
  tents: "TN",
  sleeping_bags: "SB",
  accessories: "AC",
};

function buildDrafts(rng: Rng): Draft[] {
  const drafts: Draft[] = [];
  const namesFor = (n: number) => rng.sample(MODEL_NAMES, n);

  const fwNames = namesFor(FOOTWEAR_KINDS.length * 3);
  FOOTWEAR_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 3; m++) {
      for (const gender of ["Men's", "Women's"] as const) drafts.push(footwearDraft(rng, fwNames[k * 3 + m], kind, gender));
    }
  });
  const apNames = namesFor(APPAREL_KINDS.length * 3);
  APPAREL_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 3; m++) {
      for (const gender of ["Men's", "Women's"] as const) drafts.push(apparelDraft(rng, apNames[k * 3 + m], kind, gender));
    }
  });
  const bpNames = namesFor(PACK_KINDS.length * 6);
  PACK_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 6; m++) drafts.push(packDraft(rng, bpNames[k * 6 + m], kind));
  });
  const tnNames = namesFor(TENT_KINDS.length * 3);
  TENT_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 3; m++) drafts.push(tentDraft(rng, tnNames[k * 3 + m], kind));
  });
  const sbNames = namesFor(BAG_KINDS.length * 3);
  BAG_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 3; m++) drafts.push(bagDraft(rng, sbNames[k * 3 + m], kind));
  });
  const acNames = namesFor(ACCESSORY_KINDS.length * 5);
  ACCESSORY_KINDS.forEach((kind, k) => {
    for (let m = 0; m < 5; m++) drafts.push(accessoryDraft(rng, acNames[k * 5 + m], kind));
  });
  return drafts;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/°f/g, "f")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const skuPart = (v: string) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

function cartesian(options: Draft["options"]): { optionName: string; name: string }[][] {
  return options.reduce<{ optionName: string; name: string }[][]>(
    (acc, opt) => acc.flatMap((combo) => opt.values.map((v) => [...combo, { optionName: opt.name, name: v }])),
    [[]],
  );
}

function priceString(rng: Rng, [min, max]: [number, number]): number {
  const n = rng.int(min, max);
  return rng.chance(0.5) ? n - 0.05 : n;
}

function imageUrl(label: string, color: string | null): string {
  const hex = color ? COLOR_HEX[color] : "3b4a3f";
  const text = [label, color].filter((s): s is string => Boolean(s)).map((s) => encodeURIComponent(s)).join("%5Cn");
  return `https://placehold.co/1200x1200/${hex}/f4f1ea/png?text=${text}&font=roboto`;
}

function describe(draft: Draft, dropKeys: Set<string>): string {
  const details = [...draft.attrs.filter((a) => !dropKeys.has(a.key)).map((a) => a.sentence), ...draft.extras];
  const parts = [`<p>${draft.lead}</p>`, `<p>${details.join(" ")}</p>`];
  if (draft.care) parts.push(`<p>Care: ${draft.care}</p>`);
  return parts.join("");
}

function buildProduct(rng: Rng, draft: Draft, indexInCategory: number): CatalogProduct {
  const handle = slugify(draft.title);
  const base = priceString(rng, draft.priceRange);
  const onSale = rng.chance(0.2);
  const variants: CatalogVariant[] = cartesian(draft.options).map((optionValues) => {
    const long = optionValues.some((o) => o.name === "Long");
    const price = base + (long ? 20 : 0);
    return {
      optionValues,
      sku: `RL-${CATEGORY_CODE[draft.category]}${String(indexInCategory).padStart(3, "0")}-${optionValues
        .map((o) => skuPart(o.name))
        .join("-")}`,
      price: price.toFixed(2),
      compareAtPrice: onSale ? Math.round(price * 1.2).toFixed(2) : null,
      inventory: rng.chance(0.1) ? 0 : rng.int(1, 40),
    };
  });

  const colors = draft.options.find((o) => o.name === "Color")?.values ?? [];
  const label = draft.title.replace(/ - (Men|Women)'s$/, "");
  const images =
    colors.length > 0
      ? colors.slice(0, 3).map((c) => ({ url: imageUrl(label, c), alt: `${draft.title} in ${c}, side view` }))
      : [
          { url: imageUrl(label, null), alt: `${draft.title}, front view` },
          { url: imageUrl(`${label} (detail)`, null), alt: `${draft.title}, close-up of materials and details` },
        ];

  return {
    handle,
    rubricCategory: draft.category,
    title: draft.title,
    descriptionHtml: describe(draft, new Set()),
    vendor: VENDOR,
    productType: draft.productType,
    taxonomyCategoryId: draft.taxonomyCategoryId,
    tags: draft.tags,
    options: draft.options.map((o) => ({ name: o.name, values: [...o.values] })),
    variants,
    images,
    metafields: draft.attrs.map((a) => ({ key: a.key, type: a.type, value: a.value })),
  };
}

function chooseDefects(rng: Rng, count: number, usage: Record<DefectId, number>): DefectId[] {
  const chosen: DefectId[] = [];
  while (chosen.length < count) {
    const allowed = DEFECT_IDS.filter(
      (d) =>
        !chosen.includes(d) &&
        !(d === "attributes_in_description_only" && chosen.includes("marketing_only_description")) &&
        !(d === "marketing_only_description" && chosen.includes("attributes_in_description_only")),
    );
    // Least-used first, with jitter, so every defect shows up a similar number of times.
    const next = allowed
      .map((d) => ({ d, score: usage[d] + rng.next() * 4 }))
      .sort((a, b) => a.score - b.score)[0].d;
    chosen.push(next);
    usage[next]++;
  }
  return DEFECT_IDS.filter((d) => chosen.includes(d)); // canonical order
}

function injectDefects(rng: Rng, p: CatalogProduct, draft: Draft, defects: DefectId[]): GroundTruthProduct {
  const truth: GroundTruthProduct = { handle: p.handle, category: draft.category, defects, details: {} };
  const has = (d: DefectId) => defects.includes(d);
  const sentenceOf = (key: string) => draft.attrs.find((a) => a.key === key)!.sentence.replace(/\.$/, "");

  // 2 + 3: pick disjoint sets of required attributes to strip from metafields.
  const keys = rng.shuffle(draft.attrs.map((a) => a.key));
  const missingKeys = has("attributes_missing") ? keys.splice(0, rng.int(1, 2)) : [];
  const proseKeys = has("attributes_in_description_only") ? keys.splice(0, rng.int(1, 2)) : [];
  if (missingKeys.length) truth.details.attributesMissing = missingKeys.map((key) => ({ key, evidence: sentenceOf(key) }));
  if (proseKeys.length) {
    truth.details.attributesInDescriptionOnly = proseKeys.map((key) => ({ key, evidence: sentenceOf(key) }));
  }
  const stripped = new Set([...missingKeys, ...proseKeys]);
  p.metafields = p.metafields.filter((m) => !stripped.has(m.key));
  p.descriptionHtml = describe(draft, new Set(missingKeys));

  if (has("vague_title")) {
    truth.details.originalTitle = p.title;
    p.title = rng.pick(VAGUE_TITLES[draft.category]);
  }

  // 5 before 4: duplicates are built on the standard option names.
  if (has("variant_problems")) {
    const dupOption = p.options.find((o) => o.values.some((v) => v in VALUE_SYNONYMS));
    const mode = dupOption ? rng.pick(["missing_skus", "duplicate_variant", "both"] as const) : "missing_skus";
    truth.details.variantProblem = mode;
    if (mode !== "missing_skus" && dupOption) {
      const value = dupOption.values.find((v) => v in VALUE_SYNONYMS)!;
      const synonym = VALUE_SYNONYMS[value];
      const at = p.variants.findIndex((v) => v.optionValues.some((o) => o.optionName === dupOption.name && o.name === value));
      const original = p.variants[at];
      const clone: CatalogVariant = {
        ...original,
        optionValues: original.optionValues.map((o) =>
          o.optionName === dupOption.name && o.name === value ? { ...o, name: synonym } : o,
        ),
      };
      p.variants.splice(at + 1, 0, clone);
      dupOption.values.splice(dupOption.values.indexOf(value) + 1, 0, synonym);
    }
    if (mode !== "duplicate_variant") {
      let blanked = 0;
      p.variants.forEach((v) => {
        if (rng.chance(0.35)) {
          v.sku = null;
          blanked++;
        }
      });
      if (blanked === 0) p.variants[rng.int(0, p.variants.length - 1)].sku = null;
    }
  }

  if (has("inconsistent_option_names")) {
    const renamed: { from: string; to: string }[] = [];
    const renameAt = p.options.map(() => rng.chance(0.7));
    if (!renameAt.some(Boolean)) renameAt[rng.int(0, renameAt.length - 1)] = true;
    p.options.forEach((opt, i) => {
      if (!renameAt[i]) return;
      const aliases =
        opt.name === "Color"
          ? COLOR_OPTION_ALIASES
          : draft.category === "footwear"
            ? SIZE_OPTION_ALIASES.footwear
            : SIZE_OPTION_ALIASES.other;
      const to = rng.pick(aliases);
      renamed.push({ from: opt.name, to });
      for (const v of p.variants) for (const o of v.optionValues) if (o.optionName === opt.name) o.optionName = to;
      opt.name = to;
    });
    truth.details.renamedOptions = renamed;
  }

  if (has("bad_alt_text")) {
    const bad = p.images.map(() => rng.chance(0.6));
    if (!bad.some(Boolean)) bad[0] = true;
    p.images.forEach((img, i) => {
      if (!bad[i]) return;
      img.alt = rng.pick([
        "",
        `IMG_${rng.int(1000, 9999)}.jpg`,
        `DSC_${rng.int(1000, 9999)}.JPG`,
        `${p.handle}-final-v2.png`,
      ]);
    });
    truth.details.badAltImages = bad.filter(Boolean).length;
  }

  if (has("marketing_only_description")) {
    const [a, b] = rng.pick(MARKETING_COPY);
    p.descriptionHtml = `<p>${a}</p><p>${b}</p>`;
  }

  if (has("missing_taxonomy")) {
    p.productType = "";
    p.taxonomyCategoryId = null;
    p.tags = rng.chance(0.5) ? [] : [rng.pick(["new", "sale", "featured", "bestseller"])];
  }

  return truth;
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function main() {
  const rng = createRng(SEED);
  const drafts = buildDrafts(rng);

  const perCategory = new Map<Category, number>();
  const products = drafts.map((d) => {
    const i = (perCategory.get(d.category) ?? 0) + 1;
    perCategory.set(d.category, i);
    return buildProduct(rng, d, i);
  });

  // Pick ~1/3 of each category to make messy, so defects spread across categories.
  const messy = new Set<number>();
  for (const cat of perCategory.keys()) {
    const idx = products.map((p, i) => (p.rubricCategory === cat ? i : -1)).filter((i) => i >= 0);
    rng.shuffle(idx).slice(0, Math.round(idx.length * MESSY_SHARE)).forEach((i) => messy.add(i));
  }
  const counts = rng.shuffle(DEFECT_COUNT_BAG);
  if (counts.length !== messy.size) throw new Error(`Defect bag has ${counts.length} entries for ${messy.size} messy products`);

  const usage = Object.fromEntries(DEFECT_IDS.map((d) => [d, 0])) as Record<DefectId, number>;
  let c = 0;
  const truths: GroundTruthProduct[] = products.map((p, i) => {
    if (!messy.has(i)) return { handle: p.handle, category: drafts[i].category, defects: [], details: {} };
    return injectDefects(rng, p, drafts[i], chooseDefects(rng, counts[c++], usage));
  });

  // Self-check: handles unique, clean titles pass, and the detectors see exactly the injected defects.
  const handles = new Set(products.map((p) => p.handle));
  if (handles.size !== products.length) throw new Error("Duplicate handles");
  const problems: string[] = [];
  products.forEach((p, i) => {
    if (!truths[i].defects.includes("vague_title") && isVagueTitle(p.title)) problems.push(`${p.handle}: clean title looks vague`);
    const detected = detectDefects(factsFromCatalog(p), truths[i]);
    if (!sameSet(detected, truths[i].defects)) {
      problems.push(`${p.handle}: expected [${truths[i].defects}] detected [${detected}]`);
    }
  });
  if (problems.length) throw new Error(`Self-check failed:\n${problems.join("\n")}`);

  const byDefect = Object.fromEntries(
    DEFECT_IDS.map((d) => [d, truths.filter((t) => t.defects.includes(d)).length]),
  ) as Record<DefectId, number>;
  const byDefectCount: Record<string, number> = {};
  for (const t of truths) byDefectCount[t.defects.length] = (byDefectCount[t.defects.length] ?? 0) + 1;

  const catalog = CatalogSchema.parse({ version: VERSION, generatorSeed: SEED, products });
  const groundTruth = GroundTruthSchema.parse({
    version: VERSION,
    summary: { products: products.length, messy: messy.size, byDefect, byDefectCount },
    products: truths,
  });

  const dir = join(process.cwd(), "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(join(dir, "ground-truth.json"), JSON.stringify(groundTruth, null, 2) + "\n");

  const variants = products.reduce((n, p) => n + p.variants.length, 0);
  console.log(`Wrote ${products.length} products (${variants} variants), ${messy.size} messy`);
  console.log("By category:", Object.fromEntries(perCategory));
  console.log("By defect:", byDefect);
  console.log("Defects per product:", byDefectCount);
}

main();

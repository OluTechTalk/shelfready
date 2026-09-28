// Generates the eval task set deterministically from the clean catalog and ground truth:
// natural shopper requests built from each product's true attributes, the structured
// constraints behind them, and every product that truly satisfies them.
//   25 tasks aimed at products that were seeded messy, 10 at clean products (control),
//   5 with no matching product (the right answer is to say so and not make a cart).
// Writes evals/tasks.json. Run: npm run eval:tasks

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogSchema, GroundTruthSchema, type CatalogProduct } from "../lib/catalog/schema";
import { createRng, type Rng } from "../scripts/catalog/rng";
import { acceptableHandles, genderOf, TaskSchema, type Constraints, type Task } from "./truth";

const SEED = 20260928;
const COUNTS = { messy_target: 25, clean_target: 10, no_match: 5 };
const MAX_ACCEPTABLE = 4;

const mf = (p: CatalogProduct, key: string) => p.metafields.find((m) => m.key === key)?.value;
const opt = (v: CatalogProduct["variants"][number], name: string) => v.optionValues.find((o) => o.optionName === name)?.name;
const capAbove = (price: number) => Math.ceil((price + 5) / 10) * 10; // "under $X" just above the price
const who = (g: "mens" | "womens" | null) => (g === "mens" ? "men's" : g === "womens" ? "women's" : "");

const TYPE_WORDS: Record<string, string> = {
  "Hiking Boots": "hiking boots",
  "Hiking Shoes": "hiking shoes",
  "Trail Running Shoes": "trail running shoes",
  "Casual Shoes": "casual shoes",
  "Winter Boots": "winter boots",
  "Rain Jackets": "rain jacket",
  "Insulated Jackets": "insulated jacket",
  "Fleece Jackets": "fleece jacket",
  "Softshell Jackets": "softshell jacket",
  Vests: "vest",
};

type Draft = { request: string; constraints: Constraints };

/** One natural request per product, built only from what is true about it. */
function draftFor(p: CatalogProduct, rng: Rng): Draft | null {
  const v = rng.pick(p.variants);
  const price = Number(v.price);
  const withCap = rng.chance(0.5);
  const cap = withCap ? capAbove(price) : undefined;
  const capText = cap ? `, under $${cap}` : "";
  const g = genderOf(p);

  switch (p.rubricCategory) {
    case "footwear": {
      const size = opt(v, "Size");
      const wp = mf(p, "waterproof") === "true";
      if (!size || !g) return null;
      return {
        request: `I need ${wp ? "waterproof " : ""}${who(g)} ${TYPE_WORDS[p.productType]} in size ${size}${capText}.`,
        constraints: { productTypes: [p.productType], gender: g, size, ...(wp ? { waterproof: true } : {}), ...(cap ? { maxPrice: cap } : {}) },
      };
    }
    case "apparel": {
      const size = opt(v, "Size");
      const color = rng.chance(0.5) ? opt(v, "Color") : undefined;
      if (!size || !g) return null;
      return {
        request: `Looking for a ${who(g)} ${TYPE_WORDS[p.productType]} in size ${size}${color ? `, in ${color}` : ""}${capText}.`,
        constraints: { productTypes: [p.productType], gender: g, size, ...(color ? { color } : {}), ...(cap ? { maxPrice: cap } : {}) },
      };
    }
    case "backpacks": {
      const liters = Number(mf(p, "capacity_l"));
      const use = mf(p, "use_case") ?? "";
      const [word, key] = /daypack/i.test(use)
        ? ["daypack", "Daypack"]
        : /multi-day/i.test(use)
          ? ["backpacking pack for multi-day trips", "Multi-day"]
          : /travel/i.test(use)
            ? ["travel backpack", "Travel"]
            : ["ultralight pack for fastpacking", "Fastpacking"];
      if (!liters) return null;
      return {
        request: `I want ${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}, around ${liters} liters${capText}.`,
        constraints: { attrRange: [{ key: "capacity_l", min: liters - 3, max: liters + 3 }], attrIncludes: [{ key: "use_case", text: key }], ...(cap ? { maxPrice: cap } : {}) },
      };
    }
    case "tents": {
      const people = Number(mf(p, "capacity_people"));
      const season = mf(p, "season_rating");
      if (!people || !season) return null;
      return {
        request: `I need a ${season} tent that sleeps ${people === 1 ? "one person" : `${people} people`}${capText}.`,
        constraints: { attrRange: [{ key: "capacity_people", min: people, max: people }], attrIncludes: [{ key: "season_rating", text: season }], ...(cap ? { maxPrice: cap } : {}) },
      };
    }
    case "sleeping_bags": {
      const temp = (mf(p, "temperature_rating") ?? "").split(" /")[0]; // "20°F"
      const fill = /down/i.test(mf(p, "fill_type") ?? "") ? "down" : "synthetic";
      if (!temp) return null;
      return {
        request: `A ${fill} sleeping bag rated to ${temp}${capText}.`,
        constraints: { attrIncludes: [{ key: "temperature_rating", text: temp }, { key: "fill_type", text: fill }], ...(cap ? { maxPrice: cap } : {}) },
      };
    }
    case "accessories": {
      const material = mf(p, "material") ?? "";
      const [text, key]: [string, string] =
        p.productType === "Headlamps"
          ? ["a rechargeable headlamp", "polycarbonate"]
          : p.productType === "Trekking Poles"
            ? [/carbon/i.test(material) ? "carbon fiber trekking poles" : "aluminum trekking poles", /carbon/i.test(material) ? "carbon" : "aluminum"]
            : p.productType === "Water Bottles"
              ? ["an insulated stainless steel water bottle", "stainless"]
              : p.productType === "Hats"
                ? ["a merino wool beanie", "merino"]
                : p.productType === "Socks"
                  ? ["merino hiking socks", "merino"]
                  : ["a backpacking cook set", "aluminum"];
      const size = p.productType === "Socks" ? opt(v, "Size") : undefined;
      return {
        request: `I'm after ${text}${size ? ` in size ${size}` : ""}${capText}.`,
        constraints: {
          productTypes: [p.productType],
          attrIncludes: [{ key: "material", text: key }],
          ...(size ? { size } : {}),
          ...(cap ? { maxPrice: cap } : {}),
        },
      };
    }
  }
}

function main() {
  const root = process.cwd();
  const clean = CatalogSchema.parse(JSON.parse(readFileSync(join(root, "fixtures", "catalog-clean.json"), "utf8"))).products;
  const truth = GroundTruthSchema.parse(JSON.parse(readFileSync(join(root, "fixtures", "ground-truth.json"), "utf8")));
  const defects = new Map(truth.products.map((t) => [t.handle, t.defects as string[]]));
  const rng = createRng(SEED);

  // Candidate tasks: specific enough (1–4 true answers, target among them), one per product.
  const candidates: Task[] = [];
  for (const p of clean) {
    const d = draftFor(p, rng);
    if (!d || candidates.some((c) => c.request === d.request)) continue; // one task per distinct request
    const acceptable = acceptableHandles(clean, d.constraints);
    if (!acceptable.includes(p.handle) || acceptable.length > MAX_ACCEPTABLE) continue;
    const targetDefects = defects.get(p.handle) ?? [];
    candidates.push(
      TaskSchema.parse({
        id: "",
        request: d.request,
        kind: targetDefects.length ? "messy_target" : "clean_target",
        target: p.handle,
        targetDefects,
        constraints: d.constraints,
        acceptable,
      }),
    );
  }

  const pickSpread = (pool: Task[], n: number) => {
    // Round-robin across categories so every category is covered.
    const byCat = new Map<string, Task[]>();
    for (const t of rng.shuffle(pool)) {
      const cat = clean.find((p) => p.handle === t.target)!.rubricCategory;
      byCat.set(cat, [...(byCat.get(cat) ?? []), t]);
    }
    const out: Task[] = [];
    while (out.length < n && [...byCat.values()].some((l) => l.length)) for (const l of byCat.values()) if (l.length && out.length < n) out.push(l.shift()!);
    return out;
  };
  const messy = pickSpread(candidates.filter((t) => t.kind === "messy_target"), COUNTS.messy_target);
  const control = pickSpread(candidates.filter((t) => t.kind === "clean_target"), COUNTS.clean_target);

  // No-match tasks: a real request with the budget set below every true match.
  const noMatch: Task[] = [];
  for (const t of rng.shuffle(candidates)) {
    if (noMatch.length >= COUNTS.no_match) break;
    const cheapest = Math.min(...t.acceptable.flatMap((h) => clean.find((p) => p.handle === h)!.variants.map((v) => Number(v.price))));
    const cap = Math.floor((cheapest * 0.6) / 10) * 10;
    if (cap < 20) continue;
    const constraints = { ...t.constraints, maxPrice: cap };
    if (acceptableHandles(clean, constraints).length) continue;
    const request = t.request.replace(/, under \$\d+\./, ".").replace(/\.$/, `, under $${cap}.`);
    noMatch.push(TaskSchema.parse({ ...t, id: "", request, kind: "no_match", target: null, targetDefects: [], constraints, acceptable: [] }));
  }

  const tasks = [...messy, ...control, ...noMatch].map((t, i) => ({ ...t, id: `T${String(i + 1).padStart(2, "0")}` }));
  const total = COUNTS.messy_target + COUNTS.clean_target + COUNTS.no_match;
  if (tasks.length !== total) throw new Error(`Only ${tasks.length} of ${total} tasks could be generated`);

  // Self-check: every task's answers are exactly what the truth matcher says.
  for (const t of tasks) {
    const again = acceptableHandles(clean, t.constraints);
    if (JSON.stringify(again) !== JSON.stringify(t.acceptable)) throw new Error(`${t.id}: acceptable set mismatch`);
  }

  writeFileSync(join(root, "evals", "tasks.json"), JSON.stringify({ version: 1, seed: SEED, tasks }, null, 2) + "\n");
  console.log(`Wrote ${tasks.length} tasks (${messy.length} messy targets, ${control.length} clean, ${noMatch.length} no-match)`);
  for (const t of tasks) console.log(`  ${t.id} [${t.kind}${t.targetDefects.length ? `: ${t.targetDefects.join(",")}` : ""}] ${t.request} → ${t.acceptable.length} answer(s)`);
}

main();

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

// ---------------------------------------------------------------------------
// Attribute tier: the deciding fact lives only in one structured attribute.
// ---------------------------------------------------------------------------

const HARD_COUNTS = { messy: 15, clean: 5 };
const HARD_KEYS: Record<CatalogProduct["rubricCategory"], string[]> = {
  footwear: ["width"],
  apparel: ["weather_rating"],
  backpacks: ["weight", "frame_type"],
  tents: ["setup_type", "packed_weight"],
  sleeping_bags: ["fill_type", "shape", "weight"],
  accessories: ["material"],
};

const grams = (raw: string | undefined) => {
  try {
    return (JSON.parse(raw ?? "") as { value: number }).value;
  } catch {
    return NaN;
  }
};
const an = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const packWord = (use: string) =>
  /daypack/i.test(use) ? ["daypack", "Daypack"] : /multi-day/i.test(use) ? ["backpacking pack", "Multi-day"] : /travel/i.test(use) ? ["travel pack", "Travel"] : ["ultralight pack", "Fastpacking"];

/** A request whose deciding constraint is attribute `key` of product `p` (built from its true value). */
function hardDraftFor(p: CatalogProduct, key: string, rng: Rng): Draft | null {
  const value = mf(p, key) ?? "";
  if (!value) return null;
  const v = rng.pick(p.variants);
  const g = genderOf(p);
  switch (`${p.rubricCategory}.${key}`) {
    case "footwear.width": {
      const size = opt(v, "Size");
      if (!/wide/i.test(value) || !size || !g) return null;
      return { request: `I need ${who(g)} ${TYPE_WORDS[p.productType]} in a wide width, size ${size}.`, constraints: { productTypes: [p.productType], gender: g, size, attrIncludes: [{ key: "width", text: "Wide" }] } };
    }
    case "apparel.weather_rating": {
      if (!g) return null;
      const mm = value.match(/\d{2},\d{3} mm/)?.[0];
      const temp = value.match(/\d+°F/)?.[0];
      const [phrase, text] = mm ? [`waterproof to ${mm}`, mm] : temp ? [`warm to about ${temp}`, temp] : /DWR/.test(value) ? ["with a water-resistant DWR finish", "DWR"] : [null, null];
      if (!phrase || !text) return null;
      return { request: `Looking for a ${who(g)} ${TYPE_WORDS[p.productType]} ${phrase}.`, constraints: { productTypes: [p.productType], gender: g, attrIncludes: [{ key: "weather_rating", text }] } };
    }
    case "backpacks.weight": {
      const w = grams(value);
      const [word, use] = packWord(mf(p, "use_case") ?? "");
      if (!w) return null;
      const cap = Math.ceil((w + 30) / 50) * 50;
      return { request: `I want ${an(word)} ${word} that weighs under ${cap} grams.`, constraints: { attrIncludes: [{ key: "use_case", text: use }], attrRange: [{ key: "weight", min: 0, max: cap }] } };
    }
    case "backpacks.frame_type": {
      const [word, use] = packWord(mf(p, "use_case") ?? "");
      const frameless = /frameless/i.test(value);
      return {
        request: frameless ? `I want a frameless ${word}.` : `I want ${an(word)} ${word} with an internal frame.`,
        constraints: { attrIncludes: [{ key: "use_case", text: use }, { key: "frame_type", text: frameless ? "Frameless" : "Internal" }] },
      };
    }
    case "tents.setup_type": {
      const people = Number(mf(p, "capacity_people"));
      if (!/^Freestanding dome/.test(value) || !people) return null;
      return {
        request: `I need a freestanding dome tent that sleeps ${people === 1 ? "one person" : `${people} people`}.`,
        constraints: { attrRange: [{ key: "capacity_people", min: people, max: people }], attrIncludes: [{ key: "setup_type", text: "Freestanding dome" }] },
      };
    }
    case "tents.packed_weight": {
      const people = Number(mf(p, "capacity_people"));
      const w = grams(value);
      if (!people || !w) return null;
      const cap = Math.ceil((w + 100) / 250) * 250;
      return {
        request: `I need a tent for ${people === 1 ? "one person" : `${people} people`} with a packed weight under ${(cap / 1000).toFixed(2).replace(/0$/, "")} kg.`,
        constraints: { attrRange: [{ key: "capacity_people", min: people, max: people }, { key: "packed_weight", min: 0, max: cap }] },
      };
    }
    case "sleeping_bags.fill_type": {
      const power = value.match(/\d{3}-fill/)?.[0];
      if (!power) return null;
      return { request: `I want a sleeping bag with ${power}-power down.`, constraints: { attrIncludes: [{ key: "fill_type", text: power }] } };
    }
    case "sleeping_bags.shape": {
      const temp = (mf(p, "temperature_rating") ?? "").split(" /")[0];
      if (!temp) return null;
      return {
        request: value === "Quilt" ? `I want a sleeping quilt rated to ${temp}.` : `I want a ${value.toLowerCase()}-shaped sleeping bag rated to ${temp}.`,
        constraints: { attrIncludes: [{ key: "shape", text: value }, { key: "temperature_rating", text: temp }] },
      };
    }
    case "sleeping_bags.weight": {
      const w = grams(value);
      const fill = /down/i.test(mf(p, "fill_type") ?? "") ? "down" : "synthetic";
      if (!w) return null;
      const cap = Math.ceil((w + 30) / 50) * 50;
      return { request: `I want a ${fill} sleeping bag that weighs under ${cap} grams.`, constraints: { attrIncludes: [{ key: "fill_type", text: fill }], attrRange: [{ key: "weight", min: 0, max: cap }] } };
    }
    case "accessories.material": {
      const detail = /cork/i.test(value) ? ["trekking poles with cork grips", "cork"] : /vacuum/i.test(value) ? ["a vacuum-insulated water bottle", "vacuum"] : /rib knit/i.test(value) ? ["a rib-knit merino beanie", "rib knit"] : /silicone/i.test(value) ? ["a cook set with silicone handles", "silicone"] : null;
      if (!detail) return null;
      return { request: `I'm after ${detail[0]}.`, constraints: { productTypes: [p.productType], attrIncludes: [{ key: "material", text: detail[1] }] } };
    }
  }
  return null;
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

  const standard = [...messy, ...control, ...noMatch].map((t, i) => ({ ...t, id: `T${String(i + 1).padStart(2, "0")}` }));
  const total = COUNTS.messy_target + COUNTS.clean_target + COUNTS.no_match;
  if (standard.length !== total) throw new Error(`Only ${standard.length} of ${total} tasks could be generated`);

  // Attribute tier (own RNG, so the standard tasks above never change).
  const hardRng = createRng(SEED + 1);
  const byHandle = new Map(clean.map((p) => [p.handle, p]));
  const seen = new Set(standard.map((t) => t.request));
  const hardTask = (p: CatalogProduct, key: string): Task | null => {
    const d = hardDraftFor(p, key, hardRng);
    if (!d || seen.has(d.request)) return null;
    const acceptable = acceptableHandles(clean, d.constraints);
    if (!acceptable.includes(p.handle) || acceptable.length > MAX_ACCEPTABLE) return null;
    seen.add(d.request);
    const targetDefects = defects.get(p.handle) ?? [];
    return TaskSchema.parse({
      id: "",
      request: d.request,
      kind: targetDefects.length ? "messy_target" : "clean_target",
      tier: "attribute",
      target: p.handle,
      targetDefects,
      constraints: d.constraints,
      acceptable,
    });
  };
  // Messy targets: first the exact attribute that was damaged on that product, then other messy products.
  const damaged = truth.products.flatMap((t) =>
    [...(t.details.attributesMissing ?? []), ...(t.details.attributesInDescriptionOnly ?? [])].map((a) => ({ handle: t.handle, key: a.key })),
  );
  const hardMessy: Task[] = [];
  const tryAdd = (list: Task[], p: CatalogProduct | undefined, key: string, max: number) => {
    if (!p || list.length >= max || list.some((t) => t.target === p.handle)) return;
    const t = hardTask(p, key);
    if (t) list.push(t);
  };
  for (const { handle, key } of hardRng.shuffle(damaged)) tryAdd(hardMessy, byHandle.get(handle), key, HARD_COUNTS.messy);
  for (const p of hardRng.shuffle(clean.filter((c) => (defects.get(c.handle) ?? []).length))) {
    for (const key of hardRng.shuffle(HARD_KEYS[p.rubricCategory])) tryAdd(hardMessy, p, key, HARD_COUNTS.messy);
  }
  const hardClean: Task[] = [];
  for (const p of hardRng.shuffle(clean.filter((c) => !(defects.get(c.handle) ?? []).length))) {
    for (const key of hardRng.shuffle(HARD_KEYS[p.rubricCategory])) tryAdd(hardClean, p, key, HARD_COUNTS.clean);
  }
  const hard = [...hardMessy, ...hardClean].map((t, i) => ({ ...t, id: `T${String(standard.length + i + 1).padStart(2, "0")}` }));
  if (hard.length !== HARD_COUNTS.messy + HARD_COUNTS.clean) throw new Error(`Only ${hard.length} attribute-tier tasks could be generated`);
  const tasks = [...standard, ...hard];

  // Self-check: every task's answers are exactly what the truth matcher says.
  for (const t of tasks) {
    const again = acceptableHandles(clean, t.constraints);
    if (JSON.stringify(again) !== JSON.stringify(t.acceptable)) throw new Error(`${t.id}: acceptable set mismatch`);
  }

  writeFileSync(join(root, "evals", "tasks.json"), JSON.stringify({ version: 1, seed: SEED, tasks }, null, 2) + "\n");
  console.log(`Wrote ${tasks.length} tasks: standard ${standard.length} (${messy.length} messy, ${control.length} clean, ${noMatch.length} no-match) + attribute tier ${hard.length} (${hardMessy.length} messy, ${hardClean.length} clean)`);
  for (const t of tasks) console.log(`  ${t.id} [${t.kind}${t.targetDefects.length ? `: ${t.targetDefects.join(",")}` : ""}] ${t.request} → ${t.acceptable.length} answer(s)`);
}

main();

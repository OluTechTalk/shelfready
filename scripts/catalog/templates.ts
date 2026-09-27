// Category templates for the demo catalog. Each builder returns a clean "draft":
// one sentence per required attribute (so defects can drop exactly that sentence),
// plus extra sentences that answer the other shopper questions and always carry numbers.

import type { Category } from "../../lib/audit/rubric";
import type { CatalogMetafield } from "../../lib/catalog/schema";
import type { Rng } from "./rng";

export type AttrDraft = { key: string; type: CatalogMetafield["type"]; value: string; sentence: string };

export type Draft = {
  category: Category;
  title: string;
  productType: string;
  taxonomyCategoryId: string;
  lead: string;
  attrs: AttrDraft[];
  extras: string[];
  care: string | null;
  options: { name: "Size" | "Color"; values: string[] }[];
  tags: string[];
  priceRange: [number, number];
};

export const VENDOR = "Ridgeline Outfitters";

// Placeholder image background per color (hex, no #).
export const COLOR_HEX: Record<string, string> = {
  Black: "222222",
  "Slate Grey": "5a6470",
  Navy: "1f2d4a",
  "Forest Green": "2f4f3a",
  Rust: "9a4a2a",
  Sand: "c8b58f",
  "Ocean Blue": "2a6f97",
  Olive: "6b6b3a",
  Burgundy: "6d2233",
  Charcoal: "3a3a3a",
  "Sunset Orange": "d9692b",
  Moss: "55704a",
  Stone: "a39e93",
  Graphite: "4a4d52",
};

const APPAREL_COLORS = ["Black", "Navy", "Forest Green", "Rust", "Ocean Blue", "Burgundy", "Charcoal", "Moss"];
const FOOTWEAR_COLORS = ["Black", "Slate Grey", "Stone", "Moss", "Rust", "Navy"];
const PACK_COLORS = ["Black", "Olive", "Ocean Blue", "Sunset Orange", "Charcoal", "Sand"];
const TENT_COLORS = ["Olive", "Sand", "Sunset Orange", "Stone"];
const GEAR_COLORS = ["Black", "Graphite", "Ocean Blue", "Sunset Orange", "Moss", "Sand"];

const lb = (g: number) => (g / 453.6).toFixed(1);
const oz = (g: number) => (g / 28.35).toFixed(1);
const toC = (f: number) => Math.round(((f - 32) * 5) / 9);
const weightValue = (g: number) => JSON.stringify({ value: g, unit: "GRAMS" });
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export type Gender = "Men's" | "Women's";

// ---------------------------------------------------------------------------
// Footwear
// ---------------------------------------------------------------------------

type FootwearKind = {
  noun: string;
  productType: string;
  taxonomy: string;
  waterproofChance: number;
  useCase: string;
  terrain: string;
  uppers: string[];
  grams: [number, number];
  price: [number, number];
  midWord?: string;
};

export const FOOTWEAR_KINDS: FootwearKind[] = [
  {
    noun: "Hiking Boot",
    productType: "Hiking Boots",
    taxonomy: "aa-8-3",
    waterproofChance: 0.85,
    useCase: "Hiking and backpacking",
    terrain: "rocky, technical trails and multi-day backpacking routes",
    uppers: ["Full-grain leather", "Nubuck leather", "Suede and abrasion-resistant mesh"],
    grams: [520, 680],
    price: [149, 229],
    midWord: "Mid",
  },
  {
    noun: "Hiking Shoe",
    productType: "Hiking Shoes",
    taxonomy: "aa-8",
    waterproofChance: 0.5,
    useCase: "Day hiking",
    terrain: "well-kept trails, gravel paths and light scrambles",
    uppers: ["Suede and abrasion-resistant mesh", "Synthetic mesh with TPU overlays", "Nubuck leather"],
    grams: [380, 470],
    price: [109, 159],
    midWord: "Low",
  },
  {
    noun: "Trail Running Shoe",
    productType: "Trail Running Shoes",
    taxonomy: "aa-8",
    waterproofChance: 0.2,
    useCase: "Trail running",
    terrain: "fast, muddy singletrack and technical trail races",
    uppers: ["Engineered synthetic mesh", "Recycled polyester knit", "Synthetic mesh with TPU overlays"],
    grams: [260, 330],
    price: [119, 169],
  },
  {
    noun: "Camp Shoe",
    productType: "Casual Shoes",
    taxonomy: "aa-8",
    waterproofChance: 0.1,
    useCase: "Casual and camp wear",
    terrain: "campsites, city streets and easy walking paths",
    uppers: ["Recycled polyester knit", "Suede leather", "Canvas"],
    grams: [240, 320],
    price: [69, 109],
  },
  {
    noun: "Insulated Winter Boot",
    productType: "Winter Boots",
    taxonomy: "aa-8-3",
    waterproofChance: 1,
    useCase: "Winter hiking and snow",
    terrain: "packed snow, slush and icy trailheads",
    uppers: ["Waterproof full-grain leather", "Nubuck leather with a rubber shell"],
    grams: [700, 860],
    price: [169, 249],
  },
];

export function footwearDraft(rng: Rng, model: string, kind: FootwearKind, gender: Gender): Draft {
  const waterproof = rng.chance(kind.waterproofChance);
  const upper = rng.pick(kind.uppers);
  const wide = rng.chance(0.3);
  const width = gender === "Men's" ? (wide ? "Wide (2E)" : "Regular (D)") : wide ? "Wide (D)" : "Regular (B)";
  const sizes = gender === "Men's" ? ["7", "8", "9", "10", "11", "12", "13"] : ["5", "6", "7", "8", "9", "10", "11"];
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const lug = rng.int(3, 6);
  const nameParts = [model, kind.midWord, waterproof && kind.noun !== "Insulated Winter Boot" ? "Waterproof" : null, kind.noun];
  const title = `${nameParts.filter(Boolean).join(" ")} - ${gender}`;
  const genderLower = gender.toLowerCase();

  return {
    category: "footwear",
    title,
    productType: kind.productType,
    taxonomyCategoryId: kind.taxonomy,
    lead: `The ${model} is part of our ${kind.noun.toLowerCase()} line, backed by a one-year warranty and free returns.`,
    attrs: [
      {
        key: "size_range",
        type: "single_line_text_field",
        value: `US ${sizes[0]}–${sizes[sizes.length - 1]}`,
        sentence: `Available in ${genderLower} US sizes ${sizes[0]}–${sizes[sizes.length - 1]}.`,
      },
      {
        key: "width",
        type: "single_line_text_field",
        value: width,
        sentence: `It fits true to size in a ${lower(width)} width.`,
      },
      {
        key: "gender_fit",
        type: "single_line_text_field",
        value: gender,
        sentence: `This is the ${genderLower} version, built on a ${genderLower}-specific last.`,
      },
      {
        key: "upper_material",
        type: "single_line_text_field",
        value: upper,
        sentence: `The upper is ${lower(upper)} with a protective rubber toe cap.`,
      },
      {
        key: "waterproof",
        type: "boolean",
        value: String(waterproof),
        sentence: waterproof
          ? "A waterproof, breathable membrane keeps feet dry through stream crossings and wet grass."
          : "It is not waterproof: the open construction drains quickly and dries fast in warm weather.",
      },
      {
        key: "use_case",
        type: "single_line_text_field",
        value: kind.useCase,
        sentence: `Designed for ${lower(kind.useCase)} on ${kind.terrain}.`,
      },
    ],
    extras: [
      `Each shoe weighs about ${g} g (${oz(g)} oz) in a ${genderLower} US ${gender === "Men's" ? 9 : 7}.`,
      `The ${lug} mm lugged rubber outsole grips wet rock and loose dirt.`,
    ],
    care: null,
    options: [
      { name: "Size", values: sizes },
      { name: "Color", values: rng.sample(FOOTWEAR_COLORS, 2) },
    ],
    tags: ["footwear", kind.productType.toLowerCase(), lower(kind.useCase), genderLower, waterproof ? "waterproof" : "breathable"],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Apparel
// ---------------------------------------------------------------------------

type ApparelKind = {
  noun: string;
  productType: string;
  taxonomy: string;
  materials: string[];
  weather: string[];
  useCase: string;
  care: string;
  grams: [number, number];
  price: [number, number];
};

export const APPAREL_KINDS: ApparelKind[] = [
  {
    noun: "Rain Jacket",
    productType: "Rain Jackets",
    taxonomy: "aa-1-10-2-10",
    materials: ["2.5-layer recycled nylon with a PFC-free DWR finish", "3-layer nylon ripstop with a PFC-free DWR finish"],
    weather: ["Waterproof to 20,000 mm with 15,000 g/m² breathability", "Waterproof to 10,000 mm with 10,000 g/m² breathability"],
    useCase: "Hiking and travel in the rain",
    care: "Machine wash cold and tumble dry low to reactivate the DWR finish.",
    grams: [260, 390],
    price: [149, 249],
  },
  {
    noun: "Down Jacket",
    productType: "Insulated Jackets",
    taxonomy: "aa-1-10-2",
    materials: ["20D recycled nylon shell with 800-fill-power RDS-certified down", "30D nylon shell with 650-fill-power RDS-certified duck down"],
    weather: ["Insulated with down; warm to about 20°F (-7°C) when active", "Insulated with down; warm to about 10°F (-12°C) at camp"],
    useCase: "Cold-weather hiking and camp",
    care: "Machine wash cold on a gentle cycle with down wash, then tumble dry low with dryer balls.",
    grams: [300, 480],
    price: [199, 329],
  },
  {
    noun: "Fleece Jacket",
    productType: "Fleece Jackets",
    taxonomy: "aa-1-10-2",
    materials: ["100% recycled polyester 200-weight fleece", "Recycled polyester grid fleece"],
    weather: ["Not waterproof; midweight warmth for 40–60°F (4–16°C)", "Not waterproof; lightweight warmth for 50–65°F (10–18°C)"],
    useCase: "Layering for hiking and camp",
    care: "Machine wash cold and hang to dry; do not use fabric softener.",
    grams: [330, 480],
    price: [79, 129],
  },
  {
    noun: "Softshell Jacket",
    productType: "Softshell Jackets",
    taxonomy: "aa-1-10-2",
    materials: ["Stretch nylon-elastane softshell with a brushed interior", "Double-weave polyester softshell"],
    weather: ["Water-resistant and windproof, but not fully waterproof", "Water-resistant DWR finish, wind-resistant, not fully waterproof"],
    useCase: "Climbing and ski touring",
    care: "Machine wash cold and tumble dry low; wash-in DWR restores beading.",
    grams: [380, 520],
    price: [139, 199],
  },
  {
    noun: "Insulated Vest",
    productType: "Vests",
    taxonomy: "aa-1-10",
    materials: ["Recycled polyester ripstop with 60 g/m² synthetic insulation", "Nylon ripstop with 80 g/m² synthetic insulation"],
    weather: ["Insulated with synthetic fill that stays warm when wet; water-resistant shell", "Synthetic insulation rated for 30–50°F (-1–10°C) activity"],
    useCase: "Layering for hiking and everyday wear",
    care: "Machine wash cold and tumble dry low.",
    grams: [200, 300],
    price: [89, 139],
  },
];

export function apparelDraft(rng: Rng, model: string, kind: ApparelKind, gender: Gender): Draft {
  const material = rng.pick(kind.materials);
  const weather = rng.pick(kind.weather);
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const genderLower = gender.toLowerCase();
  const pockets = rng.int(2, 4);
  return {
    category: "apparel",
    title: `${model} ${kind.noun} - ${gender}`,
    productType: kind.productType,
    taxonomyCategoryId: kind.taxonomy,
    lead: `The ${model} is a ${kind.noun.toLowerCase()} from our core outdoor collection, backed by a lifetime repair program.`,
    attrs: [
      {
        key: "size_range",
        type: "single_line_text_field",
        value: "XS–XXL",
        sentence: "Available in sizes XS–XXL.",
      },
      {
        key: "gender_fit",
        type: "single_line_text_field",
        value: `${gender} regular fit`,
        sentence: `Cut in a ${genderLower} regular fit with room for a midlayer; it runs true to size.`,
      },
      {
        key: "material",
        type: "single_line_text_field",
        value: material,
        sentence: `Made from ${material}.`,
      },
      {
        key: "weather_rating",
        type: "single_line_text_field",
        value: weather,
        sentence: `Weather protection: ${lower(weather)}.`,
      },
      {
        key: "use_case",
        type: "single_line_text_field",
        value: kind.useCase,
        sentence: `Best for ${lower(kind.useCase)}.`,
      },
    ],
    extras: [`It weighs ${g} g (${oz(g)} oz) in a ${genderLower} medium and has ${pockets} zippered pockets.`],
    care: kind.care,
    options: [
      { name: "Size", values: ["XS", "S", "M", "L", "XL", "XXL"] },
      { name: "Color", values: rng.sample(APPAREL_COLORS, rng.int(2, 3)) },
    ],
    tags: ["apparel", kind.productType.toLowerCase(), genderLower, lower(kind.useCase.split(" ")[0])],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Backpacks
// ---------------------------------------------------------------------------

type PackKind = {
  noun: string;
  productType: string;
  taxonomy: string;
  liters: [number, number];
  frame: string;
  useCase: string;
  grams: [number, number];
  price: [number, number];
  sleeve: string[];
  multiDay: string;
  torsoSizes: boolean;
};

export const PACK_KINDS: PackKind[] = [
  {
    noun: "Hiking Daypack",
    productType: "Daypacks",
    taxonomy: "lb-1-15",
    liters: [18, 30],
    frame: "Frameless design with a removable foam back panel",
    useCase: "Daypack for hiking and commuting",
    grams: [450, 900],
    price: [69, 139],
    sleeve: ["A padded sleeve fits a 15-inch laptop or a 2 L hydration bladder.", "An internal sleeve fits a 2 L hydration bladder; there is no laptop sleeve."],
    multiDay: "It is sized for day trips, not multi-day loads.",
    torsoSizes: false,
  },
  {
    noun: "Backpacking Pack",
    productType: "Backpacking Packs",
    taxonomy: "lb-1-15",
    liters: [45, 70],
    frame: "Internal aluminum frame with an adjustable torso",
    useCase: "Multi-day backpacking",
    grams: [1300, 2200],
    price: [199, 329],
    sleeve: ["An internal sleeve fits a 3 L hydration bladder; there is no laptop sleeve."],
    multiDay: "It carries loads up to 18 kg (40 lb) for trips of 3–7 days.",
    torsoSizes: true,
  },
  {
    noun: "Travel Pack",
    productType: "Travel Backpacks",
    taxonomy: "lb-1",
    liters: [35, 40],
    frame: "Internal HDPE framesheet with a stowable harness",
    useCase: "Travel and one-bag trips",
    grams: [1100, 1500],
    price: [149, 219],
    sleeve: ["A padded sleeve fits a 16-inch laptop; there is no hydration port."],
    multiDay: "It opens like a suitcase and packs clothing for trips of 1–2 weeks.",
    torsoSizes: false,
  },
  {
    noun: "Ultralight Pack",
    productType: "Backpacking Packs",
    taxonomy: "lb-1-15",
    liters: [30, 40],
    frame: "Frameless design with a removable sit pad",
    useCase: "Fastpacking and ultralight overnights",
    grams: [480, 780],
    price: [129, 199],
    sleeve: ["An internal sleeve fits a 2 L hydration bladder; there is no laptop sleeve."],
    multiDay: "It handles 1–3 night trips with a base weight under 5 kg (11 lb).",
    torsoSizes: false,
  },
];

export function packDraft(rng: Rng, model: string, kind: PackKind): Draft {
  const liters = rng.int(kind.liters[0], kind.liters[1]);
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const h = Math.round(38 + liters * 0.55);
  const w = Math.round(26 + liters * 0.15);
  const d = Math.round(14 + liters * 0.14);
  const carryOn =
    h <= 56 && w <= 36 && d <= 23
      ? `At ${h} x ${w} x ${d} cm it fits most airline carry-on limits.`
      : `At ${h} x ${w} x ${d} cm it is too large for airline carry-on.`;
  const options: Draft["options"] = [{ name: "Color", values: rng.sample(PACK_COLORS, rng.int(2, 3)) }];
  if (kind.torsoSizes) options.unshift({ name: "Size", values: ["S", "M", "L"] });
  return {
    category: "backpacks",
    title: `${model} ${liters}L ${kind.noun}`,
    productType: kind.productType,
    taxonomyCategoryId: kind.taxonomy,
    lead: `The ${model} is built with recycled ripstop fabric and YKK zippers, and it is covered by our lifetime warranty.`,
    attrs: [
      { key: "capacity_l", type: "number_integer", value: String(liters), sentence: `It holds ${liters} liters.` },
      { key: "weight", type: "weight", value: weightValue(g), sentence: `It weighs ${g} g (${lb(g)} lb) empty.` },
      { key: "frame_type", type: "single_line_text_field", value: kind.frame, sentence: `Frame: ${lower(kind.frame)}.` },
      {
        key: "use_case",
        type: "single_line_text_field",
        value: kind.useCase,
        sentence: `Built as a ${lower(kind.useCase)} pack.`,
      },
    ],
    extras: [rng.pick(kind.sleeve), kind.multiDay, carryOn],
    care: null,
    options,
    tags: ["backpacks", kind.productType.toLowerCase(), liters >= 45 ? "multi-day" : "daypack", `${liters}l`],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Tents
// ---------------------------------------------------------------------------

type TentKind = {
  people: number;
  noun: string;
  season: string;
  seasonText: string;
  setup: string[];
  grams: [number, number];
  price: [number, number];
};

export const TENT_KINDS: TentKind[] = [
  {
    people: 1,
    noun: "Ultralight Tent",
    season: "3-season",
    seasonText: "spring, summer and fall",
    setup: ["Non-freestanding, pitched with one trekking pole"],
    grams: [700, 1000],
    price: [229, 329],
  },
  {
    people: 2,
    noun: "Backpacking Tent",
    season: "3-season",
    seasonText: "spring, summer and fall",
    setup: ["Freestanding dome with 2 color-coded poles", "Semi-freestanding with a single hubbed pole"],
    grams: [1300, 1900],
    price: [279, 449],
  },
  {
    people: 3,
    noun: "Backpacking Tent",
    season: "3+ season",
    seasonText: "spring through late fall, including light snow",
    setup: ["Freestanding dome with 3 color-coded poles"],
    grams: [1900, 2600],
    price: [349, 499],
  },
  {
    people: 4,
    noun: "Camping Tent",
    season: "3-season",
    seasonText: "spring, summer and fall car camping",
    setup: ["Freestanding dome with 3 poles and a full-coverage fly"],
    grams: [4200, 5600],
    price: [249, 399],
  },
  {
    people: 6,
    noun: "Family Camping Tent",
    season: "3-season",
    seasonText: "spring, summer and fall car camping",
    setup: ["Freestanding cabin with a pre-attached hub frame"],
    grams: [8200, 10400],
    price: [399, 599],
  },
  {
    people: 2,
    noun: "Mountaineering Tent",
    season: "4-season",
    seasonText: "year-round use, including winter storms and snow load",
    setup: ["Freestanding geodesic dome with 4 crossing poles"],
    grams: [2700, 3400],
    price: [549, 749],
  },
];

export function tentDraft(rng: Rng, model: string, kind: TentKind): Draft {
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const setup = rng.pick(kind.setup);
  const sqft = Math.round(18 + kind.people * 11 + rng.int(-2, 3));
  const peak = rng.int(95, 110) + (kind.people >= 4 ? 70 : 0);
  const doors = kind.people === 1 ? 1 : 2;
  const minutes = setup.startsWith("Freestanding cabin") ? 5 : rng.int(4, 8);
  return {
    category: "tents",
    title: `${model} ${kind.people}-Person ${kind.noun}`,
    productType: "Tents",
    taxonomyCategoryId: "sg-4-2-17",
    lead: `The ${model} uses a silicone-coated ripstop fly and a bathtub floor, and every seam is taped at our factory.`,
    attrs: [
      {
        key: "capacity_people",
        type: "number_integer",
        value: String(kind.people),
        sentence: `It sleeps ${kind.people} ${kind.people === 1 ? "person" : "people"}.`,
      },
      {
        key: "season_rating",
        type: "single_line_text_field",
        value: kind.season,
        sentence: `A ${kind.season} shelter for ${kind.seasonText}.`,
      },
      {
        key: "packed_weight",
        type: "weight",
        value: weightValue(g),
        sentence: `Packed weight is ${(g / 1000).toFixed(2)} kg (${lb(g)} lb).`,
      },
      {
        key: "setup_type",
        type: "single_line_text_field",
        value: setup,
        sentence: `Setup: ${lower(setup)}; one person can pitch it in about ${minutes} minutes.`,
      },
    ],
    extras: [`Floor area is ${sqft} sq ft with ${doors} ${doors === 1 ? "door" : "doors"} and a peak height of ${peak} cm.`],
    care: null,
    options: [{ name: "Color", values: rng.sample(TENT_COLORS, rng.int(1, 2)) }],
    tags: ["tents", `${kind.people}-person`, kind.season, kind.people >= 4 ? "car camping" : "backpacking"],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Sleeping bags
// ---------------------------------------------------------------------------

type BagKind = {
  tempF: number;
  fill: string;
  fillShort: "Down" | "Synthetic";
  shape: "Mummy" | "Semi-rectangular" | "Rectangular" | "Quilt";
  grams: [number, number];
  price: [number, number];
};

export const BAG_KINDS: BagKind[] = [
  { tempF: 20, fill: "650-fill-power RDS-certified duck down", fillShort: "Down", shape: "Mummy", grams: [1000, 1250], price: [229, 299] },
  { tempF: 0, fill: "800-fill-power RDS-certified goose down", fillShort: "Down", shape: "Mummy", grams: [1400, 1700], price: [379, 449] },
  { tempF: 30, fill: "Synthetic polyester insulation", fillShort: "Synthetic", shape: "Mummy", grams: [1100, 1400], price: [119, 169] },
  { tempF: 40, fill: "Synthetic polyester insulation", fillShort: "Synthetic", shape: "Semi-rectangular", grams: [1200, 1600], price: [99, 139] },
  { tempF: 30, fill: "850-fill-power RDS-certified goose down", fillShort: "Down", shape: "Quilt", grams: [560, 720], price: [259, 349] },
  { tempF: 40, fill: "Synthetic polyester insulation", fillShort: "Synthetic", shape: "Rectangular", grams: [1600, 2100], price: [89, 129] },
];

const SIDE_SLEEPER: Record<BagKind["shape"], string> = {
  Mummy: "The tapered cut is snug for side sleepers who roll a lot, but the 5-piece hood moves with you.",
  "Semi-rectangular": "Side sleepers get extra room at the hips and knees, with 20% more width than a mummy.",
  Rectangular: "The roomy 80 cm width suits side sleepers, and it unzips flat into a 2-person blanket.",
  Quilt: "Side sleepers can roll freely because there is no back panel; 2 pad straps keep drafts out.",
};

export function bagDraft(rng: Rng, model: string, kind: BagKind): Draft {
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const [a, b] = [rng.int(16, 24), rng.int(28, 40)];
  const comfortF = kind.tempF + 10;
  return {
    category: "sleeping_bags",
    title: `${model} ${kind.tempF}°F ${kind.fillShort} Sleeping ${kind.shape === "Quilt" ? "Quilt" : "Bag"}`,
    productType: "Sleeping Bags",
    taxonomyCategoryId: "sg-4-2-14",
    lead: `The ${model} has a water-resistant shell and a full-length draft collar, and it comes with a stuff sack and a storage sack.`,
    attrs: [
      {
        key: "temperature_rating",
        type: "single_line_text_field",
        value: `${kind.tempF}°F / ${toC(kind.tempF)}°C`,
        sentence: `Temperature rating: ${kind.tempF}°F (${toC(kind.tempF)}°C) lower limit, comfortable to about ${comfortF}°F (${toC(comfortF)}°C).`,
      },
      { key: "fill_type", type: "single_line_text_field", value: kind.fill, sentence: `Insulated with ${lower(kind.fill)}.` },
      { key: "weight", type: "weight", value: weightValue(g), sentence: `It weighs ${g} g (${lb(g)} lb) in the regular length.` },
      {
        key: "shape",
        type: "single_line_text_field",
        value: kind.shape,
        sentence: `It has a ${kind.shape.toLowerCase()} shape with a roomy footbox.`,
      },
    ],
    extras: [`It packs down to ${a} x ${b} cm in the included stuff sack.`, SIDE_SLEEPER[kind.shape]],
    care: null,
    options: [{ name: "Size", values: ["Regular", "Long"] }],
    tags: ["sleeping bags", kind.fillShort.toLowerCase(), `${kind.tempF} degree`, kind.shape.toLowerCase()],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

type AccessoryKind = {
  noun: string;
  productType: string;
  taxonomy: string;
  material: string;
  dimensions: string;
  useCase: string;
  care: string;
  compatibility: string;
  grams: [number, number];
  price: [number, number];
  option: { name: "Size" | "Color"; values: string[]; count: [number, number] };
};

export const ACCESSORY_KINDS: AccessoryKind[] = [
  {
    noun: "400-Lumen Rechargeable Headlamp",
    productType: "Headlamps",
    taxonomy: "ha-15-16-2",
    material: "Polycarbonate housing with a recycled elastic strap",
    dimensions: "6 x 4 x 3.5 cm lamp body",
    useCase: "Night hiking, running and camp chores",
    care: "Wipe clean with a damp cloth; the housing is IPX4 splash-resistant.",
    compatibility: "Charges with any USB-C cable, and the strap fits over helmets.",
    grams: [70, 95],
    price: [39, 59],
    option: { name: "Color", values: GEAR_COLORS, count: [2, 3] },
  },
  {
    noun: "Carbon Trekking Poles",
    productType: "Trekking Poles",
    taxonomy: "sg-4-2-8",
    material: "Carbon fiber shafts with cork grips and tungsten tips",
    dimensions: "Adjusts from 100 to 135 cm; collapses to 62 cm",
    useCase: "Hiking and backpacking on steep terrain",
    care: "Dry the sections apart after wet hikes to keep the locks free.",
    compatibility: "Works with standard 10 mm snow baskets and trekking-pole tents.",
    grams: [440, 520],
    price: [99, 149],
    option: { name: "Color", values: ["Black", "Graphite", "Ocean Blue"], count: [1, 2] },
  },
  {
    noun: "Insulated Water Bottle",
    productType: "Water Bottles",
    taxonomy: "hg-11-3-11",
    material: "18/8 stainless steel, double-wall vacuum insulated",
    dimensions: "750 mL (25 oz), 7.3 x 26 cm",
    useCase: "Hiking, camp and everyday hydration",
    care: "Hand wash only; the lid is top-rack dishwasher safe.",
    compatibility: "The 63 mm wide mouth fits most water filters and standard ice cubes.",
    grams: [360, 420],
    price: [29, 45],
    option: { name: "Color", values: GEAR_COLORS, count: [3, 4] },
  },
  {
    noun: "Merino Wool Beanie",
    productType: "Hats",
    taxonomy: "aa-2-17",
    material: "100% merino wool rib knit",
    dimensions: "One size, fits 54–60 cm heads",
    useCase: "Cold-weather hiking and everyday wear",
    care: "Hand wash cold and lay flat to dry.",
    compatibility: "Thin enough to wear under a hood or a climbing helmet.",
    grams: [55, 80],
    price: [29, 42],
    option: { name: "Color", values: ["Black", "Charcoal", "Rust", "Forest Green", "Navy"], count: [2, 4] },
  },
  {
    noun: "Merino Hiking Socks",
    productType: "Socks",
    taxonomy: "aa-1-18",
    material: "Merino wool blend (62% merino, 35% nylon, 3% elastane)",
    dimensions: "Sizes S–XL, fits US men's 4–14",
    useCase: "Hiking and backpacking",
    care: "Machine wash warm inside out and tumble dry low.",
    compatibility: "Crew height sits above the collar of hiking boots and trail shoes.",
    grams: [60, 90],
    price: [19, 27],
    option: { name: "Size", values: ["S", "M", "L", "XL"], count: [4, 4] },
  },
  {
    noun: "Hard-Anodized Cook Set",
    productType: "Camping Cookware",
    taxonomy: "sg-4-2-2-7",
    material: "Hard-anodized aluminum with silicone handles",
    dimensions: "1.2 L pot with lid-pan; nests to 13 x 11 cm",
    useCase: "Backpacking and camp cooking for 1–2 people",
    care: "Hand wash with warm water; avoid metal scouring pads.",
    compatibility: "A 230 g fuel canister and most compact stoves nest inside the pot.",
    grams: [280, 360],
    price: [49, 79],
    option: { name: "Color", values: ["Graphite", "Sunset Orange", "Moss"], count: [1, 2] },
  },
];

export function accessoryDraft(rng: Rng, model: string, kind: AccessoryKind): Draft {
  const g = rng.int(kind.grams[0], kind.grams[1]);
  const { option } = kind;
  const values =
    option.name === "Size" ? option.values : rng.sample(option.values, rng.int(option.count[0], option.count[1]));
  return {
    category: "accessories",
    title: `${model} ${kind.noun}`,
    productType: kind.productType,
    taxonomyCategoryId: kind.taxonomy,
    lead: `The ${model} is designed and tested by our gear team, and it is covered by a two-year warranty.`,
    attrs: [
      { key: "material", type: "single_line_text_field", value: kind.material, sentence: `Material: ${lower(kind.material)}.` },
      { key: "dimensions", type: "single_line_text_field", value: kind.dimensions, sentence: `Size: ${lower(kind.dimensions)}.` },
      { key: "use_case", type: "single_line_text_field", value: kind.useCase, sentence: `Made for ${lower(kind.useCase)}.` },
    ],
    extras: [`It weighs ${g} g (${oz(g)} oz).`, kind.compatibility],
    care: kind.care,
    options: [{ name: option.name, values }],
    tags: ["accessories", kind.productType.toLowerCase(), lower(kind.useCase.split(",")[0].split(" ")[0])],
    priceRange: kind.price,
  };
}

// ---------------------------------------------------------------------------
// Messy content pools (seeded defects)
// ---------------------------------------------------------------------------

export const VAGUE_TITLES: Record<Category, string[]> = {
  footwear: ["Great Boot!!", "NEW BOOTS 2024", "Best Shoe Ever!!", "Trail Shoe - SALE", "Boots"],
  apparel: ["NEW JACKET 2024", "Amazing Jacket!!", "Jacket", "Cozy Layer!!!", "WARM FLEECE"],
  backpacks: ["Awesome Pack!!", "BACKPACK", "New Bag 2024", "Pack"],
  tents: ["TENT", "Best Tent!!", "Tent (copy)", "New Shelter 2024"],
  sleeping_bags: ["Sleeping Bag!!", "WARM BAG", "Bag - NEW"],
  accessories: ["Must Have!!", "NEW ITEM", "Untitled product", "Accessory - SALE"],
};

export const MARKETING_COPY: string[][] = [
  ["Adventure awaits!", "Built for those who go further, this is the one you'll reach for every time."],
  ["Your new favorite.", "Designed with passion and tested by people who live outside. You deserve the best."],
  ["Get out there!", "Premium quality meets bold style. Once you try it, you'll never go back."],
  ["Made for the wild.", "Whatever the trail throws at you, you'll be ready. Limited stock, so grab yours today!"],
  ["Elevate every trip.", "Thoughtful details and rugged good looks make this an instant classic."],
];

export const SIZE_OPTION_ALIASES = { footwear: ["Shoe Size", "size", "Sz"], other: ["size", "Sz", "SIZE", "Sizes"] };
export const COLOR_OPTION_ALIASES = ["colour", "Colour", "Color Way", "clr"];

// Value synonyms used to fake a duplicate variant ("M" vs "Medium"). Must stay in sync with
// normalizeOptionValue() in lib/catalog/defects.ts so the duplicate is detectable.
export const VALUE_SYNONYMS: Record<string, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra Large",
  Black: "Blk",
  Navy: "Nvy",
};

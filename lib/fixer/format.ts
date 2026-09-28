// Human-readable attribute labels and values for the review UI. Storage stays in Shopify's
// encoding (weight is {"value":…,"unit":"GRAMS"}); this is display only.

import { REQUIRED_ATTRIBUTES } from "../audit/rubric";

const UNIT_SUFFIX: Record<string, string> = { capacity_l: " L", capacity_people: " people" };

/** "capacity_l" → "Capacity", "weather_rating" → "Waterproof / insulation rating". */
export function attributeLabel(key: string): string {
  for (const attrs of Object.values(REQUIRED_ATTRIBUTES)) {
    const found = attrs.find((a) => a.key === key);
    if (found) return found.label.replace(/\s*\((L|people|y\/n)\)$/, "").replace(/\s*\(.*\)$/, "");
  }
  return key.replace(/_/g, " ");
}

/** Grams from a weight metafield value, or null if it isn't one. */
export function weightGrams(value: string): number | null {
  try {
    const w = JSON.parse(value) as { value?: number; unit?: string };
    if (typeof w.value !== "number") return null;
    const factor: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 };
    return w.value * (factor[w.unit ?? "GRAMS"] ?? 1);
  } catch {
    return null;
  }
}

export function formatAttributeValue(key: string, type: string, value: string): string {
  if (type === "weight") {
    const g = weightGrams(value);
    if (g === null) return value;
    const lb = g / 453.592;
    return `${Math.round(g).toLocaleString("en-US")} g (${lb.toFixed(1)} lb)`;
  }
  if (type === "boolean") return value === "true" ? "Yes" : value === "false" ? "No" : value;
  return `${value}${UNIT_SUFFIX[key] ?? ""}`;
}

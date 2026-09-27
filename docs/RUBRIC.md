# ShelfReady — Agent Readiness Rubric (v0 draft)

Status: v0, drafted before the build. Finalize in Episode 03 after looking at the real seeded catalog. Log any change to weights or checks in DECISIONS.md.

**The question behind every check:** could an AI shopping agent, given only this product's data, confidently match it to a shopper's request and answer their follow-up questions?

## Scoring

Each product scores 0–100 as the weighted sum of seven checks. Each check returns 0–1.

| # | Check | Weight | Type | Scores 1.0 when… |
|---|---|---|---|---|
| 1 | Required attributes | 30 | Rule | Every required attribute for the product's category is present as a structured field (metafield), not just mentioned in the description |
| 2 | Description answerability | 20 | LLM | The description answers all 5 standard shopper questions for its category (see below) |
| 3 | Variant structure | 15 | Rule | Options use standard names (Size, Color), no duplicate variants, every variant has a SKU and price |
| 4 | Title specificity | 10 | Rule + LLM | 20–80 chars, includes product type + one distinguishing attribute, no ALL CAPS, no placeholder text |
| 5 | Price & availability | 10 | Rule | Price > 0, compare-at price ≥ price if set, inventory tracked, stock state clear |
| 6 | Images & alt text | 10 | Rule | At least 1 image; every image has descriptive alt text (not empty, not the filename) |
| 7 | Taxonomy | 5 | Rule | Product type set, standard category set, ≥ 3 meaningful tags |

Partial credit: checks 1, 3, 6, 7 score as the fraction satisfied (e.g. 3 of 5 required attributes = 0.6). Check 2 = questions answered ÷ 5. Check 4 = 0.5 per sub-condition group met (length/format, content).

## Bands

| Score | Band | Meaning |
|---|---|---|
| 80–100 | Agent-ready | An agent can match and recommend it confidently |
| 50–79 | Partial | Findable, but agents will guess or skip on specific requests |
| 0–49 | Not ready | Effectively invisible to agents on anything but its name |

**Store score** = mean product score. Also report % of products in each band — that's the more intuitive number for the case study.

## Required attributes by category

Metafield keys (namespace `shelfready`) match `REQUIRED_ATTRIBUTES` in `lib/audit/rubric.ts`, which is the source of truth.

| Category | Required attributes (metafield key) |
|---|---|
| Footwear | size range (`size_range`), width (`width`), gender/fit (`gender_fit`), upper material (`upper_material`), waterproof y/n (`waterproof`), use case — trail, hiking, casual (`use_case`) |
| Apparel (jackets, layers) | size range (`size_range`), gender/fit (`gender_fit`), material (`material`), waterproof/insulation rating (`weather_rating`), use case (`use_case`) |
| Backpacks | capacity in L (`capacity_l`), weight (`weight`), frame type (`frame_type`), use case — daypack, multi-day (`use_case`) |
| Tents | capacity in people (`capacity_people`), season rating (`season_rating`), packed weight (`packed_weight`), setup type (`setup_type`) |
| Sleeping bags | temperature rating (`temperature_rating`), fill type (`fill_type`), weight (`weight`), shape (`shape`) |
| Accessories | material (`material`), size/dimensions (`dimensions`), use case (`use_case`) |

## Standard shopper questions (for check 2)

Wording matches `SHOPPER_QUESTIONS` in `lib/audit/rubric.ts` (the code wins); ids are `<category>.<slug>` there.

| Category | Questions |
|---|---|
| Footwear | Is it waterproof? How does it fit (true to size, wide)? What terrain is it for? What is the upper made of? How heavy is it? |
| Apparel | Is it waterproof / warm enough for the conditions? How does it fit? What's it made of? How do I care for it? What activity is it for? |
| Backpacks | How many liters? How heavy is it? Will it fit a laptop / hydration bladder? Is it good for multi-day trips? Is it carry-on size? |
| Tents | How many people does it fit? Which seasons is it for? What is the packed weight? How hard is setup? Is it freestanding? |
| Sleeping bags | What is the temperature rating? Is it down or synthetic? What is the packed size / weight? What shape is it? Is it good for side sleepers? |
| Accessories | What's it made of? What size is it? What's it for? How do I care for it? What is it compatible with? |

## LLM check rules

- Structured output only (Zod): `{ questionId, answered: boolean, evidence: string | null }` per question. `evidence` must quote the description; no quote = not answered.
- Temperature 0. Same model for every audit run so before/after scores are comparable.
- Cache results by product content hash; re-score only when the product changes.

## Seeded defects (Episode 02 uses this list to make ~1/3 of the catalog messy)

1. Vague title ("Great Boot!!", "NEW JACKET 2024")
2. Attributes only in description prose, not in metafields
3. Attributes missing entirely (no capacity on a backpack)
4. Inconsistent option names ("size", "Sz", "Shoe Size")
5. Duplicate variants / missing SKUs
6. Empty or filename alt text ("IMG_2231.jpg")
7. Marketing-only description ("Adventure awaits!") with no specs
8. Missing product type / category, 0–1 tags

Aim for a spread: some products with one defect, some with 3+, so the score distribution looks realistic.

## Open questions for Episode 03
- Should check 1 accept attributes found in the description at half credit? (Argument: agents can read prose, but less reliably.)
- Is 30 the right weight for required attributes, or does that over-punish accessories?

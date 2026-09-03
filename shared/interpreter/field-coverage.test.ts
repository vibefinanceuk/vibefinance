import { describe, expect, it } from "vitest";
import { INVOICE_FIELDS } from "./vocabulary.js";
// Read as text rather than through node:fs — this package targets the
// Workers runtime, and pulling Node's types in for one test would widen
// its type environment for no good reason. Vite's ?raw is the same
// mechanism the migration tests already use for .sql files.
import parserSource from "../ingestion/ubl-parser.ts?raw";

/**
 * Every declared field must be populatable by some intake path, or its
 * absence must be recorded as deliberate — decision 0067, proposed by
 * decision 0059.
 *
 * The recurring bug in this codebase is one layer disagreeing with
 * another, and it has happened five times:
 *
 *   - `invoice_lines.cost_centre` was a column with no vocabulary entry
 *   - `extraction.confidence` was set as a fact and never declared, so
 *     the rules meant to use it could not be written (0054)
 *   - decision 0053 shipped settings that reached nothing (0056, 0057)
 *   - the UBL parser populated 11 of 21 declared fields, so validation's
 *     arithmetic checks could never run on the most trustworthy path
 *     (0059)
 *   - `CIUS_PROFILES` claimed FatturaPA was a CIUS (0065)
 *
 * **None was found by reading either layer alone.** This test crosses
 * the boundary: it reads the vocabulary, reads the parser, and fails
 * when a field is declared that nothing can produce.
 *
 * It would have caught the fourth at the moment it was introduced, and
 * the first the moment `BT-133` was declared without a mapping.
 */

/**
 * Fields the UBL parser deliberately does not map, each with the reason.
 *
 * This list is the point of the test as much as the assertion is: a
 * gap has to be *stated* to be allowed, which turns "nobody noticed"
 * into "somebody decided".
 */
const DELIBERATELY_UNMAPPED: Record<string, string> = {
  "BG-20":
    "document-level allowances — a repeated, nested group with its own reason codes, amounts and tax categories, not a path-to-scalar mapping. No rule has needed them.",
  "BG-21":
    "document-level charges — the same shape as BG-20, and the same reasoning.",
};

function fieldsPopulatedByUblParser(): Set<string> {
  const found = new Set<string>();
  for (const m of parserSource.matchAll(/"(B[TG]-\d+)"\s*\]\s*=/g)) {
    found.add(m[1]);
  }
  return found;
}

describe("every declared invoice field can be populated, or its absence is recorded", () => {
  it("the UBL parser populates every field not listed as deliberately unmapped", () => {
    const populated = fieldsPopulatedByUblParser();
    const missing = INVOICE_FIELDS.filter(
      (f) => !populated.has(f) && !(f in DELIBERATELY_UNMAPPED)
    );

    expect(
      missing,
      missing.length === 0
        ? ""
        : `Declared in the vocabulary and populated by no intake path: ${missing.join(", ")}. ` +
          `Either map it in shared/ingestion/ubl-parser.ts, or add it to DELIBERATELY_UNMAPPED ` +
          `in this file with the reason. A field nothing can produce is a rule nobody can write.`
    ).toEqual([]);
  });

  it("does not carry stale exemptions for fields that are now mapped", () => {
    // An exemption left behind after the gap it excused was closed is a
    // comment claiming a limitation that no longer exists.
    const populated = fieldsPopulatedByUblParser();
    const stale = Object.keys(DELIBERATELY_UNMAPPED).filter((f) => populated.has(f));
    expect(stale, `Listed as unmapped but actually mapped: ${stale.join(", ")}`).toEqual([]);
  });

  it("does not exempt a field the vocabulary no longer declares", () => {
    const unknown = Object.keys(DELIBERATELY_UNMAPPED).filter(
      (f) => !(INVOICE_FIELDS as readonly string[]).includes(f)
    );
    expect(unknown, `Exempted but not in the vocabulary: ${unknown.join(", ")}`).toEqual([]);
  });

  it("actually detects a field the parser sets, rather than passing vacuously", () => {
    // A coverage check that finds nothing would pass for the wrong
    // reason. BT-1 is mapped and must be seen.
    expect(fieldsPopulatedByUblParser().has("BT-1")).toBe(true);
    expect(fieldsPopulatedByUblParser().size).toBeGreaterThan(10);
  });
});

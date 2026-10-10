import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { duplicateVerdict } from "../src/validation.js";
import { handleGetInvoice, handleUpsertInvoice } from "../src/invoice-facts-route.js";
import { POSSIBLE_DUPLICATE_THRESHOLD } from "../src/invoice-history.js";

/**
 * **The invoice number's duplicate check on the screen — decision 0711.**
 * Green when the stored score (decision 0028) is below the Possible
 * duplicates bar, amber at or above it, nothing when never scored.
 */

describe("duplicateVerdict", () => {
  it("confirms a number below the bar, warns at or above it, and says nothing unscored", () => {
    expect(duplicateVerdict(0, 0.4)).toEqual({ confirms: [{ check: "duplicate", fields: ["BT-1"] }], involves: [] });
    expect(duplicateVerdict(0.25, 0.4).confirms).toHaveLength(1);
    expect(duplicateVerdict(0.6, 0.4)).toEqual({
      confirms: [],
      involves: [{ check: "duplicate", fields: ["BT-1"], severity: "warning", value: "60%" }],
    });
    expect(duplicateVerdict(0.4, 0.4).involves).toHaveLength(1);
    expect(duplicateVerdict(null, 0.4)).toEqual({ confirms: [], involves: [] });
  });
});

describe("on the invoice screen", () => {
  beforeEach(async () => {
    await applyTestSchema();
  });

  const save = (id: string, number: string, total: number) =>
    handleUpsertInvoice(env.DB, { id, facts: { "BT-1": number, "BT-31": "GB111", "BT-112": total, "BT-2": "2026-10-01" } } as never);
  type Validation = { confirms?: { check: string; fields: string[] }[]; involves?: { check: string; severity: string }[] };
  const validation = async (id: string) => ((await handleGetInvoice(env.DB, id)).body as { validation: Validation }).validation;

  it("the first invoice's number is confirmed: nothing earlier from this supplier is like it", async () => {
    await save("inv-1", "INV-100", 500);
    const v = await validation("inv-1");
    expect(v.confirms).toContainEqual({ check: "duplicate", fields: ["BT-1"] });
    expect((v.involves ?? []).some((i) => i.check === "duplicate")).toBe(false);
  });

  it("a second with the same number from the same supplier is a warning on its number", async () => {
    await save("inv-1", "INV-100", 500);
    await save("inv-2", "INV-100", 500);
    expect(POSSIBLE_DUPLICATE_THRESHOLD).toBeLessThanOrEqual(0.6);
    const v = await validation("inv-2");
    expect(v.involves).toContainEqual(expect.objectContaining({ check: "duplicate", severity: "warning" }));
    expect((v.confirms ?? []).some((c) => c.check === "duplicate")).toBe(false);
  });
});

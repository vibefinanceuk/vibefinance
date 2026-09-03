import { describe, expect, it } from "vitest";
import { applySetFieldActions } from "../src/set-field.js";
import type { RuleAction } from "@vibefinance/shared";

const setField = (params: Record<string, unknown>): RuleAction =>
  ({ type: "set_field", params }) as RuleAction;

describe("applySetFieldActions — literals", () => {
  it("sets a field that had no value", () => {
    const out = applySetFieldActions({}, [setField({ field: "BT-133", value: "CC-100" })], "r1");
    expect(out.facts["BT-133"]).toBe("CC-100");
  });

  it("records a set with no previous value, distinguishably from an overwrite", () => {
    // Setting a field and overwriting one are different acts, and the
    // second is the more consequential — the record keeps them apart.
    const out = applySetFieldActions({}, [setField({ field: "BT-133", value: "CC-100" })], "r1");
    expect(out.overrides).toEqual([{ ruleId: "r1", field: "BT-133", newValue: "CC-100" }]);
    expect(out.overrides[0]).not.toHaveProperty("previousValue");
  });

  it("records an overwrite with the value it replaced", () => {
    // The auditor's question: what did this invoice say before a rule
    // touched it?
    const out = applySetFieldActions(
      { "BT-112": 2272.47 },
      [setField({ field: "BT-112", value: 3137.47 })],
      "r1"
    );
    expect(out.overrides).toEqual([
      { ruleId: "r1", field: "BT-112", previousValue: 2272.47, newValue: 3137.47 },
    ]);
  });

  it("never mutates the facts it was given", () => {
    const original = { "BT-112": 2272.47 };
    applySetFieldActions(original, [setField({ field: "BT-112", value: 3137.47 })], "r1");
    expect(original["BT-112"]).toBe(2272.47);
  });

  it("records nothing when the value is unchanged", () => {
    // Filling the audit trail with non-changes would make the real
    // ones harder to find.
    const out = applySetFieldActions(
      { "BT-112": 3137.47 },
      [setField({ field: "BT-112", value: 3137.47 })],
      "r1"
    );
    expect(out.overrides).toEqual([]);
  });

  it("handles numbers, strings and booleans", () => {
    const out = applySetFieldActions(
      {},
      [
        setField({ field: "BT-112", value: 100 }),
        setField({ field: "BT-1", value: "INV-1" }),
        setField({ field: "po.matched", value: true }),
      ],
      "r1"
    );
    expect(out.facts["BT-112"]).toBe(100);
    expect(out.facts["BT-1"]).toBe("INV-1");
    expect(out.facts["po.matched"]).toBe(true);
  });
});

describe("applySetFieldActions — copying another field", () => {
  it("copies a value across", () => {
    const out = applySetFieldActions(
      { "BT-106": 3137.47 },
      [setField({ field: "BT-112", fromField: "BT-106" })],
      "r1"
    );
    expect(out.facts["BT-112"]).toBe(3137.47);
  });

  it("sets nothing when the source field holds nothing", () => {
    // Writing undefined would turn "we could not read this" into "a
    // rule decided it was empty" — different claims about the
    // document.
    const out = applySetFieldActions(
      { "BT-112": 2272.47 },
      [setField({ field: "BT-112", fromField: "BT-106" })],
      "r1"
    );
    expect(out.facts["BT-112"]).toBe(2272.47);
    expect(out.overrides).toEqual([]);
  });

  it("copies the value as it stands when the action runs", () => {
    const out = applySetFieldActions(
      { "BT-106": 100 },
      [
        setField({ field: "BT-106", value: 200 }),
        setField({ field: "BT-112", fromField: "BT-106" }),
      ],
      "r1"
    );
    // The second action sees the first's result — actions within one
    // rule apply in order.
    expect(out.facts["BT-112"]).toBe(200);
  });
});

describe("applySetFieldActions — ordering and attribution", () => {
  it("applies several actions in written order, recording each", () => {
    const out = applySetFieldActions(
      { "BT-112": 1 },
      [setField({ field: "BT-112", value: 2 }), setField({ field: "BT-112", value: 3 })],
      "r1"
    );
    expect(out.facts["BT-112"]).toBe(3);
    // Both recorded: the record shows the sequence rather than hiding
    // the first behind the second.
    expect(out.overrides.map((o) => o.newValue)).toEqual([2, 3]);
  });

  it("attributes every override to the rule that fired it", () => {
    const out = applySetFieldActions({}, [setField({ field: "BT-133", value: "X" })], "rule-abc");
    expect(out.overrides[0].ruleId).toBe("rule-abc");
  });

  it("ignores actions that are not set_field", () => {
    const out = applySetFieldActions(
      {},
      [{ type: "flag", params: {} } as RuleAction, setField({ field: "BT-133", value: "X" })],
      "r1"
    );
    expect(out.overrides).toHaveLength(1);
  });

  it("skips a malformed action rather than throwing", () => {
    // validateRule refuses these at compile time; this is the
    // belt-and-braces case of one reaching evaluation anyway.
    const out = applySetFieldActions(
      { "BT-112": 1 },
      [setField({ value: "no field named" }), setField({ field: "BT-112" })],
      "r1"
    );
    expect(out.overrides).toEqual([]);
    expect(out.facts["BT-112"]).toBe(1);
  });
});

describe("applySetFieldActions — the target field's declared type is enforced", () => {
  it("coerces a numeric string into a number field", () => {
    // Found by reading generated worked examples: the model gave an
    // alternative total as the string "1185.00" for a field declared
    // number. Unambiguously the number a document printed, so
    // refusing it would reject a correct value on a formatting
    // technicality.
    const out = applySetFieldActions({}, [setField({ field: "BT-112", value: "1185.00" })], "r1");
    expect(out.facts["BT-112"]).toBe(1185);
    expect(typeof out.facts["BT-112"]).toBe("number");
  });

  it("records the coerced value, not the string it arrived as", () => {
    const out = applySetFieldActions({}, [setField({ field: "BT-112", value: "1185.00" })], "r1");
    expect(out.overrides[0].newValue).toBe(1185);
  });

  it("refuses prose in a number field rather than writing it", () => {
    // A string in a numeric field is the silent-never-fires bug
    // decision 0041's type system exists to prevent: a downstream
    // greater_than would simply stop matching, with no error
    // anywhere.
    const out = applySetFieldActions(
      { "BT-112": 100 },
      [setField({ field: "BT-112", value: "approximately 500" })],
      "r1"
    );
    expect(out.facts["BT-112"]).toBe(100);
    expect(out.overrides).toEqual([]);
  });

  it("refuses a non-ISO date", () => {
    const out = applySetFieldActions({}, [setField({ field: "BT-2", value: "03/04/2026" })], "r1");
    expect(out.facts["BT-2"]).toBeUndefined();
    expect(out.overrides).toEqual([]);
  });

  it("accepts an ISO date", () => {
    const out = applySetFieldActions({}, [setField({ field: "BT-2", value: "2026-07-22" })], "r1");
    expect(out.facts["BT-2"]).toBe("2026-07-22");
  });

  it("refuses a non-boolean in a boolean field", () => {
    const out = applySetFieldActions({}, [setField({ field: "po.matched", value: "yes" })], "r1");
    expect(out.overrides).toEqual([]);
  });

  it("enforces the type when copying too, not only on literals", () => {
    const out = applySetFieldActions(
      { "BT-1": "INV-2026-0042" },
      [setField({ field: "BT-112", fromField: "BT-1" })],
      "r1"
    );
    // An invoice number is text; it cannot become a total.
    expect(out.facts["BT-112"]).toBeUndefined();
    expect(out.overrides).toEqual([]);
  });

  it("permits any value for a field with no declared type", () => {
    // An honest "cannot say" rather than a guess. BG-20 is a
    // document-level group, deliberately untyped.
    const out = applySetFieldActions({}, [setField({ field: "BG-20", value: "anything" })], "r1");
    expect(out.facts["BG-20"]).toBe("anything");
  });
});

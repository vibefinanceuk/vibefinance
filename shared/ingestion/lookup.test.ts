import { describe, expect, it } from "vitest";
import { buildFunctionPrompt, compileFunction } from "./function-compiler.js";
import { applyMapping, listsInMapping, type MappingDefinition } from "./mapping-engine.js";
import { applyChain, FUNCTION_NAMES, listsInChain, lookupKey, validateChain, type FnContext } from "./mapping-functions.js";
import { mappableXml } from "./supplier-csv.js";

/**
 * **The customer's own look-up lists — decision 0568.** `look_up` reads a
 * list the caller loaded; the functions never reach a database. A value
 * not in the list is refused in words, or kept for the next step.
 */

const UNITS: FnContext = {
  lookups: {
    "LL-UNITS": { name: "Units", entries: { rolle: "RO", karton: "CT", stk: "H87" } },
    "LL-ART": { name: "Lager Nord articles", entries: { palettenregal: "ACME-4711" } },
  },
};

describe("look_up", () => {
  it("gives what the list says, whatever the case or spaces", () => {
    expect(applyChain([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "refuse" } }], " Rolle ", UNITS)).toEqual({ ok: true, value: "RO" });
    expect(lookupKey("  KARTON ")).toBe("karton");
  });

  it("refuses a value not in the list, naming the list, or keeps it for the next step", () => {
    expect(applyChain([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "refuse" } }], "Beutel", UNITS)).toEqual({
      ok: false,
      reason: '"Beutel" is not in the list Units',
    });
    // Kept, then the built-in units function reads it.
    const chain = [
      { fn: "look_up" as const, args: { list: "LL-UNITS", otherwise: "keep" } },
      { fn: "unit_code" as const },
    ];
    expect(applyChain(chain, "kg", UNITS)).toEqual({ ok: true, value: "KGM" });
    expect(applyChain(chain, "Rolle", UNITS)).toEqual({ ok: true, value: "RO" });
  });

  it("says so when the list is not there, as when it was retired", () => {
    expect(applyChain([{ fn: "look_up", args: { list: "LL-GONE", otherwise: "refuse" } }], "Rolle", UNITS)).toEqual({
      ok: false,
      reason: 'the look-up list "LL-GONE" is not available: it may have been retired',
    });
    expect(applyChain([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "refuse" } }], "Rolle")).toMatchObject({ ok: false });
  });

  it("is in the closed vocabulary, with otherwise refuse or keep", () => {
    expect(FUNCTION_NAMES).toContain("look_up");
    expect(validateChain([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "keep" } }])).toBeNull();
    expect(validateChain([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "guess" } }])).toBe("look_up's otherwise is refuse, keep or unless_empty");
    expect(validateChain([{ fn: "look_up", args: { list: "LL-UNITS" } }])).toBe("look_up needs otherwise");
  });

  it("names the lists a chain and a mapping use", () => {
    const def: MappingDefinition = {
      root: "CSV",
      linesPath: "CSV/Row",
      csv: { delimiter: ";", header: true, skip: 0 },
      lines: [
        { target: "BT-130", source: "Einheit", fx: [{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "keep" } }, { fn: "unit_code" }] },
        { target: "BT-155", source: "Artikel", fx: [{ fn: "look_up", args: { list: "LL-ART", otherwise: "refuse" } }] },
        { target: "BT-153", source: "Artikel", fx: [] },
      ],
    };
    expect(listsInChain(def.lines[0].fx)).toEqual(["LL-UNITS"]);
    expect(listsInMapping(def)).toEqual(["LL-UNITS", "LL-ART"]);
  });
});

describe("look_up in a mapping", () => {
  const CSV = "Pos;Artikel;Menge;Einheit\n1;Palettenregal;4;Stk\n2;Stretchfolie;6;Rolle\n3;Kiste;1;Beutel";
  const def: MappingDefinition = {
    root: "CSV",
    linesPath: "CSV/Row",
    csv: { delimiter: ";", header: true, skip: 0 },
    lines: [{ target: "BT-130", source: "Einheit", fx: [{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "keep" } }, { fn: "unit_code" }] }],
  };

  it("reads each line's unit through the list, and names the line whose unit neither knows", () => {
    const applied = applyMapping(mappableXml(CSV, def), def, UNITS);
    expect(applied.lines.map((l) => l["BT-130"])).toEqual(["H87", "RO", undefined]);
    expect(applied.problems).toEqual([
      expect.objectContaining({ target: "BT-130", line: 3, value: "Beutel", reason: '"Beutel" is not a unit this function knows' }),
    ]);
  });
});

describe("compiling a look-up", () => {
  const lists = [{ id: "LL-UNITS", name: "Units", examples: [["Rolle", "RO"], ["Karton", "CT"]] as Array<[string, string]> }];

  it("tells the model the customer's lists by id and name, with examples, or that there are none", () => {
    const prompt = buildFunctionPrompt("look it up in Units", { target: "BT-130", targetName: "Unit", kind: "text", samples: ["Rolle"], lists });
    expect(prompt).toContain('- "LL-UNITS": Units, for example "Rolle" becomes "RO", "Karton" becomes "CT"');
    const none = buildFunctionPrompt("look it up in Units", { target: "BT-130", targetName: "Unit", kind: "text", samples: [] });
    expect(none).toContain("(none: look_up cannot be used, so refuse an instruction that needs a list)");
  });

  it("gives worked examples through the list, and refuses a list the customer does not have", async () => {
    const answer = (steps: unknown) => ({ compile: async () => JSON.stringify({ steps }) }) as never;
    const compiled = await compileFunction(answer([{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "refuse" } }]), "look it up in Units", {
      target: "BT-130",
      targetName: "Unit",
      kind: "text",
      samples: ["Rolle", "Beutel"],
      lists,
      ctx: UNITS,
    });
    expect(compiled).toEqual({
      kind: "compiled",
      steps: [{ fn: "look_up", args: { list: "LL-UNITS", otherwise: "refuse" } }],
      examples: [
        { input: "Rolle", output: "RO" },
        { input: "Beutel", reason: '"Beutel" is not in the list Units' },
      ],
    });
    const invented = await compileFunction(answer([{ fn: "look_up", args: { list: "Units", otherwise: "refuse" } }]), "look it up in Units", {
      target: "BT-130",
      targetName: "Unit",
      kind: "text",
      samples: ["Rolle"],
      lists,
      ctx: UNITS,
    });
    expect(invented).toEqual({ kind: "refused", reason: 'There is no look-up list "Units". Make it on the Routes screen first.' });
  });
});

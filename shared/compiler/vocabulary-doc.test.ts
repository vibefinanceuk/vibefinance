import { describe, expect, it } from "vitest";
import { buildVocabularyDoc } from "./vocabulary-doc.js";
import { resolveVocabulary } from "../interpreter/vocabulary.js";

describe("buildVocabularyDoc — types and customer fields (decision 0041)", () => {
  it("renders each field's declared type, so the model can choose a valid operator", () => {
    const doc = buildVocabularyDoc("invoice");
    expect(doc).toContain("BT-1 (text)");
    expect(doc).toContain("BT-112 (number)");
    expect(doc).toContain("BT-9 (date)");
  });

  it("renders no customer section at all when none are declared", () => {
    const doc = buildVocabularyDoc("invoice");
    expect(doc).not.toContain("FIELDS THIS CUSTOMER HAS DEFINED");
  });

  it("renders declared customer fields in their own clearly-labelled section", () => {
    const v = resolveVocabulary("invoice", [
      {
        key: "custom.transport_reference",
        label: "Transport Reference",
        type: "text",
        description: "The carrier consignment reference",
      },
    ]);
    const doc = buildVocabularyDoc(v);
    expect(doc).toContain("FIELDS THIS CUSTOMER HAS DEFINED THEMSELVES");
    expect(doc).toContain("custom.transport_reference (text) — The carrier consignment reference");
  });

  it("keeps customer fields OUT of the standard field list — the distinction the closed vocabulary exists to hold", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.x", label: "X", type: "text", description: "a custom one" },
    ]);
    const doc = buildVocabularyDoc(v);
    const standardSection = doc.slice(0, doc.indexOf("FIELDS THIS CUSTOMER HAS DEFINED"));
    expect(standardSection).not.toContain("custom.x");
  });

  it("tells the model plainly that customer descriptions are not the standard's", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.x", label: "X", type: "text", description: "a custom one" },
    ]);
    expect(buildVocabularyDoc(v)).toContain("not part of any standard");
  });
});

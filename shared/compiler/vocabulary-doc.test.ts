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

describe("a third vocabulary, supplier (decision 0350) — proves the headings generalise, not just invoice/expense", () => {
  it("renders its own heading, not expense's own by fallthrough", () => {
    const doc = buildVocabularyDoc("supplier");
    expect(doc).toContain("SUPPLIER FIELDS:");
    expect(doc).not.toContain("EXPENSE FIELDS:");
  });

  it("renders its own fields with their declared types", () => {
    const doc = buildVocabularyDoc("supplier");
    expect(doc).toContain("reason (text)");
    expect(doc).toContain("changed_fields (text)");
  });

  it("renders no empty PLATFORM-DERIVED heading at all, since it has no derived fields", () => {
    const doc = buildVocabularyDoc("supplier");
    expect(doc).not.toContain("PLATFORM-DERIVED FIELDS");
  });

  it("still renders the invoice and expense vocabularies exactly as before — the fix changed nothing for either", () => {
    const invoiceDoc = buildVocabularyDoc("invoice");
    expect(invoiceDoc).toContain("INVOICE FIELDS (from the standard):");
    expect(invoiceDoc).toContain("PLATFORM-DERIVED FIELDS (never invoice data, always platform-computed):");

    const expenseDoc = buildVocabularyDoc("expense");
    expect(expenseDoc).toContain("EXPENSE FIELDS:");
    expect(expenseDoc).toContain("PLATFORM-DERIVED FIELDS (never submitted by the employee, always platform-computed):");
  });
});

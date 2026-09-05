import { describe, expect, it } from "vitest";
import {
  ISO_4217,
  UNECE_REC20_COMMON,
  UNCL5305_VAT_CATEGORY,
  FIELD_CODE_LISTS,
  CODE_LISTS,
  isValidCode,
  isClosedList,
} from "./code-lists.js";
import { INVOICE_FIELDS } from "../interpreter/vocabulary.js";

describe("the lists are the standard's, not ours", () => {
  it("records the agency and version of each", () => {
    // "Which ISO 4217" is a real question when a currency is added or
    // withdrawn, and a list without a version cannot answer it.
    for (const list of CODE_LISTS) {
      expect(list.agency, list.id).toBeTruthy();
      expect(list.version, list.id).toBeTruthy();
    }
  });

  it("carries ISO 4217 as Peppol publishes it", () => {
    expect(ISO_4217.agency).toBe("ISO");
    expect(ISO_4217.version).toBe("2018-01-01");
    // Transcribed from the Peppol code list rather than a general ISO
    // source, because Peppol's own subset is what a document is
    // validated against.
    expect(ISO_4217.codes.length).toBeGreaterThan(170);
  });

  it("has no duplicate codes in any list", () => {
    for (const list of CODE_LISTS) {
      const codes = list.codes.map(([code]) => code);
      expect(new Set(codes).size, list.id).toBe(codes.length);
    }
  });

  it("gives every code a name somebody could read", () => {
    // A dropdown of bare codes is a dropdown nobody can use: `C62`
    // means nothing without "One (unit)" beside it.
    for (const list of CODE_LISTS) {
      for (const [code, name] of list.codes) {
        expect(name.trim(), `${list.id}/${code}`).not.toBe("");
        expect(name, `${list.id}/${code}`).not.toBe(code);
      }
    }
  });
});

describe("which field takes which list", () => {
  it("maps only fields the vocabulary declares", () => {
    // A list against a field nothing can produce is a dropdown nobody
    // will see — the same class of gap `field-coverage.test.ts` guards.
    for (const field of Object.keys(FIELD_CODE_LISTS)) {
      expect(INVOICE_FIELDS as readonly string[], field).toContain(field);
    }
  });

  it("covers currency, unit of measure and VAT category", () => {
    expect(FIELD_CODE_LISTS["BT-5"]).toBe(ISO_4217);
    expect(FIELD_CODE_LISTS["BT-130"]).toBe(UNECE_REC20_COMMON);
    expect(FIELD_CODE_LISTS["BT-151"]).toBe(UNCL5305_VAT_CATEGORY);
  });

  it("leaves fields the standard does not close alone", () => {
    // Adding one here would invent a restriction Peppol does not make.
    expect(FIELD_CODE_LISTS["BT-1"]).toBeUndefined();
    expect(FIELD_CODE_LISTS["BT-153"]).toBeUndefined();
  });
});

describe("checking a value", () => {
  it("accepts a real code and refuses one that is not", () => {
    expect(isValidCode("BT-5", "EUR")).toBe(true);
    expect(isValidCode("BT-5", "GBP")).toBe(true);
    // The value somebody types when a dropdown does not exist.
    expect(isValidCode("BT-5", "EURO")).toBe(false);
    expect(isValidCode("BT-5", "eur")).toBe(false);
  });

  it("accepts anything for a field with no list", () => {
    // "Not restricted" is not the same as "invalid", and most fields
    // are the former.
    expect(isValidCode("BT-1", "INV-2026-0042")).toBe(true);
    expect(isValidCode("BT-153", "anything at all")).toBe(true);
  });

  it("refuses a non-string where a code is required", () => {
    expect(isValidCode("BT-5", 42)).toBe(false);
    expect(isValidCode("BT-5", null)).toBe(false);
  });

  it("knows the VAT categories that shift who accounts for the tax", () => {
    // AE and K move the liability; E demands an exemption reason.
    for (const code of ["S", "Z", "E", "AE", "K"]) {
      expect(isValidCode("BT-151", code), code).toBe(true);
    }
    expect(isValidCode("BT-151", "X")).toBe(false);
  });
});

describe("a subset is not a closed list, and says so", () => {
  it("calls currency and VAT category closed", () => {
    expect(isClosedList("BT-5")).toBe(true);
    expect(isClosedList("BT-151")).toBe(true);
  });

  it("does not call the unit list closed", () => {
    // Recommendation 20 runs to hundreds of codes and this carries the
    // ones in ordinary use. A code outside it may still be a real unit,
    // so validation must not refuse a document for using one.
    expect(isClosedList("BT-130")).toBe(false);
    // Even though the common ones are there.
    expect(isValidCode("BT-130", "HUR")).toBe(true);
  });

  it("calls a field with no list not closed", () => {
    expect(isClosedList("BT-1")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { INVOICE_PROFILES, PROFILE_DESCRIPTIONS, isKnownInvoiceProfile } from "./profiles.js";
import type { InvoiceProfile } from "./profiles.js";

describe("isKnownInvoiceProfile", () => {
  it("accepts every profile in the closed list", () => {
    for (const profile of INVOICE_PROFILES) {
      expect(isKnownInvoiceProfile(profile)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isKnownInvoiceProfile("made_up_profile")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isKnownInvoiceProfile(undefined)).toBe(false);
    expect(isKnownInvoiceProfile(null)).toBe(false);
    expect(isKnownInvoiceProfile(42)).toBe(false);
    expect(isKnownInvoiceProfile({})).toBe(false);
  });
});

describe("PROFILE_DESCRIPTIONS — completeness", () => {
  it("has a non-empty description for every profile in the closed list, and nothing extra", () => {
    // Catches the exact kind of drift the migration's own comment
    // warns about: INVOICE_PROFILES and the SQL CHECK constraint are two
    // separate lists a future edit has to update together by hand.
    // This test at least confirms this file's own two exports agree
    // with each other.
    const describedKeys = Object.keys(PROFILE_DESCRIPTIONS) as InvoiceProfile[];
    expect(describedKeys.sort()).toEqual([...INVOICE_PROFILES].sort());
    for (const profile of INVOICE_PROFILES) {
      expect(PROFILE_DESCRIPTIONS[profile].length).toBeGreaterThan(0);
    }
  });
});

describe("the profile list does not claim every entry is a CIUS (decision 0065)", () => {
  it("says plainly that FatturaPA is not one", () => {
    // The old constant name asserted something one of its own entries
    // contradicted. A CIUS constrains EN 16931 rather than replacing
    // it, which is why Peppol BIS, XRechnung and Factur-X need no
    // vocabulary of their own — and why a format outside EN 16931 might.
    expect(PROFILE_DESCRIPTIONS.fatturapa).toContain("Not a CIUS");
  });

  it("still describes the genuine CIUS entries as such", () => {
    expect(PROFILE_DESCRIPTIONS.peppol_bis_billing_3).toContain("CIUS");
    expect(PROFILE_DESCRIPTIONS.xrechnung).toContain("CIUS");
    expect(PROFILE_DESCRIPTIONS.factur_x).toContain("CIUS");
  });

  it("keeps the stored values unchanged, so no data migration is implied", () => {
    // The rename is TypeScript only. The migration's CHECK constrains
    // these strings, and a customer's stored profile must keep matching.
    expect([...INVOICE_PROFILES]).toEqual([
      "peppol_bis_billing_3",
      "xrechnung",
      "factur_x",
      "fatturapa",
      "en16931_base",
    ]);
  });
});

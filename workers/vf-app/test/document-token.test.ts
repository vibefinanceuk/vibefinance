import { describe, expect, it } from "vitest";
import {
  mintDocumentToken,
  verifyDocumentToken,
  mintPageToken,
  verifyPageToken,
  TOKEN_TTL_SECONDS,
} from "../src/document-token.js";

const SECRET = "a-real-looking-secret-value-for-testing";
const NOW = 1_760_000_000;

describe("minting and verifying a document token", () => {
  it("round-trips, yielding the invoice and document type it was minted for", async () => {
    // **The document type travels with the token now** — decision
    // 0273, so `/documents/:token` never has to re-derive "which
    // document" and risk disagreeing with the choice already made at
    // mint time.
    const { token } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW)).toEqual({
      valid: true,
      invoiceId: "inv-1",
      documentType: "original",
    });
  });

  it("round-trips the other document type just as well", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", "generated_rendering", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW)).toEqual({
      valid: true,
      invoiceId: "inv-1",
      documentType: "generated_rendering",
    });
  });

  it("expires within minutes, not hours", async () => {
    // A window left open across a split screen is the use case; a token
    // that outlives the task is a credential sitting in a URL bar.
    const { expiresAt } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    expect(expiresAt - NOW).toBe(TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("rejects a token past its expiry", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW + TOKEN_TTL_SECONDS)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts it one second before", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    const result = await verifyDocumentToken(SECRET, token, NOW + TOKEN_TTL_SECONDS - 1);
    expect(result.valid).toBe(true);
  });
});

describe("forgery and tampering", () => {
  it("rejects a token signed with a different secret", async () => {
    const { token } = await mintDocumentToken("some-other-secret", "inv-1", "original", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose invoice was swapped after signing", async () => {
    // The attack the signature exists to prevent: a valid token for a
    // document you may see, edited to name one you may not.
    const { token } = await mintDocumentToken(SECRET, "inv-mine", "original", NOW);
    const [, documentType, expiry, sig] = token.split(".");
    const forged = `inv-theirs.${documentType}.${expiry}.${sig}`;
    expect(await verifyDocumentToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose document type was swapped after signing", async () => {
    // **The new attack this token shape makes possible, and refuses**
    // — decision 0273. A token signed for the generated rendering must
    // not be edited to fetch the original instead, or vice versa.
    const { token } = await mintDocumentToken(SECRET, "inv-1", "generated_rendering", NOW);
    const [invoiceId, , expiry, sig] = token.split(".");
    const forged = `${invoiceId}.original.${expiry}.${sig}`;
    expect(await verifyDocumentToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose expiry was extended after signing", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    const [id, documentType, , sig] = token.split(".");
    const forged = `${id}.${documentType}.${NOW + 999999}.${sig}`;
    expect(await verifyDocumentToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("reports a bad signature rather than expiry when both are wrong", async () => {
    // Reporting "expired" for a token that was never validly signed
    // would tell an attacker their forgery was structurally right and
    // only mistimed.
    const { token } = await mintDocumentToken("other-secret", "inv-1", "original", NOW);
    const result = await verifyDocumentToken(SECRET, token, NOW + 99999);
    expect(result).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects an unrecognised document type even with a well-formed signature shape", async () => {
    for (const bad of ["", "nonsense", "a.b", "a.b.c.d.e", "inv.notatype.123.sig", "inv.original.notanumber.sig"]) {
      const result = await verifyDocumentToken(SECRET, bad, NOW);
      expect(result.valid).toBe(false);
    }
  });
});

describe("minting and verifying a page token (decision 0381)", () => {
  it("round-trips, yielding the invoice and page number it was minted for", async () => {
    // A separate token shape from mintDocumentToken's, deliberately —
    // a page is not a DocumentType. The leading "page" literal is what
    // tells the two shapes apart at a glance.
    const { token } = await mintPageToken(SECRET, "inv-1", 2, NOW);
    expect(token.startsWith("page.")).toBe(true);
    expect(await verifyPageToken(SECRET, token, NOW)).toEqual({
      valid: true,
      invoiceId: "inv-1",
      pageNumber: 2,
    });
  });

  it("expires within minutes, not hours, same as a document token", async () => {
    const { expiresAt } = await mintPageToken(SECRET, "inv-1", 1, NOW);
    expect(expiresAt - NOW).toBe(TOKEN_TTL_SECONDS);
  });

  it("rejects a token past its expiry", async () => {
    const { token } = await mintPageToken(SECRET, "inv-1", 1, NOW);
    expect(await verifyPageToken(SECRET, token, NOW + TOKEN_TTL_SECONDS)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts it one second before", async () => {
    const { token } = await mintPageToken(SECRET, "inv-1", 1, NOW);
    const result = await verifyPageToken(SECRET, token, NOW + TOKEN_TTL_SECONDS - 1);
    expect(result.valid).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await mintPageToken("some-other-secret", "inv-1", 1, NOW);
    expect(await verifyPageToken(SECRET, token, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose invoice was swapped after signing", async () => {
    const { token } = await mintPageToken(SECRET, "inv-mine", 1, NOW);
    const [prefix, , pageNumber, expiry, sig] = token.split(".");
    const forged = `${prefix}.inv-theirs.${pageNumber}.${expiry}.${sig}`;
    expect(await verifyPageToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose page number was swapped after signing", async () => {
    // The attack specific to this token shape: a link to a page you
    // may see, edited to name one you may not.
    const { token } = await mintPageToken(SECRET, "inv-1", 1, NOW);
    const [prefix, invoiceId, , expiry, sig] = token.split(".");
    const forged = `${prefix}.${invoiceId}.2.${expiry}.${sig}`;
    expect(await verifyPageToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose expiry was extended after signing", async () => {
    const { token } = await mintPageToken(SECRET, "inv-1", 1, NOW);
    const [prefix, invoiceId, pageNumber, , sig] = token.split(".");
    const forged = `${prefix}.${invoiceId}.${pageNumber}.${NOW + 999999}.${sig}`;
    expect(await verifyPageToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("reports a bad signature rather than expiry when both are wrong", async () => {
    const { token } = await mintPageToken("other-secret", "inv-1", 1, NOW);
    const result = await verifyPageToken(SECRET, token, NOW + 99999);
    expect(result).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects malformed input, including a document token presented as a page token", async () => {
    // A document token has 4 dot-parts and no "page" prefix; a page
    // token has 5 and one. Neither should be readable as the other.
    const { token: documentToken } = await mintDocumentToken(SECRET, "inv-1", "original", NOW);
    for (const bad of [
      "",
      "nonsense",
      "page.a.b",
      "page.inv-1.notanumber.123.sig",
      "page.inv-1.0.123.sig",
      "page.inv-1.-1.123.sig",
      documentToken,
    ]) {
      const result = await verifyPageToken(SECRET, bad, NOW);
      expect(result.valid, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });
});

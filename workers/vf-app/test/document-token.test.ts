import { describe, expect, it } from "vitest";
import { mintDocumentToken, verifyDocumentToken, TOKEN_TTL_SECONDS } from "../src/document-token.js";

const SECRET = "a-real-looking-secret-value-for-testing";
const NOW = 1_760_000_000;

describe("minting and verifying a document token", () => {
  it("round-trips, yielding the invoice it was minted for", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW)).toEqual({ valid: true, invoiceId: "inv-1" });
  });

  it("expires within minutes, not hours", async () => {
    // A window left open across a split screen is the use case; a token
    // that outlives the task is a credential sitting in a URL bar.
    const { expiresAt } = await mintDocumentToken(SECRET, "inv-1", NOW);
    expect(expiresAt - NOW).toBe(TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("rejects a token past its expiry", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW + TOKEN_TTL_SECONDS)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts it one second before", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", NOW);
    const result = await verifyDocumentToken(SECRET, token, NOW + TOKEN_TTL_SECONDS - 1);
    expect(result.valid).toBe(true);
  });
});

describe("forgery and tampering", () => {
  it("rejects a token signed with a different secret", async () => {
    const { token } = await mintDocumentToken("some-other-secret", "inv-1", NOW);
    expect(await verifyDocumentToken(SECRET, token, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose invoice was swapped after signing", async () => {
    // The attack the signature exists to prevent: a valid token for a
    // document you may see, edited to name one you may not.
    const { token } = await mintDocumentToken(SECRET, "inv-mine", NOW);
    const [, expiry, sig] = token.split(".");
    const forged = `inv-theirs.${expiry}.${sig}`;
    expect(await verifyDocumentToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects a token whose expiry was extended after signing", async () => {
    const { token } = await mintDocumentToken(SECRET, "inv-1", NOW);
    const [id, , sig] = token.split(".");
    const forged = `${id}.${NOW + 999999}.${sig}`;
    expect(await verifyDocumentToken(SECRET, forged, NOW)).toEqual({ valid: false, reason: "bad signature" });
  });

  it("reports a bad signature rather than expiry when both are wrong", async () => {
    // Reporting "expired" for a token that was never validly signed
    // would tell an attacker their forgery was structurally right and
    // only mistimed.
    const { token } = await mintDocumentToken("other-secret", "inv-1", NOW);
    const result = await verifyDocumentToken(SECRET, token, NOW + 99999);
    expect(result).toEqual({ valid: false, reason: "bad signature" });
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of ["", "nonsense", "a.b", "a.b.c.d", "inv.notanumber.sig"]) {
      const result = await verifyDocumentToken(SECRET, bad, NOW);
      expect(result.valid).toBe(false);
    }
  });
});

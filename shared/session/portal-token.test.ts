import { beforeAll, describe, expect, it } from "vitest";
import { signJws, signSessionToken, verifySessionToken } from "./token.js";
import {
  PORTAL_ACCESS_TTL_SECONDS,
  signPortalToken,
  verifyPortalAccess,
  verifyPortalSession,
  type PortalAccessClaims,
  type PortalSessionClaims,
} from "./portal-token.js";

/**
 * **Supplier portal tokens — decision 0713.** Same fleet key as staff
 * sessions; never accepted as one, and never as each other.
 */

let privateKey: JsonWebKey;
let publicKey: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

const NOW = new Date("2026-10-10T12:00:00.000Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

const session = (o: Partial<PortalSessionClaims> = {}): PortalSessionClaims => ({
  kind: "portal_session",
  email: "jo@lager-nord.example",
  supplierOrgId: "so-1",
  issuedAt: NOW.toISOString(),
  expiresAt: later(3600),
  ...o,
});

const access = (o: Partial<PortalAccessClaims> = {}): PortalAccessClaims => ({
  kind: "portal_access",
  email: "jo@lager-nord.example",
  supplierOrgId: "so-1",
  linkId: "pl-1",
  environmentId: "acme-prod",
  supplierId: "sup-ln",
  orgUnitIds: ["acme-uk"],
  issuedAt: NOW.toISOString(),
  expiresAt: later(PORTAL_ACCESS_TTL_SECONDS),
  ...o,
});

describe("portal tokens", () => {
  it("round-trip, each as its own kind", async () => {
    const s = await signPortalToken(session(), privateKey);
    expect(await verifyPortalSession(s, publicKey, NOW)).toEqual({ ok: true, claims: session() });
    const a = await signPortalToken(access(), privateKey);
    expect(await verifyPortalAccess(a, publicKey, "acme-prod", NOW)).toEqual({ ok: true, claims: access() });
  });

  it("are never accepted as a staff session, even carrying an environment and an email", async () => {
    const a = await signPortalToken(access(), privateKey);
    expect(await verifySessionToken(a, publicKey, "acme-prod", NOW)).toMatchObject({ ok: false, reason: "not a staff session token" });
    // Signed as a JWT but carrying a kind: still refused.
    const disguised = await signJws({ ...access(), name: "Jo" }, "JWT", privateKey);
    expect(await verifySessionToken(disguised, publicKey, "acme-prod", NOW)).toMatchObject({ ok: false, reason: "not a staff session token" });
  });

  it("and a staff session is never accepted as either portal kind", async () => {
    const staff = await signSessionToken(
      { email: "dan@acme.example", name: "Dan", environmentId: "acme-prod", issuedAt: NOW.toISOString(), expiresAt: later(3600) },
      privateKey
    );
    expect((await verifyPortalAccess(staff, publicKey, "acme-prod", NOW)).ok).toBe(false);
    expect((await verifyPortalSession(staff, publicKey, NOW)).ok).toBe(false);
  });

  it("a session is not access, and access is not a session", async () => {
    const s = await signPortalToken(session(), privateKey);
    const a = await signPortalToken(access(), privateKey);
    expect((await verifyPortalAccess(s, publicKey, "acme-prod", NOW)).ok).toBe(false);
    expect((await verifyPortalSession(a, publicKey, NOW)).ok).toBe(false);
  });

  it("access is for one instance, expires, and must name at least one company", async () => {
    const a = await signPortalToken(access(), privateKey);
    expect(await verifyPortalAccess(a, publicKey, "globex-prod", NOW)).toMatchObject({ ok: false, reason: "token is for environment acme-prod, not globex-prod" });
    expect((await verifyPortalAccess(a, publicKey, "acme-prod", new Date(NOW.getTime() + 301_000))).ok).toBe(false);
    const none = await signPortalToken(access({ orgUnitIds: [] }), privateKey);
    expect((await verifyPortalAccess(none, publicKey, "acme-prod", NOW)).ok).toBe(false);
  });

  it("refuse a token whose companies were widened after signing", async () => {
    const a = await signPortalToken(access(), privateKey);
    const [h, , sig] = a.split(".");
    const forged = btoa(JSON.stringify(access({ orgUnitIds: ["acme-uk", "acme-ie"] }))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyPortalAccess(`${h}.${forged}.${sig}`, publicKey, "acme-prod", NOW)).toMatchObject({ ok: false, reason: "signature does not verify" });
  });
});

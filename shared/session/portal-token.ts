import { openJws, signJws } from "./token.js";

/**
 * **Supplier portal tokens — decision 0713.** Signed by the same fleet key
 * as staff sessions (decision 0086), but never mistakable for one: their
 * own header `typ`, and a `kind` that `verifySessionToken` refuses.
 *
 * Two kinds, for two audiences:
 *
 * - `portal_session` — the supplier user signed in to the portal. Read by
 *   vf-licence only, to say which customers they are linked to and to
 *   issue the second kind. Names no environment, so no instance accepts it.
 * - `portal_access` — for one customer's instance, one supplier record and
 *   the companies the link covers. Short-lived. The instance takes the
 *   supplier and companies from here, never from the request.
 */

export const PORTAL_TOKEN_TYP = "VF-PORTAL";
/** Long enough for a working session; signing in again is cheap. */
export const PORTAL_SESSION_TTL_SECONDS = 8 * 3600;
/** Minutes, not hours: the portal asks again for each page it draws. */
export const PORTAL_ACCESS_TTL_SECONDS = 300;

export interface PortalSessionClaims {
  kind: "portal_session";
  email: string;
  supplierOrgId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PortalAccessClaims {
  kind: "portal_access";
  email: string;
  supplierOrgId: string;
  linkId: string;
  environmentId: string;
  /** The supplier record in that instance (`suppliers.id`). */
  supplierId: string;
  /** The companies (`org_units.id`) this link may see. Never empty. */
  orgUnitIds: string[];
  issuedAt: string;
  expiresAt: string;
}

export type PortalClaims = PortalSessionClaims | PortalAccessClaims;

export async function signPortalToken(claims: PortalClaims, privateKeyJwk: JsonWebKey): Promise<string> {
  return signJws(claims, PORTAL_TOKEN_TYP, privateKeyJwk);
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function isSession(c: Record<string, unknown>): boolean {
  return c.kind === "portal_session" && nonEmpty(c.email) && nonEmpty(c.supplierOrgId) && nonEmpty(c.issuedAt) && nonEmpty(c.expiresAt);
}

function isAccess(c: Record<string, unknown>): boolean {
  return (
    c.kind === "portal_access" &&
    nonEmpty(c.email) &&
    nonEmpty(c.supplierOrgId) &&
    nonEmpty(c.linkId) &&
    nonEmpty(c.environmentId) &&
    nonEmpty(c.supplierId) &&
    Array.isArray(c.orgUnitIds) &&
    c.orgUnitIds.length > 0 &&
    c.orgUnitIds.every(nonEmpty) &&
    nonEmpty(c.issuedAt) &&
    nonEmpty(c.expiresAt)
  );
}

/** A signed-in supplier user, for vf-licence. */
export async function verifyPortalSession(
  token: string,
  publicKeyJwk: JsonWebKey,
  now: Date = new Date()
): Promise<{ ok: true; claims: PortalSessionClaims } | { ok: false; reason: string }> {
  const opened = await openJws(token, publicKeyJwk);
  if (!opened.ok) return opened;
  const c = opened.claims as Record<string, unknown> | null;
  if (opened.typ !== PORTAL_TOKEN_TYP || !c || typeof c !== "object" || !isSession(c)) return { ok: false, reason: "not a portal session token" };
  if (new Date(String(c.expiresAt)).getTime() <= now.getTime()) return { ok: false, reason: `token expired at ${String(c.expiresAt)}` };
  return { ok: true, claims: c as unknown as PortalSessionClaims };
}

/**
 * A supplier's access to one instance, for that instance. Refused unless it
 * names `expectedEnvironmentId`: one key signs for the whole fleet, so a
 * token for another customer is otherwise indistinguishable.
 */
export async function verifyPortalAccess(
  token: string,
  publicKeyJwk: JsonWebKey,
  expectedEnvironmentId: string,
  now: Date = new Date()
): Promise<{ ok: true; claims: PortalAccessClaims } | { ok: false; reason: string }> {
  const opened = await openJws(token, publicKeyJwk);
  if (!opened.ok) return opened;
  const c = opened.claims as Record<string, unknown> | null;
  if (opened.typ !== PORTAL_TOKEN_TYP || !c || typeof c !== "object" || !isAccess(c)) return { ok: false, reason: "not a portal access token" };
  if (c.environmentId !== expectedEnvironmentId) return { ok: false, reason: `token is for environment ${String(c.environmentId)}, not ${expectedEnvironmentId}` };
  if (new Date(String(c.expiresAt)).getTime() <= now.getTime()) return { ok: false, reason: `token expired at ${String(c.expiresAt)}` };
  return { ok: true, claims: c as unknown as PortalAccessClaims };
}

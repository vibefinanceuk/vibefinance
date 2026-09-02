import { signLicenceToken } from "@vibefinance/shared";
import type { LicenceClaims } from "@vibefinance/shared";
import type { RouteResult } from "./customers-route.js";

/**
 * The token itself is short-lived (default 48h) regardless of how long
 * the underlying licence remains valid — this is what forces the
 * scheduled refresh in vf-app's licence-cache.ts to actually happen
 * periodically, rather than a customer's instance fetching once and
 * never checking in again for a year. The licence's own valid_to is a
 * separate, longer-lived fact; the token expiry is never allowed to
 * exceed it (a licence expiring sooner than the default window
 * shortens the token to match, never the reverse).
 */
const DEFAULT_TOKEN_LIFETIME_MS = 48 * 60 * 60 * 1000;

interface LicenceRow {
  plan: string;
  features_json: string;
  volume_entitlement: number;
  valid_to: string | null;
  status: string;
  status_reason: string | null;
  status_effective_at: string | null;
}

/**
 * Looks up by environmentId now (decision 0036) — a licence belongs
 * to one specific environment, never a customer as a whole.
 *
 * LicenceClaims.customerId (shared/licensing/types.ts) is deliberately
 * NOT renamed here — it's a real, external contract vf-app's own
 * licence-cache.ts already consumes, and renaming it is out of scope
 * for this schema change specifically. Its value is now genuinely an
 * environment id (e.g. "acme-production"), not a bare customer id —
 * stated here plainly rather than left as a silent, undocumented
 * mismatch between the field's name and what it actually holds.
 */
export async function handleIssueToken(
  db: D1Database,
  privateKeyJwk: JsonWebKey,
  environmentId: string,
  now: Date = new Date()
): Promise<RouteResult> {
  const row = await db
    .prepare(
      `SELECT plan, features_json, volume_entitlement, valid_to, status, status_reason, status_effective_at
       FROM licences WHERE environment_id = ?`
    )
    .bind(environmentId)
    .first<LicenceRow>();

  if (!row) {
    return { status: 404, body: { error: `no licence exists for environment ${environmentId}` } };
  }

  const defaultExpiry = new Date(now.getTime() + DEFAULT_TOKEN_LIFETIME_MS);
  const validToDate = row.valid_to ? new Date(row.valid_to) : null;
  const expiresAt =
    validToDate && validToDate.getTime() < defaultExpiry.getTime() ? validToDate : defaultExpiry;

  let features: string[];
  try {
    const parsed = JSON.parse(row.features_json);
    features = Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
  } catch {
    // A malformed features_json is a data problem, not a reason to
    // refuse issuing a token altogether — fail toward the empty set
    // rather than blocking every request for this environment over a
    // stored-data issue that has nothing to do with whether it's
    // entitled to use the product.
    features = [];
  }

  const claims: LicenceClaims = {
    customerId: environmentId,
    plan: row.plan,
    features,
    volumeEntitlement: row.volume_entitlement,
    status: row.status as LicenceClaims["status"],
    statusReason: row.status_reason ?? undefined,
    statusEffectiveAt: row.status_effective_at ?? undefined,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const token = await signLicenceToken(claims, privateKeyJwk);

  return { status: 200, body: { token, expiresAt: claims.expiresAt, status: claims.status } };
}

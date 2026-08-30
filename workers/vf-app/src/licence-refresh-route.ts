import { readLicenceState, refreshLicenceCache } from "./licence-cache.js";
import type { LicenceTokenFetcher } from "./licence-cache.js";

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * POST /licence/refresh — the same fix already applied to usage
 * telemetry (docs/decisions/0004-usage-telemetry.md), for the
 * identical class of problem: the only thing that otherwise populates
 * `licence_cache` is the 6-hourly scheduled() cron, and a freshly
 * deployed or freshly reconfigured instance has no way to force that
 * to happen sooner — found live, the first time a real deploy needed
 * it and the cron genuinely hadn't fired yet.
 *
 * Deliberately NOT licence-gated, and for a sharper reason than
 * /usage/push's: gating this behind isBlocked() would make the
 * bootstrap-blocked state (no cache row at all) permanently
 * unrecoverable via the API — the one thing this endpoint exists to
 * fix is exactly the state the gate would use to block it.
 */
export async function handleLicenceRefresh(
  db: D1Database,
  publicKeyJwk: JsonWebKey,
  fetchToken: LicenceTokenFetcher
): Promise<RouteResult> {
  const result = await refreshLicenceCache(db, publicKeyJwk, fetchToken);
  const state = await readLicenceState(db);
  const currentState = state.known
    ? { known: true, status: state.claims.status, plan: state.claims.plan }
    : { known: false };

  if (!result.refreshed) {
    return { status: 502, body: { status: "not_refreshed", reason: result.reason, currentState } };
  }
  return { status: 200, body: { status: "refreshed", currentState } };
}

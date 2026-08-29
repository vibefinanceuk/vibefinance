import { verifyLicenceToken } from "@vibefinance/shared";
import type { LicenceClaims } from "@vibefinance/shared";

/** A function that returns the raw token text, or throws/rejects on
 * any failure to reach the licence server. Injected rather than a
 * hardcoded `fetch` call so this module is testable without a live
 * network — see docs/decisions/0003-licensing-signed-token.md. */
export type LicenceTokenFetcher = () => Promise<string>;

export type LicenceState = { known: true; claims: LicenceClaims } | { known: false };

export interface RefreshResult {
  refreshed: boolean;
  reason?: string;
}

/**
 * Fetch, verify and cache the licence token. The whole point of this
 * function is what it does on failure: Blueprint, "Settled · the
 * licence server is passive" — "Being unable to reach the licence
 * server and failing to pay are different events, and only the second
 * may ever change behaviour. Silence means carry on, indefinitely."
 *
 * Both a fetch failure (network error, non-2xx) and a verification
 * failure (bad signature, expired, malformed) are treated identically
 * here: the cached state is left untouched. A verification failure is
 * deliberately NOT distinguished from an unreachable server, because a
 * response that fails to verify could be a forgery or corruption in
 * transit — adopting it would be worse than ignoring it, and the
 * Blueprint's "must not silently unlock the paid tier" principle
 * applies just as much to a forged unlock as an absent one.
 */
export async function refreshLicenceCache(
  db: D1Database,
  publicKeyJwk: JsonWebKey,
  fetchToken: LicenceTokenFetcher,
  now: Date = new Date()
): Promise<RefreshResult> {
  let rawToken: string;
  try {
    rawToken = await fetchToken();
  } catch (err) {
    return { refreshed: false, reason: `fetch failed: ${String(err)}` };
  }

  const verified = await verifyLicenceToken(rawToken, publicKeyJwk, now);
  if (!verified.ok || !verified.claims) {
    return { refreshed: false, reason: `verification failed: ${verified.reason}` };
  }

  await db
    .prepare(
      `INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET claims_json = excluded.claims_json, fetched_at = excluded.fetched_at`
    )
    .bind(JSON.stringify(verified.claims), now.toISOString())
    .run();

  return { refreshed: true };
}

export async function readLicenceState(db: D1Database): Promise<LicenceState> {
  const row = await db
    .prepare("SELECT claims_json FROM licence_cache WHERE id = 1")
    .first<{ claims_json: string }>();
  if (!row) return { known: false };
  try {
    return { known: true, claims: JSON.parse(row.claims_json) as LicenceClaims };
  } catch {
    // A cached row that doesn't even parse is no better than no row at
    // all — treated the same as "never successfully cached", not as a
    // crash. This should never happen in practice, since this module is
    // the only writer of this table, but a read path should never
    // trust its own storage blindly.
    return { known: false };
  }
}

/**
 * Whether mutating endpoints should refuse new work. Only an explicit
 * 'blocked' status does — 'warned' is a product-surface concern with no
 * enforcement effect yet (Blueprint's staged block: "notice in the
 * product, then notice with a date, then restriction" — this bundle
 * implements the restriction stage only, not the earlier notice
 * stages). Absent state (never successfully fetched, e.g. a
 * newly-provisioned instance before its first scheduled refresh) is
 * also treated as blocked — a deliberate bootstrap default, not a
 * Blueprint-specified one; see docs/decisions/0003 for the reasoning
 * and what it costs.
 */
export function isBlocked(state: LicenceState): boolean {
  if (!state.known) return true;
  return state.claims.status === "blocked";
}

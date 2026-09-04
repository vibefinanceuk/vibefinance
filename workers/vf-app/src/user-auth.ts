/**
 * Real user authentication for vf-app. See
 * docs/decisions/0010-user-authentication-and-enforcement.md.
 *
 * Deliberately the same generate-once, hash-only-stored, timing-safe-
 * compare pattern already proven twice in workers/vf-licence/src/
 * auth.ts (ADMIN_API_KEY, per-customer keys) — API keys, not
 * passwords or sessions. This product has no login UI to type a
 * password into; a Bearer key is the natural fit, the same reasoning
 * that shaped every other credential in this system so far.
 *
 * This is a deliberate near-duplicate of vf-licence's auth.ts, not an
 * import from a shared module — see the decision doc's own section on
 * why. Both files must be kept in sync by hand if this logic ever
 * needs to change; a future consolidation into shared/ is a
 * reasonable, low-risk cleanup, not done here to avoid touching an
 * already-proven, already-live security module for a DRY-purity
 * concern alone.
 */

import { verifySessionToken } from "@vibefinance/shared";

const KEY_BYTE_LENGTH = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(KEY_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  api_key_hash: string | null;
}

/**
 * Authenticates a request against org_users. Returns the matched
 * user, or null for any failure — no key, no matching hash, or a
 * disabled account. A user with no key configured (api_key_hash is
 * NULL — the state every user is in until a key is generated or
 * rotated) can never authenticate, the same "NULL means cannot
 * authenticate, not open access" principle as vf-licence's
 * isValidCustomerKey.
 *
 * Deliberately scans every active user and compares with
 * timingSafeEqual, consistent with how vf-licence's own
 * isValidCustomerKey does its comparison, rather than a SQL
 * `WHERE api_key_hash = ?` equality lookup — keeps the same
 * application-level comparison pattern across both Workers rather
 * than two different approaches to the same security property. Fine
 * at today's likely user-count scale (a full table scan of active
 * users per request); worth revisiting with an indexed lookup if that
 * changes.
 */
export async function authenticateUser(db: D1Database, request: Request): Promise<AuthenticatedUser | null> {
  const providedKey = extractBearerToken(request);
  if (!providedKey) return null;

  const providedHash = await hashApiKey(providedKey);

  const rows = await db
    .prepare("SELECT id, email, name, api_key_hash FROM org_users WHERE status = 'active'")
    .all<UserRow>();

  for (const row of rows.results) {
    if (row.api_key_hash && timingSafeEqual(providedHash, row.api_key_hash)) {
      return { id: row.id, email: row.email, name: row.name };
    }
  }
  return null;
}

/**
 * Why a session token can be refused, distinguished from a bad one —
 * decision 0088.
 *
 * `unknown_user` is the case worth separating. A valid, correctly-signed
 * token for a person with no `org_users` row is not a credential
 * problem: the token is fine and the person is not set up. Telling them
 * their sign-in failed would send them to reset a password that was
 * never wrong, when what they need is an administrator.
 */
export type SessionAuthFailure =
  | { reason: "no_token" }
  | { reason: "invalid_token"; detail: string }
  | { reason: "unknown_user"; email: string }
  | { reason: "not_configured"; detail: string };

export type SessionAuthResult =
  | { ok: true; user: AuthenticatedUser }
  | ({ ok: false } & SessionAuthFailure);

/**
 * Authenticate by session token — decision 0088.
 *
 * Four things must hold, and the order is deliberate:
 *
 *   1. the signature verifies,
 *   2. the token names **this** environment,
 *   3. it has not expired,
 *   4. an active `org_users` row exists for its email.
 *
 * The first three are `verifySessionToken`'s job (decision 0086), and
 * the second is the one that matters most: a single signing key serves
 * the whole fleet, so without it a session for one customer would be
 * accepted by every instance.
 *
 * **The fourth is this function's own contribution, and it refuses
 * rather than creates.** A person with no row is not set up: no roles,
 * no unit, no authority limit, and nothing known about them beyond an
 * identity provider vouching for them. Creating a row on first login
 * would produce the *shape* of an account without any of the decisions
 * that make one meaningful — and it would appear in listings and be
 * selectable as a task assignee while satisfying none of what
 * `assign_task`, `org_authority_limits` or the role model assume.
 *
 * It also keeps the instance in control of who exists. A customer whose
 * directory holds ten thousand people does not want ten thousand
 * potential rows in their accounts payable system.
 */
export async function authenticateSession(
  db: D1Database,
  request: Request,
  publicKeyJwk: JsonWebKey | undefined,
  environmentId: string | undefined,
  now: Date = new Date()
): Promise<SessionAuthResult> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, reason: "no_token" };

  if (!publicKeyJwk || !environmentId) {
    // Refused rather than degraded. Verifying without knowing which
    // environment this is would accept a token minted for any other.
    return {
      ok: false,
      reason: "not_configured",
      detail: "LICENCE_SIGNING_PUBLIC_KEY and ENVIRONMENT_ID must both be configured",
    };
  }

  const verified = await verifySessionToken(token, publicKeyJwk, environmentId, now);
  if (!verified.ok) return { ok: false, reason: "invalid_token", detail: verified.reason };

  const user = await db
    .prepare("SELECT id, email, name FROM org_users WHERE email = ? AND status = 'active'")
    .bind(verified.claims.email)
    .first<{ id: string; email: string; name: string }>();

  if (!user) {
    return { ok: false, reason: "unknown_user", email: verified.claims.email };
  }

  // The instance's own row wins over the token's claims. The token says
  // who authenticated; this database says who they are here — including
  // a name an administrator may have corrected after the identity
  // provider supplied it.
  return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
}


/**
 * Authenticate by session token OR API key — decision 0095.
 *
 * The two coexist rather than one replacing the other. A session is a
 * person at a screen; an API key is a service credential, and every
 * live test in this project uses one. Replacing keys with sessions
 * would break automation to solve a problem automation does not have.
 *
 * Session first, because a browser will present one and a script will
 * not — so the common case for a UI is tried before the fallback.
 */
export async function authenticateUserOrSession(
  db: D1Database,
  request: Request,
  publicKeyJwk: JsonWebKey | undefined,
  environmentId: string | undefined,
  now: Date = new Date()
): Promise<{ user: AuthenticatedUser; via: "session" | "api_key" } | { user: null; reason: string }> {
  if (publicKeyJwk && environmentId) {
    const session = await authenticateSession(db, request, publicKeyJwk, environmentId, now);
    if (session.ok) return { user: session.user, via: "session" };
    // `unknown_user` is worth surfacing rather than falling through to
    // the key path: the token was valid and the person is not set up
    // here, which is a different problem from a bad credential
    // (decision 0088) and needs a different answer from whoever is
    // helping them.
    if (session.reason === "unknown_user") {
      return { user: null, reason: `no account here for ${session.email}` };
    }
  }

  const byKey = await authenticateUser(db, request);
  if (byKey) return { user: byKey, via: "api_key" };
  return { user: null, reason: "not authenticated" };
}

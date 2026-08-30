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

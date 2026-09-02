/**
 * Authentication for vf-licence's endpoints. See
 * docs/decisions/0006-endpoint-authentication.md.
 *
 * Two distinct mechanisms, not one:
 * - Admin auth (a single shared secret, ADMIN_API_KEY): protects
 *   provisioning (POST /customers, POST /environments, POST /licences,
 *   key rotation).
 * - Per-environment auth (one random key per environment, shown once
 *   at creation, only its hash ever stored): protects the machine-to-
 *   machine calls each environment's own vf-app instance makes
 *   (fetching its own licence token, pushing its own usage). Critically,
 *   this must prevent one environment's instance from acting as a
 *   different environment — including a different environment
 *   belonging to the same customer — a shared secret would not
 *   provide that.
 *
 * Same generate-once, store-hash-only pattern as any well-known API
 * key system (GitHub, Stripe) — the plaintext exists only in the
 * creation/rotation response, never persisted anywhere.
 */

const KEY_BYTE_LENGTH = 32; // 256 bits — matches the licence signing key's own security margin

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh, random API key. Callers must hash it (hashApiKey) before
 * storing anything — the return value here is the only time the
 * plaintext exists. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(KEY_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** SHA-256, base64url-encoded. Deterministic (same key always hashes
 * the same way) so a stored hash can be compared against on every
 * request without ever storing the plaintext. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Constant-time string comparison — deliberately not `a === b`, which
 * short-circuits on the first differing byte and can leak how many
 * leading characters matched via response timing. Same convention as
 * Node's own `crypto.timingSafeEqual`: a length mismatch is checked
 * (and returns false) before the constant-time loop, since the
 * expected length here is always fixed (a hash digest or a generated
 * key), so a length mismatch itself reveals nothing an attacker didn't
 * already know.
 */
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

/** Pulls the bearer token out of a request's Authorization header, or
 * null if there isn't one in the expected shape. Pure — does not
 * validate the token itself. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/** Checks a provided key against the single admin secret. Deliberately
 * takes the raw ADMIN_API_KEY value rather than reading env directly,
 * so this stays testable without needing a real Worker environment. */
export function isValidAdminKey(providedKey: string | null, adminKey: string | undefined): boolean {
  if (!providedKey || !adminKey) return false;
  return timingSafeEqual(providedKey, adminKey);
}

/**
 * Checks a provided key against the stored hash for a specific
 * customer — the property that actually matters: a valid key for
 * customer A must never authenticate as customer B. A customer with no
 * key yet (api_key_hash is NULL — the state every customer created
 * before this migration is in, and remains in until rotated) can never
 * pass this check, which is the correct behaviour: no key configured
 * means no access, not open access.
 */
/**
 * Checks a provided key against the stored hash for a specific
 * environment — the property that actually matters: a valid key for
 * environment A must never authenticate as environment B, including a
 * different environment belonging to the *same* customer (a sandbox's
 * key must never authenticate as that customer's own production
 * environment). Re-keyed from customerId to environmentId (decision
 * 0036) — the API key now belongs to one specific environment, since
 * a customer's sandbox and production environments each authenticate
 * with their own, separate key.
 *
 * An environment with no key yet (api_key_hash is NULL — the state
 * every environment is in until the operator calls the rotation
 * endpoint once) can never pass this check, which is the correct
 * behaviour: no key configured means no access, not open access.
 */
export async function isValidEnvironmentKey(
  db: D1Database,
  environmentId: string,
  providedKey: string | null
): Promise<boolean> {
  if (!providedKey) return false;
  const row = await db
    .prepare("SELECT api_key_hash FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ api_key_hash: string | null }>();
  if (!row || !row.api_key_hash) return false;
  const providedHash = await hashApiKey(providedKey);
  return timingSafeEqual(providedHash, row.api_key_hash);
}

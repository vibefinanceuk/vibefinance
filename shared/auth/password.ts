import { argon2id } from "@noble/hashes/argon2.js";

/**
 * Password hashing — decision 0089.
 *
 * **Not `hashApiKey`.** That uses plain SHA-256, which is correct for a
 * 32-byte random key: brute force is infeasible whatever the hash costs.
 * A human-chosen password has none of that entropy, and the entire
 * defence is making each guess expensive.
 *
 * Argon2id, at OWASP's recommended parameters. The platform forced this
 * choice rather than merely favouring it: **Cloudflare Workers cap
 * PBKDF2 at 100,000 iterations**, and OWASP's minimum for
 * PBKDF2-HMAC-SHA256 is 600,000 — so the native Web Crypto route this
 * project uses everywhere else falls six-fold short of the weakest
 * algorithm OWASP sanctions.
 *
 * The dependency is a deliberate exception in a codebase that has
 * almost none. The alternative is writing a memory-hard key derivation
 * function by hand, which would be far worse.
 */

/**
 * OWASP's baseline: t=2, m=19,456 KiB, p=1. Measured at ~321 ms before
 * being chosen, which is real and acceptable for something as rare as a
 * sign-in.
 *
 * **Memory cost is the load-bearing parameter.** PBKDF2 is CPU-bound,
 * and GPUs and ASICs compute it orders of magnitude faster than a
 * defender's server; Argon2's memory requirement is what makes that
 * hardware advantage expensive rather than decisive.
 */
export const ARGON2_PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;

const SALT_BYTES = 16;

/**
 * The stored form: `argon2id$t$m$p$salt$hash`, all base64url.
 *
 * Parameters travel **with** the hash rather than living in a constant,
 * so raising the cost later does not invalidate a single existing
 * password: an old hash still verifies under the parameters it was made
 * with, and can be re-derived at the new cost on the next successful
 * sign-in.
 *
 * A constant would make every stored password unverifiable the moment
 * it changed.
 */
const PREFIX = "argon2id";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Guards against a denial of service through the hash itself.
 *
 * Argon2's cost is fixed by its parameters rather than by input length,
 * but an unbounded body still has to be read and encoded, and a limit
 * costs nothing. 1024 is far above any real password and far below
 * anything worth worrying about.
 */
const MAX_PASSWORD_BYTES = 1024;

export async function hashPassword(password: string): Promise<string> {
  if (password === "") throw new Error("refusing to hash an empty password");
  const encoded = new TextEncoder().encode(password);
  if (encoded.length > MAX_PASSWORD_BYTES) {
    throw new Error(`password exceeds ${MAX_PASSWORD_BYTES} bytes`);
  }

  // A unique salt per password, so two people choosing the same one
  // produce different hashes and a precomputed table is useless.
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = argon2id(encoded, salt, ARGON2_PARAMS);

  const { t, m, p } = ARGON2_PARAMS;
  return [PREFIX, t, m, p, base64UrlEncode(salt), base64UrlEncode(hash)].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for anything malformed rather than throwing: a stored
 * value this cannot parse is an authentication failure, not a crash —
 * and a login endpoint that throws on bad input is a way to probe it.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, tRaw, mRaw, pRaw, saltRaw, hashRaw] = parts;
  const t = Number(tRaw);
  const m = Number(mRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(t) || !Number.isInteger(m) || !Number.isInteger(p)) return false;
  // A stored hash claiming absurd parameters would let anybody who can
  // write to the database turn one sign-in into an outage.
  if (t < 1 || t > 10 || m < 1024 || m > 131072 || p < 1 || p > 4) return false;

  const encoded = new TextEncoder().encode(password);
  if (encoded.length === 0 || encoded.length > MAX_PASSWORD_BYTES) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64UrlDecode(saltRaw);
    expected = base64UrlDecode(hashRaw);
  } catch {
    return false;
  }

  // Derived under the parameters THIS hash was made with, not today's
  // constants — which is what lets the cost be raised without
  // invalidating anything.
  const actual = argon2id(encoded, salt, { t, m, p, dkLen: expected.length });

  // Constant-time. A plain comparison leaks, through response timing,
  // how many leading bytes matched — the same reasoning applied to API
  // keys and to document tokens (decision 0073).
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * Whether a stored hash was made with weaker parameters than today's.
 *
 * The mechanism that makes raising the cost possible: after a
 * successful sign-in, a hash below current strength can be re-derived
 * from the password the person just proved they know. Without this,
 * changing the parameters only ever protects new accounts.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return true;
  const [, t, m, p] = parts;
  return (
    Number(t) < ARGON2_PARAMS.t || Number(m) < ARGON2_PARAMS.m || Number(p) < ARGON2_PARAMS.p
  );
}

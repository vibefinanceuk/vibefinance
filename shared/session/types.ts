/**
 * A session token asserts that a person authenticated, and for which
 * environment — decision 0086.
 *
 * Deliberately not the licence token with extra claims. A licence token
 * says *this customer is entitled to X* and lives 48 hours; this says
 * *this person is authenticated* and lives an hour. Same crypto, same
 * verification path, unrelated lifetimes — and one token carrying both
 * would make its TTL a compromise between two requirements that have
 * nothing to do with each other (decision 0083 section 2).
 */
export interface SessionClaims {
  /** Who. The instance maps this to its own `org_users` row. */
  email: string;
  /** Display name, as the identity provider gave it. */
  name: string;
  /**
   * **Which environment this token is for, and the reason it exists.**
   *
   * `vf-licence` holds one signing key for the entire fleet, and every
   * instance verifies with the same public half. A token that only said
   * "this person authenticated" would therefore be **valid at every
   * customer's instance** — a session for one customer would open
   * another's data, with a perfectly good signature.
   *
   * So the environment is named in the token and each instance refuses
   * one addressed elsewhere. In JWT terms this is the audience claim;
   * it is the difference between a session and a skeleton key.
   */
  environmentId: string;
  /** ISO 8601. */
  issuedAt: string;
  /** ISO 8601. */
  expiresAt: string;
}

export type SessionVerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: string };

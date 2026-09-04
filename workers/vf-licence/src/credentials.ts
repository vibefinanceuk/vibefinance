import type { RouteResult } from "./customers-route.js";
import { hashPassword, verifyPassword, needsRehash } from "@vibefinance/shared";

/**
 * Credentials and access grants — decision 0092.
 *
 * The division, stated by the operator and worth keeping in these
 * words: **vf-licence decides if you get access; org_users decides what
 * you get access to.**
 *
 * So nothing here knows about roles, units or authority limits. It
 * answers one question — may this person obtain a session token for
 * this environment — and leaves everything after that to the instance.
 */

export interface CredentialCheck {
  ok: boolean;
  /** Set when the stored hash is below current strength (decision 0089). */
  needsRehash?: boolean;
}

/**
 * Verify a password against the credential for this person and
 * customer.
 *
 * **Always performs a hash**, even when no credential exists. Returning
 * early would make a missing account faster than a wrong password, and
 * the difference is measurable — which turns the login endpoint into a
 * way to enumerate who has an account.
 */
export async function checkCredential(
  db: D1Database,
  email: string,
  customerId: string,
  password: string
): Promise<CredentialCheck> {
  const row = await db
    .prepare("SELECT password_hash FROM user_credentials WHERE email = ? AND customer_id = ?")
    .bind(email.toLowerCase(), customerId)
    .first<{ password_hash: string }>();

  if (!row) {
    // A real Argon2id verification against a hash of nothing in
    // particular, so the timing matches the case where an account
    // exists. The result is discarded.
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false };
  }

  const ok = await verifyPassword(password, row.password_hash);
  return ok ? { ok, needsRehash: needsRehash(row.password_hash) } : { ok: false };
}

/**
 * A fixed hash used only to spend the same time when no credential
 * exists. Its plaintext is unknown and irrelevant — nothing verifies
 * against it successfully.
 */
const DUMMY_HASH =
  "argon2id$2$19456$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function setCredential(
  db: D1Database,
  email: string,
  customerId: string,
  password: string
): Promise<RouteResult> {
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customer) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }
  if (typeof password !== "string" || password.length < 12) {
    // Length over complexity, following NIST: a long passphrase beats a
    // short string with a symbol in it, and complexity rules mostly
    // produce predictable substitutions.
    return { status: 422, body: { error: "password must be at least 12 characters" } };
  }

  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_credentials (email, customer_id, password_hash, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email, customer_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`
    )
    .bind(email.toLowerCase(), customerId, hash, now)
    .run();

  return { status: 200, body: { email: email.toLowerCase(), customerId } };
}

/**
 * Which environments this person may reach.
 *
 * **The mechanism decision 0083 section 5 needed.** That decision said
 * the selector "lists what you can reach, not what the customer owns",
 * and left it as an authorisation question with nothing behind it. This
 * answers it from one control-plane query, without calling every
 * instance in turn.
 */
export async function listAccessibleEnvironments(
  db: D1Database,
  email: string
): Promise<{ id: string; kind: string; region: string; instanceUrl: string }[]> {
  const rows = await db
    .prepare(
      `SELECT e.id, e.kind, e.region, e.instance_url
       FROM user_environment_access a
       JOIN environments e ON e.id = a.environment_id
       WHERE a.email = ?
       ORDER BY e.kind, e.region`
    )
    .bind(email.toLowerCase())
    .all<{ id: string; kind: string; region: string; instance_url: string }>();

  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    region: r.region,
    instanceUrl: r.instance_url,
  }));
}

export async function hasAccess(
  db: D1Database,
  email: string,
  environmentId: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM user_environment_access WHERE email = ? AND environment_id = ?")
    .bind(email.toLowerCase(), environmentId)
    .first();
  return row !== null;
}

export async function grantAccess(
  db: D1Database,
  email: string,
  environmentId: string,
  grantedBy: string | null = null
): Promise<RouteResult> {
  const environment = await db
    .prepare("SELECT id, customer_id FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ id: string; customer_id: string }>();
  if (!environment) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  // Checked here as well as by the composite foreign keys, so the
  // caller gets a reason rather than a constraint error. **A grant to
  // another customer's environment is the one mistake that would
  // matter**: one row, and the isolation the whole design rests on is
  // gone — which is why the schema refuses it too, and does not rely on
  // this check being reached.
  const credential = await db
    .prepare("SELECT customer_id FROM user_credentials WHERE email = ? AND customer_id = ?")
    .bind(email.toLowerCase(), environment.customer_id)
    .first();
  if (!credential) {
    return {
      status: 422,
      body: {
        error: `${email} has no credential for customer ${environment.customer_id}`,
        detail: "a person may only be granted environments belonging to their own customer",
      },
    };
  }

  await db
    .prepare(
      `INSERT INTO user_environment_access (email, environment_id, customer_id, granted_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email, environment_id) DO NOTHING`
    )
    // The customer is carried on the row so the composite foreign keys
    // can close the boundary. It comes from the ENVIRONMENT rather than
    // the caller, so a caller cannot name one and mean another.
    .bind(email.toLowerCase(), environmentId, environment.customer_id, grantedBy)
    .run();

  return { status: 200, body: { email: email.toLowerCase(), environmentId } };
}

export async function revokeAccess(
  db: D1Database,
  email: string,
  environmentId: string
): Promise<RouteResult> {
  const result = await db
    .prepare("DELETE FROM user_environment_access WHERE email = ? AND environment_id = ?")
    .bind(email.toLowerCase(), environmentId)
    .run();

  // Revoking removes the way IN. It deliberately leaves `org_users`
  // alone: what somebody may do in an instance is that instance's
  // record, and an administrator there may want the row kept for the
  // history attached to it — who approved what, who keyed which field.
  return {
    status: 200,
    body: {
      revoked: (result.meta.changes ?? 0) > 0,
      note: "access removed in the control plane; the instance's own user record is untouched",
    },
  };
}

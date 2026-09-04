import type { RouteResult } from "./customers-route.js";
import { checkCredential, hasAccess, setCredential } from "./credentials.js";
import { assessDelay, recordAttempt, signInReport } from "./login-attempts.js";
import { signSessionToken, SESSION_TTL_SECONDS, type SessionClaims } from "@vibefinance/shared";

/**
 * Signing in — decision 0094.
 *
 * The piece that assembles everything built separately: the progressive
 * delay (0090), the credential (0092), the session token (0086) and the
 * report ISO 27001 A.8.5 asks for (0090).
 *
 * **Written defensively on purpose.** This is the front door, reachable
 * without any credential, and the only route where an attacker chooses
 * the inputs. Every branch below either returns the same shape or
 * spends the same time as its neighbours.
 */

export interface LoginBody {
  email?: unknown;
  password?: unknown;
  environmentId?: unknown;
}

/**
 * One message for every authentication failure.
 *
 * Distinguishing "no such account" from "wrong password" from "no
 * access to that instance" would let anybody enumerate who has an
 * account and which environments exist. The person who genuinely
 * mistyped is told the same thing either way, which is a small cost
 * against a real one.
 *
 * The exception is the delay: telling somebody to wait is not a leak,
 * because they already know their attempt failed.
 */
const REFUSAL = "email, password or environment is not correct";

export async function handleLogin(
  db: D1Database,
  body: LoginBody,
  privateKeyJwk: JsonWebKey,
  sourceIp: string | null = null,
  now: Date = new Date()
): Promise<RouteResult> {
  const { email, password, environmentId } = body;
  if (
    typeof email !== "string" ||
    email.trim() === "" ||
    typeof password !== "string" ||
    password === "" ||
    typeof environmentId !== "string" ||
    environmentId.trim() === ""
  ) {
    return { status: 400, body: { error: "email, password and environmentId are required" } };
  }

  const normalisedEmail = email.trim().toLowerCase();

  // The delay first, before any work. An attacker who has earned a wait
  // should not also get a free password verification out of each
  // attempt — that is the CPU cost Argon2id exists to impose on them.
  const delay = await assessDelay(db, normalisedEmail, environmentId, now);
  if (delay.tooSoon) {
    return {
      status: 429,
      body: {
        error: "too many recent attempts — wait before trying again",
        retryAfterSeconds: delay.delaySeconds,
      },
    };
  }

  // The environment decides which customer's credential to check
  // against. An environment nobody has heard of still costs a
  // verification below, so its absence is not detectable by timing.
  const environment = await db
    .prepare("SELECT id, customer_id, instance_url FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ id: string; customer_id: string; instance_url: string }>();

  const credentialOk = environment
    ? (await checkCredential(db, normalisedEmail, environment.customer_id, password)).ok
    : // Still spends the time, against a customer that cannot match.
      (await checkCredential(db, normalisedEmail, "\u0000no-such-customer", password)).ok;

  const accessOk = environment ? await hasAccess(db, normalisedEmail, environment.id) : false;

  if (!environment || !credentialOk || !accessOk) {
    // Recorded whichever it was. An attempt against an environment that
    // does not exist is a probe, and is exactly the attempt most worth
    // seeing later (decision 0090).
    await recordAttempt(db, normalisedEmail, environmentId, false, sourceIp);
    return { status: 401, body: { error: REFUSAL } };
  }

  await recordAttempt(db, normalisedEmail, environment.id, true, sourceIp);

  // After the success is recorded, so "since the last success" means
  // the one before this — which is what a person wants to be told.
  const report = await signInReport(db, normalisedEmail, environment.id);

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const claims: SessionClaims = {
    email: normalisedEmail,
    name: normalisedEmail,
    // Named in the token, so the instance refuses one addressed
    // elsewhere. A single signing key serves the whole fleet (0086).
    environmentId: environment.id,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return {
    status: 200,
    body: {
      token: await signSessionToken(claims, privateKeyJwk),
      expiresAt: claims.expiresAt,
      environmentId: environment.id,
      instanceUrl: environment.instance_url,
      // What ISO 27001:2022 Annex A 8.5 asks be shown after signing in.
      // A person who does not recognise an attempt here knows something
      // an audit log read by nobody never tells them.
      lastSignedInAt: report.lastSuccessAt,
      failedAttemptsSince: report.attemptsSinceLastSuccess,
    },
  };
}

/**
 * Which instances this person may reach — asked **before** choosing
 * one.
 *
 * Requires the password, deliberately. Answering it unauthenticated
 * would turn an email address into a map of a customer's estate.
 */
export async function handleListMyEnvironments(
  db: D1Database,
  body: LoginBody,
  now: Date = new Date()
): Promise<RouteResult> {
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string" || email.trim() === "") {
    return { status: 400, body: { error: "email and password are required" } };
  }
  const normalisedEmail = email.trim().toLowerCase();

  const delay = await assessDelay(db, normalisedEmail, "*", now);
  if (delay.tooSoon) {
    return { status: 429, body: { error: "too many recent attempts — wait before trying again" } };
  }

  // Every customer this person holds a credential for. Usually one; the
  // loop exists because nothing prevents a person working for two.
  const credentials = await db
    .prepare("SELECT customer_id FROM user_credentials WHERE email = ?")
    .bind(normalisedEmail)
    .all<{ customer_id: string }>();

  const verified: string[] = [];
  for (const c of credentials.results) {
    if ((await checkCredential(db, normalisedEmail, c.customer_id, password)).ok) {
      verified.push(c.customer_id);
    }
  }

  if (verified.length === 0) {
    await recordAttempt(db, normalisedEmail, "*", false, null);
    // The same refusal as a failed sign-in, and no hint about whether
    // the email is known.
    return { status: 401, body: { error: REFUSAL } };
  }

  await recordAttempt(db, normalisedEmail, "*", true, null);

  const rows = await db
    .prepare(
      `SELECT e.id, e.kind, e.region, e.instance_url
       FROM user_environment_access a
       JOIN environments e ON e.id = a.environment_id
       WHERE a.email = ?
       ORDER BY e.kind, e.region`
    )
    .bind(normalisedEmail)
    .all<{ id: string; kind: string; region: string; instance_url: string }>();

  return {
    status: 200,
    body: {
      environments: rows.results.map((r) => ({
        id: r.id,
        kind: r.kind,
        region: r.region,
        instanceUrl: r.instance_url,
      })),
    },
  };
}

/** Re-exported so the router has one import for the provisioning surface. */
export { setCredential };

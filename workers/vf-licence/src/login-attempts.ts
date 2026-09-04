import type { RouteResult } from "./customers-route.js";

/**
 * Slowing down guessing, and telling a person what happened while they
 * were away — decision 0090.
 *
 * **Progressive delay, not lockout.** SOC 2 requires brute-force
 * protection under CC6.1 and having none is an automatic finding, but
 * auditors accept a progressive delay as equivalent to a lockout — and
 * it avoids the trade-off a lockout carries: anybody who knows a
 * colleague's email could otherwise lock them out by guessing wrong
 * five times. A denial of service wearing a security feature's clothes.
 *
 * The account is never locked. It simply gets slower, until guessing is
 * pointless and a real person who mistyped waits a few seconds.
 */

/**
 * Delay after N consecutive failures, in seconds.
 *
 * The first two are free, because a mistyped password is ordinary. From
 * the third it climbs, and by the eighth an attacker manages roughly
 * three attempts an hour against one account — which makes a dictionary
 * attack pointless without ever telling a real user they are locked
 * out.
 *
 * Industry consensus for a hard lockout is 3-6 failures and 30-60
 * minutes (SOC 2 guidance, NIST AC-7, PCI DSS). This reaches an
 * equivalent cost by the same point without the denial of service.
 */
const DELAY_SCHEDULE_SECONDS = [0, 0, 1, 3, 10, 30, 120, 600, 1800];

/** Beyond the schedule, the last step repeats rather than growing. */
const MAX_DELAY_SECONDS = DELAY_SCHEDULE_SECONDS[DELAY_SCHEDULE_SECONDS.length - 1];

/**
 * Twelve months.
 *
 * ISO 27001 requires logs of security events without setting a
 * duration; twelve months is the common recommendation and what an
 * auditor expects to see. Annex A 8.5 is explicit that failed attempts
 * must be noted "including for criminal and/or regulatory
 * proceedings", which is an argument for keeping them well beyond the
 * few days a delay calculation needs.
 */
export const LOGIN_ATTEMPT_RETENTION_DAYS = 365;

export interface DelayVerdict {
  /** How long the caller must wait before this attempt is considered. */
  delaySeconds: number;
  /** Consecutive failures since the last success. */
  consecutiveFailures: number;
  /** Whether this attempt should be refused for being too soon. */
  tooSoon: boolean;
}

/**
 * Consecutive failures **since the last success**, which is the count
 * that matters and the one ISO 27001 Annex A 8.5 asks to be shown to
 * the user.
 *
 * A successful sign-in resets it. The rows are not deleted — "three
 * failures on Tuesday, then a success" is exactly the pattern worth
 * seeing later, and deleting on success would erase the interesting
 * case while keeping only the boring ones.
 */
export async function assessDelay(
  db: D1Database,
  email: string,
  environmentId: string,
  now: Date = new Date()
): Promise<DelayVerdict> {
  const rows = await db
    .prepare(
      `SELECT succeeded, attempted_at FROM login_attempts
       WHERE email = ? AND environment_id = ?
       ORDER BY attempted_at DESC, id DESC
       LIMIT 50`
    )
    .bind(email.toLowerCase(), environmentId)
    .all<{ succeeded: number; attempted_at: string }>();

  let consecutiveFailures = 0;
  let mostRecentFailureAt: string | null = null;
  for (const row of rows.results) {
    if (row.succeeded === 1) break;
    if (consecutiveFailures === 0) mostRecentFailureAt = row.attempted_at;
    consecutiveFailures++;
  }

  const delaySeconds =
    consecutiveFailures < DELAY_SCHEDULE_SECONDS.length
      ? DELAY_SCHEDULE_SECONDS[consecutiveFailures]
      : MAX_DELAY_SECONDS;

  if (delaySeconds === 0 || !mostRecentFailureAt) {
    return { delaySeconds: 0, consecutiveFailures, tooSoon: false };
  }

  // SQLite's datetime() has no timezone; treating it as UTC matches how
  // every other timestamp in this project is written and read.
  const lastFailure = new Date(`${mostRecentFailureAt.replace(" ", "T")}Z`).getTime();
  const readyAt = lastFailure + delaySeconds * 1000;
  return { delaySeconds, consecutiveFailures, tooSoon: now.getTime() < readyAt };
}

export async function recordAttempt(
  db: D1Database,
  email: string,
  environmentId: string,
  succeeded: boolean,
  sourceIp: string | null = null
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO login_attempts (id, email, environment_id, succeeded, source_ip) VALUES (?, ?, ?, ?, ?)"
    )
    // Lowercased on the way in. Otherwise `Dan@acme.com` and
    // `dan@acme.com` are different keys and the delay counts one
    // without counting the other, which is a bypass rather than an
    // inconsistency. A standing invariant enforces the same thing.
    .bind(crypto.randomUUID(), email.toLowerCase(), environmentId, succeeded ? 1 : 0, sourceIp)
    .run();
}

export interface SignInReport {
  lastSuccessAt: string | null;
  attemptsSinceLastSuccess: { succeeded: boolean; attemptedAt: string; sourceIp: string | null }[];
}

/**
 * What ISO 27001:2022 Annex A 8.5 asks to be shown after a successful
 * sign-in: when the last one was, and every attempt since.
 *
 * **This is the point of keeping the rows.** A person who sees three
 * failed attempts from an address they do not recognise knows something
 * an audit log read by nobody never would.
 *
 * Called after the success is recorded, so "since the last success"
 * means the one before this — which is what a person wants to be told.
 */
export async function signInReport(
  db: D1Database,
  email: string,
  environmentId: string
): Promise<SignInReport> {
  const successes = await db
    .prepare(
      `SELECT attempted_at FROM login_attempts
       WHERE email = ? AND environment_id = ? AND succeeded = 1
       ORDER BY attempted_at DESC, id DESC LIMIT 2`
    )
    .bind(email.toLowerCase(), environmentId)
    .all<{ attempted_at: string }>();

  const previousSuccess = successes.results[1]?.attempted_at ?? null;

  const since = await db
    .prepare(
      `SELECT succeeded, attempted_at, source_ip FROM login_attempts
       WHERE email = ? AND environment_id = ? AND succeeded = 0
         AND (? IS NULL OR attempted_at > ?)
       ORDER BY attempted_at DESC LIMIT 20`
    )
    .bind(email.toLowerCase(), environmentId, previousSuccess, previousSuccess)
    .all<{ succeeded: number; attempted_at: string; source_ip: string | null }>();

  return {
    lastSuccessAt: previousSuccess,
    attemptsSinceLastSuccess: since.results.map((r) => ({
      succeeded: r.succeeded === 1,
      attemptedAt: r.attempted_at,
      sourceIp: r.source_ip,
    })),
  };
}

/**
 * Discards attempts past the retention period.
 *
 * They are personal data with a security purpose, so they are kept as
 * long as an auditor expects and no longer — the same reasoning
 * decision 0077 applies to documents, with a much shorter answer.
 *
 * Unlike document retention, this one **does** delete: an attempt has
 * no value to anybody after a year, where an invoice may have several.
 */
export async function sweepOldAttempts(
  db: D1Database,
  now: Date = new Date()
): Promise<RouteResult> {
  const cutoff = new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * 86400 * 1000);
  const iso = cutoff.toISOString().replace("T", " ").slice(0, 19);

  const result = await db
    .prepare("DELETE FROM login_attempts WHERE attempted_at < ?")
    .bind(iso)
    .run();

  return {
    status: 200,
    body: { deleted: result.meta.changes ?? 0, olderThan: iso, retentionDays: LOGIN_ATTEMPT_RETENTION_DAYS },
  };
}

import type { RouteResult } from "./customers-route.js";
import { handleCreateCustomer } from "./customers-route.js";
import { handleCreateEnvironment } from "./environment-route.js";
import { handleUpsertLicence } from "./licences-route.js";

/**
 * Control-plane provisioning — decision 0039. Turns an approved
 * signup request (decision 0038) into the real control-plane records
 * a trial sandbox needs: a customer, a sandbox environment with its
 * own API key, and a 30-day trial licence.
 *
 * Deliberately HALF of provisioning. The other half — creating the
 * customer's real D1 database, R2 bucket and Worker via the
 * Cloudflare API — is not here, and this route does not pretend
 * otherwise: it returns the fleet metadata fields as null and reports
 * `infrastructureProvisioned: false`. A fleet tool must treat an
 * environment with no worker_name/d1_database_name/d1_database_id as
 * "not deployable yet" (decision 0011's own rule), which is exactly
 * the correct reading of what this route produces.
 *
 * Splitting it this way is what lets the whole control-plane half be
 * built and genuinely tested today, with the Cloudflare API calls a
 * clean, well-defined addition later rather than a coupled mess.
 */

export const TRIAL_PLAN = "trial";
export const TRIAL_DURATION_DAYS = 30;

/**
 * A trial's volume ceiling. Reported against via usage telemetry,
 * never enforced mid-period (Blueprint) — nothing counts down against
 * this in real time. Set deliberately generously relative to the
 * free tier the operator described (0-99 invoices/month): a trial
 * that hits a wall mid-evaluation would be a worse first experience
 * than one that simply reports what it used.
 */
export const TRIAL_VOLUME_ENTITLEMENT = 500;

export interface ProvisionTrialBody {
  customerId?: unknown;
}

function addDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * customerId is supplied by the operator, not derived from the
 * request's company name: a company_name is free text a stranger
 * typed into a web form, and is never assumed to be a valid or
 * sensible customer id (decision 0038's own schema comment). The
 * operator chooses a real, stable id at this point.
 *
 * `now` is injectable purely so tests can assert the trial's real
 * 30-day window without depending on wall-clock time.
 */
export async function handleProvisionTrial(
  db: D1Database,
  requestId: string,
  body: ProvisionTrialBody,
  now: Date = new Date()
): Promise<RouteResult> {
  const { customerId } = body;
  if (typeof customerId !== "string" || !customerId.trim()) {
    return { status: 400, body: { error: "customerId (a non-empty string) is required" } };
  }
  const trimmedCustomerId = customerId.trim();

  const signupRequest = await db
    .prepare("SELECT id, company_name, status, customer_id FROM signup_requests WHERE id = ?")
    .bind(requestId)
    .first<{ id: string; company_name: string; status: string; customer_id: string | null }>();
  if (!signupRequest) {
    return { status: 404, body: { error: `signup request ${requestId} does not exist` } };
  }
  if (signupRequest.status !== "approved") {
    return {
      status: 409,
      body: { error: `signup request ${requestId} is ${signupRequest.status}, not approved — only an approved request can be provisioned` },
    };
  }
  if (signupRequest.customer_id !== null) {
    return { status: 409, body: { error: `signup request ${requestId} is already provisioned` } };
  }

  // Each step below reuses the same real route handler an operator
  // would call by hand — never a second, parallel implementation of
  // the same insert. A failure in any step returns that step's own
  // error unchanged, rather than a generic "provisioning failed".
  const customerResult = await handleCreateCustomer(db, { id: trimmedCustomerId, name: signupRequest.company_name });
  if (customerResult.status !== 201) {
    return customerResult;
  }

  const environmentResult = await handleCreateEnvironment(db, {
    customerId: trimmedCustomerId,
    kind: "sandbox",
    region: "eu",
    // A real, honest placeholder: the Worker this points at does not
    // exist yet, because deploying it is the Cloudflare-API half this
    // route deliberately doesn't do. instance_url is NOT NULL in the
    // schema, so something must go here — a URL that visibly says
    // "not deployed" is better than a plausible-looking one that
    // silently 404s.
    instanceUrl: `https://not-yet-deployed.invalid/${trimmedCustomerId}-sandbox`,
  });
  if (environmentResult.status !== 201) {
    return environmentResult;
  }
  const environmentId = (environmentResult.body as { id: string }).id;
  const apiKey = (environmentResult.body as { apiKey: string }).apiKey;

  const validFrom = now.toISOString();
  const validTo = addDays(now, TRIAL_DURATION_DAYS).toISOString();
  const licenceResult = await handleUpsertLicence(db, {
    environmentId,
    plan: TRIAL_PLAN,
    volumeEntitlement: TRIAL_VOLUME_ENTITLEMENT,
    validFrom,
    validTo,
  });
  if (licenceResult.status !== 200) {
    return licenceResult;
  }

  await db
    .prepare("UPDATE signup_requests SET customer_id = ?, environment_id = ? WHERE id = ?")
    .bind(trimmedCustomerId, environmentId, requestId)
    .run();

  return {
    status: 201,
    body: {
      requestId,
      customerId: trimmedCustomerId,
      environmentId,
      // The plaintext key exists only in this response — only its
      // hash is stored (decision 0006). If lost, rotate; it can never
      // be recovered.
      apiKey,
      plan: TRIAL_PLAN,
      validFrom,
      validTo,
      // Stated explicitly rather than left for the caller to infer:
      // the control-plane records exist, the actual Cloudflare
      // infrastructure does not.
      infrastructureProvisioned: false,
      message:
        "Control-plane records created. The D1 database, R2 bucket and Worker must still be created, then recorded via PATCH /environments/:id/fleet-metadata.",
    },
  };
}

export interface ExpirySweepResult {
  checked: number;
  blocked: string[];
}

/**
 * How many days before expiry a licence gets warned, and at which
 * stages. Escalating rather than a single notice — the Blueprint's
 * own "notice in the product, then notice with a date, then
 * restriction", staged.
 *
 * Exported and injectable rather than hardcoded inside the sweep so
 * the thresholds are a real, visible, testable value rather than a
 * magic number, and so a different cadence needs no code change.
 * The sweep sorts these itself and always applies the most urgent
 * threshold a licence has genuinely crossed, so a run that missed
 * several stages (an hourly sweep that didn't fire for a week, say)
 * still produces the correct, most urgent notice rather than a stale
 * softer one.
 */
export const DEFAULT_WARNING_THRESHOLD_DAYS = [14, 7, 1];

export interface WarningSweepResult {
  warned: { environmentId: string; thresholdDays: number }[];
}

const MS_PER_DAY = 86_400_000;

/**
 * Warns licences approaching expiry — decision 0040.
 *
 * Sets status to 'warned' and records which threshold fired, so the
 * same stage never fires twice. status_reason carries the real,
 * human-readable notice ("expires in 7 days") and
 * status_effective_at carries the actual expiry date — both already
 * flow through the signed token into vf-app, so the product surface
 * needs no new plumbing to display this.
 *
 * Deliberately never touches a licence that is already 'blocked': a
 * blocked licence has either expired or been blocked for another
 * reason entirely, and neither is something to warn about. Nor does
 * it touch an open-ended licence — there is nothing to warn about
 * when there is no expiry.
 *
 * Runs before the expiry sweep in the scheduled handler, so a licence
 * that crosses its expiry in the same run gets blocked rather than
 * warned about an expiry that has already happened.
 */
export async function warnExpiringLicences(
  db: D1Database,
  now: Date = new Date(),
  thresholdDays: number[] = DEFAULT_WARNING_THRESHOLD_DAYS
): Promise<WarningSweepResult> {
  // Ascending: the tightest threshold first, so `find` returns the
  // MOST urgent one this licence has genuinely crossed. Found by a
  // failing test — searching descending returns the first (widest)
  // match instead, so a licence with hours left would be reported as
  // "expires in 14 days".
  const sorted = [...thresholdDays].sort((a, b) => a - b);
  const warned: { environmentId: string; thresholdDays: number }[] = [];

  const candidates = await db
    .prepare(
      `SELECT environment_id, valid_to, warned_at_days FROM licences
       WHERE valid_to IS NOT NULL AND valid_to > ? AND status != 'blocked'`
    )
    .bind(now.toISOString())
    .all<{ environment_id: string; valid_to: string; warned_at_days: number | null }>();

  for (const row of candidates.results) {
    const daysRemaining = (new Date(row.valid_to).getTime() - now.getTime()) / MS_PER_DAY;

    // The most urgent threshold this licence has genuinely crossed.
    const due = sorted.find((threshold) => daysRemaining <= threshold);
    if (due === undefined) continue;

    // Already warned at this stage or a more urgent one — a smaller
    // warned_at_days means a later, more urgent warning has already
    // fired, and the sweep must never walk a warning backwards.
    if (row.warned_at_days !== null && row.warned_at_days <= due) continue;

    await db
      .prepare(
        `UPDATE licences
         SET status = 'warned',
             status_reason = ?,
             status_effective_at = ?,
             warned_at_days = ?,
             updated_at = datetime('now')
         WHERE environment_id = ?`
      )
      .bind(
        `expires in ${due} ${due === 1 ? "day" : "days"}`,
        row.valid_to,
        due,
        row.environment_id
      )
      .run();

    warned.push({ environmentId: row.environment_id, thresholdDays: due });
  }

  return { warned };
}

/**
 * Blocks every licence whose valid_to has passed and which isn't
 * already blocked — decision 0039.
 *
 * Without this, an expired trial keeps working indefinitely, which is
 * the opposite of what expiry means: vf-app's licence cache fails
 * open at its last known good state (decision 0003), so a licence
 * that simply stops being renewable never actually stops anything.
 * Something has to make the transition happen, and this is it.
 *
 * 'blocked' is deliberately the right status rather than deleting the
 * licence or the environment: blocking is read-only, not lights-out
 * (decision 0003) — /rules/evaluate and /rules/compile return 402,
 * while everything read-only stays reachable. That is exactly the
 * intended end-of-trial experience: the sandbox and all its
 * configuration survive, and the customer is prompted to pay to
 * resume real work.
 *
 * A plain function over the database, with the cron handler as a thin
 * wrapper — genuinely testable without simulating a scheduled event,
 * and runnable on demand if it's ever needed.
 */
export async function expireOverdueLicences(db: D1Database, now: Date = new Date()): Promise<ExpirySweepResult> {
  const nowIso = now.toISOString();

  const overdue = await db
    .prepare(
      `SELECT environment_id FROM licences
       WHERE valid_to IS NOT NULL AND valid_to <= ? AND status != 'blocked'`
    )
    .bind(nowIso)
    .all<{ environment_id: string }>();

  const ids = overdue.results.map((row) => row.environment_id);
  if (ids.length === 0) {
    return { checked: 0, blocked: [] };
  }

  for (const environmentId of ids) {
    await db
      .prepare(
        `UPDATE licences
         SET status = 'blocked',
             status_reason = 'expired',
             status_effective_at = ?,
             updated_at = datetime('now')
         WHERE environment_id = ?`
      )
      .bind(nowIso, environmentId)
      .run();
  }

  return { checked: ids.length, blocked: ids };
}

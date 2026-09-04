import { generateApiKey, hashApiKey } from "./auth.js";
import type { RouteResult } from "./customers-route.js";

export interface CreateEnvironmentBody {
  customerId?: unknown;
  kind?: unknown;
  region?: unknown;
  instanceUrl?: unknown;
  workerName?: unknown;
  d1DatabaseName?: unknown;
  d1DatabaseId?: unknown;
  locale?: unknown;
}

const VALID_KINDS = ["sandbox", "production"] as const;

function optionalStringField(
  value: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || !value) {
    return { ok: false, error: `${fieldName}, if provided, must be a non-empty string` };
  }
  return { ok: true, value };
}

/**
 * Creates one real environment for an existing customer — decision
 * 0036. UNIQUE(customer_id, kind) in the schema means a second
 * 'production' (or a second 'sandbox') for the same customer is a
 * real, structural refusal, not silently allowed — matches the
 * described flow exactly: at most one sandbox and one production per
 * customer, ever.
 *
 * id is deterministic ({customerId}-{kind}-{region}, widened by
 * decision 0084), the same convention
 * decision 0036's own migration used to backfill Acme's existing
 * deployment as 'acme-production' — not random, so a customer's own
 * environment ids are predictable and human-readable, not opaque
 * UUIDs a person has to look up.
 *
 * Fleet metadata (workerName, d1DatabaseName, d1DatabaseId, locale) is
 * optional here, same as it was on the old, combined customer-creation
 * route — an environment can exist in the control plane before its
 * real vf-app deployment's specifics are known.
 */
export async function handleCreateEnvironment(
  db: D1Database,
  body: CreateEnvironmentBody
): Promise<RouteResult> {
  const { customerId, kind, region, instanceUrl } = body;
  if (
    typeof customerId !== "string" ||
    !customerId ||
    typeof kind !== "string" ||
    !(VALID_KINDS as readonly string[]).includes(kind) ||
    typeof region !== "string" ||
    !region ||
    typeof instanceUrl !== "string" ||
    !instanceUrl
  ) {
    return {
      status: 400,
      body: {
        error: `customerId, region and instanceUrl (all strings) and kind (one of ${VALID_KINDS.join(", ")}) are required`,
      },
    };
  }

  const customerExists = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customerExists) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  // Region is part of the key now (decision 0083 section 6). A customer
  // may hold a production in the EU and another in the US; what stays
  // refused is two productions in ONE region.
  const existingEnvironment = await db
    .prepare("SELECT id FROM environments WHERE customer_id = ? AND kind = ? AND region = ?")
    .bind(customerId, kind, region)
    .first();
  if (existingEnvironment) {
    return {
      status: 409,
      body: { error: `customer ${customerId} already has a ${kind} environment in ${region}` },
    };
  }

  const workerName = optionalStringField(body.workerName, "workerName");
  if (!workerName.ok) return { status: 400, body: { error: workerName.error } };
  const d1DatabaseName = optionalStringField(body.d1DatabaseName, "d1DatabaseName");
  if (!d1DatabaseName.ok) return { status: 400, body: { error: d1DatabaseName.error } };
  const d1DatabaseId = optionalStringField(body.d1DatabaseId, "d1DatabaseId");
  if (!d1DatabaseId.ok) return { status: 400, body: { error: d1DatabaseId.error } };
  const locale = optionalStringField(body.locale, "locale");
  if (!locale.ok) return { status: 400, body: { error: locale.error } };

  // Region included, because the id was the OTHER place "one production
  // per customer" was encoded: `Morrison-production` would collide
  // between an EU and a US production even with the constraint widened.
  //
  // Ids already issued keep their shape — `Acme-production` is
  // referenced by licences and usage_periods, and the id is opaque
  // everywhere it travels (nothing splits or parses it, checked
  // directly). So a mixed format is untidy and harmless, where
  // rewriting live ids to tidy it would not be.
  const id = `${customerId}-${kind}-${region}`;

  // The plaintext key exists only in this response — only its hash is
  // ever stored, from this point on (see docs/decisions/
  // 0006-endpoint-authentication.md). If it's lost, the fix is
  // rotating it, never recovering it.
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db
    .prepare(
      `INSERT INTO environments
         (id, customer_id, kind, region, instance_url, api_key_hash, worker_name, d1_database_name, d1_database_id, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      customerId,
      kind,
      region,
      instanceUrl,
      apiKeyHash,
      workerName.value,
      d1DatabaseName.value,
      d1DatabaseId.value,
      locale.value
    )
    .run();

  return {
    status: 201,
    body: {
      id,
      customerId,
      kind,
      region,
      instanceUrl,
      apiKey,
      workerName: workerName.value,
      d1DatabaseName: d1DatabaseName.value,
      d1DatabaseId: d1DatabaseId.value,
      locale: locale.value,
    },
  };
}

/**
 * Removing an environment created in error — decision 0085.
 *
 * Deliberately narrow: **an environment that anything references cannot
 * be deleted.** A licence, a usage period or a signup request pointing
 * at it means the environment has a history, and history is not tidied
 * away — `usage_periods` in particular is billing evidence.
 *
 * So this removes exactly one thing: a row created by mistake, before
 * it was used for anything. That is the case it exists for, and it is
 * the only case where deletion is unambiguously safe.
 *
 * The alternative was raw SQL against the live control plane, which is
 * what this project avoids everywhere else — and which offers no
 * protection at all against deleting an environment that does have
 * history.
 */
export async function handleDeleteEnvironment(
  db: D1Database,
  environmentId: string
): Promise<RouteResult> {
  const environment = await db
    .prepare("SELECT id FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ id: string }>();
  if (!environment) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  // Checked explicitly rather than left to the foreign keys. The FK
  // would refuse too, but with a constraint error that says nothing
  // about WHICH reference blocked it — and an operator deciding whether
  // a deletion is safe needs to know that.
  const [licences, usage, signups] = await Promise.all([
    db.prepare("SELECT count(*) AS n FROM licences WHERE environment_id = ?").bind(environmentId).first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n FROM usage_periods WHERE environment_id = ?").bind(environmentId).first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n FROM signup_requests WHERE environment_id = ?").bind(environmentId).first<{ n: number }>(),
  ]);

  const blocking = [
    licences?.n ? `${licences.n} licence(s)` : null,
    usage?.n ? `${usage.n} usage period(s)` : null,
    signups?.n ? `${signups.n} signup request(s)` : null,
  ].filter(Boolean);

  if (blocking.length > 0) {
    return {
      status: 409,
      body: {
        error: `environment ${environmentId} has history and cannot be deleted: ${blocking.join(", ")}`,
        detail: "only an environment created in error, before it was used, can be removed",
      },
    };
  }

  await db.prepare("DELETE FROM environments WHERE id = ?").bind(environmentId).run();
  return { status: 200, body: { deleted: environmentId } };
}

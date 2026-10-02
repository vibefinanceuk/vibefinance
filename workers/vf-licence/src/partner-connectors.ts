import type { RouteResult } from "./customers-route.js";
import { validatePartnerDefinition } from "@vibefinance/shared";

/**
 * **A partner submits a connector — decision 0595**, step 2 of slice 4.
 *
 * Asked by the instance with its own environment key (as invitations
 * are, 0593), on behalf of the person signed in there:
 *
 * - the environment must be the partner's sandbox
 *   (`partners.sandbox_customer_id`) or, since decision 0596, one of a
 *   customer the partner serves; and the partner active;
 * - the person must be one of the partner's people (0592);
 * - the definition must be one a partner connector can carry
 *   (`validatePartnerDefinition`): never an address or a secret;
 * - its audience is every linked customer, or some of them by id.
 *
 * Each submission is a new version of the connector made from that
 * Destination, waiting for VibeFinance's review (step 3). One version at
 * a time waits; the partner may withdraw it.
 */

interface PartnerOfEnv {
  environmentId: string;
  partner: { id: string; name: string; status: "active" | "suspended" } | null;
  /** Where it is built: the partner's own sandbox, or a customer it serves (decision 0596). */
  source: { customerId: string; customerName: string; sandbox: boolean };
}

/**
 * The partner a person works for here. In a partner's **sandbox**, that
 * partner. In **a customer's environment** (decision 0596), the partner
 * linked to that customer of which this person is one of the people;
 * none for anyone else, so the customer's own people never see it.
 */
async function partnerOfEnvironment(db: D1Database, environmentId: string, email: string | null): Promise<PartnerOfEnv | null> {
  const env = await db
    .prepare("SELECT e.customer_id, c.name FROM environments e JOIN customers c ON c.id = e.customer_id WHERE e.id = ?")
    .bind(environmentId)
    .first<{ customer_id: string; name: string }>();
  if (!env) return null;
  const sandboxOf = await db
    .prepare("SELECT id, name, status FROM partners WHERE sandbox_customer_id = ?")
    .bind(env.customer_id)
    .first<{ id: string; name: string; status: "active" | "suspended" }>();
  if (sandboxOf) return { environmentId, partner: sandboxOf, source: { customerId: env.customer_id, customerName: env.name, sandbox: true } };
  const person = (email ?? "").trim().toLowerCase();
  const serving = person
    ? await db
        .prepare(
          `SELECT p.id, p.name, p.status FROM partners p
           JOIN partner_customers pc ON pc.partner_id = p.id AND pc.customer_id = ?
           JOIN partner_people pp ON pp.partner_id = p.id AND pp.email = ?
           ORDER BY lower(p.name) LIMIT 1`
        )
        .bind(env.customer_id, person)
        .first<{ id: string; name: string; status: "active" | "suspended" }>()
    : null;
  return { environmentId, partner: serving ?? null, source: { customerId: env.customer_id, customerName: env.name, sandbox: false } };
}

async function linkedCustomers(db: D1Database, partnerId: string) {
  return (
    await db
      .prepare("SELECT c.id, c.name FROM partner_customers pc JOIN customers c ON c.id = pc.customer_id WHERE pc.partner_id = ? ORDER BY lower(c.name)")
      .bind(partnerId)
      .all<{ id: string; name: string }>()
  ).results;
}

interface VersionRow {
  connector_id: string;
  version: number;
  status: string;
  name: string;
  description: string;
  notes: string | null;
  audience_json: string | null;
  submitted_by: string;
  submitted_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
}

const versionView = (v: VersionRow) => ({
  version: v.version,
  status: v.status,
  name: v.name,
  description: v.description,
  notes: v.notes,
  audience: v.audience_json ? (JSON.parse(v.audience_json) as string[]) : "all",
  submittedBy: v.submitted_by,
  submittedAt: v.submitted_at,
  reviewedAt: v.reviewed_at,
  reviewReason: v.review_reason,
});

/**
 * `GET /environments/:id/partner-connectors?instanceId=&email=` — whether
 * this is a partner's sandbox; if so the partner, its linked customers,
 * whether the person may submit, and the connector made from the
 * Destination named, with its versions.
 */
export async function partnerConnectorState(db: D1Database, environmentId: string, instanceId: string | null, email: string | null): Promise<RouteResult> {
  const found = await partnerOfEnvironment(db, environmentId, email);
  if (!found) return { status: 404, body: { error: "no such environment" } };
  if (!found.partner) return { status: 200, body: { partner: null } };
  const p = found.partner;
  const person = email
    ? await db.prepare("SELECT 1 FROM partner_people WHERE partner_id = ? AND email = ?").bind(p.id, email.trim().toLowerCase()).first()
    : null;
  let connector = null;
  if (instanceId) {
    const c = await db
      .prepare("SELECT id, name, status, suspended_reason FROM partner_connectors WHERE source_environment_id = ? AND source_instance_id = ?")
      .bind(environmentId, instanceId)
      .first<{ id: string; name: string; status: string; suspended_reason: string | null }>();
    if (c) {
      const versions = (await db.prepare("SELECT * FROM partner_connector_versions WHERE connector_id = ? ORDER BY version DESC").bind(c.id).all<VersionRow>()).results;
      // Decision 0600: suspended by VibeFinance, with why.
      connector = { id: c.id, name: c.name, status: c.status, suspendedReason: c.suspended_reason, versions: versions.map(versionView) };
    }
  }
  return {
    status: 200,
    body: {
      partner: { id: p.id, name: p.name, status: p.status },
      customers: await linkedCustomers(db, p.id),
      canSubmit: p.status === "active" && !!person,
      source: found.source,
      connector,
    },
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `POST /environments/:id/partner-connectors` — submit a version for review. */
export async function submitPartnerConnector(db: D1Database, environmentId: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const found = await partnerOfEnvironment(db, environmentId, str(body.submittedBy));
  if (!found) return { status: 404, body: { error: "no such environment" } };
  if (!found.partner) {
    return found.source.sandbox
      ? { status: 403, body: { error: "this is not a partner's sandbox", reason: "not_partner_sandbox" } }
      : { status: 403, body: { error: `only the people of a partner serving ${found.source.customerName} may submit from here`, reason: "not_partner_environment" } };
  }
  const p = found.partner;
  if (p.status !== "active") return { status: 403, body: { error: `${p.name} is suspended`, reason: "partner_suspended" } };
  const email = str(body.submittedBy).toLowerCase();
  const person = email ? await db.prepare("SELECT 1 FROM partner_people WHERE partner_id = ? AND email = ?").bind(p.id, email).first() : null;
  if (!person) return { status: 403, body: { error: `${email || "this person"} is not one of ${p.name}'s people`, reason: "not_partner_person" } };

  const instanceId = str(body.instanceId);
  const name = str(body.name).replace(/\s+/g, " ");
  const description = str(body.description);
  const notes = str(body.notes) || null;
  if (!instanceId) return { status: 400, body: { error: "name the Destination it is made from", reason: "no_instance" } };
  if (!name || name.length > 80) return { status: 400, body: { error: "give it a name of up to 80 characters", reason: "bad_name" } };
  if (!description || description.length > 600) return { status: 400, body: { error: "say what it does, in up to 600 characters", reason: "bad_description" } };
  const invalid = validatePartnerDefinition(body.definition);
  if (invalid) return { status: 422, body: { error: invalid, reason: "invalid_definition" } };

  const linked = (await linkedCustomers(db, p.id)).map((c) => c.id);
  let audience: string[] | null = null;
  if (Array.isArray(body.audience)) {
    audience = [...new Set(body.audience.filter((x): x is string => typeof x === "string"))];
    if (audience.length === 0) return { status: 400, body: { error: "choose at least one customer, or all", reason: "no_audience" } };
    const outside = audience.find((id) => !linked.includes(id));
    if (outside) return { status: 422, body: { error: `${outside} is not a customer ${p.name} serves`, reason: "not_linked" } };
  } else if (body.audience !== "all") {
    return { status: 400, body: { error: "the audience is all, or a list of customers", reason: "no_audience" } };
  }

  let connector = await db
    .prepare("SELECT id, status FROM partner_connectors WHERE source_environment_id = ? AND source_instance_id = ?")
    .bind(environmentId, instanceId)
    .first<{ id: string; status?: string }>();
  // Decision 0600: a suspended connector takes no new versions until VibeFinance reinstates it.
  if (connector?.status === "suspended") return { status: 403, body: { error: "VibeFinance has suspended this connector", reason: "connector_suspended" } };
  if (!connector) {
    const taken = await db.prepare("SELECT id FROM partner_connectors WHERE partner_id = ? AND lower(name) = lower(?)").bind(p.id, name).first();
    if (taken) return { status: 409, body: { error: `${p.name} already has a connector called ${name}`, reason: "connector_name_taken" } };
    connector = { id: crypto.randomUUID() };
    await db
      .prepare("INSERT INTO partner_connectors (id, partner_id, source_environment_id, source_instance_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(connector.id, p.id, environmentId, instanceId, name, now.toISOString())
      .run();
  }
  const waiting = await db.prepare("SELECT version FROM partner_connector_versions WHERE connector_id = ? AND status = 'submitted'").bind(connector.id).first<{ version: number }>();
  if (waiting) return { status: 409, body: { error: `version ${waiting.version} is still waiting for review: withdraw it first`, reason: "already_waiting" } };
  const last = await db.prepare("SELECT COALESCE(MAX(version), 0) AS n FROM partner_connector_versions WHERE connector_id = ?").bind(connector.id).first<{ n: number }>();
  const version = (last?.n ?? 0) + 1;
  await db.batch([
    db
      .prepare(
        `INSERT INTO partner_connector_versions (connector_id, version, status, name, description, notes, audience_json, definition_json, submitted_by, submitted_at)
         VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(connector.id, version, name, description, notes, audience ? JSON.stringify(audience) : null, JSON.stringify(body.definition), email, now.toISOString()),
    db.prepare("UPDATE partner_connectors SET name = ? WHERE id = ?").bind(name, connector.id),
  ]);
  return { status: 201, body: { connectorId: connector.id, version, status: "submitted" } };
}

/** `POST /environments/:id/partner-connectors/withdraw` `{ instanceId, version, submittedBy }` — take back a version still waiting. */
export async function withdrawPartnerConnector(db: D1Database, environmentId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const found = await partnerOfEnvironment(db, environmentId, str(body.submittedBy));
  if (!found?.partner) return { status: 403, body: { error: "only a partner's people may withdraw it here", reason: "not_partner_environment" } };
  const email = str(body.submittedBy).toLowerCase();
  const person = email ? await db.prepare("SELECT 1 FROM partner_people WHERE partner_id = ? AND email = ?").bind(found.partner.id, email).first() : null;
  if (!person) return { status: 403, body: { error: "only the partner's people may withdraw it", reason: "not_partner_person" } };
  const c = await db
    .prepare("SELECT id FROM partner_connectors WHERE source_environment_id = ? AND source_instance_id = ?")
    .bind(environmentId, str(body.instanceId))
    .first<{ id: string }>();
  if (!c) return { status: 404, body: { error: "nothing was submitted from this Destination" } };
  const r = await db
    .prepare("UPDATE partner_connector_versions SET status = 'withdrawn' WHERE connector_id = ? AND version = ? AND status = 'submitted'")
    .bind(c.id, Number(body.version))
    .run();
  if ((r.meta.changes ?? 0) === 0) return { status: 409, body: { error: "that version is not waiting for review", reason: "not_waiting" } };
  return { status: 200, body: { version: Number(body.version), status: "withdrawn" } };
}

/**
 * `GET /environments/:id/library-connectors` — **the partner connectors
 * this environment's Route library offers — decision 0601**, step 4 of
 * slice 4. For each connector of an active partner that serves this
 * environment's customer (or whose sandbox it is), not suspended: its
 * latest version VibeFinance approved whose audience includes the
 * customer, with its definition. The instance keeps a copy of each
 * version it uses, so nothing changes under a customer without Upgrade.
 */
export async function libraryConnectorsFor(db: D1Database, environmentId: string): Promise<RouteResult> {
  const env = await db.prepare("SELECT customer_id FROM environments WHERE id = ?").bind(environmentId).first<{ customer_id: string }>();
  if (!env) return { status: 404, body: { error: "no such environment" } };
  const customer = env.customer_id;
  const rows = (
    await db
      .prepare(
        `SELECT v.connector_id, v.version, v.name, v.description, v.audience_json, v.definition_json, v.reviewed_at,
                p.id AS partner_id, p.name AS partner_name, p.sandbox_customer_id
           FROM partner_connector_versions v
           JOIN partner_connectors c ON c.id = v.connector_id AND c.status = 'active'
           JOIN partners p ON p.id = c.partner_id AND p.status = 'active'
          WHERE v.status = 'approved'
            AND (p.sandbox_customer_id = ? OR EXISTS (SELECT 1 FROM partner_customers pc WHERE pc.partner_id = p.id AND pc.customer_id = ?))
          ORDER BY lower(v.name), v.connector_id, v.version DESC`
      )
      .bind(customer, customer)
      .all<{
        connector_id: string;
        version: number;
        name: string;
        description: string;
        audience_json: string | null;
        definition_json: string;
        reviewed_at: string | null;
        partner_id: string;
        partner_name: string;
        sandbox_customer_id: string;
      }>()
  ).results;
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (chosen.has(r.connector_id)) continue;
    const audience = r.audience_json ? (JSON.parse(r.audience_json) as string[]) : null;
    if (r.sandbox_customer_id === customer || audience === null || audience.includes(customer)) chosen.set(r.connector_id, r);
  }
  return {
    status: 200,
    body: {
      connectors: [...chosen.values()].map((r) => ({
        connectorId: r.connector_id,
        version: r.version,
        name: r.name,
        description: r.description,
        partner: { id: r.partner_id, name: r.partner_name },
        approvedAt: r.reviewed_at,
        definition: JSON.parse(r.definition_json) as unknown,
      })),
    },
  };
}

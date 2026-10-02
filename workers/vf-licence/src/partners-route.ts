import type { RouteResult } from "./customers-route.js";

/**
 * **Partners — decision 0592**, step 1 of slice 4 of the connector
 * framework (Dan, 1 October 2026).
 *
 * A partner is a system integrator, and its own record: created by
 * VibeFinance in the operator console, with its people by email, linked
 * to the customers it serves. Later steps let it submit connectors from
 * its sandbox, which VibeFinance approves before its linked customers
 * see them.
 *
 * **Its sandbox is an ordinary customer record**, made with the partner
 * (`partner-<id>`), so its environments are provisioned, signed in to and
 * granted exactly as any customer's. A partner's people are given
 * credentials and access there through the routes that exist; this says
 * which of them can reach the sandbox, so the gap is visible.
 *
 * Every route here is privileged (the operator's), and recorded in the
 * admin log at the edge, as every other.
 */

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const now = () => new Date().toISOString();

interface PartnerRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  sandbox_customer_id: string;
  created_at: string;
  created_by: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  suspended_reason: string | null;
}

/** `id|status|expiresAt|sendError`, from the list's subquery, as an object; a pending one past its time is expired. */
function invitationOf(packed: string | null) {
  if (!packed) return null;
  const [id, status, expiresAt, ...rest] = packed.split("|");
  const sendError = rest.join("|") || null;
  return { id, status: status === "pending" && new Date(expiresAt).getTime() <= Date.now() ? "expired" : status, expiresAt, sendError };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function partnerOf(db: D1Database, id: string): Promise<PartnerRow | null> {
  return db.prepare("SELECT * FROM partners WHERE id = ?").bind(id).first<PartnerRow>();
}

/** `GET /partners` — each partner with its people, its customers, and its sandbox's environments. */
export async function handleListPartners(db: D1Database): Promise<RouteResult> {
  const partners = (await db.prepare("SELECT * FROM partners ORDER BY lower(name)").all<PartnerRow>()).results;
  const out = [];
  for (const p of partners) {
    const environments = (
      await db
        .prepare("SELECT id, kind, region, instance_url FROM environments WHERE customer_id = ? ORDER BY kind")
        .bind(p.sandbox_customer_id)
        .all<{ id: string; kind: string; region: string; instance_url: string }>()
    ).results;
    const people = (
      await db
        .prepare(
          `SELECT pp.email, pp.added_at,
                  EXISTS (SELECT 1 FROM user_credentials c WHERE c.email = pp.email AND c.customer_id = ?) AS has_credential,
                  (SELECT count(*) FROM user_environment_access a JOIN environments e ON e.id = a.environment_id
                    WHERE a.email = pp.email AND e.customer_id = ?) AS environments,
                  (SELECT i.id || '|' || i.status || '|' || i.expires_at || '|' || COALESCE(i.send_error, '') FROM invitations i
                    WHERE i.email = pp.email AND i.customer_id = ? ORDER BY i.created_at DESC LIMIT 1) AS invitation
           FROM partner_people pp WHERE pp.partner_id = ? ORDER BY pp.email`
        )
        .bind(p.sandbox_customer_id, p.sandbox_customer_id, p.sandbox_customer_id, p.id)
        .all<{ email: string; added_at: string; has_credential: number; environments: number; invitation: string | null }>()
    ).results;
    const customers = (
      await db
        .prepare(
          `SELECT c.id, c.name, pc.linked_at, pc.linked_by FROM partner_customers pc JOIN customers c ON c.id = pc.customer_id
           WHERE pc.partner_id = ? ORDER BY lower(c.name)`
        )
        .bind(p.id)
        .all<{ id: string; name: string; linked_at: string; linked_by: string | null }>()
    ).results;
    out.push({
      id: p.id,
      name: p.name,
      status: p.status,
      createdAt: p.created_at,
      createdBy: p.created_by,
      suspended: p.status === "suspended" ? { at: p.suspended_at, by: p.suspended_by, reason: p.suspended_reason } : null,
      sandbox: {
        customerId: p.sandbox_customer_id,
        environments: environments.map((e) => ({ id: e.id, kind: e.kind, region: e.region, instanceUrl: e.instance_url })),
      },
      people: people.map((x) => ({
        email: x.email,
        addedAt: x.added_at,
        // Whether they can sign in to the sandbox yet: a password for it, and access to its environments.
        canSignIn: x.has_credential === 1 && x.environments > 0,
        hasCredential: x.has_credential === 1,
        environments: x.environments,
        // Decision 0593: their latest invitation to the sandbox.
        invitation: invitationOf(x.invitation),
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name, linkedAt: c.linked_at, linkedBy: c.linked_by })),
    });
  }
  return { status: 200, body: { partners: out } };
}

/** `GET /customers` — every customer, for linking; a partner's own sandbox says whose it is. */
export async function handleListCustomers(db: D1Database): Promise<RouteResult> {
  const rows = (
    await db
      .prepare(
        `SELECT c.id, c.name, c.created_at, p.id AS partner_id FROM customers c LEFT JOIN partners p ON p.sandbox_customer_id = c.id
         ORDER BY lower(c.name)`
      )
      .all<{ id: string; name: string; created_at: string; partner_id: string | null }>()
  ).results;
  return { status: 200, body: { customers: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, sandboxOf: r.partner_id })) } };
}

/** `POST /partners` `{ id, name }` — the partner, and its sandbox's customer record. */
export async function handleCreatePartner(db: D1Database, actor: string, body: Record<string, unknown>): Promise<RouteResult> {
  const id = str(body.id).toLowerCase();
  const name = str(body.name).replace(/\s+/g, " ");
  if (!ID.test(id)) return { status: 400, body: { error: "the id is 2 to 40 lower-case letters, digits and hyphens", reason: "bad_id" } };
  if (!name || name.length > 120) return { status: 400, body: { error: "give the partner a name", reason: "bad_name" } };
  if (await partnerOf(db, id)) return { status: 409, body: { error: `partner ${id} already exists`, reason: "exists" } };
  const sandbox = `partner-${id}`;
  if (await db.prepare("SELECT id FROM customers WHERE id = ?").bind(sandbox).first()) {
    return { status: 409, body: { error: `customer ${sandbox} already exists`, reason: "sandbox_exists" } };
  }
  const nameTaken = await db.prepare("SELECT id FROM partners WHERE lower(name) = lower(?)").bind(name).first();
  if (nameTaken) return { status: 409, body: { error: `a partner is already called ${name}`, reason: "name_taken" } };
  await db.batch([
    db.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").bind(sandbox, `${name} (partner sandbox)`),
    db.prepare("INSERT INTO partners (id, name, sandbox_customer_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, name, sandbox, now(), actor),
  ]);
  return { status: 201, body: { id, name, status: "active", sandboxCustomerId: sandbox } };
}

/** `POST|DELETE /partners/:id/people` `{ email }` — one of its people, added or removed. */
export async function handlePartnerPerson(db: D1Database, actor: string, id: string, method: "POST" | "DELETE", body: Record<string, unknown>): Promise<RouteResult> {
  const partner = await partnerOf(db, id);
  if (!partner) return { status: 404, body: { error: `partner ${id} does not exist` } };
  const email = str(body.email).toLowerCase();
  if (!EMAIL.test(email)) return { status: 400, body: { error: "give an email address", reason: "bad_email" } };
  if (method === "DELETE") {
    const r = await db.prepare("DELETE FROM partner_people WHERE partner_id = ? AND email = ?").bind(id, email).run();
    return { status: 200, body: { removed: (r.meta.changes ?? 0) > 0, note: "removed from the partner; sandbox sign-in, if any, is unchanged" } };
  }
  const exists = await db.prepare("SELECT 1 FROM partner_people WHERE partner_id = ? AND email = ?").bind(id, email).first();
  if (exists) return { status: 409, body: { error: `${email} is already one of ${partner.name}'s people`, reason: "exists" } };
  await db.prepare("INSERT INTO partner_people (partner_id, email, added_at, added_by) VALUES (?, ?, ?, ?)").bind(id, email, now(), actor).run();
  return { status: 201, body: { partnerId: id, email } };
}

/** `POST|DELETE /partners/:id/customers` `{ customerId }` — a customer it serves, linked or unlinked. */
export async function handlePartnerCustomer(db: D1Database, actor: string, id: string, method: "POST" | "DELETE", body: Record<string, unknown>): Promise<RouteResult> {
  const partner = await partnerOf(db, id);
  if (!partner) return { status: 404, body: { error: `partner ${id} does not exist` } };
  const customerId = str(body.customerId);
  if (method === "DELETE") {
    const r = await db.prepare("DELETE FROM partner_customers WHERE partner_id = ? AND customer_id = ?").bind(id, customerId).run();
    return { status: 200, body: { unlinked: (r.meta.changes ?? 0) > 0 } };
  }
  const customer = await db.prepare("SELECT id, name FROM customers WHERE id = ?").bind(customerId).first<{ id: string; name: string }>();
  if (!customer) return { status: 404, body: { error: `customer ${customerId} does not exist`, reason: "no_customer" } };
  // A sandbox is a partner's workshop, never a customer it serves.
  if (await db.prepare("SELECT id FROM partners WHERE sandbox_customer_id = ?").bind(customerId).first()) {
    return { status: 422, body: { error: `${customer.name} is a partner's sandbox, not a customer`, reason: "sandbox" } };
  }
  const exists = await db.prepare("SELECT 1 FROM partner_customers WHERE partner_id = ? AND customer_id = ?").bind(id, customerId).first();
  if (exists) return { status: 409, body: { error: `${partner.name} already serves ${customer.name}`, reason: "exists" } };
  await db.prepare("INSERT INTO partner_customers (partner_id, customer_id, linked_at, linked_by) VALUES (?, ?, ?, ?)").bind(id, customerId, now(), actor).run();
  return { status: 201, body: { partnerId: id, customerId } };
}

/**
 * `POST /partners/:id/suspend` `{ reason }` and `POST /partners/:id/reinstate`.
 * Suspended, its connectors leave customers' libraries (a later step);
 * nothing already made from them stops.
 */
export async function handleSuspendPartner(db: D1Database, actor: string, id: string, suspend: boolean, body: Record<string, unknown>): Promise<RouteResult> {
  const partner = await partnerOf(db, id);
  if (!partner) return { status: 404, body: { error: `partner ${id} does not exist` } };
  if (suspend) {
    if (partner.status === "suspended") return { status: 409, body: { error: `${partner.name} is already suspended`, reason: "already" } };
    const reason = str(body.reason);
    if (!reason) return { status: 400, body: { error: "say why it is suspended", reason: "no_reason" } };
    await db
      .prepare("UPDATE partners SET status = 'suspended', suspended_at = ?, suspended_by = ?, suspended_reason = ? WHERE id = ?")
      .bind(now(), actor, reason.slice(0, 500), id)
      .run();
    return { status: 200, body: { id, status: "suspended" } };
  }
  if (partner.status === "active") return { status: 409, body: { error: `${partner.name} is not suspended`, reason: "already" } };
  await db.prepare("UPDATE partners SET status = 'active', suspended_at = NULL, suspended_by = NULL, suspended_reason = NULL WHERE id = ?").bind(id).run();
  return { status: 200, body: { id, status: "active" } };
}

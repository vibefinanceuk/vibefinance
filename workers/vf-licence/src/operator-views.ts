import type { RouteResult } from "./customers-route.js";

/**
 * **What the operator console's new screens read — decision 0603.**
 *
 * Dan asked for the console to be laid out like the main site, with a
 * side menu by activity. Two screens had no route to read from: the fleet
 * by customer, and the people who can sign in. Both are privileged, and
 * the edge records them in the admin log as every privileged route is.
 *
 * Nothing secret leaves: no key or password hash, only whether a person
 * has a password and which environments they may reach.
 */

const PLACEHOLDER = "not-yet-deployed.invalid";

/**
 * `GET /fleet-overview` — every customer, with its environments, whether
 * each is deployed, its licence, and how many people can sign in.
 */
export async function handleFleetOverview(db: D1Database): Promise<RouteResult> {
  const customers = (
    await db
      .prepare(
        `SELECT c.id, c.name, c.created_at, p.id AS partner_id, p.name AS partner_name,
                (SELECT count(*) FROM user_credentials u WHERE u.customer_id = c.id) AS people
           FROM customers c LEFT JOIN partners p ON p.sandbox_customer_id = c.id
          ORDER BY lower(c.name)`
      )
      .all<{ id: string; name: string; created_at: string; partner_id: string | null; partner_name: string | null; people: number }>()
  ).results;
  const environments = (
    await db
      .prepare(
        `SELECT e.id, e.customer_id, e.kind, e.region, e.instance_url, e.worker_name, e.d1_database_name, e.locale, e.created_at,
                l.plan, l.status AS licence_status, l.status_reason, l.volume_entitlement, l.valid_from, l.valid_to, l.features_json, l.agent_limit, l.summary_limit,
                (SELECT count(*) FROM user_environment_access a WHERE a.environment_id = e.id) AS people
           FROM environments e LEFT JOIN licences l ON l.environment_id = e.id
          ORDER BY e.customer_id, e.kind, e.id`
      )
      .all<{
        id: string;
        customer_id: string;
        kind: string;
        region: string;
        instance_url: string;
        worker_name: string | null;
        d1_database_name: string | null;
        locale: string | null;
        created_at: string;
        plan: string | null;
        licence_status: string | null;
        status_reason: string | null;
        volume_entitlement: number | null;
        valid_from: string | null;
        valid_to: string | null;
        features_json: string | null;
        agent_limit: number | null;
        summary_limit: number | null;
        people: number;
      }>()
  ).results;
  const byCustomer = new Map<string, unknown[]>();
  for (const e of environments) {
    byCustomer.set(e.customer_id, [
      ...(byCustomer.get(e.customer_id) ?? []),
      {
        id: e.id,
        kind: e.kind,
        region: e.region,
        instanceUrl: e.instance_url,
        deployed: !e.instance_url.includes(PLACEHOLDER),
        workerName: e.worker_name,
        d1DatabaseName: e.d1_database_name,
        locale: e.locale,
        createdAt: e.created_at,
        people: e.people,
        licence: e.plan
          ? {
              plan: e.plan,
              status: e.licence_status,
              statusReason: e.status_reason,
              volumeEntitlement: e.volume_entitlement,
              agentLimit: e.agent_limit,
              summaryLimit: e.summary_limit,
              validFrom: e.valid_from,
              validTo: e.valid_to,
              features: e.features_json ? (JSON.parse(e.features_json) as string[]) : [],
            }
          : null,
      },
    ]);
  }
  return {
    status: 200,
    body: {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        sandboxOf: c.partner_id ? { id: c.partner_id, name: c.partner_name } : null,
        people: c.people,
        environments: byCustomer.get(c.id) ?? [],
      })),
    },
  };
}

/**
 * `GET /people?customerId=` — everyone who has a password for a customer:
 * since when, which of its environments they may reach (granted when and
 * by whom), and the partner they are one of the people of, if any.
 */
export async function handlePeople(db: D1Database, customerId: string | null): Promise<RouteResult> {
  const people = (
    await db
      .prepare(
        `SELECT u.email, u.customer_id, c.name AS customer_name, u.created_at, u.updated_at
           FROM user_credentials u JOIN customers c ON c.id = u.customer_id
          ${customerId ? "WHERE u.customer_id = ?" : ""}
          ORDER BY lower(c.name), u.email`
      )
      .bind(...(customerId ? [customerId] : []))
      .all<{ email: string; customer_id: string; customer_name: string; created_at: string; updated_at: string | null }>()
  ).results;
  const grants = (
    await db
      .prepare(
        `SELECT a.email, a.customer_id, a.environment_id, a.granted_at, a.granted_by, e.kind
           FROM user_environment_access a JOIN environments e ON e.id = a.environment_id
          ORDER BY a.environment_id`
      )
      .all<{ email: string; customer_id: string; environment_id: string; granted_at: string | null; granted_by: string | null; kind: string }>()
  ).results;
  const partners = (
    await db.prepare("SELECT pp.email, p.name FROM partner_people pp JOIN partners p ON p.id = pp.partner_id").all<{ email: string; name: string }>()
  ).results;
  const environments = (
    await db.prepare("SELECT id, customer_id, kind FROM environments ORDER BY customer_id, kind, id").all<{ id: string; customer_id: string; kind: string }>()
  ).results;
  return {
    status: 200,
    body: {
      people: people.map((p) => ({
        email: p.email,
        customerId: p.customer_id,
        customerName: p.customer_name,
        since: p.created_at,
        passwordChangedAt: p.updated_at,
        environments: grants
          .filter((g) => g.email === p.email && g.customer_id === p.customer_id)
          .map((g) => ({ id: g.environment_id, kind: g.kind, grantedAt: g.granted_at, grantedBy: g.granted_by })),
        partnerOf: partners.filter((x) => x.email === p.email).map((x) => x.name),
      })),
      // What each customer has, so a grant can be offered.
      environments: environments.map((e) => ({ id: e.id, customerId: e.customer_id, kind: e.kind })),
    },
  };
}

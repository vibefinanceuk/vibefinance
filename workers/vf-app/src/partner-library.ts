import {
  STANDARD_CONNECTORS,
  listsInOutbound,
  partnerLibraryEntry,
  renameLists,
  validatePartnerDefinition,
  type ConnectorDefinition,
  type OutboundMapping,
  type PartnerConnectorDefinition,
} from "@vibefinance/shared";
import { askLicence, type LicenceLink } from "./invitations-route.js";
import { handleCreateLookupList } from "./lookup-lists-route.js";

/**
 * **Partner connectors in the Route library — decision 0601**, step 4 of
 * slice 4 of the connector framework.
 *
 * When the library opens, the instance asks the control plane, with its
 * own key, which partner connectors it offers this customer: each
 * connector's latest version VibeFinance approved (0600), of a partner
 * that serves the customer, for an audience the customer is in. It keeps
 * a copy of each version (`partner_connector_copies`), so:
 *
 * - a Destination made from one never changes without **Upgrade**;
 * - one no longer offered (suspended, its partner unlinked or suspended)
 *   leaves the library, and the Destinations made from it keep working
 *   from their copy;
 * - the rest of the instance (adding, saving, the mapping, upgrading)
 *   treats it as a standard connector, from `connectorLibrary`.
 */

interface CopyRow {
  id: string;
  version: number;
  partner_id: string;
  partner_name: string;
  name: string;
  description: string;
  definition_json: string;
  offered: number;
}

function entryOf(r: CopyRow, offered: boolean): ConnectorDefinition {
  return partnerLibraryEntry(
    {
      connectorId: r.id.replace(/^partner:/, ""),
      version: r.version,
      name: r.name,
      description: r.description,
      partner: { id: r.partner_id, name: r.partner_name },
      offered,
    },
    JSON.parse(r.definition_json) as PartnerConnectorDefinition
  );
}

/**
 * Asks the control plane what it offers now, keeps a copy of each version,
 * and marks which are offered. Without a link to the control plane (a
 * local instance), there is nothing to ask and the copies stand.
 */
export async function refreshPartnerConnectors(db: D1Database, link: LicenceLink | null, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (!link) return { ok: true };
  const r = await askLicence(link, "GET", "/library-connectors");
  if (r.status >= 400) return { ok: false, error: String(r.body.error ?? `the control plane answered ${r.status}`) };
  const offered = ((r.body.connectors ?? []) as Array<Record<string, unknown>>).filter((c) => validatePartnerDefinition(c.definition) === null);
  const at = now.toISOString();
  const statements = [db.prepare("UPDATE partner_connector_copies SET offered = 0")];
  for (const c of offered) {
    const partner = (c.partner ?? {}) as { id?: string; name?: string };
    statements.push(
      db
        .prepare(
          `INSERT INTO partner_connector_copies (id, version, partner_id, partner_name, name, description, definition_json, approved_at, fetched_at, offered)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT (id, version) DO UPDATE SET partner_name = excluded.partner_name, fetched_at = excluded.fetched_at, offered = 1`
        )
        .bind(
          `partner:${String(c.connectorId)}`,
          Number(c.version),
          String(partner.id ?? ""),
          String(partner.name ?? ""),
          String(c.name ?? ""),
          String(c.description ?? ""),
          JSON.stringify(c.definition),
          typeof c.approvedAt === "string" ? c.approvedAt : null,
          at
        )
    );
  }
  await db.batch(statements);
  return { ok: true };
}

/**
 * The partner connectors this instance knows: for each, the version
 * offered now, or (no longer offered) the latest it kept, as withdrawn.
 */
export async function partnerLibrary(db: D1Database): Promise<ConnectorDefinition[]> {
  const rows = (await db.prepare("SELECT * FROM partner_connector_copies ORDER BY id, version DESC").all<CopyRow>()).results;
  const byId = new Map<string, CopyRow[]>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  return [...byId.values()].map((versions) => {
    const offered = versions.find((v) => v.offered === 1);
    return entryOf(offered ?? versions[0], !!offered);
  });
}

/** Every connector this instance can resolve: the standard ones, and the partners' it has seen. */
export async function connectorLibrary(db: D1Database): Promise<ConnectorDefinition[]> {
  return [...STANDARD_CONNECTORS, ...(await partnerLibrary(db))];
}

/** One version of a partner connector, as kept. */
export async function partnerCopy(db: D1Database, id: string, version: number): Promise<ConnectorDefinition | null> {
  const r = await db.prepare("SELECT * FROM partner_connector_copies WHERE id = ? AND version = ?").bind(id, version).first<CopyRow>();
  return r ? entryOf(r, r.offered === 1) : null;
}

/**
 * A connector's mapping with this customer's look-up lists in place of
 * their names. A list it needs that the customer does not have is made,
 * empty, for them to fill in; the names made are returned.
 */
export async function mappingForCustomer(
  db: D1Database,
  userId: string,
  connector: ConnectorDefinition,
  create: boolean
): Promise<{ mapping: OutboundMapping; created: string[] } | null> {
  if (!connector.outboundMapping) return null;
  const ids = new Map<string, string>();
  const created: string[] = [];
  for (const name of listsInOutbound(connector.outboundMapping)) {
    const found = await db.prepare("SELECT id FROM lookup_lists WHERE status = 'active' AND lower(name) = lower(?)").bind(name).first<{ id: string }>();
    if (found) ids.set(name, found.id);
    else if (create) {
      const made = await handleCreateLookupList(db, userId, { name, description: `Needed by ${connector.name ?? connector.id}` });
      if (made.status !== 201) throw new Error(`could not make the look-up list ${name}`);
      ids.set(name, (made.body as { id: string }).id);
      created.push(name);
    }
  }
  return { mapping: renameLists(connector.outboundMapping, (name) => ids.get(name) ?? name), created };
}

/** Puts a connector's mapping live on a Destination: its next version, the one before retired. */
export async function installMapping(db: D1Database, instanceId: string, userId: string, connector: ConnectorDefinition, mapping: OutboundMapping): Promise<number> {
  const last = await db.prepare("SELECT COALESCE(MAX(version), 0) AS n FROM outbound_mapping_versions WHERE instance_id = ?").bind(instanceId).first<{ n: number }>();
  const version = (last?.n ?? 0) + 1;
  const at = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE outbound_mapping_versions SET status = 'retired' WHERE instance_id = ? AND status = 'live'").bind(instanceId),
    db
      .prepare(
        `INSERT INTO outbound_mapping_versions (instance_id, version, status, definition_json, copied_from, saved_at, saved_by, published_at, published_by)
         VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?)`
      )
      .bind(instanceId, version, JSON.stringify(mapping), `${connector.id}@${connector.version}`, at, userId, at, userId),
  ]);
  return version;
}

/** The look-up lists a connector reads, and how many entries each of this customer's has: an empty one needs filling in. */
export async function listsNeeded(db: D1Database, connector: ConnectorDefinition): Promise<Array<{ name: string; entries: number; exists: boolean }>> {
  const out = [];
  for (const name of connector.lookupLists ?? []) {
    const list = await db.prepare("SELECT id FROM lookup_lists WHERE status = 'active' AND lower(name) = lower(?)").bind(name).first<{ id: string }>();
    const n = list ? await db.prepare("SELECT count(*) AS n FROM lookup_entries WHERE list_id = ?").bind(list.id).first<{ n: number }>() : null;
    out.push({ name, entries: n?.n ?? 0, exists: !!list });
  }
  return out;
}

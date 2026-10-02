import { unitIdsOf } from "./destination-units.js";
import { STANDARD_CONNECTORS, connectorOfInstance } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { eligibleInvoiceIds } from "./erp-export-route.js";
import { processEnds } from "./process-ends.js";

export { processEnds };

/**
 * **Routes and where they are placed — decision 0557**, slice 3 of
 * `docs/design/routes-phase1-data-model.md`.
 *
 * Two reads for two screens:
 *
 * - `GET /routes`: every route, its live version's five parts, and how
 *   many processes it is placed in. The Routes screen, read-only in this
 *   slice: VibeFinance's standard routes, which copying and new versions
 *   (slice 5 and phase 2) will build on.
 * - `GET /process-routes?process=`: one process as a flow: its stages in
 *   order, its entry and exit stages, the Source instances that deliver
 *   to its entry stage (each a source, with its address, org and this
 *   week's traffic from the Route monitor's messages), and the
 *   Destination instances that read from its exit stage.
 *
 * Gated like Sources was, on `Admin.Configure`: this is the screen that
 * replaces it, and changing where invoices arrive still goes through the
 * `/sources` routes it always did.
 */

interface VersionRow {
  route_id: string;
  version: number;
  status: string;
  receiving_gateway: string;
  receiving_format: string;
  translation: string;
  delivery_format: string;
  delivery_gateway: string;
  published_at: string | null;
}

function partsOf(v: VersionRow) {
  return {
    version: v.version,
    status: v.status,
    receivingGateway: v.receiving_gateway,
    receivingFormat: v.receiving_format,
    translation: v.translation,
    deliveryFormat: v.delivery_format,
    deliveryGateway: v.delivery_gateway,
    publishedAt: v.published_at,
  };
}

/**
 * The version a route runs: its live one, or — for a route with none
 * yet, such as SFTP in — its latest draft, so the screen can still show
 * what it would be.
 */
async function currentVersions(db: D1Database): Promise<Map<string, VersionRow>> {
  const rows = await db
    .prepare(
      `SELECT * FROM route_versions ORDER BY route_id, CASE status WHEN 'live' THEN 0 ELSE 1 END, version DESC`
    )
    .all<VersionRow>();
  const byRoute = new Map<string, VersionRow>();
  for (const r of rows.results) if (!byRoute.has(r.route_id)) byRoute.set(r.route_id, r);
  return byRoute;
}

export async function handleListRoutes(db: D1Database): Promise<RouteResult> {
  const routes = await db
    .prepare(
      `SELECT r.id, r.direction, r.name, r.origin, r.copied_from, r.status,
              (SELECT count(DISTINCT i.process_id) FROM route_instances i
                 LEFT JOIN sources s ON s.id = i.source_id
                 WHERE i.route_id = r.id AND COALESCE(s.status, i.status) != 'retired') AS processes,
              (SELECT count(*) FROM route_instances i
                 LEFT JOIN sources s ON s.id = i.source_id
                 WHERE i.route_id = r.id AND COALESCE(s.status, i.status) != 'retired') AS instances
       FROM routes r
       ORDER BY r.direction DESC, r.origin DESC, r.name`
    )
    .all<{
      id: string;
      direction: string;
      name: string;
      origin: string;
      copied_from: string | null;
      status: string;
      processes: number;
      instances: number;
    }>();
  const versions = await currentVersions(db);
  const processNames = await db
    .prepare(
      `SELECT DISTINCT i.route_id, p.name FROM route_instances i
       JOIN processes p ON p.id = i.process_id
       LEFT JOIN sources s ON s.id = i.source_id
       WHERE COALESCE(s.status, i.status) != 'retired'
       ORDER BY p.name`
    )
    .all<{ route_id: string; name: string }>();

  /**
   * **What each Source route has received, by format — decision 0560.**
   * The last 30 days of attachments, counted by the format recognised in
   * each (`format` on the part), whether it came inside a PDF, and how
   * many broke an EN 16931 rule. An attachment with no format was read
   * as a picture (`picture`) or not read at all (`unread`).
   */
  const formatRows = await db
    .prepare(
      `SELECT i.route_id,
              COALESCE(p.format, CASE WHEN p.outcome = 'captured' THEN 'picture' ELSE 'unread' END) AS format,
              CASE WHEN p.format IS NOT NULL AND (lower(p.content_type) LIKE '%pdf%' OR lower(p.filename) LIKE '%.pdf') THEN 1 ELSE 0 END AS in_pdf,
              count(*) AS received,
              sum(CASE WHEN p.en16931_failed IS NOT NULL AND p.en16931_failed != '[]' THEN 1 ELSE 0 END) AS failing
       FROM route_message_parts p
       JOIN route_messages m ON m.id = p.message_id
       JOIN route_instances i ON i.source_id = m.instance_id
       WHERE p.role = 'attachment' AND m.direction = 'in'
         AND m.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
       GROUP BY 1, 2, 3
       ORDER BY received DESC`
    )
    .all<{ route_id: string; format: string; in_pdf: number; received: number; failing: number }>();

  return {
    status: 200,
    body: {
      routes: routes.results.map((r) => {
        const v = versions.get(r.id);
        return {
          id: r.id,
          direction: r.direction,
          name: r.name,
          origin: r.origin,
          copiedFrom: r.copied_from,
          status: r.status,
          current: v ? partsOf(v) : null,
          live: v?.status === "live",
          processes: r.processes,
          instances: r.instances,
          placedIn: processNames.results.filter((p) => p.route_id === r.id).map((p) => p.name),
          formats30d: formatRows.results
            .filter((f) => f.route_id === r.id)
            .map((f) => ({ format: f.format, inPdf: f.in_pdf === 1, received: f.received, failing: f.failing ?? 0 })),
        };
      }),
    },
  };
}

export async function handleProcessRoutes(
  db: D1Database,
  params: URLSearchParams,
  now: Date = new Date()
): Promise<RouteResult> {
  const processes = await db
    .prepare(
      `SELECT p.id, p.name,
              (SELECT count(*) FROM sources s WHERE s.process_id = p.id) AS sources
       FROM processes p ORDER BY p.name`
    )
    .all<{ id: string; name: string; sources: number }>();

  // The process asked for, or the first that receives anything.
  const asked = params.get("process");
  const chosen =
    processes.results.find((p) => p.id === asked) ??
    processes.results.find((p) => p.sources > 0) ??
    processes.results.at(0) ??
    null;
  if (!chosen) {
    return { status: 200, body: { processes: [], process: null, sources: [], destinations: [] } };
  }

  const ends = await processEnds(db, chosen.id);
  const versions = await currentVersions(db);
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();

  const sources = await db
    .prepare(
      `SELECT s.*, i.route_id, r.name AS route_name,
              (SELECT count(*) FROM route_messages m WHERE m.instance_id = s.id AND m.received_at >= ?) AS received_week,
              (SELECT count(*) FROM route_messages m WHERE m.instance_id = s.id AND m.status IN ('failed', 'partial')) AS failed_open,
              -- Decision 0580: an HTTPS source receives once it has a live key.
              (SELECT count(*) FROM source_keys k WHERE k.source_id = s.id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)) AS live_keys
       FROM sources s
       JOIN route_instances i ON i.source_id = s.id
       JOIN routes r ON r.id = i.route_id
       WHERE s.process_id = ?
       ORDER BY CASE s.status WHEN 'retired' THEN 1 ELSE 0 END, s.name`
    )
    .bind(weekAgo, now.toISOString(), chosen.id)
    .all<Record<string, unknown>>();

  const destinations = await db
    .prepare(
      `SELECT i.id, i.name, i.status, i.route_id, i.started_at, i.unit_ids, i.connector_id, i.connector_version, r.name AS route_name,
              -- Decision 0585: what an HTTPS out Destination has waiting, and what failed.
              (SELECT count(*) FROM destination_deliveries d WHERE d.instance_id = i.id AND d.status IN ('pending', 'retrying')) AS sending,
              (SELECT count(*) FROM destination_deliveries d WHERE d.instance_id = i.id AND d.status = 'failed') AS failed
       FROM route_instances i JOIN routes r ON r.id = i.route_id
       WHERE i.process_id = ? AND i.source_id IS NULL
       -- Decision 0597: a retired Destination stays on the flow, last and dimmed, as a retired Source does.
       ORDER BY i.status = 'retired', i.route_id != 'erp-csv', i.name`
    )
    .bind(chosen.id)
    .all<{ id: string; name: string; status: string; route_id: string; route_name: string; started_at: string | null; unit_ids: string | null; connector_id: string | null; connector_version: number | null; sending: number; failed: number }>();

  /**
   * **What is waiting for the ERP**, for the ERP Destination's card: this
   * process's payment-eligible invoices not yet exported, counted the way
   * the export takes them (0558). A paused Destination's are still
   * counted, as waiting for it to resume.
   */
  const erpWaiting = (await eligibleInvoiceIds(db, null, chosen.id, true)).length;

  const version = (routeId: string) => {
    const v = versions.get(routeId);
    return v ? { live: v.status === "live", ...partsOf(v) } : null;
  };

  return {
    status: 200,
    body: {
      processes: processes.results.map((p) => ({ id: p.id, name: p.name })),
      process: {
        id: chosen.id,
        name: chosen.name,
        stages: ends.stages.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence })),
        entryStageId: ends.entryStageId,
        exitStageId: ends.exitStageId,
      },
      sources: sources.results.map((s) => ({
        id: s.id,
        name: s.name,
        mechanism: s.mechanism,
        status: s.status ?? "active",
        emailAddress: s.email_address ?? null,
        emailRouting: s.email_routing ?? "not_configured",
        defaultOrgUnitId: s.default_org_unit_id ?? null,
        routeId: s.route_id,
        routeName: s.route_name,
        route: version(String(s.route_id)),
        receivedThisWeek: s.received_week,
        failedOpen: s.failed_open,
        liveKeys: s.live_keys,
      })),
      destinations: destinations.results.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        routeId: d.route_id,
        routeName: d.route_name,
        route: version(d.route_id),
        waiting: d.route_id === "erp-csv" ? erpWaiting : d.sending,
        // Decision 0585.
        started: d.route_id === "erp-csv" || d.started_at !== null,
        failedOpen: d.failed,
        // Decision 0587: the business units it sends for; null is all.
        unitIds: unitIdsOf(d),
        // Decision 0589: the connector it was made from, and whether a later version waits.
        connectorId: d.connector_id ?? d.route_id,
        connectorUpgrade: (connectorOfInstance(STANDARD_CONNECTORS, d)?.version ?? 1) > (d.connector_version ?? 1),
      })),
    },
  };
}


/**
 * `PATCH /route-instances/:id` — **pause or resume a Destination —
 * decision 0558.** A paused ERP Destination takes nothing: its process's
 * invoices stay ready, and the export leaves them until it is resumed.
 *
 * Destinations only. A Source instance is a source, paused and retired
 * through the Sources actions it always had.
 */
export async function handleSetInstanceStatus(
  db: D1Database,
  instanceId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const status = body.status;
  if (status !== "active" && status !== "paused") {
    return { status: 400, body: { error: "status must be active or paused", reason: "invalid_status" } };
  }
  const instance = await db
    .prepare("SELECT id, source_id, status, route_id, started_at FROM route_instances WHERE id = ?")
    .bind(instanceId)
    .first<{ id: string; source_id: string | null; status: string | null; route_id: string; started_at: string | null }>();
  if (!instance) return { status: 404, body: { error: `route instance ${instanceId} does not exist` } };
  if (instance.source_id) {
    return { status: 409, body: { error: "a Source instance is changed through its source", reason: "is_source" } };
  }
  if (instance.status === "retired") {
    return { status: 409, body: { error: "a retired Destination cannot be resumed", reason: "retired" } };
  }
  // Decision 0585: a Destination that has never sent starts with Start sending, which decides what already waiting is sent.
  if (status === "active" && !instance.started_at && instance.route_id !== "erp-csv") {
    return { status: 409, body: { error: "start the Destination first, deciding what already waiting is sent", reason: "not_started" } };
  }
  await db.prepare("UPDATE route_instances SET status = ? WHERE id = ?").bind(status, instanceId).run();
  return { status: 200, body: { id: instanceId, status } };
}

/**
 * **Renaming and retiring a Destination — decision 0597**, as a Source
 * can be (Dan, 2 October 2026: *"I will need for testing"*).
 *
 * - **Rename**: a name of up to 80 characters, not another live
 *   Destination's in the same process. Rules name a Destination by its id
 *   (0588), so none needs changing.
 * - **Retire**: it sends nothing more, cannot be resumed, and stays on
 *   Process routes dimmed, with what it sent kept. Refused while a rule in
 *   force sends invoices to it, naming those rules, so a rule never sends
 *   to nowhere. The ERP CSV file is not retired here: its export screen
 *   is how its invoices leave.
 */
interface DestinationRow {
  id: string;
  process_id: string;
  route_id: string;
  name: string | null;
  status: string | null;
  source_id: string | null;
}

async function destinationRow(db: D1Database, id: string): Promise<DestinationRow | RouteResult> {
  const row = await db.prepare("SELECT id, process_id, route_id, name, status, source_id FROM route_instances WHERE id = ?").bind(id).first<DestinationRow>();
  if (!row) return { status: 404, body: { error: `route instance ${id} does not exist` } };
  if (row.source_id) return { status: 409, body: { error: "a Source instance is changed through its source", reason: "is_source" } };
  return row;
}
const isResultRow = (x: DestinationRow | RouteResult): x is RouteResult => "body" in x && !("process_id" in x);

export async function handleRenameDestination(db: D1Database, id: string, rawName: unknown): Promise<RouteResult> {
  const row = await destinationRow(db, id);
  if (isResultRow(row)) return row;
  if (row.status === "retired") return { status: 409, body: { error: "a retired Destination is not renamed", reason: "retired" } };
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return { status: 400, body: { error: "give it a name of up to 80 characters", reason: "bad_name" } };
  const taken = await db
    .prepare("SELECT id FROM route_instances WHERE process_id = ? AND source_id IS NULL AND id != ? AND status != 'retired' AND lower(name) = lower(?)")
    .bind(row.process_id, id, name)
    .first();
  if (taken) return { status: 409, body: { error: "this process already has a destination with that name", reason: "name_taken" } };
  await db.prepare("UPDATE route_instances SET name = ? WHERE id = ?").bind(name, id).run();
  return { status: 200, body: { id, name } };
}

/** Rules in force that send invoices to this Destination (`send_to_destination`, 0588). */
export async function rulesSendingTo(db: D1Database, destinationId: string): Promise<Array<{ id: string; name: string | null }>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT r.id, r.name, v.compiled_json FROM rule_versions v JOIN rules r ON r.id = v.rule_id
       WHERE (v.effective_to IS NULL OR v.effective_to > ?) AND v.compiled_json LIKE '%send_to_destination%'`
    )
    .bind(new Date().toISOString())
    .all<{ id: string; name: string | null; compiled_json: string }>();
  const out: Array<{ id: string; name: string | null }> = [];
  const seen = new Set<string>();
  for (const r of rows.results) {
    if (seen.has(r.id)) continue;
    let compiled: { actions?: Array<{ type?: string; params?: Record<string, unknown> }> };
    try {
      compiled = JSON.parse(r.compiled_json);
    } catch {
      continue;
    }
    const sends = (compiled.actions ?? []).some((a) => a.type === "send_to_destination" && a.params?.destination === destinationId);
    if (sends) {
      seen.add(r.id);
      out.push({ id: r.id, name: r.name });
    }
  }
  return out;
}

export async function handleRetireDestination(db: D1Database, userId: string, id: string): Promise<RouteResult> {
  const row = await destinationRow(db, id);
  if (isResultRow(row)) return row;
  if (row.status === "retired") return { status: 409, body: { error: "it is already retired", reason: "retired" } };
  if (row.route_id === "erp-csv") return { status: 409, body: { error: "the ERP CSV file is not retired here", reason: "erp_csv" } };
  const rules = await rulesSendingTo(db, id);
  if (rules.length > 0) {
    return { status: 409, body: { error: `rules send invoices to it: ${rules.map((r) => r.name ?? r.id).join(", ")}`, reason: "rule_sends_here", rules } };
  }
  await db
    .prepare("UPDATE route_instances SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId, id)
    .run();
  return { status: 200, body: { id, status: "retired" } };
}

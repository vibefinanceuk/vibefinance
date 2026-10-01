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
              (SELECT count(*) FROM source_keys k WHERE k.source_id = s.id AND k.revoked_at IS NULL) AS live_keys
       FROM sources s
       JOIN route_instances i ON i.source_id = s.id
       JOIN routes r ON r.id = i.route_id
       WHERE s.process_id = ?
       ORDER BY CASE s.status WHEN 'retired' THEN 1 ELSE 0 END, s.name`
    )
    .bind(weekAgo, chosen.id)
    .all<Record<string, unknown>>();

  const destinations = await db
    .prepare(
      `SELECT i.id, i.name, i.status, i.route_id, r.name AS route_name
       FROM route_instances i JOIN routes r ON r.id = i.route_id
       WHERE i.process_id = ? AND i.source_id IS NULL
       ORDER BY i.name`
    )
    .bind(chosen.id)
    .all<{ id: string; name: string; status: string; route_id: string; route_name: string }>();

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
        waiting: d.route_id === "erp-csv" ? erpWaiting : null,
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
    .prepare("SELECT id, source_id, status FROM route_instances WHERE id = ?")
    .bind(instanceId)
    .first<{ id: string; source_id: string | null; status: string | null }>();
  if (!instance) return { status: 404, body: { error: `route instance ${instanceId} does not exist` } };
  if (instance.source_id) {
    return { status: 409, body: { error: "a Source instance is changed through its source", reason: "is_source" } };
  }
  if (instance.status === "retired") {
    return { status: 409, body: { error: "a retired Destination cannot be resumed", reason: "retired" } };
  }
  await db.prepare("UPDATE route_instances SET status = ? WHERE id = ?").bind(status, instanceId).run();
  return { status: 200, body: { id: instanceId, status } };
}

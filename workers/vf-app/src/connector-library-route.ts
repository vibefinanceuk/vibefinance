import { STANDARD_CONNECTORS, connectorOfInstance, type ConnectorDefinition } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";

/**
 * **The Route library — decision 0589.** Every connector, Sources and
 * Destinations, with where each is already in use (its instances, by
 * process) and whether one of them is on an older version than the
 * library's. The processes are given too, for "Add to my routes".
 */
export async function handleConnectorLibrary(db: D1Database, library: ConnectorDefinition[] = STANDARD_CONNECTORS): Promise<RouteResult> {
  const instances = (
    await db
      .prepare(
        `SELECT i.id, i.route_id, i.connector_id, i.connector_version, i.process_id, i.source_id, p.name AS process_name,
                COALESCE(s.name, i.name) AS name
         FROM route_instances i
         JOIN processes p ON p.id = i.process_id
         LEFT JOIN sources s ON s.id = i.source_id
         WHERE (i.status IS NULL OR i.status != 'retired') AND (s.id IS NULL OR s.status != 'retired')
         ORDER BY p.name, name`
      )
      .all<{
        id: string;
        route_id: string;
        connector_id: string | null;
        connector_version: number | null;
        process_id: string;
        source_id: string | null;
        process_name: string;
        name: string | null;
      }>()
  ).results;
  const used = new Map<string, Array<Record<string, unknown>>>();
  for (const i of instances) {
    const connector = connectorOfInstance(library, i);
    if (!connector) continue;
    const version = i.connector_version ?? 1;
    used.set(connector.id, [
      ...(used.get(connector.id) ?? []),
      { instanceId: i.id, processId: i.process_id, processName: i.process_name, name: i.name, version, upgradeAvailable: connector.version > version },
    ]);
  }
  const processes = (await db.prepare("SELECT id, name FROM processes ORDER BY name").all<{ id: string; name: string }>()).results;
  return {
    status: 200,
    body: {
      connectors: library.map((c) => ({
        id: c.id,
        version: c.version,
        direction: c.direction,
        publisher: c.publisher,
        status: c.status,
        categories: c.categories,
        transport: c.transport,
        formats: c.formats,
        multiple: c.multiple,
        mechanism: c.mechanism ?? null,
        vendorDocs: c.vendorDocs ?? null,
        inUse: used.get(c.id) ?? [],
      })),
      processes,
    },
  };
}

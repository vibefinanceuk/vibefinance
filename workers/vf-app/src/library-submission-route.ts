import type { RouteResult } from "./org-route.js";
import {
  PARTNER_CONNECTOR_SCHEMA,
  listsInOutbound,
  renameLists,
  validatePartnerDefinition,
  type ConnectorAuthType,
  type PartnerConnectorDefinition,
} from "@vibefinance/shared";
import { HTTPS_OUT, liveOutboundMapping, settingsOf } from "./destination-delivery.js";
import { askLicence, type LicenceLink } from "./invitations-route.js";

/**
 * **Submit for review — decision 0595**, step 2 of slice 4.
 *
 * In a partner's sandbox, an HTTPS out Destination with its settings and
 * (where it sends its own layout) its published outbound mapping becomes
 * a connector version, sent to the control plane for VibeFinance's
 * review. Only one of the partner's people may submit; the control plane
 * checks, with this environment's key.
 *
 * The definition is made here, from what the Destination does, never
 * from what the page says it does: the method, format, sign-in and
 * reference path are the Destination's own; its address and secrets are
 * never sent. The person chooses which settings a customer may not
 * change, which ways of signing in are allowed, the name, the
 * description, notes for the reviewer, and which linked customers see it.
 */

interface InstanceRow {
  id: string;
  route_id: string;
  name: string | null;
  status: string | null;
  settings_json: string | null;
}

async function destinationOf(db: D1Database, id: string): Promise<InstanceRow | RouteResult> {
  const row = await db
    .prepare("SELECT id, route_id, name, status, settings_json FROM route_instances WHERE id = ? AND source_id IS NULL")
    .bind(id)
    .first<InstanceRow>();
  if (!row) return { status: 404, body: { error: `destination ${id} does not exist` } };
  if (row.route_id !== HTTPS_OUT) return { status: 409, body: { error: "only an HTTPS out Destination can be submitted", reason: "not_https_out" } };
  return row;
}
const isResult = (x: InstanceRow | RouteResult): x is RouteResult => "status" in x && "body" in x;

/** What would be submitted from this Destination, and why it cannot be yet. */
async function readiness(db: D1Database, instance: InstanceRow) {
  const settings = settingsOf(instance);
  const problems: string[] = [];
  let mapping = null;
  let lists: string[] = [];
  if (settings.format === "mapped") {
    const live = await liveOutboundMapping(db, instance.id);
    if (!live) problems.push("no_live_mapping");
    else {
      const ids = listsInOutbound(live.definition);
      const names = new Map<string, string>();
      for (const id of ids) {
        const row = await db.prepare("SELECT name FROM lookup_lists WHERE id = ?").bind(id).first<{ name: string }>();
        if (row) names.set(id, row.name);
        else problems.push("unknown_list");
      }
      mapping = renameLists(live.definition, (id) => names.get(id) ?? id);
      lists = [...new Set(names.values())];
    }
  }
  const draft = await db.prepare("SELECT version FROM outbound_mapping_versions WHERE instance_id = ? AND status = 'draft'").bind(instance.id).first<{ version: number }>();
  return { settings, mapping, lists, problems, draftNotPublished: draft ? draft.version : null };
}

/** `GET /route-instances/:id/library-submission` — is this a partner's sandbox, and what this Destination has sent for review. */
export async function handleGetSubmission(db: D1Database, link: LicenceLink, id: string, email: string | null): Promise<RouteResult> {
  const instance = await destinationOf(db, id);
  if (isResult(instance)) return instance;
  const params = new URLSearchParams({ instanceId: id, ...(email ? { email } : {}) });
  const remote = await askLicence(link, "GET", `/partner-connectors?${params}`);
  if (remote.status >= 400) return remote;
  if (!remote.body.partner) return { status: 200, body: { partner: null } };
  const ready = await readiness(db, instance);
  return {
    status: 200,
    body: {
      ...remote.body,
      destination: {
        name: instance.name,
        method: ready.settings.method,
        format: ready.settings.format,
        authType: ready.settings.auth.type,
        referencePath: ready.settings.referencePath,
        lookupLists: ready.lists,
        problems: ready.problems,
        draftNotPublished: ready.draftNotPublished,
      },
    },
  };
}

const AUTH: ConnectorAuthType[] = ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"];

/** `POST /route-instances/:id/library-submission` — submit a version for review. */
export async function handleSubmit(db: D1Database, link: LicenceLink, id: string, email: string, body: unknown): Promise<RouteResult> {
  const instance = await destinationOf(db, id);
  if (isResult(instance)) return instance;
  const b = (body ?? {}) as Record<string, unknown>;
  const ready = await readiness(db, instance);
  if (ready.problems.length > 0) {
    return { status: 409, body: { error: `this Destination cannot be submitted yet: ${ready.problems.join(", ")}`, reason: ready.problems[0] } };
  }
  const s = ready.settings;
  const fixed = Array.isArray(b.fixed) ? b.fixed.filter((f): f is "method" | "format" => f === "method" || f === "format") : [];
  const allowed = Array.isArray(b.authTypes) ? (b.authTypes.filter((a) => AUTH.includes(a as ConnectorAuthType)) as ConnectorAuthType[]) : [s.auth.type];
  const definition: PartnerConnectorDefinition = {
    schema: PARTNER_CONNECTOR_SCHEMA,
    direction: "destination",
    routeId: "https-out",
    transport: "https",
    settings: {
      defaults: {
        method: s.method,
        format: s.format,
        auth: { type: s.auth.type, ...(s.auth.type === "api_key_header" && s.auth.header ? { header: s.auth.header } : {}) },
        referencePath: s.referencePath,
      },
      fixed,
      authTypes: allowed,
    },
    outboundMapping: ready.mapping,
    lookupLists: ready.lists,
    vendorDocs: typeof b.vendorDocs === "string" && b.vendorDocs.trim() ? b.vendorDocs.trim() : null,
  };
  const invalid = validatePartnerDefinition(definition);
  if (invalid) return { status: 422, body: { error: invalid, reason: "invalid_definition" } };
  return askLicence(link, "POST", "/partner-connectors", {
    instanceId: id,
    submittedBy: email,
    name: b.name,
    description: b.description,
    notes: b.notes,
    audience: b.audience,
    definition,
  });
}

/** `POST /route-instances/:id/library-submission/withdraw` `{ version }`. */
export async function handleWithdraw(link: LicenceLink, id: string, email: string, body: unknown): Promise<RouteResult> {
  const version = (body as { version?: unknown } | null)?.version;
  return askLicence(link, "POST", "/partner-connectors/withdraw", { instanceId: id, version, submittedBy: email });
}

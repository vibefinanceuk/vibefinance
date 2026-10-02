import type { RouteResult } from "./org-route.js";
import { invoiceExportRows, payableInvoiceIds, toCsv, type ErpExportRow } from "./erp-export-route.js";
import { coveredInvoices, coveredUnits, unitIdsOf } from "./destination-units.js";
import { STANDARD_CONNECTORS, connectorById, connectorOfInstance, type ConnectorDefinition } from "@vibefinance/shared";
import { installMapping, listsNeeded, mappingForCustomer, partnerCopy } from "./partner-library.js";
import { loadLookups } from "./lookup-lists-route.js";
import { applyOutboundMapping, listsInOutbound, type OutboundMapping, type OutboundProblem, type VfInvoice } from "@vibefinance/shared";
import { NoSecretsKeyError, readSecret, secretsSet, setSecret } from "./connector-secrets.js";
import {
  addRouteEvent,
  finishRouteMessage,
  linkRouteItem,
  openOutboundMessage,
  routePartKey,
  storeRoutePart,
} from "./route-messages.js";

/**
 * **HTTPS out and the delivery engine — decision 0585**, slice 1 of the
 * connector framework Dan agreed on 1 October 2026.
 *
 * A Destination instance of the `https-out` route posts each invoice its
 * process makes payment-eligible to an address the customer gives:
 *
 * - **settings** (`route_instances.settings_json`): the address, method,
 *   payload format, how to sign in, and where the reply holds the
 *   target's own reference. Secrets are apart, encrypted
 *   (`connector-secrets.ts`).
 * - **one delivery per invoice** (`destination_deliveries`), so nothing
 *   is sent twice. Started explicitly: what is already waiting when a
 *   Destination starts is sent only if the person starting it says so.
 * - **each delivery is an outbound route message**: every request and
 *   reply kept in R2 as its parts, every attempt an event, so the Route
 *   monitor shows what was sent and what came back.
 * - **retries** on a timeout, 408, 429 or 5xx, over about a day; a 4xx
 *   is the target refusing the invoice, said as it said it, and waits for
 *   Send again. The invoice's own process is never held up.
 *
 * The sweep runs on the cron (`*\/5 * * * *`), and Send now / Send again
 * deliver one invoice at once.
 */

export const HTTPS_OUT = "https-out";

export type AuthType = "none" | "api_key_header" | "bearer" | "basic" | "oauth2_client_credentials";
export const AUTH_TYPES: AuthType[] = ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"];
/** `mapped` is the Destination's own published outbound mapping (decision 0591). */
export type PayloadFormat = "vf_json" | "csv" | "mapped";

export interface HttpsOutSettings {
  url: string;
  method: "POST" | "PUT";
  format: PayloadFormat;
  auth: { type: AuthType; header?: string; username?: string; tokenUrl?: string; clientId?: string; scope?: string };
  referencePath: string | null;
  /** Decision 0606: fetch a CSRF token (and its session's cookies) first, as SAP's OData services need. */
  csrf?: boolean;
}

/** The one secret each way of signing in needs. */
export const SECRET_FOR: Record<AuthType, string | null> = {
  none: null,
  api_key_header: "key",
  bearer: "token",
  basic: "password",
  oauth2_client_credentials: "client_secret",
};

/** Minutes to wait before each retry: about 22 hours in all, then it fails. */
export const RETRY_MINUTES = [5, 15, 60, 180, 360, 720];

export const DEFAULT_SETTINGS: HttpsOutSettings = {
  url: "",
  method: "POST",
  format: "vf_json",
  auth: { type: "none" },
  referencePath: null,
};

export interface DeliveryDeps {
  secretsKey?: string;
  bucket?: R2Bucket;
  customerId?: string;
  fetcher?: typeof fetch;
  onFinished?: (messageId: string) => Promise<void>;
  now?: () => Date;
}

interface InstanceRow {
  id: string;
  route_id: string;
  process_id: string;
  name: string | null;
  status: string | null;
  settings_json: string | null;
  started_at: string | null;
  unit_ids: string | null;
  connector_id: string | null;
  connector_version: number | null;
}

async function instanceOf(db: D1Database, id: string): Promise<InstanceRow | null> {
  return db
    .prepare("SELECT id, route_id, process_id, name, status, settings_json, started_at, unit_ids, connector_id, connector_version FROM route_instances WHERE id = ? AND source_id IS NULL")
    .bind(id)
    .first<InstanceRow>();
}

export function settingsOf(row: { settings_json: string | null }): HttpsOutSettings {
  try {
    const parsed = JSON.parse(row.settings_json || "{}") as Partial<HttpsOutSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, auth: { ...DEFAULT_SETTINGS.auth, ...(parsed.auth ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Settings as given, checked: an https address, a known method, format and sign-in, and what each sign-in needs. */
export function checkSettings(input: unknown): { settings: HttpsOutSettings } | { error: string; reason: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const auth = (b.auth ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const url = str(b.url);
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:") return { error: "the address must be a full https:// address", reason: "bad_url" };
  const method = b.method === "PUT" ? "PUT" : b.method === "POST" || b.method === undefined ? "POST" : null;
  if (!method) return { error: "the method must be POST or PUT", reason: "bad_method" };
  const format = b.format === "csv" ? "csv" : b.format === "mapped" ? "mapped" : b.format === "vf_json" || b.format === undefined ? "vf_json" : null;
  if (!format) return { error: "the format must be vf_json, csv or mapped", reason: "bad_format" };
  const type = (AUTH_TYPES as string[]).includes(str(auth.type) || "none") ? ((str(auth.type) || "none") as AuthType) : null;
  if (!type) return { error: `sign-in must be one of ${AUTH_TYPES.join(", ")}`, reason: "bad_auth" };
  const out: HttpsOutSettings["auth"] = { type };
  if (type === "api_key_header") {
    const header = str(auth.header);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) return { error: "name the header the key goes in, such as X-API-Key", reason: "bad_header" };
    out.header = header;
  }
  if (type === "basic") {
    if (!str(auth.username)) return { error: "a user name is needed for basic sign-in", reason: "no_username" };
    out.username = str(auth.username);
  }
  if (type === "oauth2_client_credentials") {
    let tokenUrl: URL | null = null;
    try {
      tokenUrl = new URL(str(auth.tokenUrl));
    } catch {
      tokenUrl = null;
    }
    if (!tokenUrl || tokenUrl.protocol !== "https:") return { error: "the token address must be a full https:// address", reason: "bad_token_url" };
    if (!str(auth.clientId)) return { error: "a client id is needed", reason: "no_client_id" };
    out.tokenUrl = tokenUrl.toString();
    out.clientId = str(auth.clientId);
    if (str(auth.scope)) out.scope = str(auth.scope);
    // Decision 0607: a user name, where the token address asks for one (Sage Intacct's web services user, user@company).
    if (str(auth.username)) out.username = str(auth.username);
  }
  const referencePath = str(b.referencePath);
  // Decision 0607: a name may hold colons, as Sage Intacct's ia::result does.
  if (referencePath && !/^\$(\.[A-Za-z0-9_:-]+|\[\d+\])+$/.test(referencePath)) {
    return { error: "the reference must be a path such as $.id or $.data[0].documentId", reason: "bad_reference_path" };
  }
  return { settings: { url: parsed.toString(), method, format, auth: out, referencePath: referencePath || null, ...(b.csrf === true ? { csrf: true } : {}) } };
}

/** `$.a.b[0].c` in a JSON reply, as text; null where it is not there. */
export function readPath(body: unknown, path: string | null): string | null {
  if (!path) return null;
  let node: unknown = body;
  for (const m of path.slice(1).matchAll(/\.([A-Za-z0-9_:-]+)|\[(\d+)\]/g)) {
    if (node === null || typeof node !== "object") return null;
    // A name read from a list reads its first item: a reply may give one record or a list of one (decision 0607).
    if (m[1] !== undefined && Array.isArray(node)) node = node[0];
    if (node === null || typeof node !== "object") return null;
    node = m[1] !== undefined ? (node as Record<string, unknown>)[m[1]] : (node as unknown[])[Number(m[2])];
  }
  return node === undefined || node === null || typeof node === "object" ? null : String(node);
}

/**
 * **The VibeFinance invoice, as JSON — version 1.** The ERP export's own
 * rows (`ERP_EXPORT_COLUMNS`, 0552), regrouped: the invoice once, its
 * lines, and each line's distributions (a split line's rows, 0548), with
 * the supplier's ERP id and site and Account Coding. Amounts are numbers.
 */
export function invoiceJson(rows: ErpExportRow[]) {
  const first = rows[0];
  const n = (v: string) => (v === "" ? null : Number(v));
  const t = (v: string) => (v === "" ? null : v);
  const lines = new Map<string, { lineNumber: number | null; description: string | null; quantity: number | null; unit: string | null; poLine: string | null; vatCategory: string | null; vatRate: number | null; netAmount: number; distributions: unknown[] }>();
  for (const r of rows) {
    const key = r.line_number || "-";
    let line = lines.get(key);
    if (!line) {
      line = {
        lineNumber: n(r.line_number),
        description: t(r.description),
        quantity: n(r.quantity),
        unit: t(r.unit),
        poLine: t(r.po_line),
        vatCategory: t(r.vat_category),
        vatRate: n(r.vat_rate),
        netAmount: 0,
        distributions: [],
      };
      lines.set(key, line);
    }
    line.netAmount = Math.round((line.netAmount + (n(r.net_amount) ?? 0)) * 100) / 100;
    line.distributions.push({
      splitRow: n(r.split_row),
      netAmount: n(r.net_amount),
      costCentre: t(r.cost_centre),
      project: t(r.project),
      commodityCode: t(r.commodity_code),
      glCode: t(r.gl_code),
    });
  }
  return {
    schema: "vibefinance.invoice.v1",
    id: first.invoice_id,
    invoiceNumber: t(first.invoice_number),
    issueDate: t(first.issue_date),
    dueDate: t(first.due_date),
    currency: t(first.currency),
    company: t(first.company),
    supplier: { erpId: t(first.supplier_erp_id), site: t(first.supplier_site), name: t(first.supplier_name), vatId: t(first.supplier_vat_id) },
    purchaseOrder: t(first.po_number),
    totals: { net: n(first.invoice_net), vat: n(first.invoice_vat), total: n(first.invoice_total) },
    lines: [...lines.values()],
  };
}

interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  invoiceNumber: string;
  checks: string[];
  /** Decision 0591: what the outbound mapping could not lay out. Nothing is sent while there are any. */
  problems: OutboundProblem[];
}

/** Today, as an ISO date: the day an invoice is laid out to be sent (decision 0606). */
const today = () => new Date().toISOString().slice(0, 10);

/** Where a CSRF token is fetched: the service the address belongs to, its last segment taken off (decision 0606). */
export function csrfAddress(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.pathname = u.pathname.replace(/\/[^/]*$/, "/");
  return u.toString();
}

/** The cookies a reply sets, as one Cookie header: name=value pairs only. */
function cookiesOf(reply: Response): string | null {
  const h = reply.headers as Headers & { getSetCookie?: () => string[] };
  const all = typeof h.getSetCookie === "function" ? h.getSetCookie() : (reply.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/);
  const pairs = all.map((c) => c.split(";")[0].trim()).filter((c) => c.includes("="));
  return pairs.length ? pairs.join("; ") : null;
}

/** One invoice as the VibeFinance invoice JSON (0585), or null where it cannot be read. */
export async function vfInvoiceOf(db: D1Database, invoiceId: string): Promise<VfInvoice | null> {
  const rows = await invoiceExportRows(db, invoiceId, "");
  return rows.length === 0 ? null : { ...(invoiceJson(rows) as VfInvoice), sentOn: today() };
}

/** A Destination's live outbound mapping (decision 0591), or null. */
export async function liveOutboundMapping(db: D1Database, instanceId: string): Promise<{ version: number; definition: OutboundMapping } | null> {
  const row = await db
    .prepare("SELECT version, definition_json FROM outbound_mapping_versions WHERE instance_id = ? AND status = 'live'")
    .bind(instanceId)
    .first<{ version: number; definition_json: string }>();
  return row ? { version: row.version, definition: JSON.parse(row.definition_json) as OutboundMapping } : null;
}

/** What would be sent for this invoice, before sign-in is added. */
export async function buildRequest(db: D1Database, instanceId: string, settings: HttpsOutSettings, invoiceId: string): Promise<BuiltRequest | null> {
  const rows = await invoiceExportRows(db, invoiceId, "");
  if (rows.length === 0) return null;
  const checks: string[] = [];
  if (!rows[0].supplier_erp_id) checks.push("no_supplier_erp_id");
  if (rows.some((r) => !r.gl_code)) checks.push("line_without_gl_code");
  const contentType = settings.format === "csv" ? "text/csv; charset=utf-8" : "application/json";
  let problems: OutboundProblem[] = [];
  let body: string;
  if (settings.format === "csv") {
    body = toCsv(rows.map((r) => ({ ...r, export_id: "" })));
  } else if (settings.format === "mapped") {
    // Decision 0591: the Destination's own published layout.
    const live = await liveOutboundMapping(db, instanceId);
    if (!live) {
      problems = [{ at: "", source: null, value: null, reason: "the Destination's own mapping has no live version" }];
      body = "";
    } else {
      // Decision 0606: with the day it is sent, for a posting date.
      const applied = applyOutboundMapping(live.definition, { ...(invoiceJson(rows) as VfInvoice), sentOn: today() }, await loadLookups(db, listsInOutbound(live.definition)));
      problems = applied.problems;
      body = JSON.stringify(applied.body, null, 2);
    }
  } else {
    body = JSON.stringify(invoiceJson(rows), null, 2);
  }
  return {
    url: settings.url,
    method: settings.method,
    headers: {
      "Content-Type": contentType,
      // The same key each time this invoice is sent here, so a target that honours it never makes it twice.
      "Idempotency-Key": `${instanceId}:${invoiceId}`,
      "X-VibeFinance-Invoice": invoiceId,
    },
    body,
    contentType,
    invoiceNumber: rows[0].invoice_number || invoiceId,
    checks,
    problems,
  };
}

/** A mapping problem as one line of words. */
export const problemWords = (p: OutboundProblem) => {
  const shown = p.value !== null && p.value !== "" && !p.reason.includes(`"${p.value}"`) ? `"${p.value}" ` : "";
  return `${p.at ? `${p.at}${p.source ? ` (from ${p.source})` : ""}: ` : ""}${shown}${p.reason}`;
};

class SignInError extends Error {}

/** The sign-in headers, with secrets read and an OAuth token fetched where needed. */
async function signIn(db: D1Database, instanceId: string, settings: HttpsOutSettings, deps: DeliveryDeps): Promise<Record<string, string>> {
  const type = settings.auth.type;
  const name = SECRET_FOR[type];
  if (!name) return {};
  let secret: string | null;
  try {
    secret = await readSecret(db, deps.secretsKey, instanceId, name);
  } catch (err) {
    throw new SignInError(err instanceof NoSecretsKeyError ? err.message : "the stored secret could not be read: set it again");
  }
  if (!secret) throw new SignInError(`no ${name.replace("_", " ")} is set for this Destination`);
  if (type === "api_key_header") return { [settings.auth.header as string]: secret };
  if (type === "bearer") return { Authorization: `Bearer ${secret}` };
  if (type === "basic") return { Authorization: `Basic ${btoa(`${settings.auth.username}:${secret}`)}` };
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: settings.auth.clientId as string, client_secret: secret });
  if (settings.auth.scope) form.set("scope", settings.auth.scope);
  if (settings.auth.username) form.set("username", settings.auth.username);
  let reply: Response;
  try {
    reply = await (deps.fetcher ?? fetch)(settings.auth.tokenUrl as string, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new SignInError(`the token address could not be reached: ${(err as Error).message}`);
  }
  const json = (await reply.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!reply.ok || typeof json?.access_token !== "string") throw new SignInError(`the token address refused: HTTP ${reply.status}`);
  return { Authorization: `Bearer ${json.access_token}` };
}

const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

export interface DeliveryOutcome {
  status: "delivered" | "retrying" | "failed";
  httpStatus: number | null;
  reference: string | null;
  error: string | null;
  messageId: string | null;
}

/**
 * One attempt to deliver one invoice: build, sign in, send, keep the
 * request and reply, and record what came of it.
 */
export async function deliverOne(db: D1Database, instanceId: string, invoiceId: string, deps: DeliveryDeps, actor?: string): Promise<DeliveryOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const instance = await instanceOf(db, instanceId);
  if (!instance) return { status: "failed", httpStatus: null, reference: null, error: "the Destination no longer exists", messageId: null };
  const settings = settingsOf(instance);
  const existing = await db
    .prepare("SELECT attempts, message_id FROM destination_deliveries WHERE instance_id = ? AND invoice_id = ?")
    .bind(instanceId, invoiceId)
    .first<{ attempts: number; message_id: string | null }>();
  if (!existing) {
    await db
      .prepare("INSERT INTO destination_deliveries (instance_id, invoice_id, status, next_attempt_at, created_at) VALUES (?, ?, 'pending', ?, ?)")
      .bind(instanceId, invoiceId, now.toISOString(), now.toISOString())
      .run();
  }
  const attempt = (existing?.attempts ?? 0) + 1;

  const built = await buildRequest(db, instanceId, settings, invoiceId);
  let messageId = existing?.message_id ?? null;
  if (!messageId) {
    messageId = await openOutboundMessage(db, {
      destinationId: instanceId,
      recipient: (() => {
        try {
          return new URL(settings.url).host;
        } catch {
          return null;
        }
      })(),
      subject: built?.invoiceNumber ?? invoiceId,
      bytes: built ? new TextEncoder().encode(built.body).length : 0,
      receivedAt: now.toISOString(),
      event: "sending",
      ...(actor ? { actor } : {}),
    });
    if (messageId) await linkRouteItem(db, messageId, invoiceId, null);
  }

  const record = async (status: DeliveryOutcome["status"], httpStatus: number | null, error: string | null, reference: string | null, code?: string) => {
    const next = status === "retrying" ? new Date(now.getTime() + RETRY_MINUTES[Math.min(attempt - 1, RETRY_MINUTES.length - 1)] * 60_000).toISOString() : null;
    await db
      .prepare(
        `UPDATE destination_deliveries
         SET status = ?, attempts = ?, next_attempt_at = ?, last_status = ?, last_error = ?, message_id = ?, reference = COALESCE(?, reference),
             delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
         WHERE instance_id = ? AND invoice_id = ?`
      )
      .bind(status, attempt, next, httpStatus, error?.slice(0, 1000) ?? null, messageId, reference, status, now.toISOString(), instanceId, invoiceId)
      .run();
    if (messageId) {
      await addRouteEvent(db, messageId, "attempt", {
        detail: `${attempt}: ${httpStatus ? `HTTP ${httpStatus}` : "no reply"}${error ? ` · ${error}` : ""}${status === "retrying" && next ? ` · next try ${next}` : ""}`,
        ...(actor ? { actor } : {}),
      });
      if (reference) await addRouteEvent(db, messageId, "reference", { detail: reference });
      if (status === "delivered") await finishRouteMessage(db, messageId, { status: "delivered" });
      if (status === "failed") {
        await finishRouteMessage(db, messageId, {
          status: "failed",
          failedPart: "delivery",
          errorCode: code ?? (httpStatus ? `http_${httpStatus}` : "unreachable"),
          errorText: error ?? "it could not be delivered",
        });
      }
      if (status !== "retrying" && deps.onFinished) await deps.onFinished(messageId).catch(() => undefined);
    }
    return { status, httpStatus, reference, error, messageId };
  };

  if (!built) return record("failed", null, "the invoice could not be read to send", null);
  // Decision 0591: what the mapping cannot lay out is a fixable failure, never retried and never sent.
  if (built.problems.length > 0) {
    return record("failed", null, `the outbound mapping could not lay out this invoice: ${built.problems.map(problemWords).join("; ")}`, null, "outbound_mapping");
  }

  let auth: Record<string, string>;
  try {
    auth = await signIn(db, instanceId, settings, deps);
  } catch (err) {
    // Signing in is the Destination's own settings: retried, as a person may be fixing them.
    const error = (err as Error).message;
    return record(attempt > RETRY_MINUTES.length ? "failed" : "retrying", null, error, null);
  }

  /**
   * **A CSRF token first — decision 0606.** SAP's OData services refuse a
   * change without one: a `GET` of the service with `x-csrf-token: Fetch`,
   * signed in, gives the token and the session's cookies, sent with the
   * `POST`. Fetched afresh for each attempt; a refusal is retried as any
   * failure to reach the target is.
   */
  if (settings.csrf) {
    const serviceRoot = csrfAddress(built.url);
    let tokenReply: Response;
    try {
      tokenReply = await (deps.fetcher ?? fetch)(serviceRoot, {
        method: "GET",
        headers: { ...auth, "x-csrf-token": "Fetch", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return record(attempt > RETRY_MINUTES.length ? "failed" : "retrying", null, `the CSRF token could not be fetched: ${(err as Error).message}`, null);
    }
    const token = tokenReply.headers.get("x-csrf-token");
    if (!tokenReply.ok || !token || token.toLowerCase() === "required") {
      const why = `the CSRF token could not be fetched from ${serviceRoot}: HTTP ${tokenReply.status}`;
      return record(retryable(tokenReply.status) && attempt <= RETRY_MINUTES.length ? "retrying" : "failed", tokenReply.status, why, null);
    }
    auth = { ...auth, "x-csrf-token": token, ...(cookiesOf(tokenReply) ? { Cookie: cookiesOf(tokenReply) as string } : {}) };
  }

  const keep = async (role: "sent" | "reply", filename: string, contentType: string, text: string) => {
    if (!deps.bucket || !deps.customerId || !messageId) return;
    // Every attempt's request and reply, numbered on after what the message holds (Send again adds to it).
    const last = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM route_message_parts WHERE message_id = ?").bind(messageId).first<{ n: number }>();
    const seq = (last?.n ?? 0) + 1;
    await storeRoutePart(deps.bucket, db, {
      messageId,
      seq,
      role,
      filename,
      contentType,
      bytes: new TextEncoder().encode(text),
      key: routePartKey(deps.customerId, instanceId, messageId, now.toISOString(), seq, filename),
    });
  };
  const ext = settings.format === "csv" ? "csv" : "json";
  await keep("sent", `request-${attempt}.${ext}`, built.contentType, `${built.method} ${built.url}\n\n${built.body}`);

  let reply: Response;
  try {
    reply = await (deps.fetcher ?? fetch)(built.url, {
      method: built.method,
      headers: { ...built.headers, ...auth, Accept: "application/json" },
      body: built.body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const error = `the address could not be reached: ${(err as Error).message}`;
    return record(attempt > RETRY_MINUTES.length ? "failed" : "retrying", null, error, null);
  }
  const replyText = await reply.text().catch(() => "");
  await keep("reply", `reply-${attempt}.txt`, reply.headers.get("Content-Type") ?? "text/plain", `HTTP ${reply.status}\n\n${replyText.slice(0, 200_000)}`);

  if (reply.ok) {
    let json: unknown = null;
    try {
      json = JSON.parse(replyText);
    } catch {
      json = null;
    }
    return record("delivered", reply.status, null, readPath(json, settings.referencePath));
  }
  const said = replyText.trim().replace(/\s+/g, " ").slice(0, 500) || reply.statusText || "no reason given";
  if (retryable(reply.status) && attempt <= RETRY_MINUTES.length) return record("retrying", reply.status, said, null);
  return record("failed", reply.status, said, null);
}

/**
 * **The sweep — on the cron.** For each sending HTTPS out Destination:
 * its process's payment-eligible invoices it has not taken yet become
 * deliveries, then each one due is attempted, a few at a time.
 */
export async function runDeliveries(db: D1Database, deps: DeliveryDeps, limitPerDestination = 20): Promise<{ queued: number; attempted: number }> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const instances = (
    await db
      .prepare("SELECT id, process_id FROM route_instances WHERE route_id = ? AND status = 'active' AND started_at IS NOT NULL AND source_id IS NULL")
      .bind(HTTPS_OUT)
      .all<{ id: string; process_id: string }>()
  ).results;
  let queued = 0;
  let attempted = 0;
  for (const instance of instances) {
    queued += await queueNew(db, instance.id, instance.process_id, now);
    const due = (
      await db
        .prepare(
          `SELECT invoice_id FROM destination_deliveries
           WHERE instance_id = ? AND status IN ('pending', 'retrying') AND next_attempt_at <= ?
           ORDER BY next_attempt_at LIMIT ?`
        )
        .bind(instance.id, now, limitPerDestination)
        .all<{ invoice_id: string }>()
    ).results;
    for (const d of due) {
      await deliverOne(db, instance.id, d.invoice_id, deps);
      attempted++;
    }
  }
  return { queued, attempted };
}

/**
 * **What this Destination takes — decisions 0585, 0587, 0588.** Its
 * process's payment-eligible invoices in the business units it covers
 * (all, when it covers none in particular), and those a rule sent to it.
 */
export async function destinationPayable(db: D1Database, instanceId: string, processId: string): Promise<string[]> {
  const row = await db.prepare("SELECT unit_ids FROM route_instances WHERE id = ?").bind(instanceId).first<{ unit_ids: string | null }>();
  const payable = await payableInvoiceIds(db, processId);
  const covered = new Set(await coveredInvoices(db, row ? unitIdsOf(row) : null, payable));
  // Decision 0588: and what a rule sent here, whatever its unit.
  const requested = new Set(
    (await db.prepare("SELECT invoice_id FROM destination_requests WHERE instance_id = ?").bind(instanceId).all<{ invoice_id: string }>()).results.map((r) => r.invoice_id)
  );
  return payable.filter((id) => covered.has(id) || requested.has(id));
}

async function queueNew(db: D1Database, instanceId: string, processId: string, now: string, status: "pending" | "skipped" = "pending"): Promise<number> {
  const payable = await destinationPayable(db, instanceId, processId);
  const taken = new Set(
    (await db.prepare("SELECT invoice_id FROM destination_deliveries WHERE instance_id = ?").bind(instanceId).all<{ invoice_id: string }>()).results.map(
      (r) => r.invoice_id
    )
  );
  const fresh = payable.filter((id) => !taken.has(id));
  for (const id of fresh) {
    await db
      .prepare("INSERT OR IGNORE INTO destination_deliveries (instance_id, invoice_id, status, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(instanceId, id, status, status === "pending" ? now : null, now)
      .run();
  }
  return fresh.length;
}

// --- The Destination's own routes -------------------------------------------------------

/** `POST /processes/:id/destinations` `{ name, routeId }` — a new HTTPS out Destination, paused until started. */
/** A connector's defaults applied to HTTPS out's own — decision 0589. */
export function settingsFromConnector(connector: ConnectorDefinition | null): HttpsOutSettings {
  const d = connector?.settings?.defaults ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...(d.method ? { method: d.method } : {}),
    ...(d.format ? { format: d.format } : {}),
    ...(d.referencePath !== undefined ? { referencePath: d.referencePath } : {}),
    ...(d.csrf ? { csrf: true } : {}),
    // Decision 0607: an address every customer shares, such as Sage Intacct's.
    ...(d.url ? { url: d.url } : {}),
    auth: d.auth ? { ...d.auth } : { ...DEFAULT_SETTINGS.auth },
  };
}

/**
 * `POST /processes/:id/destinations` `{ name, connectorId }` — a new
 * Destination from a connector in the library (decision 0589), paused
 * until started. HTTPS out by default, as before (0585). A connector on
 * HTTPS out (the generic one, the automation webhook) fills in its
 * defaults; the ERP CSV file is one per process.
 */
export async function handleCreateDestination(
  db: D1Database,
  userId: string,
  processId: string,
  body: unknown,
  library: ConnectorDefinition[] = STANDARD_CONNECTORS
): Promise<RouteResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name === "" || name.length > 80) return { status: 400, body: { error: "a Destination needs a name, of at most 80 characters", reason: "no_name" } };
  const connectorId = typeof b.connectorId === "string" ? b.connectorId : typeof b.routeId === "string" ? b.routeId : HTTPS_OUT;
  const connector = connectorById(library, connectorId);
  if (!connector || connector.direction !== "destination") {
    return { status: 400, body: { error: `there is no destination connector ${connectorId}`, reason: "unknown_connector" } };
  }
  if (connector.status !== "available" || (connector.routeId !== HTTPS_OUT && connector.routeId !== "erp-csv")) {
    return { status: 409, body: { error: `${connectorId} is not available yet`, reason: "not_available" } };
  }
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) return { status: 404, body: { error: `process ${processId} does not exist` } };
  const taken = await db
    .prepare("SELECT 1 FROM route_instances WHERE process_id = ? AND source_id IS NULL AND lower(name) = lower(?) AND (status IS NULL OR status != 'retired')")
    .bind(processId, name)
    .first();
  if (taken) return { status: 409, body: { error: `this process already has a Destination named "${name}"`, reason: "name_taken" } };
  if (!connector.multiple) {
    const existing = await db
      .prepare("SELECT 1 FROM route_instances WHERE process_id = ? AND source_id IS NULL AND route_id = ? AND (status IS NULL OR status != 'retired')")
      .bind(processId, connector.routeId)
      .first();
    if (existing) return { status: 409, body: { error: `this process already has ${connectorId}, and has one only`, reason: "one_per_process" } };
  }
  if (connector.routeId === "erp-csv") {
    // The file is downloaded from the ERP export screen; sending, and its exports, are as 0552–0558.
    const id = `erp-${processId}`;
    await db
      .prepare("INSERT INTO route_instances (id, route_id, process_id, name, status, created_by, connector_id, connector_version) VALUES (?, 'erp-csv', ?, ?, 'active', ?, ?, ?)")
      .bind(id, processId, name, userId, connector.id, connector.version)
      .run();
    return { status: 201, body: { id, name, routeId: "erp-csv", connectorId: connector.id, status: "active" } };
  }
  const id = `dest-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(
      "INSERT INTO route_instances (id, route_id, process_id, name, status, settings_json, created_by, connector_id, connector_version) VALUES (?, ?, ?, ?, 'paused', ?, ?, ?, ?)"
    )
    .bind(id, HTTPS_OUT, processId, name, JSON.stringify(settingsFromConnector(connector)), userId, connector.id, connector.version)
    .run();
  // Decision 0601: a partner's connector brings its mapping, live, with this customer's look-up lists, made where missing.
  let listsCreated: string[] = [];
  if (connector.outboundMapping) {
    const resolved = await mappingForCustomer(db, userId, connector, true);
    if (resolved) {
      await installMapping(db, id, userId, connector, resolved.mapping);
      listsCreated = resolved.created;
    }
  }
  return { status: 201, body: { id, name, routeId: HTTPS_OUT, connectorId: connector.id, status: "paused", listsCreated } };
}

async function httpsOutInstance(db: D1Database, id: string): Promise<InstanceRow | RouteResult> {
  const instance = await instanceOf(db, id);
  if (!instance || instance.route_id !== HTTPS_OUT) return { status: 404, body: { error: `there is no HTTPS out Destination ${id}` } };
  return instance;
}
const isResult = (x: InstanceRow | RouteResult): x is RouteResult => "status" in x && "body" in x;

/**
 * **A Destination's deliveries — decisions 0585, 0586.** Any Destination's:
 * HTTPS out's, and the ERP CSV file's, whose exports are deliveries too.
 * Failed first, then trying again, waiting, and the latest delivered.
 */
export async function deliveriesOf(db: D1Database, id: string) {
  const rows = (
    await db
      .prepare(
        `SELECT d.invoice_id, d.status, d.attempts, d.next_attempt_at, d.last_status, d.last_error, d.reference, d.delivered_at, d.message_id, d.created_at,
                json_extract(h.facts_json, '$."BT-1"') AS invoice_number, COALESCE(s.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier
         FROM destination_deliveries d JOIN invoice_headers h ON h.id = d.invoice_id LEFT JOIN suppliers s ON s.id = h.supplier_id
         WHERE d.instance_id = ? AND d.status != 'skipped'
         ORDER BY CASE d.status WHEN 'failed' THEN 0 WHEN 'retrying' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, COALESCE(d.delivered_at, d.created_at) DESC
         LIMIT 25`
      )
      .bind(id)
      .all<Record<string, unknown>>()
  ).results;
  const counts = Object.fromEntries(
    (
      await db
        .prepare("SELECT status, count(*) AS n FROM destination_deliveries WHERE instance_id = ? GROUP BY status")
        .bind(id)
        .all<{ status: string; n: number }>()
    ).results.map((r) => [r.status, r.n])
  );
  return {
    counts,
    deliveries: rows.map((d) => ({
      invoiceId: d.invoice_id,
      invoiceNumber: d.invoice_number,
      supplier: d.supplier,
      status: d.status,
      attempts: d.attempts,
      nextAttemptAt: d.next_attempt_at,
      lastStatus: d.last_status,
      lastError: d.last_error,
      reference: d.reference,
      deliveredAt: d.delivered_at,
      messageId: d.message_id,
    })),
  };
}

/** `GET /route-instances/:id/deliveries` — any Destination's deliveries and their counts. */
export async function handleListDeliveries(db: D1Database, id: string): Promise<RouteResult> {
  const instance = await instanceOf(db, id);
  if (!instance) return { status: 404, body: { error: `there is no Destination ${id}` } };
  return { status: 200, body: { id, routeId: instance.route_id, ...(await deliveriesOf(db, id)) } };
}

/** `GET /route-instances/:id/connector` — settings, which secrets are set, what is waiting, recent deliveries, and invoices to try. */
/** The connector a Destination runs, its version, the latest, and what it fixes — decision 0589. */
export function connectorView(instance: { route_id: string; connector_id: string | null; connector_version: number | null }, library: ConnectorDefinition[] = STANDARD_CONNECTORS) {
  const connector = connectorOfInstance(library, instance);
  if (!connector) return null;
  const version = instance.connector_version ?? 1;
  return {
    id: connector.id,
    version,
    // Decision 0601: a partner's connector carries its own name, and says whose it is.
    name: connector.name ?? null,
    publisher: connector.publisher,
    partner: connector.partner ?? null,
    offered: connector.status !== "withdrawn",
    // Decision 0605: available, not yet proven against the real system.
    maturity: connector.maturity ?? null,
    // Decision 0610: the optional settings it uses; null for one that names none (the generic HTTPS out shows all).
    asks: connector.settings?.ask ?? null,
    latestVersion: connector.version,
    upgradeAvailable: connector.version > version,
    fixed: connector.settings?.fixed ?? [],
    authTypes: connector.settings?.authTypes ?? null,
  };
}

/** The latest payment-eligible invoices, to try a Destination or its mapping with. */
export async function candidatesOf(db: D1Database, payable: string[]) {
  return (
    await Promise.all(
      payable.slice(-20).reverse().map(async (invoiceId) => {
        const h = await db
          .prepare(
            `SELECT json_extract(h.facts_json, '$."BT-1"') AS number, json_extract(h.facts_json, '$."BT-5"') AS currency, json_extract(h.facts_json, '$."BT-112"') AS total,
                    COALESCE(s.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier
             FROM invoice_headers h LEFT JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = ?`
          )
          .bind(invoiceId)
          .first<{ number: string | null; currency: string | null; total: number | null; supplier: string | null }>();
        return { id: invoiceId, number: h?.number ?? null, supplier: h?.supplier ?? null, currency: h?.currency ?? null, total: h?.total ?? null };
      })
    )
  );
}

/** Decision 0591: a Destination's own mapping in brief — its live and draft versions. */
export async function mappingSummary(db: D1Database, instanceId: string): Promise<{ live: number | null; draft: number | null }> {
  const rows = (
    await db.prepare("SELECT version, status FROM outbound_mapping_versions WHERE instance_id = ? AND status IN ('live', 'draft')").bind(instanceId).all<{ version: number; status: string }>()
  ).results;
  return { live: rows.find((r) => r.status === "live")?.version ?? null, draft: rows.find((r) => r.status === "draft")?.version ?? null };
}

export async function handleGetConnector(db: D1Database, id: string, library: ConnectorDefinition[] = STANDARD_CONNECTORS): Promise<RouteResult> {
  const instance = await httpsOutInstance(db, id);
  if (isResult(instance)) return instance;
  const { deliveries: recent, counts } = await deliveriesOf(db, id);
  const payable = await destinationPayable(db, instance.id, instance.process_id);
  const taken = new Set(
    (await db.prepare("SELECT invoice_id FROM destination_deliveries WHERE instance_id = ?").bind(id).all<{ invoice_id: string }>()).results.map((r) => r.invoice_id)
  );
  const candidates = await candidatesOf(db, payable);
  const mapping = await mappingSummary(db, id);
  return {
    status: 200,
    body: {
      instance: { id: instance.id, name: instance.name, status: instance.status, processId: instance.process_id, startedAt: instance.started_at },
      settings: settingsOf(instance),
      connector: connectorView(instance, library),
      // Decision 0601: the look-up lists a partner's connector reads, and whether each is filled in.
      lists: await (async () => {
        const c = connectorOfInstance(library, instance);
        return c?.lookupLists?.length ? listsNeeded(db, c) : [];
      })(),
      secrets: await secretsSet(db, id),
      waitingNotTaken: payable.filter((x) => !taken.has(x)).length,
      counts,
      deliveries: recent,
      candidates,
      // Decision 0591: its own outbound mapping, if it has one.
      mapping,
    },
  };
}

/** `PUT /route-instances/:id/connector` `{ settings, secret? }` — the settings, checked, and the secret for its sign-in, encrypted. */
export async function handleSaveConnector(
  db: D1Database,
  userId: string,
  id: string,
  body: unknown,
  secretsKey: string | undefined,
  library: ConnectorDefinition[] = STANDARD_CONNECTORS
): Promise<RouteResult> {
  const instance = await httpsOutInstance(db, id);
  if (isResult(instance)) return instance;
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  const b = (body ?? {}) as Record<string, unknown>;
  const checked = checkSettings(b.settings);
  if ("error" in checked) return { status: 400, body: checked };
  // Decision 0589: what the connector fixes, and the ways of signing in it allows.
  const connector = connectorOfInstance(library, instance);
  if (connector?.settings) {
    for (const key of connector.settings.fixed) {
      const fixed = connector.settings.defaults[key];
      if (fixed !== undefined && checked.settings[key] !== fixed) {
        return { status: 400, body: { error: `${connector.id} keeps ${key} as ${fixed}`, reason: "fixed_setting" } };
      }
    }
    if (!connector.settings.authTypes.includes(checked.settings.auth.type)) {
      return { status: 400, body: { error: `${connector.id} does not sign in with ${checked.settings.auth.type}`, reason: "auth_not_allowed" } };
    }
  }
  // Decision 0591: its own layout only once one is published.
  if (checked.settings.format === "mapped" && !(await liveOutboundMapping(db, id))) {
    return { status: 409, body: { error: "publish the Destination's own mapping first", reason: "no_live_mapping" } };
  }
  const secretName = SECRET_FOR[checked.settings.auth.type];
  const secret = typeof b.secret === "string" ? b.secret : "";
  if (secret !== "") {
    if (!secretName) return { status: 400, body: { error: "this way of signing in takes no secret", reason: "no_secret_needed" } };
    try {
      await setSecret(db, secretsKey, id, secretName, secret, userId);
    } catch (err) {
      if (err instanceof NoSecretsKeyError) return { status: 503, body: { error: err.message, reason: "no_secrets_key" } };
      throw err;
    }
  }
  await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify(checked.settings), id).run();
  const set = await secretsSet(db, id);
  return { status: 200, body: { settings: checked.settings, secrets: set, secretMissing: secretName !== null && !set[secretName] } };
}

/** `POST /route-instances/:id/connector/preview` `{ invoiceId }` — exactly what would be sent, with sign-in shown but never its secret. Nothing is sent. */
export async function handlePreviewDelivery(db: D1Database, id: string, body: unknown): Promise<RouteResult> {
  const instance = await httpsOutInstance(db, id);
  if (isResult(instance)) return instance;
  const invoiceId = (body as { invoiceId?: unknown } | null)?.invoiceId;
  if (typeof invoiceId !== "string") return { status: 400, body: { error: "name the invoice to preview" } };
  const settings = settingsOf(instance);
  if (!settings.url) return { status: 409, body: { error: "give the address to send to first", reason: "no_url" } };
  const built = await buildRequest(db, id, settings, invoiceId);
  if (!built) return { status: 404, body: { error: `invoice ${invoiceId} could not be read` } };
  const shown: Record<string, string> = { ...built.headers };
  const a = settings.auth;
  if (a.type === "api_key_header") shown[a.header as string] = "•••";
  if (a.type === "bearer" || a.type === "oauth2_client_credentials") shown.Authorization = "Bearer •••";
  if (a.type === "basic") shown.Authorization = `Basic (${a.username}:•••)`;
  if (settings.csrf) {
    shown["x-csrf-token"] = "••• (fetched first)";
    shown.Cookie = "••• (the session's, with the token)";
  }
  return { status: 200, body: { method: built.method, url: built.url, headers: shown, body: built.body, checks: built.checks, problems: built.problems.map(problemWords) } };
}

/** `POST /route-instances/:id/connector/send` `{ invoiceId }` — send this invoice now: a test, or Send again. */
export async function handleSendNow(db: D1Database, userId: string, id: string, body: unknown, deps: DeliveryDeps): Promise<RouteResult> {
  const instance = await httpsOutInstance(db, id);
  if (isResult(instance)) return instance;
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  const invoiceId = (body as { invoiceId?: unknown } | null)?.invoiceId;
  if (typeof invoiceId !== "string") return { status: 400, body: { error: "name the invoice to send" } };
  if (!settingsOf(instance).url) return { status: 409, body: { error: "give the address to send to first", reason: "no_url" } };
  const exists = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!exists) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  const current = await db
    .prepare("SELECT status FROM destination_deliveries WHERE instance_id = ? AND invoice_id = ?")
    .bind(id, invoiceId)
    .first<{ status: string }>();
  if (current?.status === "delivered") {
    return { status: 409, body: { error: "this invoice was already delivered here, and is never sent twice", reason: "already_delivered" } };
  }
  // Send again starts a fresh round of retries, kept in the same message.
  if (current) await db.prepare("UPDATE destination_deliveries SET attempts = 0, status = 'pending', next_attempt_at = ? WHERE instance_id = ? AND invoice_id = ?").bind(new Date().toISOString(), id, invoiceId).run();
  const outcome = await deliverOne(db, id, invoiceId, deps, userId);
  return { status: 200, body: { ...outcome } };
}

/**
 * `POST /route-instances/:id/connector/start` `{ includeWaiting }` — start
 * sending. What is already payment-eligible is sent only if the person
 * says so; otherwise it is set aside (`skipped`), never sent by itself.
 */
export async function handleStartDestination(db: D1Database, id: string, body: unknown): Promise<RouteResult> {
  const instance = await httpsOutInstance(db, id);
  if (isResult(instance)) return instance;
  if (instance.started_at) return { status: 409, body: { error: "the Destination has already started: resume it instead", reason: "already_started" } };
  const settings = settingsOf(instance);
  if (!settings.url) return { status: 409, body: { error: "give the address to send to first", reason: "no_url" } };
  const secretName = SECRET_FOR[settings.auth.type];
  if (secretName && !(await secretsSet(db, id))[secretName]) {
    return { status: 409, body: { error: `set the ${secretName.replace("_", " ")} first`, reason: "secret_missing" } };
  }
  const includeWaiting = (body as { includeWaiting?: unknown } | null)?.includeWaiting === true;
  const now = new Date().toISOString();
  const counted = await queueNew(db, id, instance.process_id, now, includeWaiting ? "pending" : "skipped");
  await db.prepare("UPDATE route_instances SET status = 'active', started_at = ? WHERE id = ?").bind(now, id).run();
  return { status: 200, body: { id, status: "active", startedAt: now, waiting: counted, sent: includeWaiting ? counted : 0, setAside: includeWaiting ? 0 : counted } };
}

/**
 * `PUT /route-instances/:id/units` `{ unitIds, includeWaiting? }` — the
 * business units a Destination sends for — decision 0587. `null` or `[]`
 * is all. Widening a started HTTPS out Destination brings in invoices
 * already waiting in the units it now covers: they are sent only if the
 * person says so (`includeWaiting`), as when it was started (0585); asked
 * without it, the reply says how many (`decide_waiting`).
 */
export async function handleSetDestinationUnits(db: D1Database, id: string, body: unknown): Promise<RouteResult> {
  const instance = await instanceOf(db, id);
  if (!instance) return { status: 404, body: { error: `there is no Destination ${id}` } };
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.unitIds;
  if (raw !== null && raw !== undefined && !Array.isArray(raw)) return { status: 400, body: { error: "unitIds must be a list of business units, or null for all", reason: "bad_units" } };
  const unitIds = [...new Set(((raw as unknown[] | null) ?? []).map(String))];
  if (unitIds.length > 0) {
    const known = (
      await db.prepare(`SELECT id FROM org_units WHERE id IN (${unitIds.map(() => "?").join(", ")})`).bind(...unitIds).all<{ id: string }>()
    ).results.map((r) => r.id);
    const unknown = unitIds.filter((u) => !known.includes(u));
    if (unknown.length > 0) return { status: 400, body: { error: `there is no business unit ${unknown.join(", ")}`, reason: "unknown_unit" } };
  }
  const next = unitIds.length > 0 ? unitIds : null;

  let setAside = 0;
  if (instance.route_id === HTTPS_OUT && instance.started_at) {
    const payable = await payableInvoiceIds(db, instance.process_id);
    const before = new Set(await coveredInvoices(db, unitIdsOf(instance), payable));
    const taken = new Set(
      (await db.prepare("SELECT invoice_id FROM destination_deliveries WHERE instance_id = ?").bind(id).all<{ invoice_id: string }>()).results.map((r) => r.invoice_id)
    );
    const newly = (await coveredInvoices(db, next, payable)).filter((x) => !before.has(x) && !taken.has(x));
    if (newly.length > 0 && typeof b.includeWaiting !== "boolean") {
      return { status: 409, body: { error: `${newly.length} invoices already waiting in the units added`, reason: "decide_waiting", waiting: newly.length } };
    }
    if (newly.length > 0 && b.includeWaiting === false) {
      const now = new Date().toISOString();
      await db.batch(
        newly.map((invoiceId) =>
          db
            .prepare("INSERT OR IGNORE INTO destination_deliveries (instance_id, invoice_id, status, created_at) VALUES (?, ?, 'skipped', ?)")
            .bind(id, invoiceId, now)
        )
      );
      setAside = newly.length;
    }
  }
  await db.prepare("UPDATE route_instances SET unit_ids = ? WHERE id = ?").bind(next ? JSON.stringify(next) : null, id).run();
  const covered = await coveredUnits(db, next);
  return { status: 200, body: { id, unitIds: next, covered: covered ? [...covered] : null, setAside } };
}

/**
 * `POST /route-instances/:id/connector/upgrade` — move a Destination to
 * its connector's latest version (decision 0589): what the connector
 * fixes is applied; the customer's own settings (address, sign-in,
 * secret, reference, units) stay. Where the new version no longer allows
 * its way of signing in, it moves to the new default, and says so.
 */
export async function handleUpgradeConnector(db: D1Database, id: string, library: ConnectorDefinition[] = STANDARD_CONNECTORS, userId: string | null = null): Promise<RouteResult> {
  const instance = await instanceOf(db, id);
  if (!instance) return { status: 404, body: { error: `there is no Destination ${id}` } };
  const connector = connectorOfInstance(library, instance);
  if (!connector) return { status: 404, body: { error: "this Destination was made from no connector in the library", reason: "no_connector" } };
  const from = instance.connector_version ?? 1;
  if (connector.version <= from) return { status: 409, body: { error: "it is already on the latest version", reason: "up_to_date" } };
  let authChanged = false;
  if (instance.route_id === HTTPS_OUT && connector.settings) {
    const settings = settingsOf(instance);
    for (const key of connector.settings.fixed) {
      const fixed = connector.settings.defaults[key];
      if (fixed !== undefined) (settings as unknown as Record<string, unknown>)[key] = fixed;
    }
    if (!connector.settings.authTypes.includes(settings.auth.type)) {
      settings.auth = { ...(connector.settings.defaults.auth ?? { type: "none" }) };
      authChanged = true;
    }
    await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify(settings), id).run();
  }
  /**
   * Decision 0601: a partner's mapping follows the connector while the
   * Destination's live mapping is still the one the connector gave it.
   * Once the customer has published their own changes, theirs is kept,
   * and the upgrade says so.
   */
  let mapping: "updated" | "kept" | null = null;
  let listsCreated: string[] = [];
  if (connector.publisher === "partner" && connector.outboundMapping) {
    const before = await partnerCopy(db, connector.id, from);
    const was = before ? await mappingForCustomer(db, "", before, false) : null;
    const live = await liveOutboundMapping(db, id);
    const following = !live || (was !== null && JSON.stringify(was.mapping) === JSON.stringify(live.definition));
    if (following) {
      const next = await mappingForCustomer(db, userId ?? "", connector, true);
      if (next) {
        await installMapping(db, id, userId ?? "", connector, next.mapping);
        listsCreated = next.created;
      }
      mapping = "updated";
    } else {
      mapping = "kept";
    }
  }
  await db
    .prepare("UPDATE route_instances SET connector_id = ?, connector_version = ? WHERE id = ?")
    .bind(connector.id, connector.version, id)
    .run();
  return { status: 200, body: { id, connectorId: connector.id, from, to: connector.version, authChanged, mapping, listsCreated } };
}

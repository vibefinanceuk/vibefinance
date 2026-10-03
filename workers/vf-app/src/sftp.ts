import type { RouteResult } from "./examples-route.js";
import type { ExtractionModel } from "./extraction.js";
import { captureAttachmentPart } from "./inbound-email.js";
import { addRouteEvent, finishRouteMessage, openRouteMessage, routePartKey, storeRoutePart, type StoredPart } from "./route-messages.js";
import { MAX_UPLOAD_BYTES, uploadType } from "./upload-route.js";
import { NoSecretsKeyError, readSecret, secretsSet, setSecret } from "./connector-secrets.js";

/**
 * **SFTP — decision 0620, the proof of concept.** Both ways, by one
 * transport:
 *
 * - **SFTP out**, a Destination: each invoice written as a file into a
 *   folder on the customer's SFTP server (where an ERP's import picks it
 *   up), whole and never over another;
 * - **SFTP in**, a Source, collecting: the files in a folder on someone
 *   else's SFTP server (an ERP, a scanning bureau, a supplier) taken on
 *   *Check now*, moved to a "done" folder there, and read as invoices as
 *   any arriving file is (`captureAttachmentPart`, as HTTPS in does).
 *
 * The SFTP itself is done by **vf-sftp**, a Worker with a container
 * (`workers/vf-sftp`), over the `SFTP_SERVICE` service binding: a Worker
 * can open the connection to port 22, but no maintained SSH library runs
 * in one. vf-sftp keeps nothing; the password or key is read here, from
 * the connector secrets (AES-GCM, `connector-secrets.ts`), for each run.
 *
 * **The server's identity, trusted on first test.** *Test connection*
 * shows the server's host key fingerprint and keeps it; every run after
 * names it, and a server showing another is refused before anything is
 * sent (`host_key_changed`). Nothing is sent or collected until a test
 * has kept one. Changing the host or port forgets it; so does *Forget*.
 */

export const SFTP_OUT = "sftp-out";
export const SFTP_IN = "sftp-in";

export type SftpAuth = "password" | "key";
export type SftpFormat = "csv" | "vf_json";

export interface SftpSettings {
  host: string;
  port: number;
  username: string;
  auth: SftpAuth;
  /** The folder files go to (out) or are collected from (in), from the root: `/to-erp`. */
  folder: string;
  /** The server's identity, kept by the first successful test. */
  hostKey: string | null;
  /** Out: what each file holds: CSV, or the VibeFinance invoice JSON. */
  format?: SftpFormat;
  /** Out: each file's name, from `{invoiceNumber}`, `{invoiceId}`, `{date}`, `{ext}`. */
  filename?: string;
  /** In: which files are collected: `*.xml`, `RE-*`; `*` for all. */
  pattern?: string;
  /** In: where a collected file is moved: a path, or a folder within the folder. */
  doneFolder?: string;
}

/** The one secret for each way of signing in. */
export const SFTP_SECRET: Record<SftpAuth, string> = { password: "password", key: "private_key" };

export const DEFAULT_SFTP_OUT: SftpSettings = {
  host: "",
  port: 22,
  username: "",
  auth: "password",
  folder: "/",
  hostKey: null,
  format: "csv",
  filename: "{invoiceNumber}.{ext}",
};

export const DEFAULT_SFTP_IN: SftpSettings = {
  host: "",
  port: 22,
  username: "",
  auth: "password",
  folder: "/",
  hostKey: null,
  pattern: "*",
  doneFolder: "processed",
};

/** At most this many files are collected by one *Check now*, so it answers within seconds. */
export const COLLECT_PER_CHECK = 10;

export interface SftpInstance {
  id: string;
  route_id: string;
  process_id: string;
  name: string | null;
  status: string | null;
  settings_json: string | null;
  source_id: string | null;
  started_at?: string | null;
}

export function sftpSettingsOf(instance: { route_id: string; settings_json: string | null }): SftpSettings {
  const base = instance.route_id === SFTP_IN ? DEFAULT_SFTP_IN : DEFAULT_SFTP_OUT;
  let stored: Partial<SftpSettings> = {};
  try {
    stored = instance.settings_json ? (JSON.parse(instance.settings_json) as Partial<SftpSettings>) : {};
  } catch {
    stored = {};
  }
  return { ...base, ...stored };
}

/** A folder as `/a/b`: from the root, no trailing slash, no `.` or `..`. */
function normalFolder(raw: string): string | null {
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return null;
  return `/${parts.join("/")}`;
}

/** A file name or folder within a folder, joined. */
export function remotePath(folder: string, name: string): string {
  return folder === "/" ? `/${name}` : `${folder}/${name}`;
}

/** Where a collected file goes: a path from the root, or a folder within the folder collected from. */
export function doneFolderOf(settings: SftpSettings): string {
  const raw = settings.doneFolder ?? "processed";
  return (raw.startsWith("/") ? normalFolder(raw) : normalFolder(remotePath(settings.folder, raw))) ?? remotePath(settings.folder, "processed");
}

/**
 * The settings, checked, in words. `current` keeps the server's identity
 * while the host and port stay the same.
 */
export function checkSftpSettings(
  input: unknown,
  direction: "out" | "in",
  current: SftpSettings | null
): { settings: SftpSettings } | { error: string; reason: string } {
  const s = (input ?? {}) as Record<string, unknown>;
  const host = typeof s.host === "string" ? s.host.trim() : "";
  if (host === "") return { error: "name the server, such as sftp.example.com", reason: "no_host" };
  if (/^[a-z]+:\/\//i.test(host) || /[\s/@]/.test(host) || host.length > 253) {
    return { error: "give the server's name alone, such as sftp.example.com: no sftp://, user or folder", reason: "bad_host" };
  }
  const port = s.port === undefined || s.port === null || s.port === "" ? 22 : Number(s.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "the port is a number from 1 to 65535, usually 22", reason: "bad_port" };
  const username = typeof s.username === "string" ? s.username.trim() : "";
  if (username === "" || username.length > 100) return { error: "name the user to sign in as", reason: "no_username" };
  const auth = s.auth === "key" ? "key" : s.auth === "password" || s.auth === undefined ? "password" : null;
  if (!auth) return { error: "sign in with a password or a private key", reason: "bad_auth" };
  const folder = normalFolder(typeof s.folder === "string" && s.folder.trim() !== "" ? s.folder.trim() : "/");
  if (!folder) return { error: "a folder cannot climb out with ..", reason: "bad_folder" };
  const sameServer = current && current.host === host && current.port === port;
  const settings: SftpSettings = { host, port, username, auth, folder, hostKey: sameServer ? current.hostKey : null };

  if (direction === "out") {
    const format = s.format === undefined ? "csv" : s.format;
    // A Destination's own outbound mapping is HTTPS out's for now; SFTP out writes CSV or the invoice JSON.
    if (format !== "csv" && format !== "vf_json") return { error: "the file is CSV or the VibeFinance invoice JSON", reason: "bad_format" };
    const filename = typeof s.filename === "string" && s.filename.trim() !== "" ? s.filename.trim() : DEFAULT_SFTP_OUT.filename!;
    if (filename.includes("/") || filename.length > 120) return { error: "a file name has no folder in it, and at most 120 characters", reason: "bad_filename" };
    if (!filename.includes("{invoiceNumber}") && !filename.includes("{invoiceId}")) {
      return { error: "a file name needs {invoiceNumber} or {invoiceId}, so each invoice has its own", reason: "filename_not_unique" };
    }
    settings.format = format;
    settings.filename = filename;
  } else {
    const pattern = typeof s.pattern === "string" && s.pattern.trim() !== "" ? s.pattern.trim() : "*";
    if (pattern.includes("/") || pattern.length > 60) return { error: "the files to collect are a name with * or ?, such as *.xml, with no folder", reason: "bad_pattern" };
    const doneRaw = typeof s.doneFolder === "string" && s.doneFolder.trim() !== "" ? s.doneFolder.trim() : "processed";
    settings.pattern = pattern;
    settings.doneFolder = doneRaw;
    const done = doneRaw.startsWith("/") ? normalFolder(doneRaw) : normalFolder(remotePath(folder, doneRaw));
    if (!done) return { error: "the done folder cannot climb out with ..", reason: "bad_done_folder" };
    if (done === folder) return { error: "collected files are moved to another folder, so they are taken once", reason: "done_is_folder" };
  }
  return { settings };
}

/** `*` any run of characters, `?` one; case as written; the whole name. */
export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return re.test(name);
}

/** A file's name for one invoice, from the pattern: anything not a letter, number, `.`, `-` or `_` becomes `_`. */
export function fileNameFor(pattern: string, values: { invoiceNumber: string; invoiceId: string; date: string; ext: string }): string {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, "_");
  return pattern
    .replace(/\{invoiceNumber\}/g, clean(values.invoiceNumber))
    .replace(/\{invoiceId\}/g, clean(values.invoiceId))
    .replace(/\{date\}/g, clean(values.date))
    .replace(/\{ext\}/g, clean(values.ext));
}

// --- Asking vf-sftp ------------------------------------------------------------------

export interface SftpConnection {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  hostKey?: string | null;
}
export type SftpOp =
  | { op: "list"; path: string }
  | { op: "put"; path: string; contentBase64: string }
  | { op: "get"; path: string }
  | { op: "move"; from: string; to: string }
  | { op: "ensureDir"; path: string };
export interface SftpError {
  code: string;
  message: string;
}
export interface SftpStep {
  ok: boolean;
  error?: SftpError;
  entries?: Array<{ name: string; size: number; modifiedAt: string | null; isFile: boolean }>;
  contentBase64?: string;
  path?: string;
  bytes?: number;
}
export interface SftpAnswer {
  hostKey: string | null;
  results?: SftpStep[];
  error?: SftpError;
}
/** One run on one server: sign in, the operations in order, the answer. */
export type SftpRun = (connection: SftpConnection, ops: SftpOp[]) => Promise<SftpAnswer>;

/** vf-sftp over its service binding, or null where this Worker has none. */
export function sftpRunnerFrom(binding: Fetcher | undefined): SftpRun | null {
  if (!binding) return null;
  return async (connection, ops) => {
    let reply: Response;
    try {
      reply = await binding.fetch("https://vf-sftp/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection, ops }),
      });
    } catch (err) {
      return { hostKey: null, error: { code: "runner_unavailable", message: `the SFTP service could not be reached: ${(err as Error).message}` } };
    }
    const body = (await reply.json().catch(() => null)) as SftpAnswer | null;
    if (!body) return { hostKey: null, error: { code: "runner_unavailable", message: `the SFTP service answered HTTP ${reply.status}` } };
    return body;
  };
}

/** What the run needs: the settings, and the password or key read from its encrypted store. */
export async function connectionFor(
  db: D1Database,
  secretsKey: string | undefined,
  instanceId: string,
  settings: SftpSettings
): Promise<SftpConnection | SftpError> {
  if (!settings.host || !settings.username) return { code: "not_set_up", message: "give the server and user first" };
  let secret: string | null;
  try {
    secret = await readSecret(db, secretsKey, instanceId, SFTP_SECRET[settings.auth]);
  } catch (err) {
    if (err instanceof NoSecretsKeyError) return { code: "no_secrets_key", message: err.message };
    throw err;
  }
  if (!secret) return { code: "secret_missing", message: settings.auth === "key" ? "give the private key first" : "give the password first" };
  return {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    ...(settings.auth === "key" ? { privateKey: secret } : { password: secret }),
    hostKey: settings.hostKey,
  };
}

const isError = (x: SftpConnection | SftpError): x is SftpError => "code" in x && "message" in x && !("host" in x);

export interface SftpDeps {
  secretsKey?: string;
  sftp?: SftpRun | null;
}

const NO_RUNNER: SftpError = { code: "runner_unavailable", message: "SFTP is not set up for this environment: vf-sftp is not bound as SFTP_SERVICE" };

// --- The instance's own routes -----------------------------------------------------------

async function sftpInstance(db: D1Database, id: string): Promise<SftpInstance | RouteResult> {
  const row = await db
    .prepare("SELECT id, route_id, process_id, name, status, settings_json, source_id, started_at FROM route_instances WHERE id = ?")
    .bind(id)
    .first<SftpInstance>();
  if (!row || (row.route_id !== SFTP_OUT && row.route_id !== SFTP_IN)) return { status: 404, body: { error: `there is no SFTP route ${id}` } };
  if (row.route_id === SFTP_IN && !row.name) {
    const source = await db.prepare("SELECT name FROM sources WHERE id = ?").bind(row.source_id).first<{ name: string }>();
    row.name = source?.name ?? id;
  }
  return row;
}
const isResult = (x: SftpInstance | RouteResult): x is RouteResult => "body" in x && !("route_id" in x);
const directionOf = (row: SftpInstance) => (row.route_id === SFTP_IN ? "in" : "out");

/** `GET /route-instances/:id/sftp` — its settings, which secrets are set, and (in) where files are moved. */
export async function handleGetSftp(db: D1Database, id: string): Promise<RouteResult> {
  const row = await sftpInstance(db, id);
  if (isResult(row)) return row;
  const settings = sftpSettingsOf(row);
  return {
    status: 200,
    body: {
      instance: { id: row.id, name: row.name, routeId: row.route_id, direction: directionOf(row), processId: row.process_id, status: row.status, startedAt: row.started_at ?? null },
      settings,
      ...(row.route_id === SFTP_IN ? { doneFolder: doneFolderOf(settings) } : {}),
      secrets: await secretsSet(db, id),
    },
  };
}

/** `PUT /route-instances/:id/sftp` `{ settings, secret? }` — checked; the password or key encrypted. */
export async function handleSaveSftp(db: D1Database, userId: string, id: string, body: unknown, secretsKey: string | undefined): Promise<RouteResult> {
  const row = await sftpInstance(db, id);
  if (isResult(row)) return row;
  if (row.status === "retired") return { status: 409, body: { error: "it is retired", reason: "retired" } };
  const b = (body ?? {}) as Record<string, unknown>;
  const current = sftpSettingsOf(row);
  const checked = checkSftpSettings(b.settings, directionOf(row), current);
  if ("error" in checked) return { status: 400, body: checked };
  const secret = typeof b.secret === "string" ? b.secret : "";
  if (secret !== "") {
    try {
      await setSecret(db, secretsKey, id, SFTP_SECRET[checked.settings.auth], secret, userId);
    } catch (err) {
      if (err instanceof NoSecretsKeyError) return { status: 503, body: { error: err.message, reason: "no_secrets_key" } };
      throw err;
    }
  }
  await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify(checked.settings), id).run();
  const set = await secretsSet(db, id);
  return {
    status: 200,
    body: {
      settings: checked.settings,
      secrets: set,
      secretMissing: !set[SFTP_SECRET[checked.settings.auth]],
      // Said, so a person knows to test again.
      identityForgotten: current.hostKey !== null && checked.settings.hostKey === null,
    },
  };
}

/**
 * `POST /route-instances/:id/sftp/test` — sign in and list the folder.
 * The first success keeps the server's identity; the answer says it,
 * and (in) how many files are waiting to be collected.
 */
export async function handleTestSftp(db: D1Database, id: string, deps: SftpDeps): Promise<RouteResult> {
  const row = await sftpInstance(db, id);
  if (isResult(row)) return row;
  const settings = sftpSettingsOf(row);
  const connection = await connectionFor(db, deps.secretsKey, id, settings);
  if (isError(connection)) return { status: 409, body: { ok: false, ...connection } };
  if (!deps.sftp) return { status: 503, body: { ok: false, ...NO_RUNNER } };
  const answer = await deps.sftp(connection, [{ op: "list", path: settings.folder }]);
  const failed = answer.error ?? answer.results?.[0]?.error;
  if (failed) {
    return { status: 200, body: { ok: false, code: failed.code, message: failed.message, hostKey: answer.hostKey, trusted: settings.hostKey } };
  }
  let kept = false;
  if (!settings.hostKey && answer.hostKey) {
    await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify({ ...settings, hostKey: answer.hostKey }), id).run();
    kept = true;
  }
  const entries = answer.results?.[0]?.entries ?? [];
  const files = entries.filter((e) => e.isFile);
  const waiting = row.route_id === SFTP_IN ? files.filter((e) => globMatch(settings.pattern ?? "*", e.name)) : null;
  return {
    status: 200,
    body: {
      ok: true,
      hostKey: answer.hostKey,
      kept,
      folder: settings.folder,
      files: files.length,
      ...(waiting ? { waiting: waiting.length, sample: waiting.slice(0, 5).map((e) => e.name) } : {}),
    },
  };
}

/** `POST /route-instances/:id/sftp/forget-identity` — trust whichever identity the next test shows. */
export async function handleForgetSftpIdentity(db: D1Database, id: string): Promise<RouteResult> {
  const row = await sftpInstance(db, id);
  if (isResult(row)) return row;
  const settings = sftpSettingsOf(row);
  await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify({ ...settings, hostKey: null }), id).run();
  return { status: 200, body: { hostKey: null } };
}

// --- SFTP out: one invoice, one file ---------------------------------------------------------

export interface SftpSendOutcome {
  ok: boolean;
  /** The file's path on the server, kept as the reference back. */
  path?: string;
  error?: SftpError;
  /** Whether trying again might help (the server could not be reached), or a person must act first. */
  retry: boolean;
}

/**
 * Write one invoice's file: `filename` in `folder`, whole, never over
 * another. Called by the delivery engine (`deliverOne`), which records the
 * attempt as for HTTPS out.
 */
export async function sendFileBySftp(
  db: D1Database,
  instanceId: string,
  settings: SftpSettings,
  file: { body: string; invoiceNumber: string; invoiceId: string },
  deps: SftpDeps
): Promise<SftpSendOutcome> {
  if (!deps.sftp) return { ok: false, error: NO_RUNNER, retry: true };
  if (!settings.hostKey) return { ok: false, error: { code: "not_tested", message: "test the connection first, to confirm the server's identity" }, retry: true };
  const connection = await connectionFor(db, deps.secretsKey, instanceId, settings);
  if (isError(connection)) return { ok: false, error: connection, retry: true };
  const ext = settings.format === "csv" ? "csv" : "json";
  const name = fileNameFor(settings.filename ?? DEFAULT_SFTP_OUT.filename!, {
    invoiceNumber: file.invoiceNumber,
    invoiceId: file.invoiceId,
    date: new Date().toISOString().slice(0, 10),
    ext,
  });
  const path = remotePath(settings.folder, name);
  const contentBase64 = bytesToBase64(new TextEncoder().encode(file.body));
  const answer = await deps.sftp(connection, [{ op: "put", path, contentBase64 }]);
  const failed = answer.error ?? answer.results?.[0]?.error;
  if (!failed) return { ok: true, path, retry: false };
  // A file of that name already there, or a server pretending, needs a person; the rest may pass.
  const needsPerson = ["exists", "host_key_changed", "permission_denied", "bad_request", "bad_key"].includes(failed.code);
  return { ok: false, path, error: failed, retry: !needsPerson };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// --- SFTP in: collecting -----------------------------------------------------------------

export interface CollectDeps extends SftpDeps {
  model: ExtractionModel;
  bucket?: R2Bucket;
  customerId?: string;
}

interface Collected {
  file: string;
  movedTo?: string;
  messageId?: string;
  invoiceIds?: string[];
  status: "collected" | "unreadable" | "failed" | "skipped";
  reason?: string;
}

/**
 * `POST /route-instances/:id/sftp/collect` — *Check now*: the files in the
 * folder matching the pattern, up to ten, each **moved to the done folder
 * first and then read from there**, so a file is never taken twice even
 * if reading it fails here (the original is kept with its message, and
 * stays in the done folder). Each becomes a route message on the Source
 * and is read as any arriving file is.
 */
export async function handleCollectNow(db: D1Database, userId: string, id: string, deps: CollectDeps): Promise<RouteResult> {
  const row = await sftpInstance(db, id);
  if (isResult(row)) return row;
  if (row.route_id !== SFTP_IN) return { status: 404, body: { error: `${id} is not an SFTP Source` } };
  const source = await db.prepare("SELECT id, name, status FROM sources WHERE id = ?").bind(row.source_id).first<{ id: string; name: string; status: string }>();
  if (!source) return { status: 404, body: { error: `there is no source ${row.source_id}` } };
  if (source.status !== "active") return { status: 409, body: { error: `${source.name} is retired`, reason: "retired" } };
  const settings = sftpSettingsOf(row);
  if (!settings.hostKey) return { status: 409, body: { error: "test the connection first, to confirm the server's identity", reason: "not_tested" } };
  const connection = await connectionFor(db, deps.secretsKey, id, settings);
  if (isError(connection)) return { status: 409, body: { error: connection.message, reason: connection.code } };
  if (!deps.sftp) return { status: 503, body: { error: NO_RUNNER.message, reason: NO_RUNNER.code } };

  const listing = await deps.sftp(connection, [{ op: "list", path: settings.folder }]);
  const listFailed = listing.error ?? listing.results?.[0]?.error;
  if (listFailed) return { status: 502, body: { error: listFailed.message, reason: listFailed.code } };
  const matching = (listing.results?.[0]?.entries ?? []).filter((e) => e.isFile && globMatch(settings.pattern ?? "*", e.name) && !e.name.endsWith(".part"));
  const done = doneFolderOf(settings);
  const out: Collected[] = [];

  for (const entry of matching.slice(0, COLLECT_PER_CHECK)) {
    if (entry.size > MAX_UPLOAD_BYTES) {
      out.push({ file: entry.name, status: "skipped", reason: `larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB; left where it is` });
      continue;
    }
    if (!uploadType(entry.name, null)) {
      out.push({ file: entry.name, status: "skipped", reason: "not a type an invoice arrives as (PDF, image, XML or CSV); left where it is" });
      continue;
    }
    const from = remotePath(settings.folder, entry.name);
    let to = remotePath(done, entry.name);
    let run = await deps.sftp(connection, [{ op: "ensureDir", path: done }, { op: "move", from, to }, { op: "get", path: to }]);
    let failed = run.error ?? run.results?.find((r) => !r.ok)?.error;
    if (failed?.code === "exists") {
      // One of that name was collected before: this one is kept beside it, with the time in front.
      to = remotePath(done, `${new Date().toISOString().replace(/[:.]/g, "-")}-${entry.name}`);
      run = await deps.sftp(connection, [{ op: "move", from, to }, { op: "get", path: to }]);
      failed = run.error ?? run.results?.find((r) => !r.ok)?.error;
    }
    if (failed) {
      // Gone already (another collector), or the server refused: left for the next check, said.
      out.push({ file: entry.name, status: failed.code === "not_found" ? "skipped" : "failed", reason: failed.message });
      continue;
    }
    const got = run.results?.[run.results.length - 1];
    const bytes = base64ToBytes(got?.contentBase64 ?? "");
    out.push(await readCollected(db, userId, row, source, settings, entry.name, to, bytes, deps));
  }

  return {
    status: 200,
    body: {
      folder: settings.folder,
      doneFolder: done,
      matching: matching.length,
      collected: out,
      left: Math.max(0, matching.length - COLLECT_PER_CHECK),
    },
  };
}

async function readCollected(
  db: D1Database,
  userId: string,
  row: SftpInstance,
  source: { id: string; name: string },
  settings: SftpSettings,
  filename: string,
  movedTo: string,
  bytes: Uint8Array,
  deps: CollectDeps
): Promise<Collected> {
  const receivedAt = new Date().toISOString();
  const messageId = await openRouteMessage(db, {
    instanceId: source.id,
    direction: "in",
    counterparty: `${settings.username}@${settings.host}`,
    recipient: source.name,
    subject: filename.slice(0, 300),
    bytes: bytes.length,
    receivedAt,
  });
  if (!messageId) return { file: filename, movedTo, status: "failed", reason: "the message could not be recorded; the file is in the done folder" };
  await addRouteEvent(db, messageId, "sftp_collected", { detail: `${remotePath(settings.folder, filename)} → ${movedTo}`, actor: userId });

  let stored: StoredPart | undefined;
  const type = uploadType(filename, null) ?? "application/octet-stream";
  if (deps.bucket && deps.customerId) {
    const part = await storeRoutePart(deps.bucket, db, {
      messageId,
      seq: 1,
      role: "attachment",
      filename,
      contentType: type,
      bytes,
      key: routePartKey(deps.customerId, source.id, messageId, receivedAt, 1, filename),
    });
    if ("stored" in part) stored = part.stored;
    else await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: 1, detail: part.reason });
  }
  const outcome = await captureAttachmentPart(db, {
    messageId,
    sourceId: source.id,
    seq: 1,
    filename,
    bytes,
    stored,
    model: deps.model,
    bucket: deps.bucket,
    customerId: deps.customerId,
    sender: `${settings.username}@${settings.host}`,
  });
  if (!outcome.captured) {
    await finishRouteMessage(db, messageId, {
      status: "failed",
      failedPart: "translation",
      errorCode: "unreadable",
      errorText: outcome.why ?? "the file could not be read as an invoice",
    });
    return { file: filename, movedTo, messageId, status: "unreadable", reason: outcome.why ?? "the file could not be read as an invoice" };
  }
  await finishRouteMessage(db, messageId, { status: outcome.why ? "partial" : "delivered" });
  const invoiceIds = outcome.invoiceIds ?? (outcome.invoiceId ? [outcome.invoiceId] : []);
  return { file: filename, movedTo, messageId, invoiceIds, status: "collected" };
}


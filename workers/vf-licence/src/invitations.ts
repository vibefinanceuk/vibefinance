import type { RouteResult } from "./customers-route.js";
import { grantAccess, setCredential } from "./credentials.js";

/**
 * **Inviting a person — decision 0593** (Dan, 2 October 2026), in place of
 * setting a password with `curl`.
 *
 * An invitation is for one email, at one customer, to some of its
 * environments (all of them, unless named). It is emailed through Resend:
 * a link to the shared interface's welcome page carrying a long random
 * token, and a 6-digit code. On the page the person enters the code and
 * chooses a password; that sets their credential (`setCredential`) and
 * grants their access (`grantAccess`), as the operator's routes do.
 *
 * - **Only hashes are kept**: SHA-256 of the token, and of the token with
 *   the code. The token is the real secret (256 bits). The code arrives in
 *   the same email, so it adds convenience (typing on another device),
 *   not a second factor, as Dan was told.
 * - **Once, and briefly**: 72 hours, then expired; accepted once; five
 *   wrong codes and it is spent. A new invitation for the same person at
 *   the same customer cancels the one before.
 * - **Who may invite**: the operator, for any customer (privileged
 *   routes), and a customer's own instance, for that customer and that
 *   environment only, with its environment key (`created_via =
 *   environment:<id>`).
 */

export const INVITATION_HOURS = 72;
export const MAX_CODE_ATTEMPTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InvitationMailer {
  apiKey?: string;
  from?: string;
  /** The welcome page, such as https://app.vibefinance-ai.com/welcome.html */
  linkBase?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

interface InvitationRow {
  id: string;
  email: string;
  customer_id: string;
  environment_ids_json: string;
  status: "pending" | "accepted" | "cancelled" | "expired" | "spent";
  attempts: number;
  created_at: string;
  created_by: string | null;
  created_via: string;
  expires_at: string;
  sent_at: string | null;
  send_error: string | null;
  accepted_at: string | null;
  code_hash: string;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Six digits, uniformly: values at or above the largest multiple of a million are drawn again. */
function randomCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < limit) return String(n % 1_000_000).padStart(6, "0");
  }
}

const codeHash = (token: string, code: string) => sha256(`${token}:${code.replace(/\s+/g, "")}`);

/** What an invitation is now: a pending one past its time is expired. */
function statusOf(row: InvitationRow, now: Date): InvitationRow["status"] {
  return row.status === "pending" && new Date(row.expires_at).getTime() <= now.getTime() ? "expired" : row.status;
}

function view(row: InvitationRow, now: Date) {
  return {
    id: row.id,
    email: row.email,
    customerId: row.customer_id,
    environmentIds: JSON.parse(row.environment_ids_json) as string[],
    status: statusOf(row, now),
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdVia: row.created_via,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    sendError: row.send_error,
    acceptedAt: row.accepted_at,
  };
}

/** The email: the link, the code, when it stops working, and who it is from. */
export function invitationEmail(customerName: string, link: string, code: string, expiresAt: string) {
  const when = `${expiresAt.slice(0, 16).replace("T", " ")} UTC`;
  return {
    subject: `Your VibeFinance account for ${customerName}`,
    text: [
      "Hello,",
      "",
      `You have been invited to use VibeFinance for ${customerName}.`,
      "",
      "Open this link to choose your password:",
      link,
      "",
      `Your code: ${code.slice(0, 3)} ${code.slice(3)}`,
      "",
      `The link and code work once, until ${when}.`,
      "If you were not expecting this, you can ignore this email.",
      "",
      "VibeFinance",
    ].join("\n"),
  };
}

async function send(mailer: InvitationMailer, to: string, customerName: string, token: string, code: string, expiresAt: string): Promise<string | null> {
  if (!mailer.apiKey || !mailer.from || !mailer.linkBase) return "invitation email is not configured (RESEND_API_KEY, INVITE_FROM_ADDRESS, INVITE_LINK_BASE)";
  // The token in the fragment: never sent to a server, so never in a log.
  const link = `${mailer.linkBase}#t=${token}`;
  const { subject, text } = invitationEmail(customerName, link, code, expiresAt);
  try {
    const r = await (mailer.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mailer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mailer.from, to: [to], subject, text }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { message?: unknown };
      return typeof body.message === "string" ? body.message : `Resend refused the send (HTTP ${r.status})`;
    }
    return null;
  } catch (err) {
    return `could not reach Resend: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export interface InviteInput {
  email: unknown;
  customerId: string;
  /** Null for all of the customer's environments. */
  environmentIds: string[] | null;
  createdBy: string | null;
  createdVia: string;
}

/** Makes an invitation (cancelling any pending one for the same person and customer) and emails it. */
export async function invite(db: D1Database, mailer: InvitationMailer, input: InviteInput): Promise<RouteResult> {
  const now = (mailer.now ?? (() => new Date()))();
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { status: 400, body: { error: "give an email address", reason: "bad_email" } };
  const customer = await db.prepare("SELECT id, name FROM customers WHERE id = ?").bind(input.customerId).first<{ id: string; name: string }>();
  if (!customer) return { status: 404, body: { error: `customer ${input.customerId} does not exist`, reason: "no_customer" } };
  const environments = (await db.prepare("SELECT id FROM environments WHERE customer_id = ? ORDER BY kind").bind(customer.id).all<{ id: string }>()).results.map((e) => e.id);
  const chosen = input.environmentIds ?? environments;
  if (chosen.length === 0) return { status: 409, body: { error: `${customer.name} has no environment to sign in to yet`, reason: "no_environment" } };
  const foreign = chosen.find((id) => !environments.includes(id));
  if (foreign) return { status: 422, body: { error: `environment ${foreign} is not ${customer.name}'s`, reason: "not_customers_environment" } };

  const token = randomToken();
  const code = randomCode();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + INVITATION_HOURS * 3600_000).toISOString();
  await db.batch([
    db.prepare("UPDATE invitations SET status = 'cancelled' WHERE customer_id = ? AND email = ? AND status = 'pending'").bind(customer.id, email),
    db
      .prepare(
        `INSERT INTO invitations (id, email, customer_id, environment_ids_json, token_hash, code_hash, created_at, created_by, created_via, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, customer.id, JSON.stringify(chosen), await sha256(token), await codeHash(token, code), now.toISOString(), input.createdBy, input.createdVia, expiresAt),
  ]);
  const sendError = await send(mailer, email, customer.name, token, code, expiresAt);
  await db
    .prepare("UPDATE invitations SET sent_at = ?, send_error = ? WHERE id = ?")
    .bind(sendError ? null : now.toISOString(), sendError, id)
    .run();
  const row = await db.prepare("SELECT * FROM invitations WHERE id = ?").bind(id).first<InvitationRow>();
  return { status: sendError ? 502 : 201, body: { invitation: view(row as InvitationRow, now), ...(sendError ? { error: sendError, reason: "not_sent" } : {}) } };
}

/** `GET /invitations?customerId=` — the operator's list, newest first. No secrets. */
export async function listInvitations(db: D1Database, customerId: string | null, now = new Date()): Promise<RouteResult> {
  const rows = (
    await db
      .prepare(`SELECT * FROM invitations ${customerId ? "WHERE customer_id = ?" : ""} ORDER BY created_at DESC LIMIT 200`)
      .bind(...(customerId ? [customerId] : []))
      .all<InvitationRow>()
  ).results;
  return { status: 200, body: { invitations: rows.map((r) => view(r, now)) } };
}

/** An instance's own view: the latest invitation for each person, for this environment. */
export async function listForEnvironment(db: D1Database, environmentId: string, now = new Date()): Promise<RouteResult> {
  const env = await db.prepare("SELECT customer_id FROM environments WHERE id = ?").bind(environmentId).first<{ customer_id: string }>();
  if (!env) return { status: 404, body: { error: "no such environment" } };
  const rows = (await db.prepare("SELECT * FROM invitations WHERE customer_id = ? ORDER BY created_at DESC").bind(env.customer_id).all<InvitationRow>()).results;
  const latest = new Map<string, ReturnType<typeof view>>();
  for (const r of rows) {
    if (!(JSON.parse(r.environment_ids_json) as string[]).includes(environmentId)) continue;
    if (!latest.has(r.email)) latest.set(r.email, view(r, now));
  }
  return { status: 200, body: { invitations: [...latest.values()].map(({ email, status, expiresAt, sentAt, sendError, acceptedAt }) => ({ email, status, expiresAt, sentAt, sendError, acceptedAt })) } };
}

/** `POST /invitations/:id/resend` — a new link and code for the same person, customer and environments. */
export async function resendInvitation(db: D1Database, mailer: InvitationMailer, id: string, createdBy: string | null): Promise<RouteResult> {
  const row = await db.prepare("SELECT * FROM invitations WHERE id = ?").bind(id).first<InvitationRow>();
  if (!row) return { status: 404, body: { error: `invitation ${id} does not exist` } };
  if (row.status === "accepted") return { status: 409, body: { error: `${row.email} has already accepted`, reason: "accepted" } };
  return invite(db, mailer, { email: row.email, customerId: row.customer_id, environmentIds: JSON.parse(row.environment_ids_json) as string[], createdBy, createdVia: row.created_via });
}

/** `POST /invitations/:id/cancel`. */
export async function cancelInvitation(db: D1Database, id: string): Promise<RouteResult> {
  const row = await db.prepare("SELECT status FROM invitations WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return { status: 404, body: { error: `invitation ${id} does not exist` } };
  if (row.status !== "pending") return { status: 409, body: { error: `the invitation is ${row.status}`, reason: row.status } };
  await db.prepare("UPDATE invitations SET status = 'cancelled' WHERE id = ?").bind(id).run();
  return { status: 200, body: { id, status: "cancelled" } };
}

async function byToken(db: D1Database, token: unknown): Promise<InvitationRow | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return db.prepare("SELECT * FROM invitations WHERE token_hash = ?").bind(await sha256(token)).first<InvitationRow>();
}

const NOT_VALID = { status: 404, body: { error: "this invitation link is not valid", reason: "not_valid" } };

/** `POST /invitations/view` `{ token }` — public: who it is for, and whether it can still be used. */
export async function viewInvitation(db: D1Database, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const row = await byToken(db, body.token);
  if (!row) return NOT_VALID;
  const customer = await db.prepare("SELECT name FROM customers WHERE id = ?").bind(row.customer_id).first<{ name: string }>();
  return { status: 200, body: { email: row.email, customerName: customer?.name ?? row.customer_id, status: statusOf(row, now), expiresAt: row.expires_at } };
}

/**
 * `POST /invitations/accept` `{ token, code, password }` — public. The code
 * right, the password long enough: the credential is set, access granted,
 * and the invitation is spent. Five wrong codes spend it too.
 */
export async function acceptInvitation(db: D1Database, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const row = await byToken(db, body.token);
  if (!row) return NOT_VALID;
  const status = statusOf(row, now);
  if (status !== "pending") {
    if (status === "expired" && row.status === "pending") await db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").bind(row.id).run();
    return { status: 410, body: { error: `this invitation is ${status}`, reason: status } };
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12) return { status: 422, body: { error: "the password must be at least 12 characters", reason: "short_password" } };
  const code = typeof body.code === "string" ? body.code : "";
  if ((await codeHash(String(body.token), code)) !== row.code_hash) {
    const attempts = row.attempts + 1;
    const spent = attempts >= MAX_CODE_ATTEMPTS;
    await db.prepare("UPDATE invitations SET attempts = ?, status = ? WHERE id = ?").bind(attempts, spent ? "spent" : "pending", row.id).run();
    return spent
      ? { status: 410, body: { error: "too many wrong codes: ask for a new invitation", reason: "spent" } }
      : { status: 422, body: { error: "the code is not right", reason: "wrong_code", attemptsLeft: MAX_CODE_ATTEMPTS - attempts } };
  }
  // Claimed first, so the same link cannot be used twice at once.
  const claimed = await db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'pending'").bind(now.toISOString(), row.id).run();
  if ((claimed.meta.changes ?? 0) === 0) return { status: 410, body: { error: "this invitation has already been used", reason: "accepted" } };
  const set = await setCredential(db, row.email, row.customer_id, password);
  if (set.status >= 400) return set;
  const environments: Array<{ id: string; instanceUrl: string }> = [];
  for (const environmentId of JSON.parse(row.environment_ids_json) as string[]) {
    const granted = await grantAccess(db, row.email, environmentId, `invitation:${row.created_by ?? row.created_via}`);
    if (granted.status < 400 || granted.status === 409) {
      const e = await db.prepare("SELECT instance_url FROM environments WHERE id = ?").bind(environmentId).first<{ instance_url: string }>();
      if (e) environments.push({ id: environmentId, instanceUrl: e.instance_url });
    }
  }
  return { status: 200, body: { email: row.email, environments } };
}

import type { RouteResult } from "./customers-route.js";
import { hashPassword, verifyPassword } from "@vibefinance/shared";
import {
  PORTAL_ACCESS_TTL_SECONDS,
  PORTAL_SESSION_TTL_SECONDS,
  signPortalToken,
  verifyPortalSession,
  type PortalSessionClaims,
} from "@vibefinance/shared";
import { assessDelay, recordAttempt } from "./login-attempts.js";
import { INVITATION_HOURS, MAX_CODE_ATTEMPTS, type InvitationMailer } from "./invitations.js";

/**
 * **The supplier portal's directory — decision 0713.** Step 1 of
 * docs/design/supplier-portal.md.
 *
 * Who a supplier's people are, and what each may see: one supplier record
 * in one customer's instance, for the companies the customer named. The
 * customer invites (from its instance, with its environment key); the
 * person accepts with a code and a password; the portal signs them in and
 * asks here for a short-lived token per link, which only that instance
 * accepts. **Nothing about an invoice is held here.**
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Recorded in login_attempts in place of an environment: the portal is one front door. */
export const PORTAL_ATTEMPT_SCOPE = "portal";
const REFUSAL = "email or password is not correct";

export interface OrgUnit {
  id: string;
  name: string;
}

interface InvitationRow {
  id: string;
  email: string;
  environment_id: string;
  supplier_id: string;
  supplier_name: string;
  org_units_json: string;
  code_hash: string;
  status: "pending" | "accepted" | "cancelled" | "expired" | "spent";
  attempts: number;
  created_at: string;
  created_by: string | null;
  expires_at: string;
  sent_at: string | null;
  send_error: string | null;
  accepted_at: string | null;
}

interface LinkRow {
  id: string;
  email: string;
  environment_id: string;
  supplier_id: string;
  supplier_name: string;
  org_units_json: string;
  status: "active" | "ended";
  created_at: string;
  created_by: string | null;
  ended_at: string | null;
  ended_by: string | null;
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

function randomCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < limit) return String(n % 1_000_000).padStart(6, "0");
  }
}

const codeHash = (token: string, code: string) => sha256(`${token}:${code.replace(/\s+/g, "")}`);

/** The public half of the fleet's signing key, from the private JWK. */
export function publicKeyOf(privateKeyJwk: JsonWebKey): JsonWebKey {
  const { kty, crv, x, y } = privateKeyJwk;
  return { kty, crv, x, y };
}

/** Companies as given by an instance: non-empty, each with an id and a name, no repeats. */
function readOrgUnits(value: unknown): OrgUnit[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const seen = new Set<string>();
  const units: OrgUnit[] = [];
  for (const v of value) {
    const id = typeof v?.id === "string" ? v.id.trim() : "";
    const name = typeof v?.name === "string" ? v.name.trim() : "";
    if (!id || !name || id.length > 200 || name.length > 200 || seen.has(id)) return null;
    seen.add(id);
    units.push({ id, name });
  }
  return units;
}

function statusOf(row: InvitationRow, now: Date): InvitationRow["status"] {
  return row.status === "pending" && new Date(row.expires_at).getTime() <= now.getTime() ? "expired" : row.status;
}

function invitationView(row: InvitationRow, now: Date) {
  return {
    id: row.id,
    email: row.email,
    supplierId: row.supplier_id,
    orgUnits: JSON.parse(row.org_units_json) as OrgUnit[],
    status: statusOf(row, now),
    createdAt: row.created_at,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    sendError: row.send_error,
    acceptedAt: row.accepted_at,
  };
}

function linkView(row: LinkRow) {
  return {
    id: row.id,
    email: row.email,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    orgUnits: JSON.parse(row.org_units_json) as OrgUnit[],
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    endedAt: row.ended_at,
    endedBy: row.ended_by,
  };
}

/** The email: who invites them, for which companies, the link and the code. */
export function portalInvitationEmail(customerName: string, supplierName: string, companies: string[], link: string, code: string, expiresAt: string) {
  const when = `${expiresAt.slice(0, 16).replace("T", " ")} UTC`;
  return {
    subject: `${customerName} has invited you to the VibeFinance supplier portal`,
    text: [
      "Hello,",
      "",
      `${customerName} has invited you to see ${supplierName}'s invoices with them on the VibeFinance supplier portal: where each invoice is, and when it is sent for payment.`,
      "",
      `For: ${companies.join(", ")}`,
      "",
      "Open this link to accept:",
      link,
      "",
      `Your code: ${code.slice(0, 3)} ${code.slice(3)}`,
      "",
      `The link and code work once, until ${when}.`,
      "If you already use the portal, sign in with your existing password when you accept.",
      "If you were not expecting this, you can ignore this email.",
      "",
      "VibeFinance",
    ].join("\n"),
  };
}

async function send(mailer: InvitationMailer, to: string, mail: { subject: string; text: string }): Promise<string | null> {
  if (!mailer.apiKey || !mailer.from || !mailer.linkBase) return "portal invitation email is not configured (RESEND_API_KEY, INVITE_FROM_ADDRESS, PORTAL_LINK_BASE)";
  try {
    const r = await (mailer.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mailer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mailer.from, to: [to], subject: mail.subject, text: mail.text }),
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

// ---------------------------------------------------------------------------
// From a customer's instance (its environment key): invite, list, end, change.
// ---------------------------------------------------------------------------

/**
 * `POST /environments/:id/portal-invitations` `{ email, supplierId,
 * supplierName, orgUnits: [{id, name}], invitedBy }`. One person, one
 * supplier record, the companies named. A new invitation for the same
 * person and supplier cancels a pending one before it.
 */
export async function invitePortalUser(db: D1Database, mailer: InvitationMailer, environmentId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const now = (mailer.now ?? (() => new Date()))();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { status: 400, body: { error: "give an email address", reason: "bad_email" } };
  const supplierId = typeof body.supplierId === "string" ? body.supplierId.trim() : "";
  const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim().slice(0, 200) : "";
  if (!supplierId || !supplierName) return { status: 400, body: { error: "name the supplier", reason: "no_supplier" } };
  const orgUnits = readOrgUnits(body.orgUnits);
  if (!orgUnits) return { status: 400, body: { error: "name at least one company, each with an id and a name", reason: "no_companies" } };

  const environment = await db
    .prepare("SELECT e.id, c.name AS customer_name FROM environments e JOIN customers c ON c.id = e.customer_id WHERE e.id = ?")
    .bind(environmentId)
    .first<{ id: string; customer_name: string }>();
  if (!environment) return { status: 404, body: { error: "no such environment" } };

  const token = randomToken();
  const code = randomCode();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + INVITATION_HOURS * 3600_000).toISOString();
  const createdBy = typeof body.invitedBy === "string" ? body.invitedBy.slice(0, 200) : null;
  await db.batch([
    db
      .prepare("UPDATE portal_invitations SET status = 'cancelled' WHERE environment_id = ? AND supplier_id = ? AND email = ? AND status = 'pending'")
      .bind(environmentId, supplierId, email),
    db
      .prepare(
        `INSERT INTO portal_invitations (id, email, environment_id, supplier_id, supplier_name, org_units_json, token_hash, code_hash, created_at, created_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, environmentId, supplierId, supplierName, JSON.stringify(orgUnits), await sha256(token), await codeHash(token, code), now.toISOString(), createdBy, expiresAt),
  ]);
  // The token in the fragment: never sent to a server, so never in a log.
  const mail = portalInvitationEmail(environment.customer_name, supplierName, orgUnits.map((u) => u.name), `${mailer.linkBase}#t=${token}`, code, expiresAt);
  const sendError = await send(mailer, email, mail);
  await db.prepare("UPDATE portal_invitations SET sent_at = ?, send_error = ? WHERE id = ?").bind(sendError ? null : now.toISOString(), sendError, id).run();
  const row = (await db.prepare("SELECT * FROM portal_invitations WHERE id = ?").bind(id).first<InvitationRow>())!;
  return { status: sendError ? 502 : 201, body: { invitation: invitationView(row, now), ...(sendError ? { error: sendError, reason: "not_sent" } : {}) } };
}

/** `GET /environments/:id/portal-people?supplierId=` — a supplier's people: their links, and invitations not yet accepted. */
export async function listPortalPeople(db: D1Database, environmentId: string, supplierId: string | null, now = new Date()): Promise<RouteResult> {
  const where = supplierId ? "AND supplier_id = ?" : "";
  const args = supplierId ? [environmentId, supplierId] : [environmentId];
  const links = (await db.prepare(`SELECT * FROM portal_links WHERE environment_id = ? ${where} ORDER BY status, email`).bind(...args).all<LinkRow>()).results;
  const invitations = (
    await db.prepare(`SELECT * FROM portal_invitations WHERE environment_id = ? ${where} AND status != 'accepted' ORDER BY created_at DESC`).bind(...args).all<InvitationRow>()
  ).results;
  // The latest invitation for each person and supplier only.
  const latest = new Map<string, ReturnType<typeof invitationView>>();
  for (const r of invitations) {
    const key = `${r.supplier_id}\u0000${r.email}`;
    if (!latest.has(key)) latest.set(key, invitationView(r, now));
  }
  return { status: 200, body: { links: links.map(linkView), invitations: [...latest.values()] } };
}

/** `POST /environments/:id/portal-invitations/:invitationId/cancel`. */
export async function cancelPortalInvitation(db: D1Database, environmentId: string, invitationId: string): Promise<RouteResult> {
  const row = await db.prepare("SELECT status FROM portal_invitations WHERE id = ? AND environment_id = ?").bind(invitationId, environmentId).first<{ status: string }>();
  if (!row) return { status: 404, body: { error: "no such invitation" } };
  if (row.status !== "pending") return { status: 409, body: { error: `the invitation is ${row.status}`, reason: row.status } };
  await db.prepare("UPDATE portal_invitations SET status = 'cancelled' WHERE id = ?").bind(invitationId).run();
  return { status: 200, body: { id: invitationId, status: "cancelled" } };
}

/** `POST /environments/:id/portal-links/:linkId/companies` `{ orgUnits }` — what the person may see, changed. */
export async function changeLinkCompanies(db: D1Database, environmentId: string, linkId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const orgUnits = readOrgUnits(body.orgUnits);
  if (!orgUnits) return { status: 400, body: { error: "name at least one company, each with an id and a name", reason: "no_companies" } };
  const r = await db
    .prepare("UPDATE portal_links SET org_units_json = ? WHERE id = ? AND environment_id = ? AND status = 'active'")
    .bind(JSON.stringify(orgUnits), linkId, environmentId)
    .run();
  if ((r.meta.changes ?? 0) === 0) return { status: 404, body: { error: "no such active link" } };
  return { status: 200, body: { link: linkView((await db.prepare("SELECT * FROM portal_links WHERE id = ?").bind(linkId).first<LinkRow>())!) } };
}

/** Ends a link, from either side. Its row stays, as a record of who could see what, when. */
async function endLink(db: D1Database, where: { linkId: string; environmentId?: string; email?: string }, endedBy: string, now: Date): Promise<RouteResult> {
  const r = await db
    .prepare(
      `UPDATE portal_links SET status = 'ended', ended_at = ?, ended_by = ?
       WHERE id = ? AND status = 'active' ${where.environmentId ? "AND environment_id = ?" : ""} ${where.email ? "AND email = ?" : ""}`
    )
    .bind(now.toISOString(), endedBy.slice(0, 200), where.linkId, ...(where.environmentId ? [where.environmentId] : []), ...(where.email ? [where.email] : []))
    .run();
  if ((r.meta.changes ?? 0) === 0) return { status: 404, body: { error: "no such active link" } };
  return { status: 200, body: { id: where.linkId, status: "ended" } };
}

/** `POST /environments/:id/portal-links/:linkId/end` `{ endedBy }` — the customer ends it. */
export function endLinkForEnvironment(db: D1Database, environmentId: string, linkId: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const by = typeof body.endedBy === "string" && body.endedBy.trim() ? body.endedBy.trim() : `environment:${environmentId}`;
  return endLink(db, { linkId, environmentId }, by, now);
}

// ---------------------------------------------------------------------------
// Public: viewing and accepting an invitation, signing in.
// ---------------------------------------------------------------------------

async function byToken(db: D1Database, token: unknown): Promise<InvitationRow | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return db.prepare("SELECT * FROM portal_invitations WHERE token_hash = ?").bind(await sha256(token)).first<InvitationRow>();
}

const NOT_VALID = { status: 404, body: { error: "this invitation link is not valid", reason: "not_valid" } };

/** `POST /portal/invitations/view` `{ token }` — who invites whom, for what, and whether they already have a login. */
export async function viewPortalInvitation(db: D1Database, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const row = await byToken(db, body.token);
  if (!row) return NOT_VALID;
  const customer = await db
    .prepare("SELECT c.name FROM environments e JOIN customers c ON c.id = e.customer_id WHERE e.id = ?")
    .bind(row.environment_id)
    .first<{ name: string }>();
  const existing = await db.prepare("SELECT 1 AS ok FROM portal_users WHERE email = ?").bind(row.email).first();
  return {
    status: 200,
    body: {
      email: row.email,
      customerName: customer?.name ?? "",
      supplierName: row.supplier_name,
      orgUnits: (JSON.parse(row.org_units_json) as OrgUnit[]).map((u) => u.name),
      status: statusOf(row, now),
      expiresAt: row.expires_at,
      // Whether to ask for their existing password or a new one.
      hasLogin: existing !== null,
    },
  };
}

/**
 * Which supplier organisation a newly accepting person belongs to: one
 * already linked to the same supplier record at the same customer is the
 * same supplier, so they join it; otherwise a new one, named after the
 * supplier record.
 */
async function orgFor(db: D1Database, row: InvitationRow): Promise<string> {
  const colleague = await db
    .prepare(
      `SELECT u.supplier_org_id FROM portal_links l JOIN portal_users u ON u.email = l.email
       WHERE l.environment_id = ? AND l.supplier_id = ? ORDER BY l.created_at LIMIT 1`
    )
    .bind(row.environment_id, row.supplier_id)
    .first<{ supplier_org_id: string }>();
  if (colleague) return colleague.supplier_org_id;
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO supplier_orgs (id, name) VALUES (?, ?)").bind(id, row.supplier_name).run();
  return id;
}

/**
 * `POST /portal/invitations/accept` `{ token, code, password }`. Someone new
 * chooses a password (12 or more); someone who already has a portal login
 * gives theirs, so an invitation cannot be used to take over a login. The
 * code is checked first, five tries; then the link is made.
 */
export async function acceptPortalInvitation(db: D1Database, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const row = await byToken(db, body.token);
  if (!row) return NOT_VALID;
  const status = statusOf(row, now);
  if (status !== "pending") {
    if (status === "expired" && row.status === "pending") await db.prepare("UPDATE portal_invitations SET status = 'expired' WHERE id = ?").bind(row.id).run();
    return { status: 410, body: { error: `this invitation is ${status}`, reason: status } };
  }
  const code = typeof body.code === "string" ? body.code : "";
  if ((await codeHash(String(body.token), code)) !== row.code_hash) {
    const attempts = row.attempts + 1;
    const spent = attempts >= MAX_CODE_ATTEMPTS;
    await db.prepare("UPDATE portal_invitations SET attempts = ?, status = ? WHERE id = ?").bind(attempts, spent ? "spent" : "pending", row.id).run();
    return spent
      ? { status: 410, body: { error: "too many wrong codes: ask for a new invitation", reason: "spent" } }
      : { status: 422, body: { error: "the code is not right", reason: "wrong_code", attemptsLeft: MAX_CODE_ATTEMPTS - attempts } };
  }
  const password = typeof body.password === "string" ? body.password : "";
  const user = await db.prepare("SELECT email, supplier_org_id, password_hash FROM portal_users WHERE email = ?").bind(row.email).first<{ email: string; supplier_org_id: string; password_hash: string }>();
  if (user) {
    if (!(await verifyPassword(password, user.password_hash))) {
      // Counted with the codes, so an invitation is no way round the sign-in's delay.
      const attempts = row.attempts + 1;
      const spent = attempts >= MAX_CODE_ATTEMPTS;
      await db.prepare("UPDATE portal_invitations SET attempts = ?, status = ? WHERE id = ?").bind(attempts, spent ? "spent" : "pending", row.id).run();
      return spent
        ? { status: 410, body: { error: "too many wrong attempts: ask for a new invitation", reason: "spent" } }
        : { status: 422, body: { error: "that is not the password for this login", reason: "wrong_password", attemptsLeft: MAX_CODE_ATTEMPTS - attempts } };
    }
  } else if (password.length < 12) {
    return { status: 422, body: { error: "the password must be at least 12 characters", reason: "short_password" } };
  }

  // Claimed first, so the same link cannot be used twice at once.
  const claimed = await db.prepare("UPDATE portal_invitations SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'pending'").bind(now.toISOString(), row.id).run();
  if ((claimed.meta.changes ?? 0) === 0) return { status: 410, body: { error: "this invitation has already been used", reason: "accepted" } };

  if (!user) {
    const orgId = await orgFor(db, row);
    await db.prepare("INSERT INTO portal_users (email, supplier_org_id, password_hash) VALUES (?, ?, ?)").bind(row.email, orgId, await hashPassword(password)).run();
  }
  // A person already linked to this supplier at this customer: the new
  // invitation's companies replace the old ones, rather than a second link.
  const linkId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("UPDATE portal_links SET status = 'ended', ended_at = ?, ended_by = ? WHERE email = ? AND environment_id = ? AND supplier_id = ? AND status = 'active'")
      .bind(now.toISOString(), `invitation:${row.id}`, row.email, row.environment_id, row.supplier_id),
    db
      .prepare(
        `INSERT INTO portal_links (id, email, environment_id, supplier_id, supplier_name, org_units_json, created_at, created_by, invitation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(linkId, row.email, row.environment_id, row.supplier_id, row.supplier_name, row.org_units_json, now.toISOString(), row.created_by, row.id),
  ]);
  return { status: 200, body: { email: row.email, linkId } };
}

/**
 * `POST /portal/login` `{ email, password }` — a supplier user signs in.
 * The same defences as the staff sign-in (0090, 0094): the progressive
 * delay first, one message for every refusal, a verification spent even
 * for an unknown email, every attempt recorded.
 */
export async function portalLogin(db: D1Database, body: Record<string, unknown>, privateKeyJwk: JsonWebKey, sourceIp: string | null = null, now = new Date()): Promise<RouteResult> {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return { status: 400, body: { error: "email and password are required" } };

  const delay = await assessDelay(db, email, PORTAL_ATTEMPT_SCOPE, now);
  if (delay.tooSoon) return { status: 429, body: { error: "too many recent attempts — wait before trying again", retryAfterSeconds: delay.delaySeconds } };

  const user = await db.prepare("SELECT supplier_org_id, password_hash FROM portal_users WHERE email = ?").bind(email).first<{ supplier_org_id: string; password_hash: string }>();
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : (await verifyPassword(password, "argon2id$2$19456$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), false);
  await recordAttempt(db, email, PORTAL_ATTEMPT_SCOPE, !!ok, sourceIp);
  if (!user || !ok) return { status: 401, body: { error: REFUSAL } };

  const claims: PortalSessionClaims = {
    kind: "portal_session",
    email,
    supplierOrgId: user.supplier_org_id,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PORTAL_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  return { status: 200, body: { token: await signPortalToken(claims, privateKeyJwk), expiresAt: claims.expiresAt } };
}

// ---------------------------------------------------------------------------
// Signed in (a portal session token): the links, and access to each.
// ---------------------------------------------------------------------------

/** The session in a request's bearer, or why not. */
export async function portalSessionOf(token: string | null, privateKeyJwk: JsonWebKey, now = new Date()) {
  if (!token) return null;
  const verified = await verifyPortalSession(token, publicKeyOf(privateKeyJwk), now);
  return verified.ok ? verified.claims : null;
}

async function activeLinks(db: D1Database, email: string) {
  return (
    await db
      .prepare(
        `SELECT l.*, e.instance_url, c.name AS customer_name
         FROM portal_links l JOIN environments e ON e.id = l.environment_id JOIN customers c ON c.id = e.customer_id
         WHERE l.email = ? AND l.status = 'active'
         ORDER BY c.name, l.supplier_name`
      )
      .bind(email)
      .all<LinkRow & { instance_url: string; customer_name: string }>()
  ).results;
}

/** `GET /portal/links` — the customers this person may see, and for which companies. */
export async function myPortalLinks(db: D1Database, session: PortalSessionClaims): Promise<RouteResult> {
  const links = await activeLinks(db, session.email);
  return {
    status: 200,
    body: {
      email: session.email,
      links: links.map((l) => ({
        id: l.id,
        customerName: l.customer_name,
        environmentId: l.environment_id,
        instanceUrl: l.instance_url,
        supplierName: l.supplier_name,
        orgUnits: JSON.parse(l.org_units_json) as OrgUnit[],
      })),
    },
  };
}

/**
 * `POST /portal/access` — a token for each active link: for that instance,
 * that supplier record and those companies, for five minutes. Read from the
 * link as it is now, so ending a link or changing its companies takes
 * effect at the portal's next request.
 */
export async function issuePortalAccess(db: D1Database, session: PortalSessionClaims, privateKeyJwk: JsonWebKey, now = new Date()): Promise<RouteResult> {
  const links = await activeLinks(db, session.email);
  const expiresAt = new Date(now.getTime() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString();
  const access = [];
  for (const l of links) {
    const orgUnitIds = (JSON.parse(l.org_units_json) as OrgUnit[]).map((u) => u.id);
    access.push({
      linkId: l.id,
      environmentId: l.environment_id,
      instanceUrl: l.instance_url,
      expiresAt,
      token: await signPortalToken(
        {
          kind: "portal_access",
          email: session.email,
          supplierOrgId: session.supplierOrgId,
          linkId: l.id,
          environmentId: l.environment_id,
          supplierId: l.supplier_id,
          orgUnitIds,
          issuedAt: now.toISOString(),
          expiresAt,
        },
        privateKeyJwk
      ),
    });
  }
  return { status: 200, body: { access } };
}

/** `POST /portal/links/:id/end` — the supplier's person ends their own link. */
export function endMyLink(db: D1Database, session: PortalSessionClaims, linkId: string, now = new Date()): Promise<RouteResult> {
  return endLink(db, { linkId, email: session.email }, `portal:${session.email}`, now);
}

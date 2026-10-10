import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { hashApiKey } from "../src/auth.js";
import type { InvitationMailer } from "../src/invitations.js";
import {
  acceptPortalInvitation,
  invitePortalUser,
  issuePortalAccess,
  listPortalPeople,
  myPortalLinks,
  portalInvitationEmail,
  portalLogin,
  portalSessionOf,
  publicKeyOf,
  viewPortalInvitation,
} from "../src/portal.js";
import { verifyPortalAccess, verifySessionToken, type PortalSessionClaims } from "@vibefinance/shared";

/**
 * **The supplier portal's directory — decision 0713.** A customer's
 * instance invites a supplier's person for one supplier record and some
 * companies; they accept with a code and a password; signed in, they get a
 * short-lived token per link that only that instance accepts.
 */

const db = () => env.CONTROL_DB;
let key: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  key = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
});

type Sent = { to: string[]; subject: string; text: string };
function mailer(): InvitationMailer & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    apiKey: "re_test",
    from: "VibeFinance <noreply@vibefinance-ai.com>",
    linkBase: "https://portal.vibefinance-ai.com/welcome.html",
    fetcher: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Sent);
      return new Response(JSON.stringify({ id: "m" }), { status: 200 });
    }) as unknown as typeof fetch,
  };
}
const fromEmail = (s: Sent) => ({ token: s.text.match(/#t=([A-Za-z0-9_-]+)/)![1], code: s.text.match(/Your code: (\d{3}) (\d{3})/)!.slice(1).join("") });

const UK = { id: "acme-uk", name: "Acme UK Ltd" };
const IE = { id: "acme-ie", name: "Acme Ireland Ltd" };
const invite = (m: InvitationMailer, email: string, units = [UK], environmentId = "acme-prod", supplierId = "sup-ln") =>
  invitePortalUser(db(), m, environmentId, { email, supplierId, supplierName: "Lager Nord GmbH", orgUnits: units, invitedBy: "ap@acme.example" });

async function inviteAndAccept(email: string, password: string, units = [UK], environmentId = "acme-prod", supplierId = "sup-ln") {
  const m = mailer();
  expect((await invite(m, email, units, environmentId, supplierId)).status).toBe(201);
  const { token, code } = fromEmail(m.sent[0]);
  const accepted = await acceptPortalInvitation(db(), { token, code, password });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return accepted.body as { linkId: string };
}

async function signIn(email: string, password: string): Promise<PortalSessionClaims> {
  const r = await portalLogin(db(), { email, password }, key);
  expect(r.status).toBe(200);
  return (await portalSessionOf((r.body as { token: string }).token, key))!;
}

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc')").run();
  await db()
    .prepare(
      `INSERT INTO environments (id, customer_id, kind, region, instance_url, api_key_hash) VALUES
       ('acme-prod', 'acme', 'production', 'eu', 'https://acme.vibefinance.example', ?),
       ('globex-prod', 'globex', 'production', 'eu', 'https://globex.vibefinance.example', ?)`
    )
    .bind(await hashApiKey("env-key-acme"), await hashApiKey("env-key-globex"))
    .run();
});

describe("inviting a supplier's person", () => {
  it("emails who invites them, for which supplier and companies, with a link and a code; keeps only hashes", async () => {
    const m = mailer();
    const r = await invite(m, "Jo@Lager-Nord.example", [UK, IE]);
    expect(r.status).toBe(201);
    expect((r.body as { invitation: unknown }).invitation).toMatchObject({ email: "jo@lager-nord.example", supplierId: "sup-ln", orgUnits: [UK, IE], status: "pending", createdBy: "ap@acme.example" });
    expect(m.sent[0].subject).toBe("Acme Ltd has invited you to the VibeFinance supplier portal");
    expect(m.sent[0].text).toContain("For: Acme UK Ltd, Acme Ireland Ltd");
    const { token } = fromEmail(m.sent[0]);
    const stored = await db().prepare("SELECT token_hash FROM portal_invitations").first<{ token_hash: string }>();
    expect(stored!.token_hash).not.toBe(token);
  });

  it("refuses no companies, a company without a name, and no supplier", async () => {
    const m = mailer();
    expect((await invite(m, "jo@x.example", [])).status).toBe(400);
    expect((await invite(m, "jo@x.example", [{ id: "acme-uk", name: "" }])).status).toBe(400);
    expect((await invitePortalUser(db(), m, "acme-prod", { email: "jo@x.example", orgUnits: [UK] })).status).toBe(400);
  });

  it("writes the email plainly", () => {
    const { text } = portalInvitationEmail("Acme Ltd", "Lager Nord GmbH", ["Acme UK Ltd"], "https://p/#t=abc", "123456", "2026-10-13T12:00:00.000Z");
    expect(text).toContain("Your code: 123 456");
    expect(text).toContain("until 2026-10-13 12:00 UTC");
    expect(text).toContain("If you already use the portal, sign in with your existing password when you accept.");
  });
});

describe("accepting", () => {
  it("someone new chooses a password; a link is made for the supplier and companies; the view says who invited them", async () => {
    const m = mailer();
    await invite(m, "jo@lager-nord.example", [UK]);
    const { token, code } = fromEmail(m.sent[0]);
    expect((await viewPortalInvitation(db(), { token })).body).toMatchObject({ customerName: "Acme Ltd", supplierName: "Lager Nord GmbH", orgUnits: ["Acme UK Ltd"], status: "pending", hasLogin: false });
    expect((await acceptPortalInvitation(db(), { token, code, password: "short" })).status).toBe(422);
    expect((await acceptPortalInvitation(db(), { token, code: "000000", password: "a long passphrase" })).body).toMatchObject({ reason: "wrong_code", attemptsLeft: 4 });
    expect((await acceptPortalInvitation(db(), { token, code, password: "a long passphrase" })).status).toBe(200);
    expect((await acceptPortalInvitation(db(), { token, code, password: "a long passphrase" })).status).toBe(410);
    const people = (await listPortalPeople(db(), "acme-prod", "sup-ln")).body as { links: { email: string; orgUnits: unknown; status: string }[]; invitations: unknown[] };
    expect(people.links).toEqual([expect.objectContaining({ email: "jo@lager-nord.example", orgUnits: [UK], status: "active" })]);
    expect(people.invitations).toEqual([]);
  });

  it("someone who already has a login gives their own password, not a new one", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    const m = mailer();
    await invite(m, "jo@lager-nord.example", [UK], "globex-prod", "g-77");
    const { token, code } = fromEmail(m.sent[0]);
    expect((await viewPortalInvitation(db(), { token })).body).toMatchObject({ hasLogin: true, customerName: "Globex plc" });
    expect((await acceptPortalInvitation(db(), { token, code, password: "a brand new passphrase" })).body).toMatchObject({ reason: "wrong_password" });
    expect((await acceptPortalInvitation(db(), { token, code, password: "first passphrase" })).status).toBe(200);
    // One login, two customers.
    const session = await signIn("jo@lager-nord.example", "first passphrase");
    const links = (await myPortalLinks(db(), session)).body as { links: { customerName: string }[] };
    expect(links.links.map((l) => l.customerName)).toEqual(["Acme Ltd", "Globex plc"]);
  });

  it("a colleague invited for the same supplier joins the same supplier organisation", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    await inviteAndAccept("sam@lager-nord.example", "second passphrase", [IE]);
    const orgs = (await db().prepare("SELECT DISTINCT supplier_org_id FROM portal_users").all()).results;
    expect(orgs).toHaveLength(1);
    // Each with their own companies.
    const people = (await listPortalPeople(db(), "acme-prod", "sup-ln")).body as { links: { email: string; orgUnits: unknown }[] };
    expect(people.links.map((l) => [l.email, l.orgUnits])).toEqual([
      ["jo@lager-nord.example", [UK]],
      ["sam@lager-nord.example", [IE]],
    ]);
  });

  it("a second invitation for the same person and supplier replaces the companies, not a second link", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase", [UK]);
    await inviteAndAccept("jo@lager-nord.example", "first passphrase", [UK, IE]);
    const active = (await db().prepare("SELECT org_units_json FROM portal_links WHERE status = 'active'").all<{ org_units_json: string }>()).results;
    expect(active.map((r) => JSON.parse(r.org_units_json))).toEqual([[UK, IE]]);
  });
});

describe("signing in and access", () => {
  it("one message for a wrong password and an unknown email, and a delay after failures", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    const wrong = await portalLogin(db(), { email: "jo@lager-nord.example", password: "nope" }, key);
    const unknown = await portalLogin(db(), { email: "nobody@x.example", password: "nope" }, key);
    expect(wrong).toEqual({ status: 401, body: { error: "email or password is not correct" } });
    expect(unknown).toEqual(wrong);
    await portalLogin(db(), { email: "jo@lager-nord.example", password: "nope" }, key);
    expect((await portalLogin(db(), { email: "jo@lager-nord.example", password: "first passphrase" }, key)).status).toBe(429);
  });

  it("gives a token per link that only that instance accepts, for that supplier and those companies, never as staff", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase", [UK]);
    const session = await signIn("jo@lager-nord.example", "first passphrase");
    const { access } = (await issuePortalAccess(db(), session, key)).body as { access: { environmentId: string; instanceUrl: string; token: string }[] };
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ environmentId: "acme-prod", instanceUrl: "https://acme.vibefinance.example" });
    const pub = publicKeyOf(key);
    const verified = await verifyPortalAccess(access[0].token, pub, "acme-prod");
    expect(verified).toMatchObject({ ok: true, claims: { supplierId: "sup-ln", orgUnitIds: ["acme-uk"], email: "jo@lager-nord.example" } });
    expect((await verifyPortalAccess(access[0].token, pub, "globex-prod")).ok).toBe(false);
    expect((await verifySessionToken(access[0].token, pub, "acme-prod")).ok).toBe(false);
  });

  it("an ended link gives no more access", async () => {
    const { linkId } = await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    const session = await signIn("jo@lager-nord.example", "first passphrase");
    await db().prepare("UPDATE portal_links SET status = 'ended' WHERE id = ?").bind(linkId).run();
    expect((await issuePortalAccess(db(), session, key)).body).toEqual({ access: [] });
  });
});

describe("through the router", () => {
  const withKey = () => ({ ...(env as unknown as Env), LICENCE_SIGNING_PRIVATE_KEY: JSON.stringify(key) }) as Env;
  const call = (method: string, path: string, bearer: string | null, body?: unknown) =>
    worker.fetch(
      new Request(`https://licence.example.com${path}`, {
        method,
        headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      withKey()
    );

  it("an instance invites, lists, changes companies and ends a link for its own environment only, with its key", async () => {
    const body = { email: "jo@lager-nord.example", supplierId: "sup-ln", supplierName: "Lager Nord GmbH", orgUnits: [UK] };
    expect((await call("POST", "/environments/acme-prod/portal-invitations", "env-key-globex", body)).status).toBe(401);
    const made = await call("POST", "/environments/acme-prod/portal-invitations", "env-key-acme", body);
    // No Resend key here: made, said not sent.
    expect(made.status).toBe(502);
    const listed = (await (await call("GET", "/environments/acme-prod/portal-people?supplierId=sup-ln", "env-key-acme")).json()) as { invitations: { id: string; status: string }[] };
    expect(listed.invitations).toEqual([expect.objectContaining({ status: "pending" })]);
    expect((await call("POST", `/environments/acme-prod/portal-invitations/${listed.invitations[0].id}/cancel`, "env-key-acme", {})).status).toBe(200);

    const { linkId } = await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    // Globex's key cannot touch Acme's link.
    expect((await call("POST", `/environments/globex-prod/portal-links/${linkId}/end`, "env-key-globex", {})).status).toBe(404);
    const changed = await call("POST", `/environments/acme-prod/portal-links/${linkId}/companies`, "env-key-acme", { orgUnits: [IE] });
    expect(((await changed.json()) as { link: { orgUnits: unknown } }).link.orgUnits).toEqual([IE]);
    expect((await call("POST", `/environments/acme-prod/portal-links/${linkId}/end`, "env-key-acme", { endedBy: "ap@acme.example" })).status).toBe(200);
  });

  it("a supplier signs in, lists their customers, gets access, and ends their own link; nothing without a portal session", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    expect((await call("GET", "/portal/links", null)).status).toBe(401);
    const login = (await (await call("POST", "/portal/login", null, { email: "jo@lager-nord.example", password: "first passphrase" })).json()) as { token: string };
    const links = (await (await call("GET", "/portal/links", login.token)).json()) as { links: { id: string; customerName: string; orgUnits: unknown }[] };
    expect(links.links).toEqual([expect.objectContaining({ customerName: "Acme Ltd", orgUnits: [UK] })]);
    const access = (await (await call("POST", "/portal/access", login.token, {})).json()) as { access: unknown[] };
    expect(access.access).toHaveLength(1);
    // An access token is not a session.
    const accessToken = (access.access[0] as { token: string }).token;
    expect((await call("GET", "/portal/links", accessToken)).status).toBe(401);
    expect((await call("POST", `/portal/links/${links.links[0].id}/end`, login.token, {})).status).toBe(200);
    expect(((await (await call("GET", "/portal/links", login.token)).json()) as { links: unknown[] }).links).toEqual([]);
  });

  it("an environment with portal history cannot be deleted", async () => {
    await inviteAndAccept("jo@lager-nord.example", "first passphrase");
    const { handleDeleteEnvironment } = await import("../src/environment-route.js");
    const r = await handleDeleteEnvironment(db(), "acme-prod");
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toContain("supplier portal");
  });
});

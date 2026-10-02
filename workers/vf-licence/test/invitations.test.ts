import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker, { isPrivileged } from "../src/index.js";
import type { Env } from "../src/index.js";
import { hashApiKey } from "../src/auth.js";
import { checkCredential, hasAccess } from "../src/credentials.js";
import { acceptInvitation, cancelInvitation, invitationEmail, invite, listForEnvironment, listInvitations, resendInvitation, viewInvitation, type InvitationMailer } from "../src/invitations.js";
import { handleCreatePartner, handleListPartners, handlePartnerPerson } from "../src/partners-route.js";

/**
 * **Inviting a person — decision 0593.** An email with a link and a
 * 6-digit code; the code and a password set the credential and grant the
 * access; once, briefly, five tries.
 */

const db = () => env.CONTROL_DB;
const OP = "dan@vibefinance.example";

type Sent = { to: string[]; from: string; subject: string; text: string };
function mailer(now?: Date): InvitationMailer & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    apiKey: "re_test",
    from: "VibeFinance <noreply@vibefinance-ai.com>",
    linkBase: "https://app.vibefinance-ai.com/welcome.html",
    fetcher: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Sent);
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch,
    ...(now ? { now: () => now } : {}),
  };
}
/** The token and code, as the person reads them from the email. */
const fromEmail = (s: Sent) => ({ token: s.text.match(/#t=([A-Za-z0-9_-]+)/)![1], code: s.text.match(/Your code: (\d{3}) (\d{3})/)!.slice(1).join("") });

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd')").run();
  await db()
    .prepare("INSERT INTO environments (id, customer_id, kind, region, instance_url, api_key_hash) VALUES ('acme-prod', 'acme', 'production', 'eu', 'https://acme.vibefinance.example', ?), ('acme-sbx', 'acme', 'sandbox', 'eu', 'https://acme-sbx.vibefinance.example', NULL)")
    .bind(await hashApiKey("env-key-acme-prod"))
    .run();
});

describe("inviting a person — decision 0593", () => {
  it("emails a link and a 6-digit code, keeps only their hashes, and the code and a password set the credential and access", async () => {
    const m = mailer();
    const made = await invite(db(), m, { email: " Ana@Acme.example ", customerId: "acme", environmentIds: null, createdBy: OP, createdVia: "operator" });
    expect(made).toMatchObject({ status: 201, body: { invitation: { email: "ana@acme.example", status: "pending", environmentIds: ["acme-prod", "acme-sbx"], createdBy: OP, sentAt: expect.any(String), sendError: null } } });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ to: ["ana@acme.example"], from: "VibeFinance <noreply@vibefinance-ai.com>", subject: "Your VibeFinance account for Acme Ltd" });
    expect(m.sent[0].text).toContain("https://app.vibefinance-ai.com/welcome.html#t=");
    const { token, code } = fromEmail(m.sent[0]);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(code).toMatch(/^\d{6}$/);
    const stored = JSON.stringify(await db().prepare("SELECT * FROM invitations").first());
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(code);

    expect(await viewInvitation(db(), { token })).toEqual({ status: 200, body: { email: "ana@acme.example", customerName: "Acme Ltd", status: "pending", expiresAt: expect.any(String) } });
    expect(await acceptInvitation(db(), { token, code, password: "short" })).toMatchObject({ status: 422, body: { reason: "short_password" } });
    const accepted = await acceptInvitation(db(), { token, code: `${code.slice(0, 3)} ${code.slice(3)}`, password: "a long enough passphrase" });
    expect(accepted).toEqual({
      status: 200,
      body: {
        email: "ana@acme.example",
        environments: [
          { id: "acme-prod", instanceUrl: "https://acme.vibefinance.example" },
          { id: "acme-sbx", instanceUrl: "https://acme-sbx.vibefinance.example" },
        ],
      },
    });
    expect((await checkCredential(db(), "ana@acme.example", "acme", "a long enough passphrase")).ok).toBe(true);
    expect(await hasAccess(db(), "ana@acme.example", "acme-prod")).toBe(true);
    // Once.
    expect(await acceptInvitation(db(), { token, code, password: "another long passphrase" })).toMatchObject({ status: 410, body: { reason: "accepted" } });
    expect(await viewInvitation(db(), { token })).toMatchObject({ body: { status: "accepted" } });
  });

  it("is spent after five wrong codes, and refuses a token it does not know", async () => {
    const m = mailer();
    await invite(db(), m, { email: "ben@acme.example", customerId: "acme", environmentIds: ["acme-prod"], createdBy: OP, createdVia: "operator" });
    const { token, code } = fromEmail(m.sent[0]);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let left = 4; left >= 1; left--) {
      expect(await acceptInvitation(db(), { token, code: wrong, password: "a long enough passphrase" })).toMatchObject({ status: 422, body: { reason: "wrong_code", attemptsLeft: left } });
    }
    expect(await acceptInvitation(db(), { token, code: wrong, password: "a long enough passphrase" })).toMatchObject({ status: 410, body: { reason: "spent" } });
    expect(await acceptInvitation(db(), { token, code, password: "a long enough passphrase" })).toMatchObject({ status: 410, body: { reason: "spent" } });
    expect((await checkCredential(db(), "ben@acme.example", "acme", "a long enough passphrase")).ok).toBe(false);
    expect(await viewInvitation(db(), { token: "x".repeat(43) })).toMatchObject({ status: 404, body: { reason: "not_valid" } });
  });

  it("expires after 72 hours; a new invitation cancels the one before; resend and cancel", async () => {
    const then = new Date("2026-10-02T09:00:00Z");
    const m = mailer(then);
    await invite(db(), m, { email: "cara@acme.example", customerId: "acme", environmentIds: null, createdBy: OP, createdVia: "operator" });
    const first = fromEmail(m.sent[0]);
    const late = new Date(then.getTime() + 72 * 3600_000 + 1000);
    expect(await acceptInvitation(db(), { ...first, password: "a long enough passphrase" }, late)).toMatchObject({ status: 410, body: { reason: "expired" } });
    const [row] = ((await listInvitations(db(), "acme")).body as { invitations: Array<{ id: string; status: string }> }).invitations;
    expect(row.status).toBe("expired");

    const again = await resendInvitation(db(), m, row.id, OP);
    expect(again.status).toBe(201);
    const second = fromEmail(m.sent[1]);
    expect(second.token).not.toBe(first.token);
    // A third, made directly, cancels the second.
    await invite(db(), m, { email: "cara@acme.example", customerId: "acme", environmentIds: null, createdBy: OP, createdVia: "operator" });
    expect(await acceptInvitation(db(), { ...second, password: "a long enough passphrase" })).toMatchObject({ status: 410, body: { reason: "cancelled" } });
    const third = ((await listInvitations(db(), "acme", then)).body as { invitations: Array<{ id: string; status: string }> }).invitations.find((i) => i.status === "pending")!;
    expect(await cancelInvitation(db(), third.id)).toEqual({ status: 200, body: { id: third.id, status: "cancelled" } });
    expect(await cancelInvitation(db(), third.id)).toMatchObject({ status: 409 });
  });

  it("refuses what it cannot send to, and says when the email could not be sent", async () => {
    const m = mailer();
    expect(await invite(db(), m, { email: "nope", customerId: "acme", environmentIds: null, createdBy: OP, createdVia: "operator" })).toMatchObject({ status: 400, body: { reason: "bad_email" } });
    expect(await invite(db(), m, { email: "a@b.example", customerId: "nobody", environmentIds: null, createdBy: OP, createdVia: "operator" })).toMatchObject({ status: 404 });
    await db().prepare("INSERT INTO customers (id, name) VALUES ('empty', 'Empty Co')").run();
    expect(await invite(db(), m, { email: "a@b.example", customerId: "empty", environmentIds: null, createdBy: OP, createdVia: "operator" })).toMatchObject({ status: 409, body: { reason: "no_environment" } });
    expect(await invite(db(), m, { email: "a@b.example", customerId: "acme", environmentIds: ["other-env"], createdBy: OP, createdVia: "operator" })).toMatchObject({ status: 422, body: { reason: "not_customers_environment" } });
    const unconfigured = await invite(db(), { linkBase: "x" }, { email: "dee@acme.example", customerId: "acme", environmentIds: null, createdBy: OP, createdVia: "operator" });
    expect(unconfigured).toMatchObject({ status: 502, body: { reason: "not_sent", invitation: { status: "pending", sentAt: null, sendError: expect.stringContaining("RESEND_API_KEY") } } });
    expect(m.sent).toHaveLength(0);
  });

  it("writes the email in plain words", () => {
    const { subject, text } = invitationEmail("Acme Ltd", "https://app.example/welcome.html#t=abc", "123456", "2026-10-05T09:00:00.000Z");
    expect(subject).toBe("Your VibeFinance account for Acme Ltd");
    expect(text).toContain("Your code: 123 456");
    expect(text).toContain("until 2026-10-05 09:00 UTC");
  });

  it("shows a partner's people their sandbox invitation", async () => {
    await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
    await db().prepare("INSERT INTO environments (id, customer_id, kind, region, instance_url) VALUES ('nw-sbx', 'partner-northwind', 'sandbox', 'eu', 'https://nw.example')").run();
    await handlePartnerPerson(db(), OP, "northwind", "POST", { email: "ana@northwind.example" });
    await invite(db(), mailer(), { email: "ana@northwind.example", customerId: "partner-northwind", environmentIds: null, createdBy: OP, createdVia: "operator" });
    const [p] = ((await handleListPartners(db())).body as { partners: Array<{ people: Array<Record<string, unknown>> }> }).partners;
    expect(p.people[0]).toMatchObject({ email: "ana@northwind.example", invitation: { status: "pending", sendError: null } });
  });
});

describe("through the router", () => {
  it("lets an instance invite for its own environment only, with its key, and list its people's invitations", async () => {
    const call = (path: string, key: string, body?: unknown) =>
      SELF.fetch(`https://licence.example.com${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    expect((await call("/environments/acme-prod/invitations", "wrong", { email: "x@acme.example" })).status).toBe(401);
    // Its key opens its own environment only; the sandbox has no key.
    expect((await call("/environments/acme-sbx/invitations", "env-key-acme-prod", { email: "x@acme.example" })).status).toBe(401);
    const made = await call("/environments/acme-prod/invitations", "env-key-acme-prod", { email: "eve@acme.example", invitedBy: "admin@acme.example" });
    // No Resend key in tests: made, said not sent.
    expect(made.status).toBe(502);
    expect(await made.json()).toMatchObject({ reason: "not_sent", invitation: { email: "eve@acme.example", environmentIds: ["acme-prod"], createdVia: "environment:acme-prod", createdBy: "admin@acme.example" } });
    const listed = (await (await call("/environments/acme-prod/invitations", "env-key-acme-prod")).json()) as { invitations: unknown[] };
    expect(listed.invitations).toEqual([{ email: "eve@acme.example", status: "pending", expiresAt: expect.any(String), sentAt: null, sendError: expect.any(String), acceptedAt: null }]);
    expect((await listForEnvironment(db(), "acme-sbx")).body).toEqual({ invitations: [] });
  });

  it("keeps making, listing, resending and cancelling the operator's; viewing and accepting are public", async () => {
    expect(isPrivileged("POST", "/invitations")).toBe(true);
    expect(isPrivileged("GET", "/invitations")).toBe(true);
    expect(isPrivileged("POST", "/invitations/abc/resend")).toBe(true);
    expect(isPrivileged("POST", "/invitations/abc/cancel")).toBe(true);
    expect(isPrivileged("POST", "/invitations/view")).toBe(false);
    expect(isPrivileged("POST", "/invitations/accept")).toBe(false);
    expect((await SELF.fetch("https://licence.example.com/invitations", { method: "POST", headers: { Authorization: "Bearer x" }, body: "{}" })).status).toBe(401);
    const viewed = await SELF.fetch("https://licence.example.com/invitations/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "y".repeat(43) }) });
    expect(viewed.status).toBe(404);

    const key = "k".repeat(48);
    const made = await worker.fetch(
      new Request("https://licence.example.com/invitations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cf-Access-Authenticated-User-Email": OP },
        body: JSON.stringify({ email: "fay@acme.example", customerId: "acme" }),
      }),
      { ...env, ADMIN_API_KEY: key } as unknown as Env
    );
    expect(made.status).toBe(502);
    expect(await made.json()).toMatchObject({ invitation: { createdBy: OP, createdVia: "operator", environmentIds: ["acme-prod", "acme-sbx"] } });
  });
});

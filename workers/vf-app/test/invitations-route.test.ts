import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInviteUser, handleListUserInvitations, type LicenceLink } from "../src/invitations-route.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Inviting a person from the Access screen — decision 0593.** The
 * instance asks the control plane, with its own environment key, to
 * email the person a link and code.
 */

type Call = { url: string; method: string; auth: string | null; body: unknown };
function licence(reply: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const service = {
    fetch: async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", auth: new Headers(init.headers).get("Authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    },
  } as unknown as Fetcher;
  return { calls, link: { service, environmentId: "acme-prod", apiKey: "env-key" } as LicenceLink };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-ana', 'ana@acme.example', 'Ana')").run();
});

describe("inviting a person — decision 0593", () => {
  it("asks the control plane, with this environment's key, to invite the person by their email here", async () => {
    const { calls, link } = licence({
      status: 201,
      body: { invitation: { id: "secret-id", email: "ana@acme.example", status: "pending", expiresAt: "2026-10-05T09:00:00Z", sentAt: "2026-10-02T09:00:00Z", sendError: null, createdBy: "x" } },
    });
    const r = await handleInviteUser(env.DB, link, "u-ana", "dan@acme.example");
    expect(calls).toEqual([{ url: "https://vf-licence.internal/environments/acme-prod/invitations", method: "POST", auth: "Bearer env-key", body: { email: "ana@acme.example", invitedBy: "dan@acme.example" } }]);
    // Only what the screen needs.
    expect(r).toEqual({ status: 201, body: { invitation: { email: "ana@acme.example", status: "pending", expiresAt: "2026-10-05T09:00:00Z", sentAt: "2026-10-02T09:00:00Z", sendError: null } } });
    expect(await handleInviteUser(env.DB, link, "nobody", null)).toMatchObject({ status: 404 });
  });

  it("passes on what the control plane refused, and that it could not be reached", async () => {
    const { link } = licence({ status: 502, body: { reason: "not_sent", error: "invitation email is not configured", invitation: { email: "ana@acme.example", status: "pending", sendError: "invitation email is not configured" } } });
    expect(await handleInviteUser(env.DB, link, "u-ana", null)).toMatchObject({ status: 502, body: { reason: "not_sent", invitation: { sendError: "invitation email is not configured" } } });
    const down = { service: { fetch: async () => { throw new Error("boom"); } } as unknown as Fetcher, environmentId: "e", apiKey: "k" };
    expect(await handleInviteUser(env.DB, down, "u-ana", null)).toMatchObject({ status: 502, body: { reason: "unreachable" } });
    const { calls, link: listing } = licence({ status: 200, body: { invitations: [{ email: "ana@acme.example", status: "accepted" }] } });
    expect(await handleListUserInvitations(listing)).toEqual({ status: 200, body: { invitations: [{ email: "ana@acme.example", status: "accepted" }] } });
    expect(calls[0].method).toBe("GET");
  });
});

describe("through the router", () => {
  async function person(id: string, permissions: string[]): Promise<string> {
    const key = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'P', ?)").bind(id, `${id}@acme.example`, await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Role', ?)").bind(id, JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();
    return key;
  }
  it("is Admin.UserManagement's, and goes to the control plane with this environment's key", async () => {
    const admin = await person("u-admin", ["Admin.UserManagement"]);
    const other = await person("u-other", ["AP.Validate"]);
    const { calls, link } = licence({ status: 201, body: { invitation: { email: "ana@acme.example", status: "pending" } } });
    const e = { ...env, LICENCE_SERVICE: link.service, ENVIRONMENT_ID: "acme-prod", VF_LICENCE_API_KEY: "env-key" } as unknown as Env;
    const call = (path: string, key: string, method = "POST") => worker.fetch(new Request(`https://vf.example${path}`, { method, headers: { Authorization: `Bearer ${key}` } }), e);
    expect((await call("/org/users/u-ana/invite", other)).status).toBe(403);
    expect((await call("/org/users/u-ana/invite", admin)).status).toBe(201);
    expect(calls[0].body).toEqual({ email: "ana@acme.example", invitedBy: "u-admin@acme.example" });
    expect((await call("/org/users/invitations", admin, "GET")).status).toBe(201);
    expect((await call("/org/users/invitations", other, "GET")).status).toBe(403);
    // Not configured: said, not attempted.
    const bare = await worker.fetch(new Request("https://vf.example/org/users/u-ana/invite", { method: "POST", headers: { Authorization: `Bearer ${admin}` } }), { ...env } as unknown as Env);
    expect(bare.status).toBe(503);
  });
});

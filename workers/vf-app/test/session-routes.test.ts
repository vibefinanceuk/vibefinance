import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signSessionToken, SESSION_TTL_SECONDS, type SessionClaims } from "@vibefinance/shared";

/**
 * Which routes accept a session — decision 0105.
 *
 * **The gap this closes.** `authenticateUserOrSession` was tested
 * directly and worked. What nothing tested was *which routes call it* —
 * and claiming a task used `requirePermission`, which understands only
 * API keys. A person clicking Claim in the Task Manager got a 401 while
 * the same call worked from `curl`, and 927 tests passed throughout.
 *
 * Reaching this needed a signing key the tests control, which is why
 * `wrangler.test.jsonc` now carries one.
 */
const PRIVATE_KEY: JsonWebKey = {
  "key_ops": [
    "sign"
  ],
  "ext": true,
  "kty": "EC",
  "x": "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  "y": "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  "crv": "P-256",
  "d": "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk"
};

const THIS_ENVIRONMENT = "test-environment";

async function sessionFor(email: string): Promise<string> {
  const now = new Date();
  const claims: SessionClaims = {
    email,
    name: email,
    environmentId: THIS_ENVIRONMENT,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  return signSessionToken(claims, PRIVATE_KEY);
}

async function seed() {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('alice','alice@acme.com','Alice')").run();
  await env.DB.prepare(
    "INSERT INTO org_roles (id, name, permissions_json) VALUES ('r','AP','[\"AP.Validate\"]')"
  ).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice','r')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap','AP')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('ap','alice')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('p','P')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('s','p','S',1)"
  ).run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, owner_team_id, required_permission) VALUES ('t','s','ap','AP.Validate')"
  ).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seed();
});

describe("the routes a browser needs accept a session", () => {
  /**
   * Every one of these is reachable from the Task Manager, so every one
   * must take a session. A route that takes only an API key works from
   * `curl` and fails from the screen -- which is exactly how the claim
   * bug presented.
   */
  const browserRoutes: [string, string][] = [
    ["GET", "/whoami"],
    ["GET", "/tasks"],
    ["POST", "/tasks/t/claim"],
    ["POST", "/tasks/t/release"],
  ];

  for (const [method, path] of browserRoutes) {
    it(`accepts a session on ${method} ${path}`, async () => {
      const token = await sessionFor("alice@acme.com");
      const res = await SELF.fetch(`https://app.example.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });

      // Not 401. What each route then DOES is its own tests' business;
      // this asserts only that the credential was understood.
      expect(res.status, `${method} ${path} rejected a valid session`).not.toBe(401);
    });
  }

  it("still refuses a session for another environment", async () => {
    // One signing key serves the whole fleet (decision 0086), so this
    // is the only thing stopping a session for one customer opening
    // another's data.
    const claims: SessionClaims = {
      email: "alice@acme.com",
      name: "Alice",
      environmentId: "somebody-elses-environment",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const token = await signSessionToken(claims, PRIVATE_KEY);

    const res = await SELF.fetch("https://app.example.com/whoami", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("still refuses no credential at all", async () => {
    const res = await SELF.fetch("https://app.example.com/tasks");
    expect(res.status).toBe(401);
  });
});

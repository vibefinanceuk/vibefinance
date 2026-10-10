import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Inviting a supplier's people to the portal — decision 0715.** From the
 * supplier's page: who is linked, invite for chosen companies, cancel,
 * change companies, end. vf-licence is faked here; its side is 0713's.
 */

type Seen = { method: string; path: string; body: Record<string, unknown> | null };
const UK = { id: "uk", name: "Acme UK Ltd" };
const IE = { id: "ie", name: "Acme Ireland Ltd" };

function fakeLicence(seen: Seen[]) {
  const people = {
    links: [
      { id: "pl-1", email: "jo@lager-nord.example", supplierId: "sup-ln", orgUnits: [UK], status: "active", createdAt: "2026-10-10", endedAt: null },
      { id: "pl-ie", email: "sam@lager-nord.example", supplierId: "sup-ln", orgUnits: [IE], status: "active", createdAt: "2026-10-10", endedAt: null },
      { id: "pl-old", email: "old@lager-nord.example", supplierId: "sup-ln", orgUnits: [UK], status: "ended", createdAt: "2026-09-01", endedAt: "2026-09-02" },
    ],
    invitations: [{ id: "inv-1", email: "kim@lager-nord.example", supplierId: "sup-ln", orgUnits: [UK], status: "pending", expiresAt: "2026-10-13", sentAt: "2026-10-10", sendError: null }],
  };
  return {
    fetch: async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.replace("/environments/test-environment", "") + u.search;
      seen.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : null });
      if (path.startsWith("/portal-people")) return new Response(JSON.stringify(people), { status: 200 });
      if (path === "/portal-invitations") return new Response(JSON.stringify({ invitation: { email: "new@lager-nord.example", status: "pending" } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  } as unknown as Fetcher;
}

let key: string;
async function person(permissions: string[], unitId: string | null = null) {
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'R', ?)").bind(JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('u-ap', 'r', ?)").bind(unitId).run();
}

async function licence(features: string[]) {
  const claims = { customerId: "c", plan: "standard", features, volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
}

function call(seen: Seen[], method: string, path: string, body?: unknown) {
  return worker.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { ...(env as unknown as Env), LICENCE_SERVICE: fakeLicence(seen), VF_LICENCE_API_KEY: "env-key" } as Env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
  );
}

beforeEach(async () => {
  await applyTestSchema();
  await licence(["supplier_portal"]);
  key = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES ('u-ap', 'ap@acme.example', 'AP', ?)").bind(await hashApiKey(key)).run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-ln', 'Lager Nord GmbH')").run();
});

describe("seeing a supplier's portal people", () => {
  it("lists the active links and open invitations, and the companies this person may invite for", async () => {
    await person(["Supplier.Maintain"]);
    const seen: Seen[] = [];
    const res = await call(seen, "GET", "/suppliers/sup-ln/portal");
    const body = (await res.json()) as { licensed: boolean; canManage: boolean; companies: unknown[]; links: { id: string }[]; invitations: unknown[] };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ licensed: true, canManage: true, companies: [IE, UK] });
    expect(body.links.map((l) => l.id)).toEqual(["pl-1", "pl-ie"]);
    expect(body.invitations).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/portal-people?supplierId=sup-ln" });
  });

  it("says only that it is not licensed, and asks the control plane nothing", async () => {
    await person(["AP.Supplier"]);
    await licence([]);
    const seen: Seen[] = [];
    expect(await (await call(seen, "GET", "/suppliers/sup-ln/portal")).json()).toEqual({ licensed: false });
    expect(seen).toEqual([]);
  });

  it("someone who may only view sees the people but no companies to invite for", async () => {
    await person(["AP.Supplier"]);
    const body = (await (await call([], "GET", "/suppliers/sup-ln/portal")).json()) as { canManage: boolean; companies: unknown[] };
    expect(body).toMatchObject({ canManage: false, companies: [] });
  });

  it("refuses someone with neither permission, and a supplier that does not exist", async () => {
    await person(["AP.Validate"]);
    expect((await call([], "GET", "/suppliers/sup-ln/portal")).status).toBe(403);
    await env.DB.prepare("UPDATE org_roles SET permissions_json = '[\"AP.Supplier\"]'").run();
    expect((await call([], "GET", "/suppliers/nope/portal")).status).toBe(404);
  });
});

describe("inviting and changing", () => {
  it("invites for chosen companies, sending the supplier's name and the companies' names, and who invited", async () => {
    await person(["Supplier.Maintain"]);
    const seen: Seen[] = [];
    const res = await call(seen, "POST", "/suppliers/sup-ln/portal/invitations", { email: "new@lager-nord.example", orgUnitIds: ["uk", "ie"] });
    expect(res.status).toBe(201);
    expect(seen.at(-1)).toEqual({
      method: "POST",
      path: "/portal-invitations",
      body: { email: "new@lager-nord.example", supplierId: "sup-ln", supplierName: "Lager Nord GmbH", orgUnits: [UK, IE], invitedBy: "ap@acme.example" },
    });
  });

  it("only for companies this person holds Supplier.Maintain in, and never none", async () => {
    await person(["Supplier.Maintain"], "uk");
    const seen: Seen[] = [];
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/invitations", { email: "x@y.example", orgUnitIds: ["ie"] })).status).toBe(400);
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/invitations", { email: "x@y.example", orgUnitIds: [] })).status).toBe(400);
    expect(seen).toEqual([]);
    // Nor take a company away that they could not have given.
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/links/pl-ie/companies", { orgUnitIds: ["uk"] })).status).toBe(403);
  });

  it("viewing alone may not invite", async () => {
    await person(["AP.Supplier"]);
    expect((await call([], "POST", "/suppliers/sup-ln/portal/invitations", { email: "x@y.example", orgUnitIds: ["uk"] })).status).toBe(403);
  });

  it("cancels, changes companies and ends, but only what is this supplier's", async () => {
    await person(["Supplier.Maintain"]);
    const seen: Seen[] = [];
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/invitations/inv-1/cancel", {})).status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ method: "POST", path: "/portal-invitations/inv-1/cancel" });
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/links/pl-1/companies", { orgUnitIds: ["uk", "ie"] })).status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ path: "/portal-links/pl-1/companies", body: { orgUnits: [UK, IE] } });
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/links/pl-1/end", {})).status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ path: "/portal-links/pl-1/end", body: { endedBy: "ap@acme.example" } });
    // Not one of this supplier's.
    expect((await call(seen, "POST", "/suppliers/sup-ln/portal/links/pl-someone-elses/end", {})).status).toBe(404);
  });
});

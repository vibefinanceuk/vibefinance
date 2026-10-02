import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleFleetOverview, handlePeople } from "../src/operator-views.js";
import { handleCreatePartner, handlePartnerPerson } from "../src/partners-route.js";
import { grantAccess, setCredential } from "../src/credentials.js";
import worker, { isPrivileged, type Env } from "../src/index.js";

/**
 * **The operator console's screens — decision 0603.** The fleet by
 * customer, and the people who can sign in, never a key or a hash.
 */

const db = () => env.CONTROL_DB;

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc')").run();
  await db()
    .prepare(
      `INSERT INTO environments (id, customer_id, kind, region, instance_url, worker_name, api_key_hash) VALUES
       ('acme-prod', 'acme', 'production', 'eu', 'https://acme.example', 'vf-app-acme', 'secret-hash'),
       ('acme-sbx', 'acme', 'sandbox', 'eu', 'https://not-yet-deployed.invalid', NULL, NULL)`
    )
    .run();
  await db()
    .prepare("INSERT INTO licences (environment_id, plan, features_json, volume_entitlement, valid_from, valid_to, status) VALUES ('acme-prod', 'growth', '[\"ap\"]', 5000, '2026-01-01', '2026-12-31', 'active')")
    .run();
  await setCredential(db(), "Ana@Acme.example", "acme", "a-long-password-1");
  await setCredential(db(), "bo@acme.example", "acme", "a-long-password-2");
  await grantAccess(db(), "ana@acme.example", "acme-prod", "dan@vibefinance.example");
  await handleCreatePartner(db(), "dan@vibefinance.example", { id: "northwind", name: "Northwind" });
  await handlePartnerPerson(db(), "dan@vibefinance.example", "northwind", "POST", { email: "bo@acme.example" });
});

describe("the operator console's screens — decision 0603", () => {
  it("shows each customer with its environments, whether deployed, its licence and its people, never a key", async () => {
    const body = (await handleFleetOverview(db())).body as { customers: Array<Record<string, unknown>> };
    expect(body.customers.map((c) => c.id)).toEqual(["acme", "globex", "partner-northwind"]);
    expect(body.customers[0]).toEqual({
      id: "acme",
      name: "Acme Ltd",
      createdAt: expect.any(String),
      sandboxOf: null,
      people: 2,
      environments: [
        expect.objectContaining({
          id: "acme-prod",
          kind: "production",
          deployed: true,
          workerName: "vf-app-acme",
          people: 1,
          licence: { plan: "growth", status: "active", statusReason: null, volumeEntitlement: 5000, validFrom: "2026-01-01", validTo: "2026-12-31", features: ["ap"] },
        }),
        expect.objectContaining({ id: "acme-sbx", kind: "sandbox", deployed: false, people: 0, licence: null }),
      ],
    });
    expect(body.customers[2]).toMatchObject({ sandboxOf: { id: "northwind", name: "Northwind" }, environments: [] });
    expect(JSON.stringify(body)).not.toContain("secret-hash");
  });

  it("lists the people who can sign in, with the environments they may reach and the partner they work for, never a hash", async () => {
    const body = (await handlePeople(db(), null)).body as { people: Array<Record<string, unknown>>; environments: unknown[] };
    expect(body.people).toEqual([
      expect.objectContaining({ email: "ana@acme.example", customerId: "acme", customerName: "Acme Ltd", environments: [expect.objectContaining({ id: "acme-prod", kind: "production", grantedBy: "dan@vibefinance.example" })], partnerOf: [] }),
      expect.objectContaining({ email: "bo@acme.example", environments: [], partnerOf: ["Northwind"] }),
    ]);
    expect(body.environments).toEqual([
      { id: "acme-prod", customerId: "acme", kind: "production" },
      { id: "acme-sbx", customerId: "acme", kind: "sandbox" },
    ]);
    expect(JSON.stringify(body)).not.toContain("argon2");
    expect(((await handlePeople(db(), "globex")).body as { people: unknown[] }).people).toEqual([]);
  });

  it("is the operator's only, and recorded", async () => {
    expect(isPrivileged("GET", "/fleet-overview")).toBe(true);
    expect(isPrivileged("GET", "/people")).toBe(true);
    const key = "k".repeat(48);
    for (const path of ["/fleet-overview", "/people"]) {
      expect((await SELF.fetch(`https://licence.example.com${path}`, { headers: { Authorization: "Bearer x" } })).status).toBe(401);
      const r = await worker.fetch(
        new Request(`https://licence.example.com${path}`, { headers: { Authorization: `Bearer ${key}`, "Cf-Access-Authenticated-User-Email": "dan@vibefinance.example" } }),
        { ...env, ADMIN_API_KEY: key } as unknown as Env
      );
      expect(r.status).toBe(200);
    }
  });
});

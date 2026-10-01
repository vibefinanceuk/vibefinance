import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker, { isPrivileged } from "../src/index.js";
import type { Env } from "../src/index.js";
import {
  handleCreatePartner,
  handleListCustomers,
  handleListPartners,
  handlePartnerCustomer,
  handlePartnerPerson,
  handleSuspendPartner,
} from "../src/partners-route.js";

/**
 * **Partners — decision 0592**, step 1 of slice 4: a system integrator as
 * its own record, its people, the customers VibeFinance links it to, and
 * its sandbox as an ordinary customer.
 */

const db = () => env.CONTROL_DB;
const OP = "dan@vibefinance.example";

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc')").run();
});

describe("partners — decision 0592", () => {
  it("makes a partner with its sandbox as a customer record, and refuses a bad id, a duplicate, or a name taken", async () => {
    expect(await handleCreatePartner(db(), OP, { id: "Northwind-SI", name: " Northwind   Integration " })).toEqual({
      status: 201,
      body: { id: "northwind-si", name: "Northwind Integration", status: "active", sandboxCustomerId: "partner-northwind-si" },
    });
    expect(await db().prepare("SELECT name FROM customers WHERE id = 'partner-northwind-si'").first()).toEqual({ name: "Northwind Integration (partner sandbox)" });
    expect(await db().prepare("SELECT created_by FROM partners WHERE id = 'northwind-si'").first()).toEqual({ created_by: OP });
    expect(await handleCreatePartner(db(), OP, { id: "x", name: "X" })).toMatchObject({ status: 400, body: { reason: "bad_id" } });
    expect(await handleCreatePartner(db(), OP, { id: "ok-id", name: "" })).toMatchObject({ status: 400, body: { reason: "bad_name" } });
    expect(await handleCreatePartner(db(), OP, { id: "northwind-si", name: "Other" })).toMatchObject({ status: 409, body: { reason: "exists" } });
    expect(await handleCreatePartner(db(), OP, { id: "nw2", name: "northwind integration" })).toMatchObject({ status: 409, body: { reason: "name_taken" } });
  });

  it("names its people, and says which of them can sign in to the sandbox yet", async () => {
    await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
    expect(await handlePartnerPerson(db(), OP, "northwind", "POST", { email: "Ana@Northwind.example" })).toMatchObject({ status: 201, body: { email: "ana@northwind.example" } });
    expect(await handlePartnerPerson(db(), OP, "northwind", "POST", { email: "ana@northwind.example" })).toMatchObject({ status: 409, body: { reason: "exists" } });
    expect(await handlePartnerPerson(db(), OP, "northwind", "POST", { email: "not-an-email" })).toMatchObject({ status: 400, body: { reason: "bad_email" } });
    await handlePartnerPerson(db(), OP, "northwind", "POST", { email: "ben@northwind.example" });
    // Ana has a sandbox password and access to its environment; Ben has neither yet.
    await db()
      .prepare("INSERT INTO environments (id, customer_id, kind, region, instance_url) VALUES ('nw-sbx', 'partner-northwind', 'sandbox', 'eu', 'https://northwind.vibefinance.example')")
      .run();
    await db().prepare("INSERT INTO user_credentials (email, customer_id, password_hash, updated_at) VALUES ('ana@northwind.example', 'partner-northwind', 'h', '2026-10-01')").run();
    await db().prepare("INSERT INTO user_environment_access (email, environment_id, customer_id) VALUES ('ana@northwind.example', 'nw-sbx', 'partner-northwind')").run();
    const [p] = ((await handleListPartners(db())).body as { partners: Array<Record<string, unknown>> }).partners;
    expect(p).toMatchObject({
      id: "northwind",
      status: "active",
      suspended: null,
      sandbox: { customerId: "partner-northwind", environments: [{ id: "nw-sbx", kind: "sandbox", instanceUrl: "https://northwind.vibefinance.example" }] },
      people: [
        { email: "ana@northwind.example", canSignIn: true, hasCredential: true, environments: 1 },
        { email: "ben@northwind.example", canSignIn: false, hasCredential: false, environments: 0 },
      ],
      customers: [],
    });
    expect(await handlePartnerPerson(db(), OP, "northwind", "DELETE", { email: "ben@northwind.example" })).toMatchObject({ status: 200, body: { removed: true } });
    expect(await handlePartnerPerson(db(), OP, "nobody", "POST", { email: "a@b.example" })).toMatchObject({ status: 404 });
  });

  it("links the customers it serves, never its own sandbox or one that does not exist, and unlinks", async () => {
    await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
    expect(await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "acme" })).toMatchObject({ status: 201 });
    expect(await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "acme" })).toMatchObject({ status: 409, body: { reason: "exists" } });
    expect(await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "partner-northwind" })).toMatchObject({ status: 422, body: { reason: "sandbox" } });
    expect(await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "nope" })).toMatchObject({ status: 404, body: { reason: "no_customer" } });
    await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "globex" });
    const [p] = ((await handleListPartners(db())).body as { partners: Array<{ customers: unknown[] }> }).partners;
    expect(p.customers).toEqual([
      { id: "acme", name: "Acme Ltd", linkedAt: expect.any(String), linkedBy: OP },
      { id: "globex", name: "Globex plc", linkedAt: expect.any(String), linkedBy: OP },
    ]);
    expect(await handlePartnerCustomer(db(), OP, "northwind", "DELETE", { customerId: "globex" })).toEqual({ status: 200, body: { unlinked: true } });
    // The customer list marks a partner's sandbox, so it is not offered for linking.
    const customers = ((await handleListCustomers(db())).body as { customers: Array<{ id: string; sandboxOf: string | null }> }).customers;
    expect(customers.map((c) => [c.id, c.sandboxOf])).toEqual([
      ["acme", null],
      ["globex", null],
      ["partner-northwind", "northwind"],
    ]);
  });

  it("suspends with a reason and reinstates", async () => {
    await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
    expect(await handleSuspendPartner(db(), OP, "northwind", true, {})).toMatchObject({ status: 400, body: { reason: "no_reason" } });
    expect(await handleSuspendPartner(db(), OP, "northwind", true, { reason: "Contract ended" })).toEqual({ status: 200, body: { id: "northwind", status: "suspended" } });
    expect(await handleSuspendPartner(db(), OP, "northwind", true, { reason: "again" })).toMatchObject({ status: 409 });
    const [p] = ((await handleListPartners(db())).body as { partners: Array<Record<string, unknown>> }).partners;
    expect(p).toMatchObject({ status: "suspended", suspended: { by: OP, reason: "Contract ended" } });
    expect(await handleSuspendPartner(db(), OP, "northwind", false, {})).toEqual({ status: 200, body: { id: "northwind", status: "active" } });
    expect(await handleSuspendPartner(db(), OP, "northwind", false, {})).toMatchObject({ status: 409 });
  });
});

describe("through the router", () => {
  it("is the operator's alone: privileged, refused without the key, and every attempt recorded", async () => {
    for (const [method, path] of [
      ["GET", "/partners"],
      ["POST", "/partners"],
      ["GET", "/customers"],
      ["POST", "/partners/northwind/people"],
      ["DELETE", "/partners/northwind/people"],
      ["POST", "/partners/northwind/customers"],
      ["DELETE", "/partners/northwind/customers"],
      ["POST", "/partners/northwind/suspend"],
      ["POST", "/partners/northwind/reinstate"],
    ]) {
      expect(isPrivileged(method, path)).toBe(true);
    }
    const refused = await SELF.fetch("https://licence.example.com/partners", { method: "POST", headers: { Authorization: "Bearer whatever" }, body: "{}" });
    expect(refused.status).toBe(401);
    expect(await db().prepare("SELECT action, outcome FROM admin_actions").first()).toEqual({ action: "POST /partners", outcome: "refused" });
  });

  it("with the key, creates and lists, attributed to the operator Access verified", async () => {
    const key = "k".repeat(48);
    const call = (method: string, path: string, body?: unknown) =>
      worker.fetch(
        new Request(`https://licence.example.com${path}`, {
          method,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cf-Access-Authenticated-User-Email": OP },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { ...env, ADMIN_API_KEY: key } as unknown as Env
      );
    expect((await call("POST", "/partners", { id: "northwind", name: "Northwind" })).status).toBe(201);
    expect((await call("POST", "/partners/northwind/customers", { customerId: "acme" })).status).toBe(201);
    expect((await call("POST", "/partners/northwind/people", { email: "ana@northwind.example" })).status).toBe(201);
    const listed = (await (await call("GET", "/partners")).json()) as { partners: Array<Record<string, unknown>> };
    expect(listed.partners[0]).toMatchObject({ id: "northwind", createdBy: OP, customers: [{ id: "acme" }], people: [{ email: "ana@northwind.example" }] });
    expect((await call("GET", "/customers")).status).toBe(200);
    expect((await call("PATCH", "/partners/northwind/people", {})).status).not.toBe(200);
  });
});

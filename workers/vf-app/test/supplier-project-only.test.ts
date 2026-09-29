import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetInvoice, loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";

/**
 * A supplier site whose spend is project-only expenditure — decision
 * 0547. Read live from the supplier, for rules (`supplier.projectOnly`)
 * and for the viewer (`supplierProjectOnly`, which opens the Coding
 * pop-out on Project with no Cost centre side).
 */
beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES ('sup-p', '40500', 'Fit-out Contractors')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, supplier_id, facts_json) VALUES ('inv-1', 'sup-p', ?), ('inv-2', NULL, ?)")
    .bind(JSON.stringify({ "BT-1": "INV-1", "BT-112": 100 }), JSON.stringify({ "BT-1": "INV-2", "BT-112": 100 }))
    .run();
});

const setProjectOnly = (on: boolean) => env.DB.prepare("UPDATE suppliers SET project_only = ? WHERE id = 'sup-p'").bind(on ? 1 : 0).run();
const invoice = async (id: string) => (await handleGetInvoice(env.DB, id)).body as { supplierProjectOnly: boolean };

describe("a project-only supplier site, read live — decision 0547", () => {
  it("gives rules supplier.projectOnly as the supplier says it now, not as it was at capture", async () => {
    expect((await loadLiveInvoiceFacts(env.DB, "inv-1"))!.facts["supplier.projectOnly"]).toBe(false);
    await setProjectOnly(true);
    expect((await loadLiveInvoiceFacts(env.DB, "inv-1"))!.facts["supplier.projectOnly"]).toBe(true);
  });

  it("leaves the fact absent when no supplier is attached", async () => {
    expect((await loadLiveInvoiceFacts(env.DB, "inv-2"))!.facts).not.toHaveProperty("supplier.projectOnly");
  });

  it("tells the viewer, so the Coding pop-out opens on Project", async () => {
    expect((await invoice("inv-1")).supplierProjectOnly).toBe(false);
    await setProjectOnly(true);
    expect((await invoice("inv-1")).supplierProjectOnly).toBe(true);
    expect((await invoice("inv-2")).supplierProjectOnly).toBe(false);
  });
});

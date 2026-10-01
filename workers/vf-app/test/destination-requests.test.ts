import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { visitCurrentStage } from "../src/workflow-engine.js";
import { destinationPayable } from "../src/destination-delivery.js";
import { eligibleInvoiceIds } from "../src/erp-export-route.js";

/**
 * **A rule sends an invoice to a Destination — decision 0588.** At the
 * stage invoices are sent from, "invoices for Projekt GmbH also go to
 * Oracle Projects": recorded when the rule fires, and the Destination
 * takes the invoice as well as what its business units cover (0587).
 */

async function seed() {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('de', 'Acme Germany'), ('uk', 'Acme UK')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP'), ('other', 'Other')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('intake', 'ap', 'Intake', 1), ('eligible', 'ap', 'Payment Eligible', 2)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare(
    `INSERT INTO route_instances (id, route_id, process_id, name, status, unit_ids, started_at) VALUES
       ('dest-proj', 'https-out', 'ap', 'Oracle Projects', 'active', '["uk"]', '2026-10-01T00:00:00Z'),
       ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active', '["uk"]', '2026-10-01T00:00:00Z'),
       ('dest-elsewhere', 'https-out', 'other', 'Elsewhere', 'active', NULL, '2026-10-01T00:00:00Z')`
  ).run();
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, vocabulary) VALUES ('rs-send', 'Sending', 'all_matches', 'invoice')").run();
  await env.DB.prepare("UPDATE process_stages SET rule_set_id = 'rs-send' WHERE id = 'eligible'").run();
}

async function rule(id: string, supplier: string, destinations: string[]) {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, 'rs-send', 1, 1)").bind(id).run();
  await env.DB.prepare(
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
     VALUES (?, 1, 'send it', ?, 'u-dan', 'u-dan', '2026-09-01', '2026-01-01T00:00:00.000Z')`
  )
    .bind(
      id,
      JSON.stringify({
        conditions: { all: [{ field: "BT-27", operator: "is", value: supplier }] },
        actions: destinations.map((d) => ({ type: "send_to_destination", params: { destination: d } })),
      })
    )
    .run();
}

async function invoiceAtEligible(id: string, facts: Record<string, unknown>, unit: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, ?, ?)").bind(id, JSON.stringify(facts), unit).run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'eligible', 'in_progress')")
    .bind(`pi-${id}`, id)
    .run();
  return `pi-${id}`;
}

const requests = async () =>
  (await env.DB.prepare("SELECT invoice_id, instance_id, rule_id FROM destination_requests ORDER BY invoice_id, instance_id").all()).results;

beforeEach(async () => {
  await applyTestSchema();
  await seed();
});

describe("send_to_destination", () => {
  it("records the Destinations a firing rule names, of this process only, and not when it does not fire", async () => {
    await rule("r-proj", "Projekt GmbH", ["dest-proj", "erp-ap", "dest-elsewhere", "nope"]);
    const facts = { "BT-27": "Projekt GmbH" };
    await visitCurrentStage(env.DB, await invoiceAtEligible("inv-1", facts, "de"), facts as never);
    const other = { "BT-27": "Someone else" };
    await visitCurrentStage(env.DB, await invoiceAtEligible("inv-2", other, "de"), other as never);
    expect(await requests()).toEqual([
      { invoice_id: "inv-1", instance_id: "dest-proj", rule_id: "r-proj" },
      { invoice_id: "inv-1", instance_id: "erp-ap", rule_id: "r-proj" },
    ]);
  });

  it("adds to what the Destination's business units cover, for HTTPS out and the ERP CSV file", async () => {
    await rule("r-proj", "Projekt GmbH", ["dest-proj", "erp-ap"]);
    const facts = { "BT-27": "Projekt GmbH" };
    await visitCurrentStage(env.DB, await invoiceAtEligible("inv-de", facts, "de"), facts as never);
    const plain = { "BT-27": "Plain Ltd" };
    await visitCurrentStage(env.DB, await invoiceAtEligible("inv-uk", plain, "uk"), plain as never);
    await visitCurrentStage(env.DB, await invoiceAtEligible("inv-de2", plain, "de"), plain as never);
    // Both cover Acme UK; the rule adds the German Projekt GmbH invoice; the other German one goes to neither.
    expect((await destinationPayable(env.DB, "dest-proj", "ap")).sort()).toEqual(["inv-de", "inv-uk"]);
    expect((await eligibleInvoiceIds(env.DB, null, "ap")).sort()).toEqual(["inv-de", "inv-uk"]);
  });
});

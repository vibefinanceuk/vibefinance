import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCaptureIntake, handleCaptureUblXml, handleIntakeStats } from "../src/intake-capture-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateTeam } from "../src/team-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedProcessWithChannel(processId: string, channelId: string, channelName: string): Promise<void> {
  await handleCreateProcess(env.DB, { id: processId, name: "Test process" });
  await handleCreateStage(env.DB, processId, { id: `${processId}-received`, name: "Received", sequence: 1 });
  await handleCreateStage(env.DB, processId, { id: `${processId}-eligible`, name: "Payment-eligible", sequence: 2 });
  await handleCreateIntakeChannel(env.DB, processId, { id: channelId, name: channelName });
}

describe("handleCaptureIntake", () => {
  it("404s when the channel does not exist", async () => {
    const result = await handleCaptureIntake(env.DB, "does-not-exist", { id: "inv-1", facts: {} });
    expect(result.status).toBe(404);
  });

  it("400s and logs a rejected event when id is missing — the channel exists, the payload doesn't", async () => {
    await seedProcessWithChannel("p1", "ic1", "Email");
    const result = await handleCaptureIntake(env.DB, "ic1", { facts: {} });
    expect(result.status).toBe(400);
    const event = await env.DB.prepare("SELECT outcome, reason, process_instance_id FROM intake_capture_events WHERE channel_id = ?")
      .bind("ic1")
      .first();
    expect(event).toEqual({ outcome: "rejected", reason: "id (string) is required", process_instance_id: null });
  });

  it("a genuinely successful capture: stores facts, creates an instance, visits it, and records an accepted event — all as one call", async () => {
    await seedProcessWithChannel("p2", "ic2", "Email");
    const result = await handleCaptureIntake(env.DB, "ic2", { id: "inv-cap-1", facts: {} });
    expect(result.status).toBe(201);
    const body = result.body as { instanceId: string; processId: string };
    expect(body.processId).toBe("p2");

    // The instance genuinely exists and genuinely advanced — both
    // automatic stages have no rule set, so it should complete in
    // one call.
    const instance = await env.DB.prepare("SELECT status FROM process_instances WHERE id = ?").bind(body.instanceId).first();
    expect(instance).toEqual({ status: "completed" });

    // Facts were genuinely stored via the real invoice storage path.
    const header = await env.DB.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind("inv-cap-1").first();
    expect(header).toEqual({ id: "inv-cap-1" });

    const event = await env.DB.prepare("SELECT outcome, process_instance_id FROM intake_capture_events WHERE channel_id = ?")
      .bind("ic2")
      .first();
    expect(event).toEqual({ outcome: "accepted", process_instance_id: body.instanceId });
  });

  it("mandate.channel defaults to the channel's own name when not explicitly supplied", async () => {
    await seedProcessWithChannel("p3", "ic3", "Supplier Portal");
    await handleCaptureIntake(env.DB, "ic3", { id: "inv-cap-2", facts: {} });
    const row = await env.DB.prepare("SELECT mandate_channel FROM invoice_headers WHERE id = ?").bind("inv-cap-2").first();
    expect(row).toEqual({ mandate_channel: "Supplier Portal" });
  });

  it("an explicit mandateChannel overrides the channel's own default name", async () => {
    await seedProcessWithChannel("p4", "ic4", "Supplier Portal");
    await handleCaptureIntake(env.DB, "ic4", { id: "inv-cap-3", facts: {}, mandateChannel: "Manual Override" });
    const row = await env.DB.prepare("SELECT mandate_channel FROM invoice_headers WHERE id = ?").bind("inv-cap-3").first();
    expect(row).toEqual({ mandate_channel: "Manual Override" });
  });

  it("Intake stays content-agnostic: a thin document with missing fields still becomes an instance and advances normally — content quality is Validate's job, not Intake's", async () => {
    await seedProcessWithChannel("p5", "ic5", "Email");
    // No supplierVatId, no invoiceNumber, no totalWithVat at all — a
    // genuinely thin document.
    const result = await handleCaptureIntake(env.DB, "ic5", { id: "inv-thin", facts: {} });
    expect(result.status).toBe(201);
    const body = result.body as { instanceId: string };
    const instance = await env.DB.prepare("SELECT status FROM process_instances WHERE id = ?").bind(body.instanceId).first();
    expect(instance).toEqual({ status: "completed" }); // still advances all the way through — Intake never validated content
  });

  it("a process with a rule-bearing Validate stage still blocks correctly when content is thin, and advances when it's not — Intake itself never intervenes", async () => {
    await handleCreateProcess(env.DB, { id: "p6", name: "AP with validate" });
    await handleCreateStage(env.DB, "p6", { id: "intake", name: "Intake", sequence: 1 });
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs-validate", "test", "first_match", "active")
      .run();
    const ruleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 0, 1)").bind(ruleId, "rs-validate").run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        ruleId,
        "test",
        JSON.stringify({
          conditions: { field: "BT-31", operator: "is_empty" },
          actions: [{ type: "assign_task", params: { team: "validate-team", permission: "AP.Validate" } }],
        }),
        "test-model",
        "alice",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      )
      .run();
    await handleCreateStage(env.DB, "p6", { id: "validate", name: "Validate", sequence: 2, ruleSetId: "rs-validate" });
    await handleCreateTeam(env.DB, { id: "validate-team", name: "Validate Team" });
    await handleCreateIntakeChannel(env.DB, "p6", { id: "ic6", name: "Email" });

    // Thin: no supplierVatId at all -> BT-31 is empty -> should block at Validate.
    const thinResult = await handleCaptureIntake(env.DB, "ic6", { id: "inv-thin-2", facts: {} });
    const thinBody = thinResult.body as { instanceId: string };
    const thinInstance = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind(thinBody.instanceId)
      .first();
    expect(thinInstance).toEqual({ status: "in_progress", current_stage_id: "validate" });

    // Complete: supplierVatId present -> BT-31 not empty -> sails through.
    const completeResult = await handleCaptureIntake(env.DB, "ic6", { id: "inv-complete", supplierVatId: "DE123", facts: {} });
    const completeBody = completeResult.body as { instanceId: string };
    const completeInstance = await env.DB.prepare("SELECT status FROM process_instances WHERE id = ?").bind(completeBody.instanceId).first();
    expect(completeInstance).toEqual({ status: "completed" });
  });

  it("a genuinely invalid line (missing lineNumber) is rejected and logged, with no instance created", async () => {
    await seedProcessWithChannel("p7", "ic7", "Email");
    const result = await handleCaptureIntake(env.DB, "ic7", { id: "inv-bad-line", facts: {}, lines: [{ amount: 100 }] });
    expect(result.status).toBe(422);
    const event = await env.DB.prepare("SELECT outcome, process_instance_id FROM intake_capture_events WHERE channel_id = ?")
      .bind("ic7")
      .first();
    expect(event).toEqual({ outcome: "rejected", process_instance_id: null });
    const instanceCount = await env.DB.prepare("SELECT count(*) AS n FROM process_instances").first<{ n: number }>();
    expect(instanceCount?.n).toBe(0);
  });
});

describe("handleIntakeStats", () => {
  it("404s when the process does not exist", async () => {
    const result = await handleIntakeStats(env.DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("a channel with zero events reports 0/0, not null — real, correct aggregation over an empty set", async () => {
    await seedProcessWithChannel("p8", "ic8", "Email");
    const result = await handleIntakeStats(env.DB, "p8");
    expect(result.body).toEqual({
      processId: "p8",
      channels: [{ channelId: "ic8", channelName: "Email", accepted: 0, rejected: 0 }],
    });
  });

  it("real volume and exception counts, accumulated correctly across mixed outcomes and multiple channels", async () => {
    await handleCreateProcess(env.DB, { id: "p9", name: "Stats test" });
    await handleCreateStage(env.DB, "p9", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateIntakeChannel(env.DB, "p9", { id: "ic9a", name: "Email" });
    await handleCreateIntakeChannel(env.DB, "p9", { id: "ic9b", name: "EDI" });

    await handleCaptureIntake(env.DB, "ic9a", { id: "s-1", facts: {} }); // accepted
    await handleCaptureIntake(env.DB, "ic9a", { id: "s-2", facts: {} }); // accepted
    await handleCaptureIntake(env.DB, "ic9a", { facts: {} }); // rejected (no id)
    await handleCaptureIntake(env.DB, "ic9b", { id: "s-3", facts: {} }); // accepted

    const result = await handleIntakeStats(env.DB, "p9");
    const body = result.body as { channels: Array<{ channelId: string; accepted: number; rejected: number }> };
    const byId = Object.fromEntries(body.channels.map((c) => [c.channelId, c]));
    expect(byId["ic9a"]).toEqual({ channelId: "ic9a", channelName: "Email", accepted: 2, rejected: 1 });
    expect(byId["ic9b"]).toEqual({ channelId: "ic9b", channelName: "EDI", accepted: 1, rejected: 0 });
  });

  it("only reports channels belonging to the named process — no cross-process leakage", async () => {
    await seedProcessWithChannel("p10", "ic10", "Email");
    await seedProcessWithChannel("p11", "ic11", "Email");
    await handleCaptureIntake(env.DB, "ic10", { id: "cross-1", facts: {} });

    const result = await handleIntakeStats(env.DB, "p11");
    const body = result.body as { channels: Array<{ channelId: string }> };
    expect(body.channels.map((c) => c.channelId)).toEqual(["ic11"]);
  });
});

const SAMPLE_UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-XML-1</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>DE555666777</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="EUR">1200.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity>2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>1200.00</cbc:LineExtensionAmount>
  </cac:InvoiceLine>
</Invoice>`;

describe("handleCaptureUblXml (decision 0030)", () => {
  it("a genuine UBL document is parsed and captured through the exact same orchestration as JSON capture", async () => {
    await seedProcessWithChannel("px1", "icx1", "EDI");
    const result = await handleCaptureUblXml(env.DB, "icx1", SAMPLE_UBL_INVOICE);
    expect(result.status).toBe(201);

    // The real, structured columns were genuinely populated from the
    // parsed XML, not just the opaque facts blob.
    const body = result.body as { instanceId: string };
    const header = await env.DB.prepare(
      "SELECT supplier_vat_id, invoice_number, total_with_vat FROM invoice_headers"
    ).first();
    expect(header).toEqual({ supplier_vat_id: "DE555666777", invoice_number: "INV-XML-1", total_with_vat: 1200 });

    const lineRow = await env.DB.prepare("SELECT amount FROM invoice_lines").first();
    expect(lineRow).toEqual({ amount: 1200 });

    const instance = await env.DB.prepare("SELECT status FROM process_instances WHERE id = ?").bind(body.instanceId).first();
    expect(instance).toEqual({ status: "completed" });
  });

  it("an explicit id override is used instead of a generated one", async () => {
    await seedProcessWithChannel("px2", "icx2", "EDI");
    await handleCaptureUblXml(env.DB, "icx2", SAMPLE_UBL_INVOICE, "my-own-id");
    const header = await env.DB.prepare("SELECT id FROM invoice_headers").first();
    expect(header).toEqual({ id: "my-own-id" });
  });

  it("a generated id is used when no override is given — a real invoice number is never used as this system's own id directly", async () => {
    await seedProcessWithChannel("px3", "icx3", "EDI");
    await handleCaptureUblXml(env.DB, "icx3", SAMPLE_UBL_INVOICE);
    const header = await env.DB.prepare("SELECT id, invoice_number FROM invoice_headers").first<{ id: string; invoice_number: string }>();
    expect(header?.invoice_number).toBe("INV-XML-1");
    expect(header?.id).not.toBe("INV-XML-1"); // a real, generated UUID, not the raw invoice number
  });

  it("a genuinely malformed XML document is refused with a 422 and a real, specific reason — no instance created", async () => {
    await seedProcessWithChannel("px4", "icx4", "EDI");
    const result = await handleCaptureUblXml(env.DB, "icx4", "<Invoice><ID>unclosed");
    expect(result.status).toBe(422);
    const instanceCount = await env.DB.prepare("SELECT count(*) AS n FROM process_instances").first<{ n: number }>();
    expect(instanceCount?.n).toBe(0);
  });

  it("a rejected XML capture is still logged as a real intake_capture_events row — exceptions from bad documents are visible in analytics too", async () => {
    await seedProcessWithChannel("px5", "icx5", "EDI");
    await handleCaptureUblXml(env.DB, "icx5", "not xml at all");
    const event = await env.DB.prepare("SELECT outcome FROM intake_capture_events WHERE channel_id = ?").bind("icx5").first();
    expect(event).toEqual({ outcome: "rejected" });
  });

  it("404s when the channel does not exist, without ever attempting to parse the XML", async () => {
    const result = await handleCaptureUblXml(env.DB, "does-not-exist", SAMPLE_UBL_INVOICE);
    expect(result.status).toBe(404);
  });
});

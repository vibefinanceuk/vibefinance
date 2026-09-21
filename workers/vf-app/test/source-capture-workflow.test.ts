import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateTeam } from "../src/team-route.js";
import { handleLoadSuppliers } from "../src/load-suppliers.js";

/**
 * Decision 0434 — a Validation-stage rule testing supplier.* facts
 * (decision 0433's own reason for existing) must actually see them on
 * the very first visit an email-captured invoice ever gets, not only
 * in what gets written to invoice_headers afterward for display.
 *
 * source-capture.test.ts already covers structure detection and
 * routing; this file is specifically the interaction between capture
 * and the workflow engine — the exact seam decision 0434 fixed. A
 * separate process ("p-workflow") rather than source-capture.test.ts's
 * own shared "p-ap", so this file's own stages and rules cannot
 * interact with anything that file's tests assume about "p-ap".
 */

async function seedRuleSet(id: string, compiledJson: Record<string, unknown>): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind(id, "test", "first_match", "active")
    .run();
  const ruleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 0, 1)").bind(ruleId, id).run();
  await env.DB.prepare(
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
  )
    .bind(ruleId, "test rule", JSON.stringify(compiledJson), "test-model", "alice", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}

function ublWithSupplierVat(id: string, vat: string): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>${vat}</cbc:CompanyID></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="GBP">100.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`);
}

const fakeModel = { extract: async () => "{}" };

describe("a Validation-stage rule testing supplier.unmatchedReason (decision 0434)", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await handleCreateProcess(env.DB, { id: "p-workflow", name: "AP" });
    await seedRuleSet("rs-validation", {
      conditions: { field: "supplier.unmatchedReason", operator: "is", value: "ambiguous_site" },
      actions: [{ type: "assign_task", params: { team: "team1", permission: "AP.Validate" } }],
    });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme UK') ON CONFLICT(id) DO NOTHING").run();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team", unitId: "u1" });
    await handleCreateStage(env.DB, "p-workflow", { id: "s-validation", name: "Validation", sequence: 1, ruleSetId: "rs-validation" });
    await handleCreateStage(env.DB, "p-workflow", { id: "s-payment-eligible", name: "Payment-eligible", sequence: 2 });

    await handleCreateSource(env.DB, "p-workflow", { id: "src-mail", name: "AP mailbox", mechanism: "email" });
    await handleCreateIntakeChannel(env.DB, "p-workflow", { id: "ch-xml", name: "Structured XML", structure: "structured_xml" });
  });

  it("blocks at Validation with a real task — the exact scenario decision 0433 recommended this rule for", async () => {
    // Two active, non-pay sites sharing one VAT number -> ambiguous_site,
    // the same shape as the operator's own live TEST-ORG-0020 report.
    await handleLoadSuppliers(
      env.DB,
      `ERP ID,Name,VAT,Pay Site\nSITE-A,Northwind A,GB447711223,No\nSITE-B,Northwind B,GB447711223,No\n`,
      "test-loader"
    );

    const result = await handleCaptureFromSource(env.DB, "src-mail", ublWithSupplierVat("INV-AMBIG-1", "GB447711223"), fakeModel);
    expect(result.status).toBe(201);
    const invoiceId = (result.body as { id: string }).id;

    const instanceRow = await env.DB
      .prepare("SELECT status, current_stage_id FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ?")
      .bind(invoiceId)
      .first<{ status: string; current_stage_id: string }>();
    expect(instanceRow).toEqual({ status: "in_progress", current_stage_id: "s-validation" });

    const taskRow = await env.DB
      .prepare("SELECT required_permission FROM tasks WHERE stage_id = 's-validation'")
      .first<{ required_permission: string }>();
    expect(taskRow?.required_permission).toBe("AP.Validate");

    // The DB-persisted, display-facing fact still agrees — decision
    // 0434 added a second place this gets computed, not a replacement
    // for the first.
    const invoiceRow = await env.DB
      .prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind(invoiceId)
      .first<{ facts_json: string }>();
    expect(JSON.parse(invoiceRow!.facts_json)["supplier.unmatchedReason"]).toBe("ambiguous_site");
  });

  it("does not block an ordinary, unambiguous match — no regression for the common case", async () => {
    await handleLoadSuppliers(env.DB, `ERP ID,Name,VAT,Pay Site\nSITE-A,Northwind A,GB447711223,Yes\n`, "test-loader");

    const result = await handleCaptureFromSource(env.DB, "src-mail", ublWithSupplierVat("INV-CLEAN-1", "GB447711223"), fakeModel);
    expect(result.status).toBe(201);
    const invoiceId = (result.body as { id: string }).id;

    const instanceRow = await env.DB
      .prepare("SELECT status FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ?")
      .bind(invoiceId)
      .first<{ status: string }>();
    expect(instanceRow).toEqual({ status: "completed" });

    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("does not block when nothing matches at all (no_match, not ambiguous_site)", async () => {
    // No suppliers loaded at all -> no_match, a different reason this
    // rule was deliberately scoped not to flag (decision 0433's own
    // answer: only ambiguous_site, no_identifier/no_match already have
    // decision 0222's amber ribbon).
    const result = await handleCaptureFromSource(env.DB, "src-mail", ublWithSupplierVat("INV-UNKNOWN-1", "GB999999999"), fakeModel);
    expect(result.status).toBe(201);
    const invoiceId = (result.body as { id: string }).id;

    const instanceRow = await env.DB
      .prepare("SELECT status FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ?")
      .bind(invoiceId)
      .first<{ status: string }>();
    expect(instanceRow).toEqual({ status: "completed" });
  });
});

/**
 * Decision 0435 — a stage visit that genuinely ERRORS (as opposed to
 * one that simply has nothing to fire) must not disappear. Found
 * live, immediately after decision 0434 shipped: the operator's own
 * rule fired `assign_task` against a Validation stage with no
 * declared `required_permission`, task creation was refused, and the
 * invoice sat at Validation with no task ever appearing — and no way
 * for the operator to see why.
 */
describe("a stage visit that errors out is recorded, not swallowed (decision 0435)", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await handleCreateProcess(env.DB, { id: "p-workflow-error", name: "AP" });
    // The exact misconfiguration this decision was found from: a rule
    // whose own action names no permission, on a stage that declares
    // none either — handleCreateTask has nothing to fall back to.
    await seedRuleSet("rs-misconfigured", {
      conditions: { field: "supplier.unmatchedReason", operator: "is", value: "ambiguous_site" },
      actions: [{ type: "assign_task", params: { team: "team1" } }],
    });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme UK') ON CONFLICT(id) DO NOTHING").run();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team", unitId: "u1" });
    await handleCreateStage(env.DB, "p-workflow-error", { id: "s-validation", name: "Validation", sequence: 1, ruleSetId: "rs-misconfigured" });
    await handleCreateStage(env.DB, "p-workflow-error", { id: "s-payment-eligible", name: "Payment-eligible", sequence: 2 });

    await handleCreateSource(env.DB, "p-workflow-error", { id: "src-mail", name: "AP mailbox", mechanism: "email" });
    await handleCreateIntakeChannel(env.DB, "p-workflow-error", { id: "ch-xml", name: "Structured XML", structure: "structured_xml" });
    await handleLoadSuppliers(
      env.DB,
      `ERP ID,Name,VAT,Pay Site\nSITE-A,Northwind A,GB447711223,No\nSITE-B,Northwind B,GB447711223,No\n`,
      "test-loader"
    );
  });

  it("still stores the invoice (201) and records why the stage visit failed, as a fact on the invoice", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", ublWithSupplierVat("INV-MISCONFIG-1", "GB447711223"), fakeModel);

    // The document is genuinely stored — a rule-configuration mistake
    // is not a reason to lose the invoice, or to make an email
    // pipeline think it needs to retry.
    expect(result.status).toBe(201);
    const invoiceId = (result.body as { id: string }).id;

    const invoiceRow = await env.DB
      .prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind(invoiceId)
      .first<{ facts_json: string }>();
    const stageError = JSON.parse(invoiceRow!.facts_json)["workflow.stageError"] as string;
    expect(stageError).toContain("assign_task fired an invalid task");
    expect(stageError).toContain("closed permission vocabulary");

    // And no task exists — this was never a real block, just a stall.
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("writes nothing when the visit succeeds ordinarily — no false positives", async () => {
    // A clean, unambiguous match never triggers the misconfigured
    // rule's condition at all, so nothing errors.
    await env.DB.prepare("DELETE FROM suppliers").run();
    await handleLoadSuppliers(env.DB, `ERP ID,Name,VAT,Pay Site\nSITE-A,Northwind A,GB447711223,Yes\n`, "test-loader");

    const result = await handleCaptureFromSource(env.DB, "src-mail", ublWithSupplierVat("INV-CLEAN-2", "GB447711223"), fakeModel);
    expect(result.status).toBe(201);
    const invoiceId = (result.body as { id: string }).id;

    const invoiceRow = await env.DB
      .prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind(invoiceId)
      .first<{ facts_json: string }>();
    expect(JSON.parse(invoiceRow!.facts_json)["workflow.stageError"]).toBeUndefined();
  });
});

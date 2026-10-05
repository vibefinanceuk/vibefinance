import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompilerModel } from "@vibefinance/shared";
import { handleCreateAgent, handleGetAgentNote, handleListAgentNotes, handleRunAgentNow, type AgentDeps, type ReportTable } from "../src/agents.js";
import { handleDecideAgentAction, handleListAgentActions } from "../src/agent-actions.js";
import { handleGetActivity } from "../src/activity-route.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents phase 3, slice 2: chasing a supplier about an invoice returned
 * with no reply — decision 0632. Lager Nord GmbH (Germany) had invoice
 * 88242 returned on 25 September for missing information; Kingsway (UK)
 * had K-7 returned on 27 September. Today is Monday 5 October.
 */

const SATURDAY = new Date("2026-10-03T12:00:00Z");
const MONDAY = new Date("2026-10-05T09:00:00Z");

async function person(id: string, name: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function returned(id: string, o: { number: string; supplierId: string | null; supplierName: string; country: string; total: number; currency: string; issued: string; returnedAt: string; reason: string; comment?: string }) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat, issue_date, supplier_id, created_at) VALUES (?, ?, 'ap-uk', ?, ?, ?, ?, ?, '2026-09-20 09:00:00')")
    .bind(id, JSON.stringify({ "BT-1": o.number, "BT-27": o.supplierName, "BT-40": o.country }), o.number, o.currency, o.total, o.issued, o.supplierId)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status, ended_at, return_reason_id, supplier_comment) VALUES (?, 'ap', 'invoice', ?, 'approval', 'returned_manually', ?, ?, ?)",
  )
    .bind(`pi-${id}`, id, o.returnedAt, o.reason, o.comment ?? null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-uk', 'AP UK', 'operating_unit', 'acme-uk')").run();
  await person("dan", "Dan Young", ["AP.Agents", "AP.Manager", "AP.Analysis", "AP.ReturnToSupplier"]);
  await person("pat", "Pat", ["AP.Analysis"]);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, email) VALUES ('sup-ln', 'Lager Nord GmbH', 'billing@lager-nord.de'), ('sup-kw', 'Kingsway', NULL)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO org_settings (id) VALUES (1)").run();
  await env.DB.prepare("UPDATE org_settings SET ap_team_email = 'ap@acme.co.uk' WHERE id = 1").run();
  await returned("ln", { number: "88242", supplierId: "sup-ln", supplierName: "Lager Nord GmbH", country: "DE", total: 1240, currency: "EUR", issued: "2026-09-01", returnedAt: "2026-09-25T10:00:00.000Z", reason: "missing_information", comment: "BT-2 nicht lesbar" });
  await returned("kw", { number: "K-7", supplierId: "sup-kw", supplierName: "Kingsway", country: "GB", total: 18400, currency: "GBP", issued: "2026-09-15", returnedAt: "2026-09-27T10:00:00.000Z", reason: "incorrect_po_or_pricing" });
  await returned("new", { number: "N-1", supplierId: "sup-kw", supplierName: "Kingsway", country: "GB", total: 5, currency: "GBP", issued: "2026-10-01", returnedAt: "2026-10-03T10:00:00.000Z", reason: "other" }); // 2 days: too soon
  await returned("fixed", { number: "F-1", supplierId: "sup-kw", supplierName: "Kingsway", country: "GB", total: 9, currency: "GBP", issued: "2026-09-01", returnedAt: "2026-09-20T10:00:00.000Z", reason: "other" });
  // F-1 came back corrected.
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat, supplier_id, created_at) VALUES ('fixed-2', '{}', 'ap-uk', 'F-1', 'GBP', 9, 'sup-kw', '2026-09-24 09:00:00')").run();
  // Kingsway has no address on file; its return went to accounts@kingsway.co.uk.
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv-kw', 'pi-kw', 'approval', 'matched')").run();
  await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status) VALUES ('t-kw', 'approval', 'sv-kw', 'AP.Approve', 'returned')").run();
  await env.DB.prepare(
    "INSERT INTO supplier_return_emails (id, process_instance_id, task_id, supplier_id, to_address, subject, body, status, created_by) VALUES ('sre-1', 'pi-kw', 't-kw', 'sup-kw', 'accounts@kingsway.co.uk', 's', 'b', 'delivered', 'dan')",
  ).run();
});

async function chasingAgent() {
  const made = await handleCreateAgent(env.DB, "dan", { name: "Chase returns", report: "returned_no_reply", orgIds: ["acme-uk"], schedule: { every: "workday", time: "09:00" }, action: "chase_supplier" }, SATURDAY);
  expect(made.status).toBe(201);
  return (made.body as { id: string }).id;
}

type Chase = { id: string; payload: { to: string; cc: string | null; subject: string; body: string; drafted: string; facts: { invoice: string; locale: string } } };
const waiting = async (user = "dan", now = MONDAY) => ((await handleListAgentActions(env.DB, user, now)).body as { actions: Chase[] }).actions;
const byInvoice = (list: Chase[], n: string) => list.find((a) => a.payload.facts.invoice === n)!;

function mailer() {
  const sent: SendEmailInput[] = [];
  const deps: AgentDeps = {
    email: { apiKey: "re_test", from: "ap@vibefinance-ai.com" },
    appUrl: null,
    bucket: null,
    send: async (_k, input) => (sent.push(input), { ok: true, messageId: "msg-1" }),
  };
  return { sent, deps };
}

describe("returned to the supplier, no reply", () => {
  it("lists returns older than the days chosen with no corrected invoice since", async () => {
    const id = await chasingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const note = ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string }[] }).notes[0];
    const table = ((await handleGetAgentNote(env.DB, "dan", note.id)).body as { table: ReportTable }).table;
    expect(table.rows.map((r) => [r.invoice, r.daysSince, r.returnReason])).toEqual([
      ["88242", 10, "Missing required information"],
      ["K-7", 8, "Incorrect PO reference or pricing"],
    ]);
    expect(table.options).toEqual({ waitDays: 7 });
  });
});

describe("chasing a supplier", () => {
  it("prepares a letter in the supplier's language, to the address on file, copied to the AP team", async () => {
    const id = await chasingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const list = await waiting();
    expect(list).toHaveLength(2);
    const ln = byInvoice(list, "88242");
    expect(ln.payload).toMatchObject({ to: "billing@lager-nord.de", cc: "ap@acme.co.uk", drafted: "ours", subject: "Rechnung 88242: zurückgesandt am 25.09.2026" });
    expect(ln.payload.body).toContain("am 25.09.2026 haben wir Ihre Rechnung 88242 vom 01.09.2026 über 1.240,00 EUR zurückgesandt. Grund: Missing required information.");
    expect(ln.payload.body).toContain("Unser Hinweis damals: BT-2 nicht lesbar");
    expect(ln.payload.body).toContain("Acme UK Ltd, Kreditorenbuchhaltung");
    // No address on file: where the return itself went.
    const kw = byInvoice(list, "K-7");
    expect(kw.payload).toMatchObject({ to: "accounts@kingsway.co.uk", subject: "Invoice K-7: returned on 27 September 2026" });
    expect(kw.payload.body).toContain("for 18,400.00 GBP");
    expect(await waiting("pat")).toEqual([]);
  });

  it("uses the AI's wording only around our own facts", async () => {
    const id = await chasingAgent();
    const good: CompilerModel = { compile: async () => "Dear {supplier},\n\nWe are still waiting for a corrected invoice {invoice}, returned on {returned}. Could you send it?\n\n{company}, Accounts Payable" };
    await handleRunAgentNow(env.DB, "dan", id, MONDAY, { ...mailer().deps, model: good });
    const kw = byInvoice(await waiting(), "K-7");
    expect(kw.payload.drafted).toBe("ai");
    expect(kw.payload.body).toBe("Dear Kingsway,\n\nWe are still waiting for a corrected invoice K-7, returned on 27 September 2026. Could you send it?\n\nAcme UK Ltd, Accounts Payable");

    await env.DB.prepare("DELETE FROM agent_actions").run();
    const sly: CompilerModel = { compile: async () => "Dear {supplier}, please pay 500 for {invoice} returned {returned}." };
    await handleRunAgentNow(env.DB, "dan", id, MONDAY, { ...mailer().deps, model: sly });
    expect(byInvoice(await waiting(), "K-7").payload.drafted).toBe("ours");
  });

  it("sends the letter as the approver left it, unless a number in it is not the invoice's", async () => {
    const id = await chasingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const ln = byInvoice(await waiting(), "88242");
    const { sent, deps } = mailer();
    const edited = `${ln.payload.body}\n\nBitte überweisen Sie 2.000,00 EUR.`;
    expect((await handleDecideAgentAction(env.DB, "dan", ln.id, "approve", { body: edited }, deps, MONDAY)).body).toMatchObject({ reason: "number_not_on_invoice", stray: "2.000,00" });
    expect((await handleDecideAgentAction(env.DB, "dan", ln.id, "approve", { body: `${ln.payload.body}\n\nSchreiben Sie an evil@example.com` }, deps, MONDAY)).body).toMatchObject({ reason: "chase_address_in_text" });
    expect(sent).toHaveLength(0);

    const kind = ln.payload.body.replace("Bitte senden", "Bitte senden Sie uns freundlicherweise bis Freitag");
    const r = await handleDecideAgentAction(env.DB, "dan", ln.id, "approve", { body: kind }, deps, MONDAY);
    expect(r.body).toMatchObject({ status: "done", emailed: true, to: "billing@lager-nord.de" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "billing@lager-nord.de", cc: "ap@acme.co.uk", subject: "Rechnung 88242: zurückgesandt am 25.09.2026", text: kind });
    expect(sent[0].html).toContain("<p style=");
    const timeline = (await handleGetActivity(env.DB, "ln")).body as { items: { action?: string; userName?: string; targetUserName?: string; comment?: string }[] };
    expect(timeline.items.find((i) => i.action === "chase")).toMatchObject({ userName: "Dan Young", targetUserName: "Lager Nord GmbH (billing@lager-nord.de)", comment: "Rechnung 88242: zurückgesandt am 25.09.2026" });
    expect((await handleDecideAgentAction(env.DB, "dan", ln.id, "approve", {}, deps, MONDAY)).body).toMatchObject({ reason: "already_done" });
  });

  it("does not send when the supplier replied, or the address changed, since it was prepared", async () => {
    const id = await chasingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const list = await waiting();
    const { sent, deps } = mailer();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat, supplier_id, created_at) VALUES ('ln-2', '{}', 'ap-uk', '88242', 'EUR', 1240, 'sup-ln', '2026-10-05 08:00:00')").run();
    expect((await handleDecideAgentAction(env.DB, "dan", byInvoice(list, "88242").id, "approve", {}, deps, MONDAY)).body).toMatchObject({ reason: "replied" });
    await env.DB.prepare("UPDATE suppliers SET email = 'new@kingsway.co.uk' WHERE id = 'sup-kw'").run();
    expect((await handleDecideAgentAction(env.DB, "dan", byInvoice(list, "K-7").id, "approve", {}, deps, MONDAY)).body).toMatchObject({ reason: "address_changed" });
    expect(sent).toHaveLength(0);
  });

  it("waits, untouched, where email is not set up", async () => {
    const id = await chasingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const ln = byInvoice(await waiting(), "88242");
    expect((await handleDecideAgentAction(env.DB, "dan", ln.id, "approve", {}, { email: null, appUrl: null, bucket: null }, MONDAY)).body).toMatchObject({ reason: "email_not_configured" });
    expect(byInvoice(await waiting(), "88242").id).toBe(ln.id);
  });
});

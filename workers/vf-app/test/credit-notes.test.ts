import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  creditsFor,
  findCreditedInvoice,
  handleDecideCredit,
  handleGetCreditNoteConfig,
  handleListCreditsToConfirm,
  handlePutCreditNoteConfig,
  settleCreditNote,
} from "../src/credit-notes.js";
import { eligibleInvoiceIds } from "../src/erp-export-route.js";
import { handleGetActivity } from "../src/activity-route.js";

/**
 * **A credit note and the invoice it credits — decision 0731.** Lager Nord
 * (GB111) sends INV-1 (£120, payment-eligible, an open task on it), then
 * credit notes against it, settled as AP Setup › Credit Notes says.
 */

async function person(id: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function doc(id: string, facts: Record<string, unknown>, opts: { status?: string; task?: boolean } = {}) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, ?, 'uk')")
    .bind(id, JSON.stringify({ "BT-5": "GBP", "BT-31": "GB111", "BT-2": "2026-10-01", ...facts }))
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'eligible', ?)")
    .bind(`pi-${id}`, id, opts.status ?? "in_progress")
    .run();
  if (opts.task) {
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'eligible', 'matched')").bind(`sv-${id}`, `pi-${id}`).run();
    await env.DB.prepare(
      "INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, status, stage_visit_id) VALUES (?, 'eligible', 'ap-team', 'AP.Approve', 'open', ?)"
    )
      .bind(`t-${id}`, `sv-${id}`)
      .run();
  }
}

const facts = async (id: string) => JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{ facts_json: string }>())!.facts_json) as Record<string, unknown>;
const settle = async (id: string) => settleCreditNote(env.DB, id, await facts(id));
const status = async (id: string) => (await env.DB.prepare("SELECT status FROM process_instances WHERE subject_id = ?").bind(id).first<{ status: string }>())?.status;
const state = async (id: string) => (await env.DB.prepare("SELECT state FROM credit_notes WHERE credit_note_id = ?").bind(id).first<{ state: string }>())?.state;

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('uk', 'Acme UK', 'legal_entity')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('eligible', 'ap', 'Payment-eligible', 1)").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('ap-team', 'AP Review', 'uk')").run();
  await person("ada", ["Admin.Configure"]);
  await person("rui", []);
  await person("kim", []);
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('ap-team', 'rui')").run();
  await env.DB.prepare("UPDATE credit_note_config SET confirm_team_id = 'ap-team'").run();
  await doc("inv-1", { "BT-1": "INV-1", "BT-3": "380", "BT-112": 120 }, { task: true });
});

describe("finding the invoice a credit note credits", () => {
  it("by number, from the same supplier, an invoice and not a credit note; in full or in part", async () => {
    await doc("other", { "BT-1": "INV-1", "BT-31": "GB999", "BT-112": 120 });
    await doc("cn-full", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await doc("cn-part", { "BT-1": "CN-2", "BT-3": "381", "BT-25": "INV-1", "BT-112": 20 });
    await doc("cn-none", { "BT-1": "CN-3", "BT-3": "381", "BT-25": "INV-404", "BT-112": 20 });
    expect(await findCreditedInvoice(env.DB, "cn-full", await facts("cn-full"))).toMatchObject({ reference: "INV-1", invoice: { id: "inv-1" }, covers: "full" });
    expect(await findCreditedInvoice(env.DB, "cn-part", await facts("cn-part"))).toMatchObject({ invoice: { id: "inv-1" }, covers: "partial" });
    expect(await findCreditedInvoice(env.DB, "cn-none", await facts("cn-none"))).toMatchObject({ reference: "INV-404", invoice: null, covers: null });
  });
});

describe("the same supplier, however each wrote its VAT number (Dan, 11 October)", () => {
  it("finds an invoice read as 111350965 from a credit note saying GB111350965, and the other way round", async () => {
    await doc("thornbury", { "BT-1": "INV-16356", "BT-31": "111350965", "BT-112": 479.04 });
    await doc("cn-gb", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-16356", "BT-31": "GB111350965", "BT-112": 479.04 });
    expect(await findCreditedInvoice(env.DB, "cn-gb", await facts("cn-gb"))).toMatchObject({ invoice: { id: "thornbury" }, covers: "full" });
    await doc("inv-gb", { "BT-1": "INV-77", "BT-31": "GB 222 333 444", "BT-112": 10 });
    await doc("cn-bare", { "BT-1": "CN-2", "BT-3": "381", "BT-25": "INV-77", "BT-31": "222333444", "BT-112": 10 });
    expect(await findCreditedInvoice(env.DB, "cn-bare", await facts("cn-bare"))).toMatchObject({ invoice: { id: "inv-gb" } });
  });
});

describe("what happens to it, as AP Setup says", () => {
  it("by default, one in full waits for the team to confirm: neither is exported meanwhile; Credit marks the invoice Credited", async () => {
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 }, { status: "completed" });
    expect((await eligibleInvoiceIds(env.DB, null)).sort()).toEqual(["cn-1", "inv-1"]);
    await settle("cn-1");
    expect(await state("cn-1")).toBe("to_confirm");
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual([]);

    expect((await handleListCreditsToConfirm(env.DB, "kim")).body).toEqual({ credits: [], mayConfirm: false });
    const listed = (await handleListCreditsToConfirm(env.DB, "rui")).body as { credits: Array<Record<string, unknown>> };
    expect(listed.credits).toMatchObject([{ creditNoteNumber: "CN-1", invoice: { id: "inv-1", number: "INV-1", total: 120 }, covers: "full", state: "to_confirm" }]);
    expect((await handleDecideCredit(env.DB, "kim", "cn-1", { decision: "credit" })).status).toBe(403);

    expect((await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "credit" })).status).toBe(200);
    expect(await state("cn-1")).toBe("credited");
    expect(await status("inv-1")).toBe("credited");
    expect((await env.DB.prepare("SELECT status FROM tasks WHERE id = 't-inv-1'").first<{ status: string }>())?.status).toBe("cancelled");
    // The credit note goes to the ERP; the invoice never does.
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual(["cn-1"]);
    expect((await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "pay" })).status).toBe(409);
  });

  it("Take out of payment credits it at once; for part of an invoice, Pay lets the invoice be paid", async () => {
    await handlePutCreditNoteConfig(env.DB, "ada", { fullUnpaid: "take_out" });
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await settle("cn-1");
    expect(await state("cn-1")).toBe("credited");
    expect(await status("inv-1")).toBe("credited");

    await doc("inv-2", { "BT-1": "INV-2", "BT-112": 500 }, { status: "completed" });
    await doc("cn-2", { "BT-1": "CN-2", "BT-3": "381", "BT-25": "INV-2", "BT-112": 50 });
    await settle("cn-2");
    expect(await state("cn-2")).toBe("netted");
    expect(await status("inv-2")).toBe("completed");
  });

  it("Hold keeps an invoice credited in part until confirmed; Pay then releases it", async () => {
    await handlePutCreditNoteConfig(env.DB, "ada", { partial: "hold" });
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 20 });
    await settle("cn-1");
    expect(await state("cn-1")).toBe("to_confirm");
    expect(await eligibleInvoiceIds(env.DB, null)).not.toContain("inv-1");
    await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "pay" });
    expect(await state("cn-1")).toBe("netted");
    expect(await status("inv-1")).toBe("in_progress");
    expect(await eligibleInvoiceIds(env.DB, null)).toContain("inv-1");
  });

  it("one whose invoice is not found waits for AP to say which, or to process it against none", async () => {
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-9", "BT-112": 120 });
    await settle("cn-1");
    expect(await state("cn-1")).toBe("to_confirm");
    expect((await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "credit" })).body).toMatchObject({ reason: "no_invoice" });
    expect((await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "link", invoiceNumber: "INV-9" })).body).toMatchObject({ reason: "not_found" });
    const linked = await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "link", invoiceNumber: "INV-1" });
    expect(linked.body).toMatchObject({ credit: { invoice: { id: "inv-1" }, covers: "full", state: "to_confirm" } });
    await handleDecideCredit(env.DB, "rui", "cn-1", { decision: "credit" });
    expect(await status("inv-1")).toBe("credited");

    await handlePutCreditNoteConfig(env.DB, "ada", { notFound: "process" });
    await doc("cn-2", { "BT-1": "CN-2", "BT-3": "381", "BT-112": 10 });
    await settle("cn-2");
    expect(await state("cn-2")).toBe("unmatched");
  });

  it("an invoice already sent for payment is kept as a credit and marked Credited; a returned one is Credited too", async () => {
    await env.DB.prepare("INSERT INTO erp_exports (id, created_by, created_at, invoice_count, row_count) VALUES ('x1', 'ada', '2026-10-02', 1, 1)").run();
    await env.DB.prepare("INSERT INTO erp_export_invoices (export_id, invoice_id) VALUES ('x1', 'inv-1')").run();
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await settle("cn-1");
    expect((await creditsFor(env.DB, "cn-1")).credit).toMatchObject({ state: "credited", afterPayment: true });
    expect(await status("inv-1")).toBe("credited");

    await doc("inv-r", { "BT-1": "INV-R", "BT-112": 80 }, { status: "returned_manually" });
    await doc("cn-r", { "BT-1": "CN-R", "BT-3": "381", "BT-25": "INV-R", "BT-112": 80 });
    await settle("cn-r");
    expect(await status("inv-r")).toBe("credited");
  });

  it("is decided once: reading the credit note again changes nothing", async () => {
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await settle("cn-1");
    await handlePutCreditNoteConfig(env.DB, "ada", { fullUnpaid: "take_out" });
    await settle("cn-1");
    expect(await state("cn-1")).toBe("to_confirm");
    expect(await status("inv-1")).toBe("in_progress");
  });

  it("says so on both Timelines", async () => {
    await handlePutCreditNoteConfig(env.DB, "ada", { fullUnpaid: "take_out" });
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await settle("cn-1");
    const actions = async (id: string) => ((await handleGetActivity(env.DB, id)).body as { items: Array<{ action?: string; invoiceNumber?: string }> }).items.filter((i) => i.action?.startsWith("credit"));
    expect(await actions("cn-1")).toMatchObject([{ action: "credit_credited", invoiceNumber: "INV-1" }]);
    expect(await actions("inv-1")).toMatchObject([{ action: "credited_by", invoiceNumber: "CN-1" }]);
  });
});

describe("AP Setup › Credit Notes", () => {
  it("answers the settings and the teams; refuses a value it does not know or a team that does not exist", async () => {
    await env.DB.prepare("UPDATE credit_note_config SET confirm_team_id = NULL").run();
    expect((await handleGetCreditNoteConfig(env.DB)).body).toEqual({
      config: { fullUnpaid: "confirm", partial: "pay", notFound: "review", confirmTeamId: null, networkAllowed: true },
      teams: [{ id: "ap-team", name: "AP Review" }],
    });
    expect((await handlePutCreditNoteConfig(env.DB, "ada", { partial: "later" as never })).status).toBe(400);
    expect((await handlePutCreditNoteConfig(env.DB, "ada", { confirmTeamId: "nobody" })).status).toBe(400);
    const saved = await handlePutCreditNoteConfig(env.DB, "ada", { confirmTeamId: "ap-team", networkAllowed: false });
    expect(saved.body).toMatchObject({ config: { confirmTeamId: "ap-team", networkAllowed: false } });
  });

  it("with no team chosen, an administrator confirms; with one, its members (and administrators)", async () => {
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 120 });
    await settle("cn-1");
    await env.DB.prepare("UPDATE credit_note_config SET confirm_team_id = NULL").run();
    expect(((await handleListCreditsToConfirm(env.DB, "rui")).body as { mayConfirm: boolean }).mayConfirm).toBe(false);
    expect(((await handleListCreditsToConfirm(env.DB, "ada")).body as { mayConfirm: boolean }).mayConfirm).toBe(true);
    await handlePutCreditNoteConfig(env.DB, "ada", { confirmTeamId: "ap-team" });
    expect(((await handleListCreditsToConfirm(env.DB, "rui")).body as { mayConfirm: boolean }).mayConfirm).toBe(true);
  });
});

/** **Credit notes and purchase orders — decision 0733.** */
describe("against a purchase order", () => {
  it("a credit note gives back what it credits; one whose invoice is Credited counts for nothing, as the invoice does", async () => {
    const { loadPoConsumption } = await import("../src/po-matching.js");
    await env.DB.prepare("UPDATE invoice_headers SET facts_json = json_set(facts_json, '$.\"BT-13\"', 'PO-1') WHERE id = 'inv-1'").run();
    await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-1', 1, ?)").bind(JSON.stringify({ "BT-132": "1", "BT-129": 2, "BT-131": 100 })).run();
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-13": "PO-1", "BT-112": 24 });
    await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('cn-1', 1, ?)").bind(JSON.stringify({ "BT-132": "1", "BT-129": 1, "BT-131": 20 })).run();
    await settle("cn-1"); // In part, paid and netted (the default).
    const netted = await loadPoConsumption(env.DB, "PO-1", null);
    expect(netted.headerAmount).toBeCloseTo(96);
    expect(netted.byLine.get(1)).toEqual({ quantity: 1, amount: 80 });

    await env.DB.prepare("UPDATE credit_notes SET state = 'credited'").run();
    await env.DB.prepare("UPDATE process_instances SET status = 'credited' WHERE subject_id = 'inv-1'").run();
    const credited = await loadPoConsumption(env.DB, "PO-1", null);
    expect(credited.headerAmount).toBe(0);
    expect(credited.byLine.get(1) ?? { quantity: 0, amount: 0 }).toEqual({ quantity: 0, amount: 0 });
  });

  it("one that names only the invoice it credits gives back on that invoice's PO (Dan, 12 October)", async () => {
    const { loadPoConsumption } = await import("../src/po-matching.js");
    await env.DB.prepare("UPDATE invoice_headers SET facts_json = json_set(facts_json, '$.\"BT-13\"', 'PO-1') WHERE id = 'inv-1'").run();
    await doc("cn-1", { "BT-1": "CN-1", "BT-3": "381", "BT-25": "INV-1", "BT-112": 24 });
    expect((await loadPoConsumption(env.DB, "PO-1", null)).headerAmount).toBeCloseTo(120);
    await settle("cn-1");
    expect((await loadPoConsumption(env.DB, "PO-1", null)).headerAmount).toBeCloseTo(96);
  });

  it("is not matched to the PO itself: no po.* facts, so no matching rule stops it", async () => {
    const { mergePoMatchFacts } = await import("../src/po-matching.js");
    const merged = await mergePoMatchFacts(env.DB, { "BT-3": "381", "BT-13": "PO-1", "BT-112": 24 }, [{ lineNumber: 1, "BT-132": "1", "BT-129": 1 }], { invoiceId: "nothing" });
    expect(Object.keys(merged.headerFacts).filter((k) => k.startsWith("po."))).toEqual([]);
    expect(Object.keys(merged.lines[0]).filter((k) => k.startsWith("po."))).toEqual([]);
    const invoice = await mergePoMatchFacts(env.DB, { "BT-3": "380", "BT-13": "PO-1", "BT-112": 24 }, [{ lineNumber: 1, "BT-132": "1", "BT-129": 1 }], { invoiceId: "nothing" });
    expect(invoice.headerFacts["po.matched"]).toBeDefined();
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";
import { handleSetFieldVisibility } from "../src/field-visibility-route.js";
import { checkLineCoding, mergeCodingValidityFacts } from "../src/coding-validation.js";
import { loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";
import { validateInvoiceFacts } from "../src/validation.js";
import { resolveApprovalTargets } from "../src/approval-hierarchy.js";

/**
 * Coding values checked against Account Coding's own lists — decision
 * 0511.
 *
 * Three questions the operator answered directly: a keyed value that
 * fails is **refused**; the links between lists (company code,
 * Commodity Code) are **enforced**, strictly for General Ledger Code
 * and leniently for Cost Centre; and a supplier's own BT-133 that fails
 * is **kept and flagged**, never refused.
 */

async function seedInvoice(id: string, orgUnitId: string | null, lines: Record<string, unknown>[] = []) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1)"
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, '{}', ?)")
    .bind(id, orgUnitId)
    .run();
  for (const [index, facts] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, ?, ?)")
      .bind(id, index + 1, JSON.stringify(facts))
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
     VALUES (?, 'ap', 'invoice', ?, 'coding')`
  )
    .bind(`pi-${id}`, id)
    .run();
}

async function link(owner: string, ownerId: string, filter: string, filterId: string) {
  await env.DB.prepare(
    `INSERT INTO coding_list_entry_filters (owner_list_type_id, owner_entry_id, filter_list_type_id, filter_entry_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(owner, ownerId, filter, filterId)
    .run();
}

const key = (invoiceId: string, lineFacts: Record<string, unknown>, headerFacts: Record<string, unknown> = {}) =>
  handleKeyInvoiceFields(
    env.DB,
    invoiceId,
    { facts: headerFacts, lines: [{ lineNumber: 1, facts: lineFacts }] } as never,
    "u-dan"
  );

type Refusal = {
  reason: string;
  error: string;
  invalid: { line: number | null; field: string; value: string; reason: string }[];
};

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan Y.')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK'), ('DE01', 'Acme DE')").run();
  await handleSetFieldVisibility(env.DB, {
    fields: [
      { field: "BT-133", visibility: "edit" },
      { field: "BT-131", visibility: "edit" },
      { field: "coding.project", visibility: "edit" },
      { field: "coding.commodity_code", visibility: "edit" },
      { field: "coding.gl_code", visibility: "edit" },
    ],
  });
  await env.DB.prepare(
    "INSERT INTO cost_centres (id, name) VALUES ('cc-uk', 'UK Marketing'), ('cc-de', 'DE Marketing'), ('cc-any', 'Unlinked')"
  ).run();
  await link("cost_centre", "cc-uk", "company_code", "UK01");
  await link("cost_centre", "cc-de", "company_code", "DE01");
  await env.DB.prepare(
    `INSERT INTO coding_list_entries (list_type_id, id, name) VALUES
       ('project', 'PRJ-1', 'Fit-out'),
       ('commodity_code', 'CM-STAT', 'Stationery'),
       ('commodity_code', 'CM-IT', 'IT'),
       ('gl_code', 'GL-6000', 'Office supplies'),
       ('gl_code', 'GL-7000', 'IT equipment'),
       ('gl_code', 'GL-NOCO', 'No company set')`
  ).run();
  await link("gl_code", "GL-6000", "company_code", "UK01");
  await link("gl_code", "GL-6000", "commodity_code", "CM-STAT");
  await link("gl_code", "GL-7000", "company_code", "UK01");
  await link("gl_code", "GL-7000", "commodity_code", "CM-IT");
  await link("gl_code", "GL-NOCO", "commodity_code", "CM-STAT");
});

describe("keying — a coded value must be on Account Coding's own list (decision 0511)", () => {
  it("refuses a Project that is not on the list, naming the line, field and reason, and writes nothing", async () => {
    await seedInvoice("inv-1", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-1", { "coding.project": "PRJ-TYPO" });

    expect(result.status).toBe(422);
    const body = result.body as Refusal;
    expect(body.reason).toBe("invalid_coding");
    expect(body.invalid).toEqual([{ line: 1, field: "coding.project", value: "PRJ-TYPO", reason: "not_on_list" }]);
    expect(body.error).toContain("line 1 coding.project");

    const trail = await env.DB.prepare("SELECT count(*) AS n FROM keyed_fields WHERE invoice_id = 'inv-1'").first<{
      n: number;
    }>();
    expect(trail?.n).toBe(0);
    const line = await env.DB.prepare("SELECT facts_json FROM invoice_lines WHERE invoice_id = 'inv-1'").first<{
      facts_json: string;
    }>();
    expect(JSON.parse(line!.facts_json)["coding.project"]).toBeUndefined();
  });

  it("accepts a value that is on the list", async () => {
    await seedInvoice("inv-2", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-2", { "coding.project": "PRJ-1" });
    expect(result.status).toBe(200);
  });

  it("refuses a Cost Centre that is not on the list", async () => {
    await seedInvoice("inv-3", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-3", { "BT-133": "cc-nope" });
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid[0]).toMatchObject({ field: "BT-133", reason: "not_on_list" });
  });

  it("refuses a Cost Centre linked only to a different company", async () => {
    await seedInvoice("inv-4", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-4", { "BT-133": "cc-de" });
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid[0]).toMatchObject({ field: "BT-133", reason: "wrong_company" });
  });

  it("accepts a Cost Centre linked to the invoice's company, and — leniently — one linked to no company at all", async () => {
    await seedInvoice("inv-5", "UK01", [{ "BT-131": 10 }]);
    expect((await key("inv-5", { "BT-133": "cc-uk" })).status).toBe(200);
    expect((await key("inv-5", { "BT-133": "cc-any" })).status).toBe(200);
  });

  it("applies no company link at all when the invoice has not been placed in an org, exactly as the picker does", async () => {
    await seedInvoice("inv-6", null, [{ "BT-131": 10 }]);
    expect((await key("inv-6", { "BT-133": "cc-de" })).status).toBe(200);
  });

  it("refuses a General Ledger Code not linked to the line's Commodity Code", async () => {
    await seedInvoice("inv-7", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-7", { "coding.commodity_code": "CM-STAT", "coding.gl_code": "GL-7000" });
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid).toEqual([
      { line: 1, field: "coding.gl_code", value: "GL-7000", reason: "wrong_commodity" },
    ]);
  });

  it("is strict for General Ledger Code: one with no company link is refused once the invoice has a company", async () => {
    await seedInvoice("inv-8", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-8", { "coding.commodity_code": "CM-STAT", "coding.gl_code": "GL-NOCO" });
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid[0]).toMatchObject({ field: "coding.gl_code", reason: "wrong_company" });
  });

  it("accepts a General Ledger Code linked to both the company and the Commodity Code", async () => {
    await seedInvoice("inv-9", "UK01", [{ "BT-131": 10 }]);
    const result = await key("inv-9", { "coding.commodity_code": "CM-STAT", "coding.gl_code": "GL-6000" });
    expect(result.status).toBe(200);
  });

  it("re-checks the stored General Ledger Code when only the Commodity Code changes", async () => {
    await seedInvoice("inv-10", "UK01", [{ "BT-131": 10, "coding.commodity_code": "CM-STAT", "coding.gl_code": "GL-6000" }]);
    const result = await key("inv-10", { "coding.commodity_code": "CM-IT" });
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid[0]).toMatchObject({ field: "coding.gl_code", reason: "wrong_commodity" });
  });

  it("does not refuse an untouched, already-invalid supplier BT-133 resent with an unrelated change — and still reports it", async () => {
    // The viewer resends every editable line field on every save
    // (decision 0109); a supplier's own cbc:AccountingCost must not
    // block somebody correcting the amount beside it.
    await seedInvoice("inv-11", "UK01", [{ "BT-131": 10, "BT-133": "SUPPLIER-REF-9" }]);
    const result = await key("inv-11", { "BT-131": 12, "BT-133": "SUPPLIER-REF-9" });

    expect(result.status).toBe(200);
    const validation = (result.body as {
      validation: { failures: string[]; involves?: { check: string; fields: string[]; line?: number; severity: string }[] };
    }).validation;
    expect(validation.failures).toContain("account_coding");
    expect(validation.involves).toContainEqual(
      expect.objectContaining({ check: "account_coding", fields: ["BT-133"], line: 1, severity: "danger" })
    );
  });

  it("checks coding keyed on the header too, since header facts reach every line", async () => {
    await seedInvoice("inv-12", "UK01", [{ "BT-131": 10 }]);
    const result = await handleKeyInvoiceFields(env.DB, "inv-12", { facts: { "BT-133": "cc-nope" } } as never, "u-dan");
    expect(result.status).toBe(422);
    expect((result.body as Refusal).invalid[0]).toMatchObject({ line: null, field: "BT-133", reason: "not_on_list" });
  });
});

describe("coding.line_invalid — the flag half (decision 0511)", () => {
  it("names the failing fields, is empty for a clean line, and skips nothing-coded fields", async () => {
    const lines = await mergeCodingValidityFacts(env.DB, "UK01", [
      { lineNumber: 1, "BT-133": "cc-uk", "coding.project": "PRJ-1" },
      { lineNumber: 2, "BT-133": "SUPPLIER-REF", "coding.project": "PRJ-1" },
      { lineNumber: 3, "BT-133": "" },
    ] as never);
    expect(lines.map((l) => l["coding.line_invalid"])).toEqual(["", "BT-133", ""]);
  });

  it("reaches every stage re-evaluation through loadLiveInvoiceFacts", async () => {
    await seedInvoice("inv-live", "UK01", [{ "BT-131": 10, "BT-133": "SUPPLIER-REF" }, { "BT-131": 5, "BT-133": "cc-uk" }]);
    const live = await loadLiveInvoiceFacts(env.DB, "inv-live");
    expect(live!.lines.map((l) => (l as Record<string, unknown>)["coding.line_invalid"])).toEqual(["BT-133", ""]);
  });

  it("becomes the account_coding validation check, at danger severity", async () => {
    const lines = await mergeCodingValidityFacts(env.DB, "UK01", [{ lineNumber: 1, "BT-133": "SUPPLIER-REF" }] as never);
    const verdict = validateInvoiceFacts({ "BT-112": 10 } as never, lines);
    expect(verdict.checked).toContain("account_coding");
    expect(verdict.failures).toContain("account_coding");
    expect(verdict.involves).toContainEqual({
      check: "account_coding",
      fields: ["BT-133"],
      line: 1,
      value: "SUPPLIER-REF",
      severity: "danger",
    });
  });

  it("does not report the check as run when nothing computed coding.line_invalid", () => {
    const verdict = validateInvoiceFacts({ "BT-112": 10 } as never, [{ "BT-133": "anything" }] as never);
    expect(verdict.checked).not.toContain("account_coding");
  });

  it("checkLineCoding's `only` limits the check to the named fields", async () => {
    const problems = await checkLineCoding(
      env.DB,
      "UK01",
      { "BT-133": "SUPPLIER-REF", "coding.project": "PRJ-1" },
      new Set(["coding.project"])
    );
    expect(problems).toEqual([]);
  });
});

describe("approval routing names a value not on the list (decision 0511)", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'cost_object', default_approver_user_id = 'u-dan' WHERE id = 1").run();
    await env.DB.prepare("UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'").run();
  });

  const params = (overrides: Record<string, unknown>) => ({
    instanceId: "inv-1",
    processId: "ap",
    currentSequence: 2,
    processVersion: 1,
    lineNumber: 1,
    unitId: null,
    currency: "EUR",
    amount: 100,
    costCentreId: null,
    ...overrides,
  });

  it("says a Cost Centre is not on the list, rather than that its chain ran out uncovered", async () => {
    const resolutions = await resolveApprovalTargets(env.DB, params({ costCentreId: "SUPPLIER-REF" }) as never);
    expect(resolutions).toEqual([
      {
        targetUserId: "u-dan",
        reasoning: "The cost centre value SUPPLIER-REF is not on the Account Coding list. Sent to the configured Default Approver.",
      },
    ]);
  });

  it("says the same of any other dimension", async () => {
    const resolutions = await resolveApprovalTargets(env.DB, params({ costObjectValues: { project: "PRJ-TYPO" } }) as never);
    expect((resolutions[0] as { reasoning: string }).reasoning).toContain("PRJ-TYPO is not on the Account Coding list");
  });
});

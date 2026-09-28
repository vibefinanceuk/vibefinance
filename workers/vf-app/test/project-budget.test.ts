import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleProjectUsage, projectSpendByOthers } from "../src/project-budget.js";
import { loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";
import { handleSetFieldVisibility } from "../src/field-visibility-route.js";

/**
 * A project's budget and status — decision 0542. PRJ-1 has a budget of
 * 1,000; two other invoices have used 700 of it, one more was returned
 * to its supplier and never counts.
 */

async function invoice(id: string, lines: Record<string, unknown>[], status: string | null = "in_progress") {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(id).run();
  for (const [i, facts] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, JSON.stringify(facts))
      .run();
  }
  if (status) {
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'coding', ?)"
    )
      .bind(`pi-${id}`, id, status)
      .run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1)").run();
  await env.DB.prepare(
    `INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare(
    `INSERT INTO coding_list_entries (list_type_id, id, name, budget_amount) VALUES ('project', 'PRJ-1', 'Fit-out', 1000), ('project', 'PRJ-NB', 'No budget', NULL)`
  ).run();
  await env.DB.prepare("INSERT INTO coding_list_entries (list_type_id, id, name, status) VALUES ('project', 'PRJ-OLD', 'Finished', 'closed')").run();
  await invoice("inv-a", [{ "BT-131": 400, "coding.project": "PRJ-1" }, { "BT-131": 999, "coding.project": "PRJ-NB" }]);
  await invoice("inv-b", [{ "BT-131": "300", "coding.project": "PRJ-1" }]);
  await invoice("inv-returned", [{ "BT-131": 5000, "coding.project": "PRJ-1" }], "returned_manually");
});

describe("a project's budget (decision 0542)", () => {
  it("counts every other invoice's lines coded to it, never this one's, and never a returned invoice's", async () => {
    expect(await projectSpendByOthers(env.DB, "PRJ-1", null)).toBe(700);
    expect(await projectSpendByOthers(env.DB, "PRJ-1", "inv-a")).toBe(300);
  });

  it("tells the Coding pop-out the budget and what other invoices have used", async () => {
    await invoice("inv-t", [{ "BT-131": 100 }]);
    expect(await handleProjectUsage(env.DB, "inv-t", "PRJ-1")).toEqual({
      status: 200,
      body: { projectId: "PRJ-1", name: "Fit-out", status: "active", budget: 1000, usedByOthers: 700 },
    });
    expect((await handleProjectUsage(env.DB, "inv-t", "PRJ-NB")).body).toMatchObject({ budget: null, usedByOthers: null });
    expect((await handleProjectUsage(env.DB, "inv-t", "NOPE")).status).toBe(404);
    expect((await handleProjectUsage(env.DB, "inv-t", null)).status).toBe(400);
  });

  it("gives rules project.over_budget and project.budget_used_pct, this invoice's lines counted together", async () => {
    await invoice("inv-t", [
      { "BT-131": 200, "coding.project": "PRJ-1" },
      { "BT-131": 150, "coding.project": "PRJ-1" },
      { "BT-131": 50, "coding.project": "PRJ-NB" },
      { "BT-131": 50 },
    ]);
    const lines = (await loadLiveInvoiceFacts(env.DB, "inv-t"))!.lines;
    // 700 by others + 350 here = 1,050 of 1,000.
    expect(lines.map((l) => [l["project.over_budget"], l["project.budget_used_pct"]])).toEqual([
      [true, 105],
      [true, 105],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("is not over while within the budget", async () => {
    await invoice("inv-t", [{ "BT-131": 300, "coding.project": "PRJ-1" }]);
    const line = (await loadLiveInvoiceFacts(env.DB, "inv-t"))!.lines[0];
    expect([line["project.over_budget"], line["project.budget_used_pct"]]).toEqual([false, 100]);
  });
});

describe("a closed project (decision 0542)", () => {
  beforeEach(async () => {
    await handleSetFieldVisibility(env.DB, { fields: [{ field: "BT-131", visibility: "edit" }, { field: "coding.project", visibility: "edit" }] });
    await invoice("inv-t", [{ "BT-131": 10 }]);
  });

  it("refuses a save coding a line to it", async () => {
    const refused = await handleKeyInvoiceFields(env.DB, "inv-t", { facts: {}, lines: [{ lineNumber: 1, facts: { "coding.project": "PRJ-OLD" } }] } as never, "u-dan");
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ reason: "invalid_coding", invalid: [{ line: 1, field: "coding.project", value: "PRJ-OLD", reason: "closed" }] });
    expect((refused.body as { error: string }).error).toContain("is closed");
  });

  it("flags a line still coded to it once it closes", async () => {
    await env.DB.prepare("UPDATE invoice_lines SET facts_json = ? WHERE invoice_id = 'inv-t'").bind(JSON.stringify({ "BT-131": 10, "coding.project": "PRJ-1" })).run();
    expect((await loadLiveInvoiceFacts(env.DB, "inv-t"))!.lines[0]["coding.line_invalid"]).toBe("");
    await env.DB.prepare("UPDATE coding_list_entries SET status = 'closed' WHERE id = 'PRJ-1'").run();
    expect((await loadLiveInvoiceFacts(env.DB, "inv-t"))!.lines[0]["coding.line_invalid"]).toBe("coding.project");
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUpdateCostCentre, handleListCostCentresDetailed } from "../src/ledger-route.js";
import { handleListCodingListEntries } from "../src/coding-list-route.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";
import { handleSetFieldVisibility } from "../src/field-visibility-route.js";
import { loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";

/**
 * GL codes allowed for a cost centre — decision 0543. Marketing is
 * linked to 6100 and 6200; IT has no links, so it takes any GL code.
 */
beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc-mkt', 'Marketing'), ('cc-it', 'IT')").run();
  await env.DB.prepare(
    `INSERT INTO coding_list_entries (list_type_id, id, name) VALUES
       ('gl_code', '6100', 'Advertising'), ('gl_code', '6200', 'Events'), ('gl_code', '7100', 'Software')`
  ).run();
  expect((await handleUpdateCostCentre(env.DB, "cc-mkt", { glCodes: ["6100", "6200"] })).status).toBe(200);
});

describe("which GL codes a cost centre may be charged with (decision 0543)", () => {
  it("is set in AP Setup as a list, shown with each cost centre, and can be emptied again", async () => {
    const list = async () =>
      ((await handleListCostCentresDetailed(env.DB)).body as { costCentres: { id: string; glCodes: { id: string; name: string }[] }[] }).costCentres;
    expect((await list()).map((c) => [c.id, c.glCodes])).toEqual([
      ["cc-it", []],
      ["cc-mkt", [{ id: "6100", name: "Advertising" }, { id: "6200", name: "Events" }]],
    ]);
    await handleUpdateCostCentre(env.DB, "cc-mkt", { glCodes: [] });
    expect((await list()).find((c) => c.id === "cc-mkt")?.glCodes).toEqual([]);
  });

  it("refuses a GL code Account Coding doesn't hold, and anything but a list", async () => {
    expect((await handleUpdateCostCentre(env.DB, "cc-it", { glCodes: ["9999"] })).status).toBe(404);
    expect((await handleUpdateCostCentre(env.DB, "cc-it", { glCodes: "6100" })).status).toBe(400);
  });

  it("offers only the linked GL codes for a cost centre with links, and every one for a cost centre without", async () => {
    const offered = async (cc: string) =>
      ((await handleListCodingListEntries(env.DB, "gl_code", null, null, null, true, { cost_centre: cc })).body as { entries: { id: string }[] }).entries.map(
        (e) => e.id
      );
    expect(await offered("cc-mkt")).toEqual(["6100", "6200"]);
    expect(await offered("cc-it")).toEqual(["6100", "6200", "7100"]);
  });

  describe("on an invoice line", () => {
    beforeEach(async () => {
      await handleSetFieldVisibility(env.DB, {
        fields: [
          { field: "BT-131", visibility: "edit" },
          { field: "BT-133", visibility: "edit" },
          { field: "coding.gl_code", visibility: "edit" },
        ],
      });
      await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
      await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1)").run();
      await env.DB.prepare(
        `INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
         SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
      ).run();
      await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
      await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES ('l1', 'inv-1', 1, ?)").bind(JSON.stringify({ "BT-131": 10 })).run();
      await env.DB.prepare(
        "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id) VALUES ('pi-1', 'ap', 'invoice', 'inv-1', 'coding')"
      ).run();
    });
    const key = (facts: Record<string, unknown>) =>
      handleKeyInvoiceFields(env.DB, "inv-1", { facts: {}, lines: [{ lineNumber: 1, facts }] } as never, "u-dan");

    it("refuses a GL code the line's cost centre isn't linked to, and accepts a linked one", async () => {
      const refused = await key({ "BT-133": "cc-mkt", "coding.gl_code": "7100" });
      expect(refused).toMatchObject({ status: 422, body: { reason: "invalid_coding", invalid: [{ line: 1, field: "coding.gl_code", value: "7100", reason: "wrong_cost_centre" }] } });
      expect((refused.body as { error: string }).error).toContain("is not allowed for the line's Cost Centre");
      expect((await key({ "BT-133": "cc-mkt", "coding.gl_code": "6100" })).status).toBe(200);
    });

    it("accepts any GL code with a cost centre that has no links", async () => {
      expect((await key({ "BT-133": "cc-it", "coding.gl_code": "7100" })).status).toBe(200);
    });

    it("re-checks the GL code when only the cost centre changes", async () => {
      expect((await key({ "BT-133": "cc-it", "coding.gl_code": "7100" })).status).toBe(200);
      const refused = await key({ "BT-133": "cc-mkt" });
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ invalid: [{ field: "coding.gl_code", reason: "wrong_cost_centre" }] });
    });

    it("flags a line whose GL code stops being allowed when links are added", async () => {
      expect((await key({ "BT-133": "cc-it", "coding.gl_code": "7100" })).status).toBe(200);
      expect((await loadLiveInvoiceFacts(env.DB, "inv-1"))!.lines[0]["coding.line_invalid"]).toBe("");
      await handleUpdateCostCentre(env.DB, "cc-it", { glCodes: ["6100"] });
      expect((await loadLiveInvoiceFacts(env.DB, "inv-1"))!.lines[0]["coding.line_invalid"]).toBe("coding.gl_code");
    });
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetCodingListCsvFormat, handleLoadCodingListCsv } from "../src/coding-list-csv-route.js";

/**
 * CSV Template and Load for Account Coding — decision 0445. Cost
 * Centre, Project, Commodity Code, and General Ledger Code — not
 * Company code, confirmed directly with the operator.
 */

async function seedUser(id = "approver-1", email = `${id}@acme.com`, name = "Ada") {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, email, name).run();
}

async function seedUnit(id = "UK01", name = "Acme UK") {
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES (?, ?)").bind(id, name).run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleGetCodingListCsvFormat", () => {
  it("404s an unknown or company_code list type", async () => {
    expect((await handleGetCodingListCsvFormat(env.DB, "widget")).status).toBe(404);
    expect((await handleGetCodingListCsvFormat(env.DB, "company_code")).status).toBe(404);
  });

  it("project has the base fields and no filter columns", async () => {
    const result = await handleGetCodingListCsvFormat(env.DB, "project");
    expect(result.status).toBe(200);
    const fields = (result.body as { fields: { key: string }[] }).fields;
    expect(fields.map((f) => f.key)).toEqual(["id", "name", "is_default", "approver_email", "parent_entry_id"]);
  });

  it("gl_code adds both declared filter columns", async () => {
    const result = await handleGetCodingListCsvFormat(env.DB, "gl_code");
    const fields = (result.body as { fields: { key: string; columns: string[] }[] }).fields;
    // Filter columns come from a set (coding_list_type_filters), not an
    // ordered list — both are present, order between them is not
    // semantically meaningful.
    expect(fields.map((f) => f.key).slice(0, 5)).toEqual(["id", "name", "is_default", "approver_email", "parent_entry_id"]);
    expect(fields.map((f) => f.key).slice(5).sort()).toEqual(["filter_commodity_code", "filter_company_code"].sort());
    const companyFilter = fields.find((f) => f.key === "filter_company_code")!;
    expect(companyFilter.columns[0]).toBe("filter by - company code");
  });

  it("cost_centre gets the same base shape as the other three — 'Approver,' not 'Owner'", async () => {
    const result = await handleGetCodingListCsvFormat(env.DB, "cost_centre");
    const fields = (result.body as { fields: { key: string; columns: string[] }[] }).fields;
    expect(fields.map((f) => f.key)).toEqual(["id", "name", "is_default", "approver_email", "parent_entry_id", "filter_company_code"]);
    const approver = fields.find((f) => f.key === "approver_email")!;
    expect(approver.columns).toContain("approver");
    expect(approver.columns).toContain("owner");
  });
});

function csv(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\n");
}

describe("handleLoadCodingListCsv — structural refusals", () => {
  it("404s an unknown or company_code list type", async () => {
    expect((await handleLoadCodingListCsv(env.DB, "widget", "id,name\n1,One")).status).toBe(404);
    expect((await handleLoadCodingListCsv(env.DB, "company_code", "id,name\n1,One")).status).toBe(404);
  });

  it("400s a file with no header row or entries", async () => {
    const result = await handleLoadCodingListCsv(env.DB, "project", "id,name");
    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("no_rows");
  });

  it("400s a file with no id column", async () => {
    const result = await handleLoadCodingListCsv(env.DB, "project", csv([["name"], ["One"]]));
    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("no_id_column");
  });

  it("400s a file with no name column", async () => {
    const result = await handleLoadCodingListCsv(env.DB, "project", csv([["id"], ["p1"]]));
    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("no_name_column");
  });

  it("400s the whole file on a duplicate id", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name"],
        ["p1", "One"],
        ["p1", "One again"],
      ])
    );
    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("duplicate_id");
  });
});

describe("handleLoadCodingListCsv — project (a genuinely greenfield list)", () => {
  it("creates new entries, accepting 'Path' as an alias for name", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "path", "default"],
        ["p1", "Project One", "yes"],
        ["p2", "Project Two", ""],
      ])
    );
    expect(result.status).toBe(200);
    const body = result.body as { entriesCreated: number; entriesUpdated: number; refused: unknown[] };
    expect(body.entriesCreated).toBe(2);
    expect(body.entriesUpdated).toBe(0);
    expect(body.refused).toEqual([]);

    const row = await env.DB.prepare("SELECT name, is_default FROM coding_list_entries WHERE list_type_id='project' AND id='p1'").first<{
      name: string;
      is_default: number;
    }>();
    expect(row?.name).toBe("Project One");
    expect(row?.is_default).toBe(1);
  });

  it("a second load updates every field the file describes — full replace, not merge", async () => {
    await seedUser();
    await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name"], ["p1", "Project One"]]));

    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([["id", "name", "default", "approver"], ["p1", "Project One Renamed", "true", "approver-1@acme.com"]])
    );
    expect(result.status).toBe(200);
    const body = result.body as { entriesCreated: number; entriesUpdated: number };
    expect(body.entriesCreated).toBe(0);
    expect(body.entriesUpdated).toBe(1);

    const row = await env.DB.prepare(
      "SELECT name, is_default, approver_user_id FROM coding_list_entries WHERE list_type_id='project' AND id='p1'"
    ).first<{ name: string; is_default: number; approver_user_id: string }>();
    expect(row?.name).toBe("Project One Renamed");
    expect(row?.is_default).toBe(1);
    expect(row?.approver_user_id).toBe("approver-1");
  });

  it("a blank approver column on a re-load clears a previously-set approver — full replace", async () => {
    await seedUser();
    await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name", "approver"], ["p1", "Project One", "approver-1@acme.com"]]));

    await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name", "approver"], ["p1", "Project One", ""]]));

    const row = await env.DB.prepare("SELECT approver_user_id FROM coding_list_entries WHERE list_type_id='project' AND id='p1'").first<{
      approver_user_id: string | null;
    }>();
    expect(row?.approver_user_id).toBeNull();
  });

  it("refuses a row whose approver email does not exist, per row rather than the whole file", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name", "approver"],
        ["p1", "Project One", "nobody@acme.com"],
        ["p2", "Project Two", ""],
      ])
    );
    expect(result.status).toBe(200);
    const body = result.body as { entriesCreated: number; refused: { id: string; reason: string }[] };
    expect(body.entriesCreated).toBe(1); // p2 still loads
    expect(body.refused).toEqual([{ id: "p1", reason: "approver email nobody@acme.com does not exist" }]);
  });

  it("refuses a row with an unrecognised default value", async () => {
    const result = await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name", "default"], ["p1", "Project One", "maybe"]]));
    const body = result.body as { refused: { id: string; reason: string }[] };
    expect(body.refused).toEqual([{ id: "p1", reason: 'default must be true/false, yes/no, y/n, or 1/0 — got "maybe"' }]);
  });

  it("accepts every documented spelling of a Y/N default value", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name", "default"],
        ["p1", "One", "Y"],
        ["p2", "Two", "1"],
        ["p3", "Three", "true"],
        ["p4", "Four", "N"],
        ["p5", "Five", "0"],
      ])
    );
    expect((result.body as { refused: unknown[] }).refused).toEqual([]);
    const rows = await env.DB.prepare("SELECT id, is_default FROM coding_list_entries WHERE list_type_id='project' ORDER BY id").all<{
      id: string;
      is_default: number;
    }>();
    expect(rows.results.map((r) => [r.id, r.is_default])).toEqual([
      ["p1", 1],
      ["p2", 1],
      ["p3", 1],
      ["p4", 0],
      ["p5", 0],
    ]);
  });

  it("loads a child before its own parent in the file, correctly, via the phase-two pass", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name", "parent entry id"],
        ["child", "Child", "parent"],
        ["parent", "Parent", ""],
      ])
    );
    expect(result.status).toBe(200);
    expect((result.body as { refused: unknown[] }).refused).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT parent_entry_id FROM coding_list_entries WHERE list_type_id='project' AND id='child'"
    ).first<{ parent_entry_id: string }>();
    expect(row?.parent_entry_id).toBe("parent");
  });

  it("refuses a row that would create a cycle, phase two catching it against live state", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name", "parent entry id"],
        ["a", "A", "b"],
        ["b", "B", "a"],
      ])
    );
    const body = result.body as { refused: { id: string; reason: string }[] };
    expect(body.refused.length).toBe(1);
    expect(body.refused[0].reason).toMatch(/cycle/);
  });

  it("a blank parent on a re-load clears a previously-set parent", async () => {
    await handleLoadCodingListCsv(
      env.DB,
      "project",
      csv([
        ["id", "name", "parent entry id"],
        ["parent", "Parent", ""],
        ["child", "Child", "parent"],
      ])
    );
    await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name", "parent entry id"], ["child", "Child", ""]]));

    const row = await env.DB.prepare(
      "SELECT parent_entry_id FROM coding_list_entries WHERE list_type_id='project' AND id='child'"
    ).first<{ parent_entry_id: string | null }>();
    expect(row?.parent_entry_id).toBeNull();
  });

  it("leaves an id absent from the file completely untouched — never destructive across rows", async () => {
    await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name"], ["keep", "Kept"]]));
    const result = await handleLoadCodingListCsv(env.DB, "project", csv([["id", "name"], ["other", "Other"]]));
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT name FROM coding_list_entries WHERE list_type_id='project' AND id='keep'").first<{
      name: string;
    }>();
    expect(row?.name).toBe("Kept"); // still there, unaffected by a load that never mentioned it
  });
});

describe("handleLoadCodingListCsv — gl_code (the operator's own worked example)", () => {
  it("loads a GL code scoped to both a company code and a commodity code", async () => {
    await seedUnit("UK01", "Acme UK");
    await handleLoadCodingListCsv(env.DB, "commodity_code", csv([["id", "name"], ["10000000", "Live Plant and Animal Material"]]));

    const result = await handleLoadCodingListCsv(
      env.DB,
      "gl_code",
      csv([
        ["id", "name", "filter by - company code", "filter by - commodity code"],
        ["600100", "Cost of Goods Sold", "UK01", "10000000"],
      ])
    );
    expect(result.status).toBe(200);
    expect((result.body as { entriesCreated: number }).entriesCreated).toBe(1);

    const filters = await env.DB.prepare(
      "SELECT filter_list_type_id, filter_entry_id FROM coding_list_entry_filters WHERE owner_list_type_id='gl_code' AND owner_entry_id='600100' ORDER BY filter_list_type_id"
    ).all<{ filter_list_type_id: string; filter_entry_id: string }>();
    expect(filters.results).toEqual([
      { filter_list_type_id: "commodity_code", filter_entry_id: "10000000" },
      { filter_list_type_id: "company_code", filter_entry_id: "UK01" },
    ]);
  });

  it("refuses a row whose filter value does not exist", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "gl_code",
      csv([["id", "name", "filter by - company code"], ["600100", "Cost of Goods Sold", "NOPE"]])
    );
    const body = result.body as { refused: { id: string; reason: string }[] };
    expect(body.refused.length).toBe(1);
    expect(body.refused[0].reason).toMatch(/does not exist/);
  });
});

describe("handleLoadCodingListCsv — cost_centre (its own two real differences)", () => {
  it("creates a cost centre, ignoring a Default column value since the field does not exist for this type", async () => {
    const result = await handleLoadCodingListCsv(env.DB, "cost_centre", csv([["id", "name", "default"], ["CC1", "Marketing", "yes"]]));
    expect(result.status).toBe(200);
    expect((result.body as { refused: unknown[] }).refused).toEqual([]);
    const row = await env.DB.prepare("SELECT id, name FROM cost_centres WHERE id='CC1'").first();
    expect(row).toBeTruthy();
  });

  it("'Approver' resolves to owner_user_id for cost centre", async () => {
    await seedUser();
    const result = await handleLoadCodingListCsv(
      env.DB,
      "cost_centre",
      csv([["id", "name", "approver"], ["CC1", "Marketing", "approver-1@acme.com"]])
    );
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT owner_user_id FROM cost_centres WHERE id='CC1'").first<{ owner_user_id: string }>();
    expect(row?.owner_user_id).toBe("approver-1");
  });

  it("refuses, rather than silently ignoring, a re-load whose name disagrees with what is stored", async () => {
    await handleLoadCodingListCsv(env.DB, "cost_centre", csv([["id", "name"], ["CC1", "Marketing"]]));
    const result = await handleLoadCodingListCsv(env.DB, "cost_centre", csv([["id", "name"], ["CC1", "Marketing (Renamed)"]]));
    const body = result.body as { entriesUpdated: number; refused: { id: string; reason: string }[] };
    expect(body.entriesUpdated).toBe(0);
    expect(body.refused).toEqual([
      { id: "CC1", reason: 'cost centre name cannot be changed after creation (stored: "Marketing", file: "Marketing (Renamed)")' },
    ]);
  });

  it("scopes a cost centre by company code, and a re-load with a blank filter clears it", async () => {
    await seedUnit("UK01", "Acme UK");
    await handleLoadCodingListCsv(env.DB, "cost_centre", csv([["id", "name", "filter by - company code"], ["CC1", "Marketing", "UK01"]]));
    let filters = await env.DB.prepare(
      "SELECT filter_entry_id FROM coding_list_entry_filters WHERE owner_list_type_id='cost_centre' AND owner_entry_id='CC1'"
    ).all();
    expect(filters.results.length).toBe(1);

    await handleLoadCodingListCsv(env.DB, "cost_centre", csv([["id", "name", "filter by - company code"], ["CC1", "Marketing", ""]]));
    filters = await env.DB.prepare(
      "SELECT filter_entry_id FROM coding_list_entry_filters WHERE owner_list_type_id='cost_centre' AND owner_entry_id='CC1'"
    ).all();
    expect(filters.results.length).toBe(0);
  });

  it("loads a child cost centre before its own parent, via the phase-two pass", async () => {
    const result = await handleLoadCodingListCsv(
      env.DB,
      "cost_centre",
      csv([
        ["id", "name", "parent entry id"],
        ["child", "Child", "parent"],
        ["parent", "Parent", ""],
      ])
    );
    expect(result.status).toBe(200);
    expect((result.body as { refused: unknown[] }).refused).toEqual([]);
    const row = await env.DB.prepare("SELECT parent_cost_centre_id FROM cost_centres WHERE id='child'").first<{
      parent_cost_centre_id: string;
    }>();
    expect(row?.parent_cost_centre_id).toBe("parent");
  });
});

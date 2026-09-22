import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleListCodingListEntries,
  handleCreateCodingListEntry,
  handleUpdateCodingListEntry,
} from "../src/coding-list-route.js";

/**
 * Account Coding's own generic lists — decision 0444. Project,
 * Commodity Code, and General Ledger Code, the three genuinely
 * greenfield lists the operator's own example exports needed. Company
 * code (`org_units`) and Cost Centre (`cost_centres`) keep their own
 * existing routes, tested elsewhere.
 */

async function seedUser(id = "approver-1", name = "Ada") {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, name)
    .run();
}

async function seedUnit(id = "UK01", name = "Acme UK") {
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES (?, ?)").bind(id, name).run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleListCodingListEntries", () => {
  it("404s an unknown list type", async () => {
    const result = await handleListCodingListEntries(env.DB, "widget");
    expect(result.status).toBe(404);
  });

  it("starts empty, and says what filters this type declares", async () => {
    const result = await handleListCodingListEntries(env.DB, "gl_code");
    expect(result.status).toBe(200);
    expect((result.body as { entries: unknown[] }).entries).toEqual([]);
    expect((result.body as { declaredFilters: string[] }).declaredFilters.sort()).toEqual(["commodity_code", "company_code"]);
  });

  it("commodity_code and project declare no filters at all", async () => {
    const result = await handleListCodingListEntries(env.DB, "project");
    expect((result.body as { declaredFilters: string[] }).declaredFilters).toEqual([]);
  });
});

describe("handleCreateCodingListEntry", () => {
  it("404s an unknown list type", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "widget", { id: "w1", name: "Widget" });
    expect(result.status).toBe(404);
  });

  it("400s when id or name is missing", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1" });
    expect(result.status).toBe(400);
  });

  it("creates a real entry", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "DE01MJO", name: "Mjolner" });
    expect(result.status).toBe(201);
    const listed = await handleListCodingListEntries(env.DB, "project");
    expect((listed.body as { entries: { id: string; name: string }[] }).entries).toEqual([{
      id: "DE01MJO",
      name: "Mjolner",
      isDefault: false,
      approverUserId: null,
      approverName: null,
      parentEntryId: null,
      parentName: null,
      filters: [],
    }]);
  });

  it("409s on a duplicate id within the same list type", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "First" });
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Second" });
    expect(result.status).toBe(409);
  });

  it("the same id may exist in two different list types — they are not one namespace", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "10000000", name: "A project" });
    const result = await handleCreateCodingListEntry(env.DB, "commodity_code", { id: "10000000", name: "Live Plant & Animal Material" });
    expect(result.status).toBe(201);
  });

  it("builds a real hierarchy — the operator's own Project example, one level", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "DE01MJO", name: "Mjolner" });
    const result = await handleCreateCodingListEntry(env.DB, "project", {
      id: "DE01MJO.10",
      name: "Investigation",
      parentEntryId: "DE01MJO",
    });
    expect(result.status).toBe(201);
    const listed = await handleListCodingListEntries(env.DB, "project");
    const child = (listed.body as { entries: { id: string; parentEntryId: string | null; parentName: string | null }[] }).entries.find(
      (e) => e.id === "DE01MJO.10"
    );
    expect(child).toMatchObject({ parentEntryId: "DE01MJO", parentName: "Mjolner" });
  });

  it("404s a parent that does not exist", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Orphan", parentEntryId: "nope" });
    expect(result.status).toBe(404);
  });

  it("409s a self-parent", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Loop", parentEntryId: "p1" });
    expect(result.status).toBe(409);
  });

  it("404s an approver that does not exist", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", approverUserId: "nobody" });
    expect(result.status).toBe(404);
  });

  it("accepts a real approver", async () => {
    await seedUser();
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", approverUserId: "approver-1" });
    expect(result.status).toBe(201);
  });

  it("400s a filter this type does not declare", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", filters: { company_code: "UK01" } });
    expect(result.status).toBe(400);
  });

  it("the operator's own GL Code example — scoped to a real company code and commodity code", async () => {
    await seedUnit();
    await handleCreateCodingListEntry(env.DB, "commodity_code", { id: "10000000", name: "Live Plant & Animal Material" });
    const result = await handleCreateCodingListEntry(env.DB, "gl_code", {
      id: "800100",
      name: "Plant Suppliers",
      filters: { company_code: "UK01", commodity_code: "10000000" },
    });
    expect(result.status).toBe(201);
    const listed = await handleListCodingListEntries(env.DB, "gl_code");
    const entry = (listed.body as { entries: { id: string; filters: { filterListTypeId: string; filterEntryName: string | null }[] }[] }).entries[0];
    expect(entry.filters.sort((a, b) => a.filterListTypeId.localeCompare(b.filterListTypeId))).toEqual([
      { filterListTypeId: "commodity_code", filterEntryId: "10000000", filterEntryName: "Live Plant & Animal Material" },
      { filterListTypeId: "company_code", filterEntryId: "UK01", filterEntryName: "Acme UK" },
    ]);
  });

  it("404s a filter value that does not exist", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "G1", filters: { company_code: "nope" } });
    expect(result.status).toBe(404);
  });
});

describe("handleUpdateCodingListEntry", () => {
  it("404s an entry that does not exist", async () => {
    const result = await handleUpdateCodingListEntry(env.DB, "project", "nope", { name: "X" });
    expect(result.status).toBe(404);
  });

  it("400s an entirely empty update", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1" });
    const result = await handleUpdateCodingListEntry(env.DB, "project", "p1", {});
    expect(result.status).toBe(400);
  });

  it("renames an entry", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Old name" });
    const result = await handleUpdateCodingListEntry(env.DB, "project", "p1", { name: "New name" });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT name FROM coding_list_entries WHERE list_type_id = 'project' AND id = 'p1'").first<{ name: string }>();
    expect(row?.name).toBe("New name");
  });

  it("409s a parent change that would create a cycle", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "a", name: "A" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "b", name: "B", parentEntryId: "a" });
    const result = await handleUpdateCodingListEntry(env.DB, "project", "a", { parentEntryId: "b" });
    expect(result.status).toBe(409);
  });

  it("replaces filters wholesale, and clearing one means leaving it out", async () => {
    await seedUnit();
    await handleCreateCodingListEntry(env.DB, "commodity_code", { id: "c1", name: "Commodity 1" });
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "G1", filters: { company_code: "UK01", commodity_code: "c1" } });

    const result = await handleUpdateCodingListEntry(env.DB, "gl_code", "g1", { filters: { company_code: "UK01" } });
    expect(result.status).toBe(200);
    const listed = await handleListCodingListEntries(env.DB, "gl_code");
    const entry = (listed.body as { entries: { filters: unknown[] }[] }).entries[0];
    expect(entry.filters).toEqual([{ filterListTypeId: "company_code", filterEntryId: "UK01", filterEntryName: "Acme UK" }]);
  });
});

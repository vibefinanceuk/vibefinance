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

/**
 * Search and real, server-side pagination — decision 0446, the same
 * treatment `purchase-order-route.test.ts`'s own "searching the list"
 * and "real, server-side pagination" describe blocks already give
 * Purchase Orders (decision 0376).
 */
describe("searching the list — decision 0446", () => {
  it("matches on id", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "DE01MJO", name: "Mjolner" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "FR02ABC", name: "Other" });
    const result = await handleListCodingListEntries(env.DB, "project", "MJO");
    const body = result.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id)).toEqual(["DE01MJO"]);
  });

  it("matches on name", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Mjolner" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "p2", name: "Something else" });
    const result = await handleListCodingListEntries(env.DB, "project", "mjolner");
    const body = result.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id)).toEqual(["p1"]);
  });

  it("matches on the resolved approver name", async () => {
    await seedUser();
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", approverUserId: "approver-1" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "p2", name: "P2" });
    const result = await handleListCodingListEntries(env.DB, "project", "Ada");
    const body = result.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id)).toEqual(["p1"]);
  });

  it("matches on the resolved parent name", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "DE01MJO", name: "Mjolner" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "DE01MJO.10", name: "Investigation", parentEntryId: "DE01MJO" });
    const result = await handleListCodingListEntries(env.DB, "project", "Mjolner");
    const body = result.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id).sort()).toEqual(["DE01MJO", "DE01MJO.10"]);
  });

  it("treats a literal percent or underscore in the term as itself, not a SQL wildcard", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "PO_1", name: "50% off" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "POX1", name: "Something else" });

    const percentResult = await handleListCodingListEntries(env.DB, "project", "50%");
    expect((percentResult.body as { entries: unknown[] }).entries).toHaveLength(1);

    const underscoreResult = await handleListCodingListEntries(env.DB, "project", "PO_1");
    const body = underscoreResult.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id)).toEqual(["PO_1"]);
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1" });
    const result = await handleListCodingListEntries(env.DB, "project", "no such thing anywhere");
    const body = result.body as { entries: unknown[]; total: number };
    expect(body.entries).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("real, server-side pagination — decision 0446", () => {
  async function seedManyEntries(count: number) {
    for (let i = 0; i < count; i++) {
      await handleCreateCodingListEntry(env.DB, "project", { id: `P-${1000 + i}`, name: `Project ${1000 + i}` });
    }
  }

  it("returns only pageSize rows, defaulting to 50", async () => {
    await seedManyEntries(120);
    const result = await handleListCodingListEntries(env.DB, "project");
    const body = result.body as { entries: unknown[]; total: number; page: number; pageSize: number };
    expect(body.entries).toHaveLength(50);
    expect(body.total).toBe(120);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("returns the next slice on page 2, with no overlap and no gap", async () => {
    await seedManyEntries(120);
    const page1 = await handleListCodingListEntries(env.DB, "project", null, "1", "50");
    const page2 = await handleListCodingListEntries(env.DB, "project", null, "2", "50");
    const ids1 = (page1.body as { entries: { id: string }[] }).entries.map((e) => e.id);
    const ids2 = (page2.body as { entries: { id: string }[] }).entries.map((e) => e.id);
    expect(ids1).toHaveLength(50);
    expect(ids2).toHaveLength(50);
    expect(new Set([...ids1, ...ids2]).size).toBe(100);
  });

  it("returns a real, partial last page rather than padding or erroring", async () => {
    await seedManyEntries(120);
    const result = await handleListCodingListEntries(env.DB, "project", null, "3", "50");
    expect((result.body as { entries: unknown[] }).entries).toHaveLength(20);
  });

  it("falls back to page 1 for anything not a real positive integer", async () => {
    await seedManyEntries(5);
    for (const bad of ["0", "-1", "abc", null]) {
      const result = await handleListCodingListEntries(env.DB, "project", null, bad);
      expect((result.body as { page: number }).page).toBe(1);
    }
  });

  it("falls back to the default page size for anything outside the allowed set", async () => {
    await seedManyEntries(5);
    for (const bad of ["10", "9999", "abc", null]) {
      const result = await handleListCodingListEntries(env.DB, "project", null, null, bad);
      expect((result.body as { pageSize: number }).pageSize).toBe(50);
    }
  });

  it("accepts every page size actually offered in the UI", async () => {
    await seedManyEntries(5);
    for (const allowed of ["25", "50", "100", "200"]) {
      const result = await handleListCodingListEntries(env.DB, "project", null, null, allowed);
      expect((result.body as { pageSize: number }).pageSize).toBe(Number(allowed));
    }
  });

  it("total reflects every matching row, not just the page returned", async () => {
    await seedManyEntries(120);
    const result = await handleListCodingListEntries(env.DB, "project", null, "1", "25");
    const body = result.body as { entries: unknown[]; total: number };
    expect(body.entries).toHaveLength(25);
    expect(body.total).toBe(120);
  });

  it("total narrows with search, not just the page's own row count", async () => {
    await seedManyEntries(120);
    await handleCreateCodingListEntry(env.DB, "project", { id: "RARE-1", name: "A rare project" });
    const result = await handleListCodingListEntries(env.DB, "project", "rare");
    const body = result.body as { entries: unknown[]; total: number };
    expect(body.total).toBe(1);
  });
});

describe("the `all` bypass mode — decision 0446, for a create/edit form's own pickers", () => {
  it("returns every entry, ignoring page and pageSize", async () => {
    const seedManyEntries = async (count: number) => {
      for (let i = 0; i < count; i++) {
        await handleCreateCodingListEntry(env.DB, "project", { id: `P-${1000 + i}`, name: `Project ${1000 + i}` });
      }
    };
    await seedManyEntries(120);
    const result = await handleListCodingListEntries(env.DB, "project", null, "1", "50", true);
    const body = result.body as { entries: unknown[]; total: number; page: number; pageSize: number };
    expect(body.entries).toHaveLength(120);
    expect(body.total).toBe(120);
    expect(body.page).toBe(1);
  });

  it("still honours a search term — a picker can be narrowed too", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "Mjolner" });
    await handleCreateCodingListEntry(env.DB, "project", { id: "p2", name: "Something else" });
    const result = await handleListCodingListEntries(env.DB, "project", "mjolner", null, null, true);
    const body = result.body as { entries: { id: string }[] };
    expect(body.entries.map((e) => e.id)).toEqual(["p1"]);
  });

  it("runs no count query at all — total is simply the returned entries' own length", async () => {
    const result = await handleListCodingListEntries(env.DB, "project", null, null, null, true);
    const body = result.body as { entries: unknown[]; total: number };
    expect(body.total).toBe(body.entries.length);
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
      approvalLimit: null,
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

  // The missing half of what Cost Centre already has — decision 0452.
  it("refuses a limit with nobody to hold it", async () => {
    const result = await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", approvalLimit: 5000 });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("limit_without_owner");
  });

  it("400s a negative limit", async () => {
    await seedUser();
    const result = await handleCreateCodingListEntry(env.DB, "project", {
      id: "p1",
      name: "P1",
      approverUserId: "approver-1",
      approvalLimit: -1,
    });
    expect(result.status).toBe(400);
  });

  it("accepts a real limit alongside its owner", async () => {
    await seedUser();
    const result = await handleCreateCodingListEntry(env.DB, "project", {
      id: "p1",
      name: "P1",
      approverUserId: "approver-1",
      approvalLimit: 5000,
    });
    expect(result.status).toBe(201);
    const listed = await handleListCodingListEntries(env.DB, "project");
    const entry = (listed.body as { entries: { id: string; approvalLimit: number | null }[] }).entries.find((e) => e.id === "p1");
    expect(entry?.approvalLimit).toBe(5000);
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

  it("updates the limit alongside its owner — decision 0452", async () => {
    await seedUser();
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1", approverUserId: "approver-1" });
    const result = await handleUpdateCodingListEntry(env.DB, "project", "p1", {
      approverUserId: "approver-1",
      approvalLimit: 2500,
    });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT approval_limit FROM coding_list_entries WHERE list_type_id = 'project' AND id = 'p1'"
    ).first<{ approval_limit: number | null }>();
    expect(row?.approval_limit).toBe(2500);
  });

  it("refuses a limit update with no owner in the same call", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1" });
    const result = await handleUpdateCodingListEntry(env.DB, "project", "p1", { approvalLimit: 2500 });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("limit_without_owner");
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

/**
 * **Narrowing a read to matching entries only** — decision 0453, the
 * invoice-line Coding pop-out's own "linked Commodity and General
 * Ledger Code": a General Ledger Code picker scoped by the Company
 * Code and Commodity Code already chosen elsewhere in the pop-out.
 * Additive — every test above this block passes no `filters` argument
 * at all and is untouched by any of this.
 */
describe("filters param — narrowing a read to matching entries only, decision 0453", () => {
  it("returns only entries whose own declared filter matches the value given", async () => {
    await seedUnit("UK01", "Acme UK");
    await seedUnit("DE01", "Acme DE");
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "UK ledger", filters: { company_code: "UK01" } });
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g2", name: "DE ledger", filters: { company_code: "DE01" } });

    const result = await handleListCodingListEntries(env.DB, "gl_code", null, null, null, false, { company_code: "UK01" });
    expect((result.body as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(["g1"]);
  });

  it("combines with search — decision 0446's own param, both narrow together", async () => {
    await seedUnit();
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "Plant Suppliers", filters: { company_code: "UK01" } });
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g2", name: "Office Supplies", filters: { company_code: "UK01" } });

    const result = await handleListCodingListEntries(env.DB, "gl_code", "plant", null, null, false, { company_code: "UK01" });
    expect((result.body as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(["g1"]);
  });

  it("stacks two filters — an entry must match both to be returned", async () => {
    await seedUnit();
    await handleCreateCodingListEntry(env.DB, "commodity_code", { id: "c1", name: "Commodity 1" });
    await handleCreateCodingListEntry(env.DB, "commodity_code", { id: "c2", name: "Commodity 2" });
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "Matches both", filters: { company_code: "UK01", commodity_code: "c1" } });
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g2", name: "Wrong commodity", filters: { company_code: "UK01", commodity_code: "c2" } });

    const result = await handleListCodingListEntries(env.DB, "gl_code", null, null, null, false, {
      company_code: "UK01",
      commodity_code: "c1",
    });
    expect((result.body as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(["g1"]);
  });

  it("a filter key this type does not declare is silently ignored, not an error", async () => {
    await handleCreateCodingListEntry(env.DB, "project", { id: "p1", name: "P1" });
    // project declares no filters at all — a company_code filter here
    // would 400 on the write side (validateFilters); on this read
    // side it is simply not applied, per this function's own doc
    // comment.
    const result = await handleListCodingListEntries(env.DB, "project", null, null, null, false, { company_code: "UK01" });
    expect(result.status).toBe(200);
    expect((result.body as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(["p1"]);
  });

  it("an entry with no filter value set at all does not match a filtered read", async () => {
    await seedUnit();
    await handleCreateCodingListEntry(env.DB, "gl_code", { id: "g1", name: "Unscoped" });
    const result = await handleListCodingListEntries(env.DB, "gl_code", null, null, null, false, { company_code: "UK01" });
    expect((result.body as { entries: unknown[] }).entries).toEqual([]);
  });
});

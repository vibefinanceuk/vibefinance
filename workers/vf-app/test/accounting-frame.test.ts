import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateLedger,
  handleAssignLedger,
  handleUpdateCostCentre,
  handleListCostCentresDetailed,
  resolveApprovalChain,
} from "../src/ledger-route.js";

/**
 * The accounting frame — decision 0195.
 *
 * Decision 0194 found the one thing both Oracle and SAP have that this
 * project did not: a **ledger** (Oracle) or **controlling area** (SAP).
 * A cost centre belongs to **it**, not to a company — which is why one
 * may be charged by several entities sharing a chart of accounts.
 */

async function seedPeople() {
  for (const [id, name] of [
    ["alice", "Alice"],
    ["mo", "Mo"],
    ["cfo", "The CFO"],
  ]) {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
      .bind(id, `${id}@acme.com`, name)
      .run();
  }
}

async function seedLedger(id = "eu") {
  await handleCreateLedger(env.DB, {
    id,
    name: `Ledger ${id}`,
    chartOfAccounts: "GROUP-COA",
    currency: "EUR",
  });
}

async function seedCostCentre(
  id: string,
  changes: Record<string, unknown> = {},
  ledger = "eu"
) {
  await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES (?, ?)")
    .bind(id, `Cost centre ${id}`)
    .run();
  await handleUpdateCostCentre(env.DB, id, { ledgerId: ledger, ...changes });
}

beforeEach(async () => {
  await applyTestSchema();
  await seedPeople();
});

describe("which entities account where", () => {
  it("lets a legal entity account in a ledger", async () => {
    await seedLedger();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();

    const result = await handleAssignLedger(env.DB, "acme-fr", { ledgerId: "eu" });
    expect(result.status).toBe(200);
  });

  it("lets several account in the same one", async () => {
    /**
     * **The whole point.** SAP: *"one or many company codes can be
     * linked to a single controlling area."* It is what makes
     * cross-entity cost accounting possible at all.
     */
    await seedLedger();
    for (const id of ["acme-fr", "acme-de"]) {
      await env.DB.prepare(
        "INSERT INTO org_units (id, name, kind) VALUES (?, ?, 'legal_entity')"
      )
        .bind(id, id)
        .run();
      await handleAssignLedger(env.DB, id, { ledgerId: "eu" });
    }

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM org_units WHERE ledger_id = 'eu'"
    ).first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("refuses an operating unit", async () => {
    // **An operating unit processes transactions and does not account
    // for itself** — decision 0036's split, and Oracle's rule that a
    // business unit posts through its entity rather than instead of it.
    await seedLedger();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('ap-fr', 'AP France', 'operating_unit')"
    ).run();

    const result = await handleAssignLedger(env.DB, "ap-fr", { ledgerId: "eu" });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("not_a_legal_entity");
  });
});

describe("the cost centre tree", () => {
  it("refuses a parent in a different ledger", async () => {
    // **A tree crossing charts of accounts is a tree whose totals mean
    // nothing.**
    await seedLedger("eu");
    await seedLedger("us");
    await seedCostCentre("marketing-eu", {}, "eu");
    await seedCostCentre("group-us", {}, "us");

    const result = await handleUpdateCostCentre(env.DB, "marketing-eu", {
      parentCostCentreId: "group-us",
    });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("different_ledger");
  });

  it("refuses a cost centre as its own parent", async () => {
    // A cycle would make escalation loop forever.
    await seedLedger();
    await seedCostCentre("marketing");

    const result = await handleUpdateCostCentre(env.DB, "marketing", {
      parentCostCentreId: "marketing",
    });
    expect(result.status).toBe(409);
  });

  it("refuses a limit with nobody to hold it", async () => {
    // **A limit with no owner is a number nobody can act on.**
    await seedLedger();
    await seedCostCentre("marketing");

    const result = await handleUpdateCostCentre(env.DB, "marketing", { approvalLimit: 5000 });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("limit_without_owner");
  });
});

describe("who approves what is charged here", () => {
  /**
   * **Decision 0184's *Limit* mode.** Start at the cost centre, climb
   * while nobody's limit covers the amount, stop at the first owner
   * whose does.
   */
  async function seedChain() {
    await seedLedger();
    await seedCostCentre("group", { ownerUserId: "cfo" });
    await seedCostCentre("finance", {
      ownerUserId: "mo",
      approvalLimit: 10000,
      parentCostCentreId: "group",
    });
    await seedCostCentre("marketing", {
      ownerUserId: "alice",
      approvalLimit: 1000,
      parentCostCentreId: "finance",
    });
  }

  it("stops at the first owner whose limit covers it", async () => {
    await seedChain();
    const result = await resolveApprovalChain(env.DB, "marketing", 500);

    expect(result.covered).toBe(true);
    expect(result.chain.map((c) => c.ownerUserId)).toEqual(["alice"]);
  });

  it("climbs when the amount exceeds a limit", async () => {
    await seedChain();
    const result = await resolveApprovalChain(env.DB, "marketing", 5000);

    // **Alice is asked and cannot cover it**, so Mo is next — and the
    // chain records both, because who was asked is part of the answer.
    expect(result.chain.map((c) => c.ownerUserId)).toEqual(["alice", "mo"]);
    expect(result.covered).toBe(true);
  });

  it("climbs to the top when it must", async () => {
    await seedChain();
    const result = await resolveApprovalChain(env.DB, "marketing", 50000);

    expect(result.chain.map((c) => c.ownerUserId)).toEqual(["alice", "mo", "cfo"]);
    expect(result.covered).toBe(true);
  });

  it("treats no limit as approving anything", async () => {
    // **How a group CFO at the top of a chain is configured**:
    // escalation happens when an amount exceeds a threshold, and an
    // owner with none has none to exceed.
    await seedChain();
    const result = await resolveApprovalChain(env.DB, "marketing", 999999999);

    expect(result.chain.at(-1)?.ownerUserId).toBe("cfo");
    expect(result.covered).toBe(true);
  });

  it("passes through a cost centre with no owner", async () => {
    // **A real configuration rather than a broken one** — it escalates
    // immediately.
    await seedLedger();
    await seedCostCentre("group", { ownerUserId: "cfo" });
    await seedCostCentre("passthrough", { parentCostCentreId: "group" });

    const result = await resolveApprovalChain(env.DB, "passthrough", 100);
    expect(result.chain.map((c) => c.ownerUserId)).toEqual(["cfo"]);
  });

  it("says so when the chain runs out uncovered", async () => {
    /**
     * **Decision 0184 recorded this as undecided**, and this reports it
     * rather than resolving it: the caller sees who was asked and that
     * nobody could approve it.
     */
    await seedLedger();
    await seedCostCentre("marketing", { ownerUserId: "alice", approvalLimit: 1000 });

    const result = await resolveApprovalChain(env.DB, "marketing", 50000);
    expect(result.covered).toBe(false);
    expect(result.chain.map((c) => c.ownerUserId)).toEqual(["alice"]);
  });

  it("does not loop on a cycle it did not create", async () => {
    // The route refuses a self-parent, and data can arrive by other
    // routes — decision 0152's lesson that a guarantee the code makes
    // is not one the data keeps.
    await seedLedger();
    await seedCostCentre("a", { ownerUserId: "alice", approvalLimit: 1 });
    await seedCostCentre("b", { ownerUserId: "mo", approvalLimit: 1 });
    await env.DB.prepare(
      "UPDATE cost_centres SET parent_cost_centre_id = 'b' WHERE id = 'a'"
    ).run();
    await env.DB.prepare(
      "UPDATE cost_centres SET parent_cost_centre_id = 'a' WHERE id = 'b'"
    ).run();

    const result = await resolveApprovalChain(env.DB, "a", 50000);
    expect(result.covered).toBe(false);
    expect(result.chain).toHaveLength(2);
  });
});

describe("Cost Centre's own place in Account Coding — decision 0444", () => {
  it("handleListCostCentresDetailed resolves every name a management screen needs", async () => {
    await seedLedger();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK')").run();
    await seedCostCentre("group", { ownerUserId: "cfo", approvalLimit: 100000 });
    await seedCostCentre("it", { ownerUserId: "alice", approvalLimit: 5000, parentCostCentreId: "group" });

    const result = await handleListCostCentresDetailed(env.DB);
    expect(result.status).toBe(200);
    const it = (result.body as { costCentres: Record<string, unknown>[] }).costCentres.find((c) => c.id === "it");
    expect(it).toMatchObject({
      id: "it",
      name: "Cost centre it",
      ledgerId: "eu",
      ledgerName: "Ledger eu",
      parentCostCentreId: "group",
      parentName: "Cost centre group",
      ownerUserId: "alice",
      ownerName: "Alice",
      approvalLimit: 5000,
      filters: [],
    });
  });

  it("a cost centre with no company-code filter set shows an empty filters list, not an error", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'Unscoped')").run();
    const result = await handleListCostCentresDetailed(env.DB);
    expect((result.body as { costCentres: { filters: unknown[] }[] }).costCentres[0].filters).toEqual([]);
  });

  it("**the operator's own Cost Centre example** — filtered by a real company code, reusing the same generic mechanism gl_code uses", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('UK150001', 'Local IT department')").run();

    const setResult = await handleUpdateCostCentre(env.DB, "UK150001", { filters: { company_code: "UK01" } });
    expect(setResult.status).toBe(200);

    const result = await handleListCostCentresDetailed(env.DB);
    const cc = (result.body as { costCentres: { filters: { filterListTypeId: string; filterEntryId: string; filterEntryName: string }[] }[] }).costCentres[0];
    expect(cc.filters).toEqual([{ filterListTypeId: "company_code", filterEntryId: "UK01", filterEntryName: "Acme UK" }]);
  });

  it("400s a filter cost_centre does not declare", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'CC1')").run();
    const result = await handleUpdateCostCentre(env.DB, "cc1", { filters: { commodity_code: "10000000" } });
    expect(result.status).toBe(400);
  });

  it("404s a company code that does not exist", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'CC1')").run();
    const result = await handleUpdateCostCentre(env.DB, "cc1", { filters: { company_code: "nope" } });
    expect(result.status).toBe(404);
  });

  it("setting only a filter, with nothing else in the body, still counts as a real change", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'CC1')").run();
    const result = await handleUpdateCostCentre(env.DB, "cc1", { filters: { company_code: "UK01" } });
    expect(result.status).toBe(200);
  });
});

/**
 * Search and real, server-side pagination for Cost Centre — decision
 * 0446, the same treatment `coding-list-route.test.ts`'s own
 * "searching the list" and "real, server-side pagination" describe
 * blocks already give the other three coding lists.
 */
describe("searching the Cost Centre list — decision 0446", () => {
  it("matches on id", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('UK150001', 'Local IT')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('FR200002', 'Other')").run();
    const result = await handleListCostCentresDetailed(env.DB, "UK1500");
    const body = result.body as { costCentres: { id: string }[] };
    expect(body.costCentres.map((c) => c.id)).toEqual(["UK150001"]);
  });

  it("matches on name", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'Local IT department')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc2', 'Something else')").run();
    const result = await handleListCostCentresDetailed(env.DB, "it department");
    const body = result.body as { costCentres: { id: string }[] };
    expect(body.costCentres.map((c) => c.id)).toEqual(["cc1"]);
  });

  it("matches on the resolved owner (Approver) name", async () => {
    await seedLedger();
    await seedCostCentre("cc1", { ownerUserId: "alice" });
    await seedCostCentre("cc2", {});
    const result = await handleListCostCentresDetailed(env.DB, "Alice");
    const body = result.body as { costCentres: { id: string }[] };
    expect(body.costCentres.map((c) => c.id)).toEqual(["cc1"]);
  });

  it("matches on the resolved parent name", async () => {
    await seedLedger();
    await seedCostCentre("group");
    await seedCostCentre("it", { parentCostCentreId: "group" });
    const result = await handleListCostCentresDetailed(env.DB, "group");
    const body = result.body as { costCentres: { id: string }[] };
    expect(body.costCentres.map((c) => c.id).sort()).toEqual(["group", "it"]);
  });

  it("treats a literal percent or underscore in the term as itself, not a SQL wildcard", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('CC_1', '50% off')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('CCX1', 'Something else')").run();

    const percentResult = await handleListCostCentresDetailed(env.DB, "50%");
    expect((percentResult.body as { costCentres: unknown[] }).costCentres).toHaveLength(1);

    const underscoreResult = await handleListCostCentresDetailed(env.DB, "CC_1");
    const body = underscoreResult.body as { costCentres: { id: string }[] };
    expect(body.costCentres.map((c) => c.id)).toEqual(["CC_1"]);
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'CC1')").run();
    const result = await handleListCostCentresDetailed(env.DB, "no such thing anywhere");
    const body = result.body as { costCentres: unknown[]; total: number };
    expect(body.costCentres).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("real, server-side pagination for Cost Centre — decision 0446", () => {
  async function seedManyCostCentres(count: number) {
    for (let i = 0; i < count; i++) {
      await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES (?, ?)")
        .bind(`CC-${1000 + i}`, `Cost centre ${1000 + i}`)
        .run();
    }
  }

  it("returns only pageSize rows, defaulting to 50", async () => {
    await seedManyCostCentres(120);
    const result = await handleListCostCentresDetailed(env.DB);
    const body = result.body as { costCentres: unknown[]; total: number; page: number; pageSize: number };
    expect(body.costCentres).toHaveLength(50);
    expect(body.total).toBe(120);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("returns the next slice on page 2, with no overlap and no gap", async () => {
    await seedManyCostCentres(120);
    const page1 = await handleListCostCentresDetailed(env.DB, null, "1", "50");
    const page2 = await handleListCostCentresDetailed(env.DB, null, "2", "50");
    const ids1 = (page1.body as { costCentres: { id: string }[] }).costCentres.map((c) => c.id);
    const ids2 = (page2.body as { costCentres: { id: string }[] }).costCentres.map((c) => c.id);
    expect(ids1).toHaveLength(50);
    expect(ids2).toHaveLength(50);
    expect(new Set([...ids1, ...ids2]).size).toBe(100);
  });

  it("returns a real, partial last page rather than padding or erroring", async () => {
    await seedManyCostCentres(120);
    const result = await handleListCostCentresDetailed(env.DB, null, "3", "50");
    expect((result.body as { costCentres: unknown[] }).costCentres).toHaveLength(20);
  });

  it("falls back to page 1 for anything not a real positive integer", async () => {
    await seedManyCostCentres(5);
    for (const bad of ["0", "-1", "abc", null]) {
      const result = await handleListCostCentresDetailed(env.DB, null, bad);
      expect((result.body as { page: number }).page).toBe(1);
    }
  });

  it("falls back to the default page size for anything outside the allowed set", async () => {
    await seedManyCostCentres(5);
    for (const bad of ["10", "9999", "abc", null]) {
      const result = await handleListCostCentresDetailed(env.DB, null, null, bad);
      expect((result.body as { pageSize: number }).pageSize).toBe(50);
    }
  });

  it("accepts every page size actually offered in the UI", async () => {
    await seedManyCostCentres(5);
    for (const allowed of ["25", "50", "100", "200"]) {
      const result = await handleListCostCentresDetailed(env.DB, null, null, allowed);
      expect((result.body as { pageSize: number }).pageSize).toBe(Number(allowed));
    }
  });

  it("total reflects every matching row, not just the page returned", async () => {
    await seedManyCostCentres(120);
    const result = await handleListCostCentresDetailed(env.DB, null, "1", "25");
    const body = result.body as { costCentres: unknown[]; total: number };
    expect(body.costCentres).toHaveLength(25);
    expect(body.total).toBe(120);
  });

  it("total narrows with search, not just the page's own row count", async () => {
    await seedManyCostCentres(120);
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('RARE-1', 'A rare cost centre')").run();
    const result = await handleListCostCentresDetailed(env.DB, "rare");
    const body = result.body as { costCentres: unknown[]; total: number };
    expect(body.total).toBe(1);
  });
});

/**
 * **`filters` narrows to matching cost centres only** — decision 0453,
 * the invoice-line Coding pop-out's own Cost Centre picker, scoped to
 * the Company Code already known for the invoice. The same
 * `codingListFilterClause`/`filters` mechanism `coding-list-
 * route.test.ts`'s own "filters param" describe block proves for the
 * three greenfield lists, restated here since Cost Centre keeps its
 * own dedicated table and query.
 */
describe("filters param — narrowing a read to matching cost centres only, decision 0453", () => {
  it("returns only cost centres whose own company-code filter matches the value given", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK'), ('DE01', 'Acme DE')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc-uk', 'UK cost centre'), ('cc-de', 'DE cost centre')").run();
    await handleUpdateCostCentre(env.DB, "cc-uk", { filters: { company_code: "UK01" } });
    await handleUpdateCostCentre(env.DB, "cc-de", { filters: { company_code: "DE01" } });

    const result = await handleListCostCentresDetailed(env.DB, null, null, null, { company_code: "UK01" });
    expect((result.body as { costCentres: { id: string }[] }).costCentres.map((c) => c.id)).toEqual(["cc-uk"]);
  });

  it("combines with search, both narrowing together", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'IT department'), ('cc2', 'Marketing department')").run();
    await handleUpdateCostCentre(env.DB, "cc1", { filters: { company_code: "UK01" } });
    await handleUpdateCostCentre(env.DB, "cc2", { filters: { company_code: "UK01" } });

    const result = await handleListCostCentresDetailed(env.DB, "IT", null, null, { company_code: "UK01" });
    expect((result.body as { costCentres: { id: string }[] }).costCentres.map((c) => c.id)).toEqual(["cc1"]);
  });

  it("a cost centre with no filter value set at all does not match a filtered read", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK')").run();
    await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'Unscoped')").run();
    const result = await handleListCostCentresDetailed(env.DB, null, null, null, { company_code: "UK01" });
    expect((result.body as { costCentres: unknown[] }).costCentres).toEqual([]);
  });
});

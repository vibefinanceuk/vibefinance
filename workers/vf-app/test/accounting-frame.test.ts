import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateLedger,
  handleAssignLedger,
  handleUpdateCostCentre,
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

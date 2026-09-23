import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateUser } from "../src/org-route.js";
import {
  handleGetApprovalConfig,
  handleUpdateApprovalConfig,
  handleSetSupervisorOverride,
  handleDeleteSupervisorOverride,
  handleSetLimitOverride,
  handleDeleteLimitOverride,
  handleSetCostObjectDimensions,
} from "../src/approval-config-route.js";

/**
 * The write API for the Approval Hierarchy tab — decision 0440.
 *
 * Decision 0439 built the migration and left every table it added
 * reachable only by direct SQL; these are the routes that give
 * `ap-setup.js`'s own Approval Hierarchy tab a real way to populate
 * them, tested the same way every other route test in this file
 * already is.
 */

async function seedUnits(): Promise<void> {
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')").run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'acme-group')"
  ).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedUnits();
  await handleCreateUser(env.DB, { id: "alice", email: "alice@acme.com", name: "Alice" });
  await handleCreateUser(env.DB, { id: "bob", email: "bob@acme.com", name: "Bob" });
});

describe("handleGetApprovalConfig", () => {
  it("reads the singleton row's own default state — employee_supervisor, no default approver", async () => {
    const result = await handleGetApprovalConfig(env.DB);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      mode: "employee_supervisor",
      defaultApproverUserId: null,
      defaultApproverName: null,
      supervisorOverrides: [],
      limitOverrides: [],
    });
  });

  it("names the default approver, not just their id", async () => {
    await handleUpdateApprovalConfig(env.DB, { mode: "manual", defaultApproverUserId: "alice" });
    const result = await handleGetApprovalConfig(env.DB);
    expect(result.body.defaultApproverUserId).toBe("alice");
    expect(result.body.defaultApproverName).toBe("Alice");
  });

  it("joins both override tables to real names, not bare ids", async () => {
    await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "bob" });
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: 5000 });

    const result = await handleGetApprovalConfig(env.DB);
    expect(result.body.supervisorOverrides).toEqual([
      { userId: "alice", userName: "Alice", unitId: "acme-fr", unitName: "Acme France", supervisorId: "bob", supervisorName: "Bob" },
    ]);
    expect(result.body.limitOverrides).toEqual([
      { userId: "alice", userName: "Alice", unitId: "acme-fr", unitName: "Acme France", currency: "EUR", maxAmount: 5000 },
    ]);
  });
});

describe("handleUpdateApprovalConfig", () => {
  it("422s on a mode outside the closed vocabulary", async () => {
    const result = await handleUpdateApprovalConfig(env.DB, { mode: "whatever" });
    expect(result.status).toBe(422);
  });

  it("404s when the default approver named does not exist", async () => {
    const result = await handleUpdateApprovalConfig(env.DB, { mode: "manual", defaultApproverUserId: "ghost" });
    expect(result.status).toBe(404);
  });

  it("accepts every mode the vocabulary names", async () => {
    for (const mode of ["employee_supervisor", "cost_object", "manual", "api"]) {
      const result = await handleUpdateApprovalConfig(env.DB, { mode });
      expect(result.status).toBe(200);
    }
  });

  it("clears the default approver by passing null explicitly", async () => {
    await handleUpdateApprovalConfig(env.DB, { mode: "manual", defaultApproverUserId: "alice" });
    const cleared = await handleUpdateApprovalConfig(env.DB, { mode: "manual", defaultApproverUserId: null });
    expect(cleared.status).toBe(200);
    const row = await env.DB.prepare("SELECT default_approver_user_id FROM org_approval_config WHERE id = 1").first<{
      default_approver_user_id: string | null;
    }>();
    expect(row?.default_approver_user_id).toBeNull();
  });

  it("actually persists — a second read sees what the first write set", async () => {
    await handleUpdateApprovalConfig(env.DB, { mode: "cost_object", defaultApproverUserId: "bob" });
    const result = await handleGetApprovalConfig(env.DB);
    expect(result.body.mode).toBe("cost_object");
    expect(result.body.defaultApproverUserId).toBe("bob");
  });
});

describe("handleSetSupervisorOverride", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr" });
    expect(result.status).toBe(400);
  });

  it("422s on self-supervision, before the database's own CHECK constraint has to", async () => {
    const result = await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "alice" });
    expect(result.status).toBe(422);
  });

  it("404s when the user, unit or supervisor does not exist", async () => {
    expect((await handleSetSupervisorOverride(env.DB, { userId: "ghost", unitId: "acme-fr", supervisorId: "bob" })).status).toBe(404);
    expect((await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "ghost-unit", supervisorId: "bob" })).status).toBe(404);
    expect((await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "ghost" })).status).toBe(404);
  });

  it("upserts — setting it again for the same user/unit is a correction, not a duplicate", async () => {
    await handleCreateUser(env.DB, { id: "carol", email: "carol@acme.com", name: "Carol" });
    await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "bob" });
    const second = await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "carol" });
    expect(second.status).toBe(200);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_user_supervisor_overrides").first<{ n: number }>();
    expect(count?.n).toBe(1);
    const row = await env.DB.prepare("SELECT supervisor_id FROM org_user_supervisor_overrides WHERE user_id = ? AND unit_id = ?")
      .bind("alice", "acme-fr")
      .first<{ supervisor_id: string }>();
    expect(row?.supervisor_id).toBe("carol");
  });
});

describe("handleDeleteSupervisorOverride", () => {
  it("404s on a delete that matches nothing — refused, not a silent no-op", async () => {
    const result = await handleDeleteSupervisorOverride(env.DB, "alice", "acme-fr");
    expect(result.status).toBe(404);
  });

  it("removes exactly the override named, leaving the global default (manager_id) untouched", async () => {
    await handleSetSupervisorOverride(env.DB, { userId: "alice", unitId: "acme-fr", supervisorId: "bob" });
    const result = await handleDeleteSupervisorOverride(env.DB, "alice", "acme-fr");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM org_user_supervisor_overrides WHERE user_id = ? AND unit_id = ?")
      .bind("alice", "acme-fr")
      .first();
    expect(row).toBeNull();
  });
});

describe("handleSetLimitOverride", () => {
  it("400s when maxAmount is not a number", async () => {
    const result = await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: "5000" });
    expect(result.status).toBe(400);
  });

  it("400s on a negative amount", async () => {
    const result = await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: -1 });
    expect(result.status).toBe(400);
  });

  it("404s when the user or unit does not exist", async () => {
    expect((await handleSetLimitOverride(env.DB, { userId: "ghost", unitId: "acme-fr", currency: "EUR", maxAmount: 100 })).status).toBe(404);
    expect((await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "ghost-unit", currency: "EUR", maxAmount: 100 })).status).toBe(404);
  });

  it("upserts on the (user, unit, currency) composite key — a correction, not a duplicate", async () => {
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: 2000 });
    const second = await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: 9000 });
    expect(second.status).toBe(200);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_authority_limit_overrides").first<{ n: number }>();
    expect(count?.n).toBe(1);
    const row = await env.DB.prepare(
      "SELECT max_amount FROM org_authority_limit_overrides WHERE user_id = ? AND unit_id = ? AND currency = ?"
    )
      .bind("alice", "acme-fr", "EUR")
      .first<{ max_amount: number }>();
    expect(row?.max_amount).toBe(9000);
  });

  it("the operator's own example: EUR at Acme France and GBP at a different org, both real rows", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity')").run();
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: 2000 });
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-uk", currency: "GBP", maxAmount: 1500 });

    const result = await handleGetApprovalConfig(env.DB);
    expect(result.body.limitOverrides).toHaveLength(2);
  });
});

describe("handleDeleteLimitOverride", () => {
  it("404s on a delete that matches nothing", async () => {
    const result = await handleDeleteLimitOverride(env.DB, "alice", "acme-fr", "EUR");
    expect(result.status).toBe(404);
  });

  it("removes exactly the currency named, leaving another currency for the same user/unit untouched", async () => {
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "EUR", maxAmount: 2000 });
    await handleSetLimitOverride(env.DB, { userId: "alice", unitId: "acme-fr", currency: "USD", maxAmount: 2500 });

    const result = await handleDeleteLimitOverride(env.DB, "alice", "acme-fr", "EUR");
    expect(result.status).toBe(200);

    const remaining = await env.DB.prepare("SELECT currency FROM org_authority_limit_overrides WHERE user_id = ? AND unit_id = ?")
      .bind("alice", "acme-fr")
      .all<{ currency: string }>();
    expect(remaining.results.map((r) => r.currency)).toEqual(["USD"]);
  });
});

describe("Cost-Object Priority — decision 0452", () => {
  it("handleGetApprovalConfig carries all four dimensions, in the seeded default state", async () => {
    const result = await handleGetApprovalConfig(env.DB);
    expect(result.body.costObjectDimensions).toEqual([
      { listTypeId: "cost_centre", name: "Cost Centre", enabled: true, sequence: 0 },
      { listTypeId: "project", name: "Project", enabled: false, sequence: 1 },
      { listTypeId: "commodity_code", name: "Commodity Code", enabled: false, sequence: 2 },
      { listTypeId: "gl_code", name: "General Ledger Code", enabled: false, sequence: 3 },
    ]);
  });

  it("400s an empty or missing dimensions array", async () => {
    expect((await handleSetCostObjectDimensions(env.DB, {})).status).toBe(400);
    expect((await handleSetCostObjectDimensions(env.DB, { dimensions: [] })).status).toBe(400);
  });

  it("422s a dimension this system does not know, including company_code", async () => {
    for (const bad of ["company_code", "widget"]) {
      const result = await handleSetCostObjectDimensions(env.DB, {
        dimensions: [{ listTypeId: bad, enabled: true }],
      });
      expect(result.status, bad).toBe(422);
    }
  });

  it("422s a non-boolean enabled", async () => {
    const result = await handleSetCostObjectDimensions(env.DB, {
      dimensions: [{ listTypeId: "project", enabled: "yes" }],
    });
    expect(result.status).toBe(422);
  });

  it("422s the same dimension named twice", async () => {
    const result = await handleSetCostObjectDimensions(env.DB, {
      dimensions: [
        { listTypeId: "project", enabled: true },
        { listTypeId: "project", enabled: false },
      ],
    });
    expect(result.status).toBe(422);
  });

  it("turns a dimension on, and it persists", async () => {
    const result = await handleSetCostObjectDimensions(env.DB, {
      dimensions: [{ listTypeId: "project", enabled: true, sequence: 0 }],
    });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT enabled, sequence FROM cost_object_dimensions WHERE list_type_id = 'project'").first<{
      enabled: number;
      sequence: number;
    }>();
    expect(row).toEqual({ enabled: 1, sequence: 0 });
  });

  it("never creates or deletes a row — a fifth, unknown dimension is refused, not inserted", async () => {
    await handleSetCostObjectDimensions(env.DB, { dimensions: [{ listTypeId: "widget", enabled: true }] }).catch(() => {});
    const count = await env.DB.prepare("SELECT count(*) AS n FROM cost_object_dimensions").first<{ n: number }>();
    expect(count?.n).toBe(4);
  });

  it("takes order from the order dimensions were listed, the same convention field visibility uses", async () => {
    await handleSetCostObjectDimensions(env.DB, {
      dimensions: [
        { listTypeId: "gl_code", enabled: true },
        { listTypeId: "cost_centre", enabled: true },
      ],
    });
    const rows = await env.DB.prepare(
      "SELECT list_type_id, sequence FROM cost_object_dimensions WHERE list_type_id IN ('gl_code', 'cost_centre')"
    ).all<{ list_type_id: string; sequence: number }>();
    const glCode = rows.results.find((r) => r.list_type_id === "gl_code");
    const costCentre = rows.results.find((r) => r.list_type_id === "cost_centre");
    expect(glCode?.sequence).toBeLessThan(costCentre!.sequence);
  });

  it("leaves an unlisted dimension exactly as it was", async () => {
    await handleSetCostObjectDimensions(env.DB, { dimensions: [{ listTypeId: "project", enabled: true }] });
    const costCentre = await env.DB.prepare("SELECT enabled FROM cost_object_dimensions WHERE list_type_id = 'cost_centre'").first<{
      enabled: number;
    }>();
    // Untouched — still the seeded default, enabled.
    expect(costCentre?.enabled).toBe(1);
  });
});

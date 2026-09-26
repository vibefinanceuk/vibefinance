import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateUser } from "../src/org-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateProcessInstance } from "../src/workflow-engine.js";
import {
  resolveApprovalLimit,
  resolveSupervisorId,
  findLineCoder,
  resolveApprovalHierarchy,
  resolveApprovalTargets,
} from "../src/approval-hierarchy.js";

/**
 * Approval Hierarchy — decision 0439.
 *
 * The exact gap the operator named directly: a global limit and a
 * global supervisor cannot express "EUR at Acme France, GBP at Acme
 * UK." These tests are the defence for the two override tables that
 * close it, and for the Employee-Supervisor and Cost-Object resolvers
 * built on top of them.
 */

async function seedUnits(): Promise<void> {
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')").run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'acme-group')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-fr', 'AP France', 'operating_unit', 'acme-fr')"
  ).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedUnits();
  await handleCreateUser(env.DB, { id: "alice", email: "alice@acme.com", name: "Alice" });
  await handleCreateUser(env.DB, { id: "bob", email: "bob@acme.com", name: "Bob" });
});

describe("resolveApprovalLimit — the override first, most specific unit wins, the global default last", () => {
  it("returns null when nothing is recorded anywhere", async () => {
    expect(await resolveApprovalLimit(env.DB, "alice", "ap-fr", "EUR")).toBeNull();
  });

  it("falls back to the global org_authority_limits row when no override exists", async () => {
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();
    expect(await resolveApprovalLimit(env.DB, "alice", "ap-fr", "EUR")).toBe(2000);
    // And with no unit at all — the exact case a global limit exists for.
    expect(await resolveApprovalLimit(env.DB, "alice", null, "EUR")).toBe(2000);
  });

  it("an override at the exact unit wins over the global default", async () => {
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();
    await env.DB.prepare(
      "INSERT INTO org_authority_limit_overrides (user_id, unit_id, currency, max_amount) VALUES ('alice', 'ap-fr', 'EUR', 5000)"
    ).run();
    expect(await resolveApprovalLimit(env.DB, "alice", "ap-fr", "EUR")).toBe(5000);
    // A different unit entirely still reads the global default.
    expect(await resolveApprovalLimit(env.DB, "alice", "acme-group", "EUR")).toBe(2000);
  });

  it("an override on a parent unit is found by walking the lineage, most specific first", async () => {
    await env.DB.prepare(
      "INSERT INTO org_authority_limit_overrides (user_id, unit_id, currency, max_amount) VALUES ('alice', 'acme-fr', 'EUR', 3000)"
    ).run();
    // Asked about the child (ap-fr); acme-fr's own override is what's found.
    expect(await resolveApprovalLimit(env.DB, "alice", "ap-fr", "EUR")).toBe(3000);
  });

  it("the exact case the operator named: different limits, different currencies, different orgs", async () => {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_authority_limit_overrides (user_id, unit_id, currency, max_amount) VALUES ('alice', 'acme-fr', 'EUR', 2000)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_authority_limit_overrides (user_id, unit_id, currency, max_amount) VALUES ('alice', 'acme-uk', 'GBP', 1500)"
    ).run();
    expect(await resolveApprovalLimit(env.DB, "alice", "acme-fr", "EUR")).toBe(2000);
    expect(await resolveApprovalLimit(env.DB, "alice", "acme-uk", "GBP")).toBe(1500);
    // Neither leaks into the other org/currency combination.
    expect(await resolveApprovalLimit(env.DB, "alice", "acme-uk", "EUR")).toBeNull();
    expect(await resolveApprovalLimit(env.DB, "alice", "acme-fr", "GBP")).toBeNull();
  });
});

describe("resolveSupervisorId — the override first, then org_users.manager_id", () => {
  it("returns null when nobody is recorded", async () => {
    expect(await resolveSupervisorId(env.DB, "alice", "ap-fr")).toBeNull();
  });

  it("falls back to the global manager_id column when no override exists", async () => {
    await env.DB.prepare("UPDATE org_users SET manager_id = 'bob' WHERE id = 'alice'").run();
    expect(await resolveSupervisorId(env.DB, "alice", "ap-fr")).toBe("bob");
  });

  it("a unit-scoped override wins over the global manager_id, at that unit and its descendants", async () => {
    await handleCreateUser(env.DB, { id: "carol", email: "carol@acme.com", name: "Carol" });
    await env.DB.prepare("UPDATE org_users SET manager_id = 'bob' WHERE id = 'alice'").run();
    await env.DB.prepare(
      "INSERT INTO org_user_supervisor_overrides (user_id, unit_id, supervisor_id) VALUES ('alice', 'acme-fr', 'carol')"
    ).run();
    expect(await resolveSupervisorId(env.DB, "alice", "ap-fr")).toBe("carol"); // found via lineage
    expect(await resolveSupervisorId(env.DB, "alice", "acme-group")).toBe("bob"); // outside the override's own scope
  });
});

describe("findLineCoder — whoever completed the immediately preceding stage's task for this line", () => {
  async function seedCodingThenApproval(): Promise<{ instanceId: string; processId: string; approvalSequence: number }> {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "coding", name: "Coding", sequence: 1, evaluationScope: "line" });
    await handleCreateStage(env.DB, "p1", { id: "approval", name: "Approval", sequence: 2, evaluationScope: "line" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    return { instanceId: (created.body as { id: string }).id, processId: "p1", approvalSequence: 2 };
  }

  it("returns null when the preceding stage never ran (no stage_visits row at all)", async () => {
    const { instanceId, processId, approvalSequence } = await seedCodingThenApproval();
    expect(await findLineCoder(env.DB, instanceId, processId, approvalSequence, 1, 1)).toBeNull();
  });

  it("finds the coder once their task on that line is completed", async () => {
    const { instanceId, processId, approvalSequence } = await seedCodingThenApproval();
    const visitId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'coding', 'matched', datetime('now'))"
    )
      .bind(visitId, instanceId)
      .run();
    const taskId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, line_number, completed_by, completed_at)
       VALUES (?, 'coding', ?, 'alice', 'AP.Code', 1, 'alice', datetime('now'))`
    )
      .bind(taskId, visitId)
      .run();

    expect(await findLineCoder(env.DB, instanceId, processId, approvalSequence, 1, 1)).toBe("alice");
    // A different line, nobody completed it yet.
    expect(await findLineCoder(env.DB, instanceId, processId, approvalSequence, 1, 2)).toBeNull();
  });
});

describe("resolveApprovalHierarchy — employee_supervisor mode", () => {
  it("the coder's own limit covers it: they approve it themselves", async () => {
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "irrelevant-no-coder-lookup-needed",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: null, // exercised directly against a known starter below instead
      unitId: null,
      currency: "EUR",
      amount: 1000,
      costCentreId: null,
    });
    // No line number and no config row change: employee_supervisor with
    // no line-level starting point has nothing to resolve against, and
    // (with no Default Approver configured) reports that honestly.
    expect(resolution).toEqual({
      unresolved: true,
      reason:
        "This Approval stage evaluates the whole document, not a line, and Employee-Supervisor routing has no document-level starting point yet. No Default Approver is configured.",
    });
  });

  async function seedCoderChain(): Promise<{ instanceId: string }> {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "coding", name: "Coding", sequence: 1, evaluationScope: "line" });
    await handleCreateStage(env.DB, "p1", { id: "approval", name: "Approval", sequence: 2, evaluationScope: "line" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const visitId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'coding', 'matched', datetime('now'))"
    )
      .bind(visitId, instanceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, line_number, completed_by, completed_at)
       VALUES (?, 'coding', ?, 'alice', 'AP.Code', 1, 'alice', datetime('now'))`
    )
      .bind(crypto.randomUUID(), visitId)
      .run();

    return { instanceId };
  }

  it("the line's own coder approves it, when their limit covers the amount", async () => {
    const { instanceId } = await seedCoderChain();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "alice" });
  });

  it("over the coder's limit: escalates to their supervisor", async () => {
    const { instanceId } = await seedCoderChain();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('bob', 'EUR', 10000)").run();
    await env.DB.prepare("UPDATE org_users SET manager_id = 'bob' WHERE id = 'alice'").run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 5000,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });

  it("a coder with no limit recorded escalates immediately — a gap, not an unlimited approver", async () => {
    const { instanceId } = await seedCoderChain();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('bob', 'EUR', 10000)").run();
    await env.DB.prepare("UPDATE org_users SET manager_id = 'bob' WHERE id = 'alice'").run();
    // Alice has NO authority limit at all.

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1, // a trivial amount — still escalates, because alice has no limit to test it against
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });

  it("the chain runs out with no covering limit and no supervisor: falls to the configured Default Approver", async () => {
    const { instanceId } = await seedCoderChain();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 100)").run();
    // No manager_id set for alice — the chain ends there.
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 5000,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });

  it("the chain runs out and no Default Approver is configured: reports unresolved rather than guessing", async () => {
    const { instanceId } = await seedCoderChain();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 100)").run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 5000,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ unresolved: true });
  });

  it("no recorded coder for the line: falls to the Default Approver directly", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: (created.body as { id: string }).id,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 5000,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });
});

describe("resolveApprovalHierarchy — cost_object mode", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'cost_object' WHERE id = 1").run();
  });

  it("delegates to the already-built resolveApprovalChain and returns its owner", async () => {
    await env.DB.prepare(
      "INSERT INTO cost_centres (id, name, owner_user_id, approval_limit) VALUES ('cc1', 'Marketing', 'alice', 2000)"
    ).run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: "cc1",
    });
    expect(resolution).toMatchObject({ targetUserId: "alice" });
  });

  it("no cost centre recorded for the line: falls to the Default Approver", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });
});

describe("resolveApprovalTargets — the plural entry point (decision 0452)", () => {
  it("every mode but cost_object still wraps a single answer in a one-element array", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });
});

describe("resolveApprovalTargets — cost_object mode, generalized across dimensions (decision 0452)", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'cost_object' WHERE id = 1").run();
    // coding_list_types and cost_object_dimensions are both seeded by
    // migrations 0076/0077 themselves — 'project' already exists, and
    // only cost_centre starts enabled.
  });

  it("only cost centre enabled and coded — exactly what resolveCostObject (singular) already did, unchanged", async () => {
    await env.DB.prepare(
      "INSERT INTO cost_centres (id, name, owner_user_id, approval_limit) VALUES ('cc1', 'Marketing', 'alice', 2000)"
    ).run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: "cc1",
    });
    expect(resolutions).toEqual([{ targetUserId: "alice", reasoning: "cost centre chain: cc1." }]);
  });

  it("a dimension with no coded value on the line is not consulted, even when enabled", async () => {
    await env.DB.prepare(
      "UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'"
    ).run();
    await env.DB.prepare(
      "INSERT INTO cost_centres (id, name, owner_user_id, approval_limit) VALUES ('cc1', 'Marketing', 'alice', 2000)"
    ).run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: "cc1",
      // No project value on this line — project stays not applicable.
    });
    expect(resolutions).toEqual([{ targetUserId: "alice", reasoning: "cost centre chain: cc1." }]);
  });

  it("an enabled dimension with a coded value raises its own chain over coding_list_entries", async () => {
    await env.DB.prepare("UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'").run();
    await env.DB.prepare(
      "INSERT INTO coding_list_entries (list_type_id, id, name, approver_user_id, approval_limit) VALUES ('project', 'p1', 'Mjolner', 'bob', 5000)"
    ).run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
      costObjectValues: { project: "p1" },
    });
    expect(resolutions).toEqual([{ targetUserId: "bob", reasoning: "project chain: p1." }]);
  });

  it("escalates via parent_entry_id when the immediate entry's own limit doesn't cover it", async () => {
    await env.DB.prepare("UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'").run();
    await env.DB.prepare(
      "INSERT INTO coding_list_entries (list_type_id, id, name, approver_user_id, approval_limit) VALUES ('project', 'parent', 'Group', 'bob', NULL)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO coding_list_entries (list_type_id, id, name, approver_user_id, approval_limit, parent_entry_id) VALUES ('project', 'child', 'Team', 'alice', 100, 'parent')"
    ).run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 5000, // over alice's 100 limit, uncapped for bob (NULL)
      costCentreId: null,
      costObjectValues: { project: "child" },
    });
    expect(resolutions).toEqual([{ targetUserId: "bob", reasoning: "project chain: child → parent." }]);
  });

  it("the operator's own envisaged design: two enabled, coded dimensions on one line raise two independent tasks", async () => {
    await env.DB.prepare("UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'").run();
    await env.DB.prepare(
      "INSERT INTO cost_centres (id, name, owner_user_id, approval_limit) VALUES ('cc1', 'Marketing', 'alice', 2000)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO coding_list_entries (list_type_id, id, name, approver_user_id, approval_limit) VALUES ('project', 'p1', 'Mjolner', 'bob', 5000)"
    ).run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: "cc1",
      costObjectValues: { project: "p1" },
    });
    // Both, not the higher-priority one alone — 0184's own "parallel
    // across cost objects" reading, settled by the operator directly.
    expect(resolutions).toHaveLength(2);
    expect(resolutions).toEqual(
      expect.arrayContaining([
        { targetUserId: "alice", reasoning: "cost centre chain: cc1." },
        { targetUserId: "bob", reasoning: "project chain: p1." },
      ])
    );
  });

  it("a coded, enabled dimension whose chain runs out uncovered resolves to the Default Approver, independently of the other dimension", async () => {
    await env.DB.prepare("UPDATE cost_object_dimensions SET enabled = 1 WHERE list_type_id = 'project'").run();
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();
    await env.DB.prepare(
      "INSERT INTO cost_centres (id, name, owner_user_id, approval_limit) VALUES ('cc1', 'Marketing', 'alice', 2000)"
    ).run();
    // A project entry with no approver at all — the chain runs out immediately.
    await env.DB.prepare("INSERT INTO coding_list_entries (list_type_id, id, name) VALUES ('project', 'p1', 'Mjolner')").run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: "cc1",
      costObjectValues: { project: "p1" },
    });
    expect(resolutions).toHaveLength(2);
    expect(resolutions).toContainEqual({ targetUserId: "alice", reasoning: "cost centre chain: cc1." });
    expect(resolutions.find((r) => "targetUserId" in r && r.targetUserId === "bob")).toBeTruthy();
  });

  it("no dimension is both enabled and coded — resolves to one default/unresolved result, same as before this decision", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();

    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolutions).toEqual([{ targetUserId: "bob", reasoning: "No cost-object information recorded for this line. Sent to the configured Default Approver." }]);
  });

  it("reports unresolved, not a guess, when no dimension applies and no Default Approver is configured", async () => {
    const resolutions = await resolveApprovalTargets(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolutions).toEqual([{ unresolved: true, reason: "No cost-object information recorded for this line. No Default Approver is configured." }]);
  });
});

describe("resolveApprovalHierarchy — api is named but not built; manual resolves only from a human's own choice (decision 0495)", () => {
  it("manual mode with nobody manually selected falls to the Default Approver, never fakes a resolution", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual', default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });

  it("manual mode with nobody manually selected and no Default Approver reports unresolved", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual', default_approver_user_id = NULL WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ unresolved: true });
  });

  it("api mode with no Default Approver reports unresolved rather than guessing", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'api' WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
    });
    expect(resolution).toMatchObject({ unresolved: true });
  });
});

describe("resolveApprovalHierarchy — Route To Approver's own manual selection (decision 0495)", () => {
  it("uses the manually selected approver directly, over any configured Default Approver", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual', default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
      manualTargetUserId: "alice",
    });
    expect(resolution).toMatchObject({ targetUserId: "alice" });
  });

  it("reports unresolved when the manually selected user does not exist, rather than trusting the caller blindly", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual', default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
      manualTargetUserId: "nobody-by-this-id",
    });
    expect(resolution).toMatchObject({ unresolved: true });
  });

  it("ignores manualTargetUserId entirely outside Manual mode — the operator's own words: 'otherwise, no selection of an approver'", async () => {
    // employee_supervisor is the default mode straight off applyTestSchema
    // — no explicit UPDATE needed, which is itself part of the point:
    // this is what an ordinary customer's config already looks like.
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "coding", name: "Coding", sequence: 1, evaluationScope: "line" });
    await handleCreateStage(env.DB, "p1", { id: "approval", name: "Approval", sequence: 2, evaluationScope: "line" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;
    const visitId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'coding', 'matched', datetime('now'))"
    )
      .bind(visitId, instanceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, line_number, completed_by, completed_at)
       VALUES (?, 'coding', ?, 'alice', 'AP.Code', 1, 'alice', datetime('now'))`
    )
      .bind(crypto.randomUUID(), visitId)
      .run();
    await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('alice', 'EUR', 2000)").run();

    // Alice coded the line and her own limit covers it — the
    // Employee-Supervisor chain's own, correct answer. A manual
    // approver ("bob") is offered anyway; this mode has its own chain
    // and must not notice it at all.
    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId,
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
      manualTargetUserId: "bob",
    });
    expect(resolution).toMatchObject({ targetUserId: "alice" });
  });
});

describe("resolveApprovalHierarchy — no longer checks Non-PO routing (decision 0471)", () => {
  it("ignores collaboratorUserIds entirely and goes straight to mode dispatch, toggle on or off", async () => {
    // The single-target contract can't represent "route to more than
    // one Business Approver," so decision 0471 moved this check into
    // resolveApprovalTargets alone — reached directly, this function
    // now behaves as if Non-PO routing did not exist at all.
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1, default_approver_user_id = 'bob' WHERE id = 1").run();
    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, "Business Approver", JSON.stringify(["Procurement.Approve"]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice', ?)").bind(roleId).run();

    const resolution = await resolveApprovalHierarchy(env.DB, {
      instanceId: "inv-1",
      processId: "p1",
      currentSequence: 2,
      processVersion: 1,
      lineNumber: 1,
      unitId: null,
      currency: "EUR",
      amount: 1500,
      costCentreId: null,
      poReferenced: false,
      collaboratorUserIds: ["alice"],
    });
    // employee_supervisor mode, no line coder seeded — falls straight
    // to Default Approver, never to alice, even though she genuinely
    // holds Procurement.Approve and the toggle is on.
    expect(resolution).toMatchObject({ targetUserId: "bob" });
  });
});

describe("Non-PO Approval routing — decisions 0468/0469/0471, resolveApprovalTargets only, additive ahead of whichever mode is configured", () => {
  const baseParams = {
    instanceId: "inv-1",
    processId: "p1",
    currentSequence: 2,
    processVersion: 1,
    lineNumber: 1,
    unitId: null,
    currency: "EUR",
    amount: 1500,
    costCentreId: null,
  };

  /** A real role grant, the same shape every other permission test in this codebase uses — hasPermission reads org_roles/org_user_roles, not a flag on the user. */
  async function grantProcurementApprove(userId: string): Promise<void> {
    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, "Business Approver", JSON.stringify(["Procurement.Approve"]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, roleId).run();
  }

  it("off by default: a Non-PO invoice with a qualifying collaborator still falls through to the configured mode", async () => {
    // No toggle flip at all — the migration's own default.
    await env.DB.prepare("UPDATE org_approval_config SET default_approver_user_id = 'bob' WHERE id = 1").run();
    await grantProcurementApprove("alice");
    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: false,
      collaboratorUserIds: ["alice"],
    });
    // employee_supervisor mode, no line coder seeded — falls to Default
    // Approver exactly as it would with collaboratorUserIds absent.
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });

  it("routes to every collaborator who holds Procurement.Approve, once the toggle is on and the invoice is Non-PO", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1 WHERE id = 1").run();
    await handleCreateUser(env.DB, { id: "carol", email: "carol@acme.com", name: "Carol" });
    await grantProcurementApprove("alice");
    await grantProcurementApprove("carol");

    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: false,
      collaboratorUserIds: ["alice", "carol"],
    });
    // Both, in parallel — decision 0452's own multi-target shape — each
    // carrying its own requiredPermission override, the fix for the
    // gap decision 0470 left open.
    expect(resolutions).toEqual([
      {
        targetUserId: "alice",
        reasoning: expect.stringContaining("Business Approver"),
        requiredPermission: "Procurement.Approve",
      },
      {
        targetUserId: "carol",
        reasoning: expect.stringContaining("Business Approver"),
        requiredPermission: "Procurement.Approve",
      },
    ]);
  });

  it("skips a collaborator who was added but never granted Procurement.Approve — only whoever actually holds it is routed", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1 WHERE id = 1").run();
    await handleCreateUser(env.DB, { id: "carol", email: "carol@acme.com", name: "Carol" });
    await grantProcurementApprove("alice");
    // Carol is a collaborator (view/comment only, via Procurement.Collaborate
    // in real usage) but never a Business Approver.

    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: false,
      collaboratorUserIds: ["alice", "carol"],
    });
    expect(resolutions).toEqual([
      { targetUserId: "alice", reasoning: expect.any(String), requiredPermission: "Procurement.Approve" },
    ]);
  });

  it("a PO-referenced invoice still uses the configured mode, toggle on or not", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1, default_approver_user_id = 'bob' WHERE id = 1").run();
    await grantProcurementApprove("alice");
    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: true,
      collaboratorUserIds: ["alice"],
    });
    // employee_supervisor mode, no line coder seeded for this instance
    // — falls to Default Approver, never to alice, because this
    // invoice carries a PO reference.
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });

  it("no collaborators known: falls through even with the toggle on and no PO reference", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1, default_approver_user_id = 'bob' WHERE id = 1").run();
    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: false,
      collaboratorUserIds: [],
    });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });

  it("collaborators known, but none hold Procurement.Approve: falls through the same way", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1, default_approver_user_id = 'bob' WHERE id = 1").run();
    // alice is a collaborator but was never granted the role.
    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      poReferenced: false,
      collaboratorUserIds: ["alice"],
    });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });

  it("pre-empts cost_object mode's own multi-dimension walk entirely, same precedence as decision 0469", async () => {
    await env.DB.prepare(
      "UPDATE org_approval_config SET mode = 'cost_object', route_non_po_to_requester = 1 WHERE id = 1"
    ).run();
    await grantProcurementApprove("alice");
    const resolutions = await resolveApprovalTargets(env.DB, {
      ...baseParams,
      costCentreId: "does-not-matter-here",
      poReferenced: false,
      collaboratorUserIds: ["alice"],
    });
    // A single target, not one per cost-object dimension.
    expect(resolutions).toEqual([
      { targetUserId: "alice", reasoning: expect.any(String), requiredPermission: "Procurement.Approve" },
    ]);
  });

  it("every field absent (every caller written before this decision) behaves exactly as before", async () => {
    await env.DB.prepare("UPDATE org_approval_config SET route_non_po_to_requester = 1, default_approver_user_id = 'bob' WHERE id = 1").run();
    // poReferenced/collaboratorUserIds simply omitted, the same shape
    // every pre-existing test in this file already uses.
    const resolutions = await resolveApprovalTargets(env.DB, baseParams);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ targetUserId: "bob" });
  });
});

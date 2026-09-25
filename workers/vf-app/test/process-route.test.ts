import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateProcess,
  handleCreateStage,
  handleGetProcess,
  handleStartDraft,
  handleAddDraftStage,
  handleRemoveDraftStage,
  handlePublishDraft,
  handleDiscardDraft,
  handleReorderDraftStages,
} from "../src/process-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateProcess", () => {
  it("400s when id or name is missing", async () => {
    const result = await handleCreateProcess(env.DB, { id: "p1" });
    expect(result.status).toBe(400);
  });

  it("creates a process", async () => {
    const result = await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT name FROM processes WHERE id = ?").bind("p1").first();
    expect(row).toEqual({ name: "Standard AP" });
  });

  it("409s on a duplicate id", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateProcess(env.DB, { id: "p1", name: "Different name" });
    expect(result.status).toBe(409);
  });
});

describe("handleCreateStage", () => {
  it("400s when id, name, or sequence is missing", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received" });
    expect(result.status).toBe(400);
  });

  it("404s when the process does not exist", async () => {
    const result = await handleCreateStage(env.DB, "does-not-exist", { id: "s1", name: "Received", sequence: 1 });
    expect(result.status).toBe(404);
  });

  it("creates a stage with no rule set — a purely automatic stage", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT name, sequence, rule_set_id FROM process_stages WHERE id = ?")
      .bind("s1")
      .first();
    expect(row).toEqual({ name: "Received", sequence: 1, rule_set_id: null });
  });

  it("404s when ruleSetId is provided but does not exist", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", {
      id: "s1",
      name: "Approval",
      sequence: 1,
      ruleSetId: "does-not-exist",
    });
    expect(result.status).toBe(404);
  });

  it("creates a stage with a real rule set", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs1", "test", "first_match", "active")
      .run();
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", {
      id: "s1",
      name: "Approval",
      sequence: 1,
      ruleSetId: "rs1",
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT rule_set_id FROM process_stages WHERE id = ?").bind("s1").first();
    expect(row).toEqual({ rule_set_id: "rs1" });
  });

  it("409s when the sequence is already used by another stage in the same process", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validated", sequence: 1 });
    expect(result.status).toBe(409);
  });

  it("the same sequence number is fine across two DIFFERENT processes", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateProcess(env.DB, { id: "p2", name: "Expense" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleCreateStage(env.DB, "p2", { id: "s2", name: "Submitted", sequence: 1 });
    expect(result.status).toBe(201);
  });
});

describe("handleGetProcess — decision 0349", () => {
  it("404s a process that does not exist", async () => {
    const result = await handleGetProcess(env.DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("returns the live stages in sequence order, and no draft when none exists", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validated", sequence: 2 });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });

    const result = await handleGetProcess(env.DB, "p1");
    expect(result.status).toBe(200);
    const body = result.body as { version: number; stages: { id: string }[]; draft: unknown };
    expect(body.version).toBe(1);
    expect(body.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(body.draft).toBeNull();
  });

  it("joins the rule set's own name onto each stage", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs1", "AP Approval Rules", "first_match", "active")
      .run();
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { ruleSetId: string | null; ruleSetName: string | null }[] };
    expect(body.stages[0]).toEqual(expect.objectContaining({ ruleSetId: "rs1", ruleSetName: "AP Approval Rules" }));
  });

  it("shows a draft, distinct from the live version, once one exists", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { version: number; stages: { id: string }[]; draft: { version: number; stages: { id: string }[] } | null };
    expect(body.version).toBe(1);
    expect(body.stages.map((s) => s.id)).toEqual(["s1"]);
    expect(body.draft?.version).toBe(2);
    expect(body.draft?.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("defaults a new stage to offering field restrictions — decision 0485", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Validation", sequence: 1 });

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { id: string; offerFieldRestrictions: boolean }[] };
    expect(body.stages[0]).toEqual(expect.objectContaining({ offerFieldRestrictions: true }));
  });

  it("carries a stage turned off through to the read", async () => {
    // Reads the same column `handleSetStageOffersFieldRestrictions`
    // writes; a real, if minimal, end-to-end check that the two agree
    // on what "off" means.
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "intake", name: "Intake", sequence: 1 });
    await env.DB.prepare("UPDATE process_stages SET offer_field_restrictions = 0 WHERE id = 'intake'").run();

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { id: string; offerFieldRestrictions: boolean }[] };
    expect(body.stages[0]).toEqual(expect.objectContaining({ offerFieldRestrictions: false }));
  });

  it("defaults a new stage to not reverifying its rule on Complete — decision 0487, sparse and off by default", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Coding", sequence: 1 });

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { id: string; reverifyRuleOnComplete: boolean }[] };
    expect(body.stages[0]).toEqual(expect.objectContaining({ reverifyRuleOnComplete: false }));
  });

  it("carries a stage turned on through to the read", async () => {
    // Reads the same table `handleSetStageAction` writes to — a real,
    // if minimal, end-to-end check that the two agree.
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Coding", sequence: 1 });
    await env.DB
      .prepare(
        `INSERT INTO stage_actions (stage_id, action, reverify_rule_on_complete) VALUES ('s1', 'complete', 1)`
      )
      .run();

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { id: string; reverifyRuleOnComplete: boolean }[] };
    expect(body.stages[0]).toEqual(expect.objectContaining({ reverifyRuleOnComplete: true }));
  });

  it("defaults a new stage to no configured return targets — decision 0490, sparse", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1 });

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { stages: { id: string; returnTargets: unknown[] }[] };
    expect(body.stages[0].returnTargets).toEqual([]);
  });

  it("carries a configured return target through to the read, with its names resolved", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Coding", sequence: 2 });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-coding', 'Coding', 'u1')").run();
    await env.DB
      .prepare("INSERT INTO stage_return_targets (id, source_stage_id, target_stage_id, team_id) VALUES ('rt1', 's1', 's2', 'team-coding')")
      .run();

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as {
      stages: { id: string; returnTargets: { id: string; targetStageId: string; targetStageName: string; teamId: string; teamName: string }[] }[];
    };
    const approval = body.stages.find((s) => s.id === "s1");
    expect(approval?.returnTargets).toEqual([
      { id: "rt1", targetStageId: "s2", targetStageName: "Coding", teamId: "team-coding", teamName: "Coding" },
    ]);
    // Coding itself has none configured from it.
    expect(body.stages.find((s) => s.id === "s2")?.returnTargets).toEqual([]);
  });

  it("returns every org team alongside the stages — the picker's own team list", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-coding', 'Coding', 'u1')").run();

    const result = await handleGetProcess(env.DB, "p1");
    const body = result.body as { teams: { id: string; name: string }[] };
    expect(body.teams).toEqual([{ id: "team-coding", name: "Coding" }]);
  });
});

describe("handleStartDraft — decision 0353", () => {
  it("404s a process that does not exist", async () => {
    const result = await handleStartDraft(env.DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  /**
   * **The exact gap reported live** — "It seems that I cannot modify
   * an existing process?" Starting a draft was always possible as a
   * side effect of adding or removing a stage; there was no way in
   * for someone who only wants to reorder or remove something,
   * without first typing in a stage nobody actually wants.
   */
  it("starts a draft with nothing new in it, copying the live version's own membership exactly", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Approval", sequence: 2 });

    const result = await handleStartDraft(env.DB, "p1");
    expect(result.status).toBe(200);
    const body = result.body as { draft: { version: number; stages: { id: string }[] } };
    expect(body.draft.version).toBe(2);
    expect(body.draft.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("is idempotent — calling it again on a process that already has a draft just returns it, without re-copying", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleStartDraft(env.DB, "p1");
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handleStartDraft(env.DB, "p1");
    const body = result.body as { draft: { stages: { id: string }[] } };
    // Still both — a second start-draft call must not reset the
    // draft's own membership back to a fresh copy of the live version.
    expect(body.draft.stages.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("lets the newly-started draft's own, already-existing stages be removed and reordered directly", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Approval", sequence: 2 });

    await handleStartDraft(env.DB, "p1");
    // Reordering an existing, previously-live stage — never possible
    // before this existed, since there was no way to reach a draft
    // without adding something new first.
    const reorderResult = await handleReorderDraftStages(env.DB, "p1", ["s2", "s1"]);
    expect(reorderResult.status).toBe(200);

    const draft = await env.DB
      .prepare("SELECT stage_id FROM process_stage_versions WHERE process_id = 'p1' AND version = 2 ORDER BY sequence")
      .all<{ stage_id: string }>();
    expect(draft.results.map((r: { stage_id: string }) => r.stage_id)).toEqual(["s2", "s1"]);
  });
});

describe("handleAddDraftStage — decision 0349", () => {
  it("400s when id or name is missing", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleAddDraftStage(env.DB, "p1", { id: "s1" });
    expect(result.status).toBe(400);
  });

  it("404s when the process does not exist", async () => {
    const result = await handleAddDraftStage(env.DB, "does-not-exist", { id: "s1", name: "Coding" });
    expect(result.status).toBe(404);
  });

  it("409s a stage id that already exists", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleAddDraftStage(env.DB, "p1", { id: "s1", name: "Duplicate" });
    expect(result.status).toBe(409);
  });

  it("404s a ruleSetId that does not exist", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleAddDraftStage(env.DB, "p1", { id: "s1", name: "Coding", ruleSetId: "does-not-exist" });
    expect(result.status).toBe(404);
  });

  /**
   * **The exact claim reported live** — a stage already on the live
   * version is never touched by adding to the draft.
   */
  it("never changes the live version's own membership", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const process = await env.DB.prepare("SELECT version FROM processes WHERE id = 'p1'").first<{ version: number }>();
    expect(process?.version).toBe(1);
    const liveMembership = await env.DB
      .prepare("SELECT stage_id FROM process_stage_versions WHERE process_id = 'p1' AND version = 1")
      .all<{ stage_id: string }>();
    expect(liveMembership.results.map((r: { stage_id: string }) => r.stage_id)).toEqual(["s1"]);
  });

  it("creates the draft by copying the live version's own membership forward, on the first edit", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validation", sequence: 2 });

    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Coding" });

    const draftMembership = await env.DB
      .prepare("SELECT stage_id, sequence FROM process_stage_versions WHERE process_id = 'p1' AND version = 2 ORDER BY sequence")
      .all<{ stage_id: string; sequence: number }>();
    expect(draftMembership.results.map((r: { stage_id: string; sequence: number }) => r.stage_id)).toEqual(["s1", "s2", "s3"]);
  });

  it("appends to the end of the draft's own order, ignoring process_stages.sequence entirely", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });
    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Approval" });

    const draftMembership = await env.DB
      .prepare("SELECT stage_id, sequence FROM process_stage_versions WHERE process_id = 'p1' AND version = 2 ORDER BY sequence")
      .all<{ stage_id: string; sequence: number }>();
    expect(draftMembership.results.map((r: { stage_id: string; sequence: number }) => r.stage_id)).toEqual(["s1", "s2", "s3"]);
  });

  it("adding twice to the same draft does not re-copy the live version a second time", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });
    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Approval" });

    const draftMembership = await env.DB
      .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = 'p1' AND version = 2 AND stage_id = 's1'")
      .first<{ n: number }>();
    expect(draftMembership?.n).toBe(1);
  });
});

describe("handleRemoveDraftStage — decision 0349", () => {
  it("404s when the process does not exist", async () => {
    const result = await handleRemoveDraftStage(env.DB, "does-not-exist", "s1");
    expect(result.status).toBe(404);
  });

  it("404s a stage not in the current draft", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleRemoveDraftStage(env.DB, "p1", "does-not-exist");
    expect(result.status).toBe(404);
  });

  /**
   * **Line Review, the exact case decision 0150 was written for.** A
   * completed task cites the stage; the stage row is never deleted,
   * only absent from the new version's own membership.
   */
  it("removes a stage from the draft without deleting the stage row itself", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Line Review", sequence: 2 });

    const result = await handleRemoveDraftStage(env.DB, "p1", "s2");
    expect(result.status).toBe(200);

    const stageRow = await env.DB.prepare("SELECT id FROM process_stages WHERE id = 's2'").first();
    expect(stageRow).not.toBeNull();
    const draftMembership = await env.DB
      .prepare("SELECT stage_id FROM process_stage_versions WHERE process_id = 'p1' AND version = 2")
      .all<{ stage_id: string }>();
    expect(draftMembership.results.map((r: { stage_id: string }) => r.stage_id)).toEqual(["s1"]);
  });

  it("422s removing the last remaining stage from a draft", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleRemoveDraftStage(env.DB, "p1", "s1");
    expect(result.status).toBe(422);
    const draftMembership = await env.DB
      .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = 'p1' AND version = 2")
      .first<{ n: number }>();
    expect(draftMembership?.n).toBe(1);
  });
});

describe("handlePublishDraft — decision 0349", () => {
  it("404s when the process does not exist", async () => {
    const result = await handlePublishDraft(env.DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("422s when there is no draft to publish", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handlePublishDraft(env.DB, "p1");
    expect(result.status).toBe(422);
  });

  it("bumps processes.version to the draft's own version, and nothing else", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handlePublishDraft(env.DB, "p1");
    expect(result.status).toBe(200);
    const process = await env.DB.prepare("SELECT version FROM processes WHERE id = 'p1'").first<{ version: number }>();
    expect(process?.version).toBe(2);
  });

  /**
   * **The exact requirement confirmed live**: "anything already on a
   * process version would complete that version; only new items
   * entering the process would follow a new version." An in-flight
   * instance's own `process_version` is never touched by publishing.
   */
  it("never changes an in-flight instance's own process_version", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await env.DB
      .prepare(
        "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, process_version) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind("inst1", "p1", "invoice", "inv1", "s1", 1)
      .run();

    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });
    await handlePublishDraft(env.DB, "p1");

    const instance = await env.DB.prepare("SELECT process_version FROM process_instances WHERE id = 'inst1'").first<{ process_version: number }>();
    expect(instance?.process_version).toBe(1);
  });
});

describe("handleDiscardDraft — decision 0349", () => {
  it("404s when the process does not exist", async () => {
    const result = await handleDiscardDraft(env.DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("deletes only the draft's own membership, leaving the live version untouched", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handleDiscardDraft(env.DB, "p1");
    expect(result.status).toBe(200);

    const draftMembership = await env.DB
      .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = 'p1' AND version = 2")
      .first<{ n: number }>();
    expect(draftMembership?.n).toBe(0);
    const liveMembership = await env.DB
      .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = 'p1' AND version = 1")
      .first<{ n: number }>();
    expect(liveMembership?.n).toBe(1);
    const process = await env.DB.prepare("SELECT version FROM processes WHERE id = 'p1'").first<{ version: number }>();
    expect(process?.version).toBe(1);
  });
});

describe("process routes, gated for the first time — decision 0349", () => {
  async function keyForPermission(permission: string): Promise<string> {
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
      .bind(id, `${id}@acme.com`, "Test", await hashApiKey(apiKey))
      .run();

    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, `Role granting ${permission}`, JSON.stringify([permission]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();

    return apiKey;
  }

  it("POST /processes succeeds for Admin.Configure, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.Configure");
    const res = await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /processes 403s a real request lacking Admin.Configure", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /processes 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes", {
      method: "POST",
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /processes/:id/stages 403s a real request lacking Admin.Configure", async () => {
    const setupKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /processes/:id succeeds for Admin.Configure, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const res = await SELF.fetch("https://example.com/processes/p1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
  });

  describe("GET /processes — either standing opens it, decision 0351", () => {
    it("succeeds for Admin.Configure", async () => {
      const apiKey = await keyForPermission("Admin.Configure");
      const res = await SELF.fetch("https://example.com/processes", { headers: { Authorization: `Bearer ${apiKey}` } });
      expect(res.status).toBe(200);
    });

    it("succeeds for Admin.RuleManagement too — needed to populate the Rules screen's own process selector", async () => {
      const apiKey = await keyForPermission("Admin.RuleManagement");
      const res = await SELF.fetch("https://example.com/processes", { headers: { Authorization: `Bearer ${apiKey}` } });
      expect(res.status).toBe(200);
    });

    it("403s a real request holding neither", async () => {
      const apiKey = await keyForPermission("AP.Dashboard");
      const res = await SELF.fetch("https://example.com/processes", { headers: { Authorization: `Bearer ${apiKey}` } });
      expect(res.status).toBe(403);
    });

    it("401s with no credential at all", async () => {
      const res = await SELF.fetch("https://example.com/processes");
      expect(res.status).toBe(401);
    });
  });

  it("GET /processes/:id 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes/p1");
    expect(res.status).toBe(401);
  });

  it("POST /processes/:id/draft/stages 403s a real request lacking Admin.Configure", async () => {
    const setupKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes/p1/draft/stages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "s1", name: "Coding" }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /processes/:id/draft/stages/:stageId 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes/p1/draft/stages/s1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("POST /processes/:id/publish 403s a real request lacking Admin.Configure", async () => {
    const setupKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes/p1/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /processes/:id/draft 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes/p1/draft", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("handleReorderDraftStages — decision 0352", () => {
  it("404s when the process does not exist", async () => {
    const result = await handleReorderDraftStages(env.DB, "does-not-exist", ["s1"]);
    expect(result.status).toBe(404);
  });

  it("400s when orderedStageIds is not an array of strings", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const notArray = await handleReorderDraftStages(env.DB, "p1", "s1");
    expect(notArray.status).toBe(400);
    const mixedTypes = await handleReorderDraftStages(env.DB, "p1", ["s1", 2]);
    expect(mixedTypes.status).toBe(400);
  });

  it("422s when there is no draft to reorder at all", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleReorderDraftStages(env.DB, "p1", ["s1"]);
    expect(result.status).toBe(422);
  });

  it("422s a partial list — missing a stage the draft actually has", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });
    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Approval" });

    const result = await handleReorderDraftStages(env.DB, "p1", ["s1", "s2"]);
    expect(result.status).toBe(422);
  });

  it("422s a list naming a stage that isn't in the draft at all", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handleReorderDraftStages(env.DB, "p1", ["s1", "does-not-exist"]);
    expect(result.status).toBe(422);
  });

  it("422s a list with a duplicate entry, even if the set would otherwise match", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });

    const result = await handleReorderDraftStages(env.DB, "p1", ["s1", "s1"]);
    expect(result.status).toBe(422);
  });

  it("reorders the draft's own membership to exactly the given order", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleAddDraftStage(env.DB, "p1", { id: "s2", name: "Coding" });
    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Approval" });
    // Draft order is currently s1, s2, s3 — reverse it.

    const result = await handleReorderDraftStages(env.DB, "p1", ["s3", "s1", "s2"]);
    expect(result.status).toBe(200);

    const draft = await env.DB
      .prepare("SELECT stage_id, sequence FROM process_stage_versions WHERE process_id = 'p1' AND version = 2 ORDER BY sequence")
      .all<{ stage_id: string; sequence: number }>();
    expect(draft.results.map((r: { stage_id: string }) => r.stage_id)).toEqual(["s3", "s1", "s2"]);
    expect(draft.results.map((r: { sequence: number }) => r.sequence)).toEqual([1, 2, 3]);
  });

  /**
   * **The exact boundary decision 0349 already established, checked
   * directly for this new action too.** Reordering a draft must never
   * touch the live version's own order, and must never touch an
   * in-flight instance already visiting a stage under it.
   */
  it("never changes the live version's own order, or an in-flight instance's own process_version", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Approval", sequence: 2 });
    await env.DB
      .prepare(
        "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, process_version) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind("inst1", "p1", "invoice", "inv1", "s1", 1)
      .run();

    await handleAddDraftStage(env.DB, "p1", { id: "s3", name: "Coding" });
    await handleReorderDraftStages(env.DB, "p1", ["s3", "s1", "s2"]);

    const liveOrder = await env.DB
      .prepare("SELECT stage_id FROM process_stage_versions WHERE process_id = 'p1' AND version = 1 ORDER BY sequence")
      .all<{ stage_id: string }>();
    expect(liveOrder.results.map((r: { stage_id: string }) => r.stage_id)).toEqual(["s1", "s2"]);

    const instance = await env.DB.prepare("SELECT process_version FROM process_instances WHERE id = 'inst1'").first<{ process_version: number }>();
    expect(instance?.process_version).toBe(1);
  });
});

describe("process routes, gated for the first time — decision 0349 — reorder route, decision 0352", () => {
  async function keyForPermission(permission: string): Promise<string> {
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
      .bind(id, `${id}@acme.com`, "Test", await hashApiKey(apiKey))
      .run();

    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, `Role granting ${permission}`, JSON.stringify([permission]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();

    return apiKey;
  }

  it("PUT /processes/:id/draft/stages 403s a real request lacking Admin.Configure", async () => {
    const setupKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes/p1/draft/stages", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderedStageIds: ["s1"] }),
    });
    expect(res.status).toBe(403);
  });

  it("PUT /processes/:id/draft/stages 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes/p1/draft/stages", {
      method: "PUT",
      body: JSON.stringify({ orderedStageIds: ["s1"] }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /processes/:id/draft/stages succeeds for Admin.Configure, through the real router — and never collides with POST on the same path", async () => {
    const apiKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }),
    });
    const addRes = await SELF.fetch("https://example.com/processes/p1/draft/stages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "s2", name: "Coding" }),
    });
    expect(addRes.status).toBe(201);

    const reorderRes = await SELF.fetch("https://example.com/processes/p1/draft/stages", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderedStageIds: ["s2", "s1"] }),
    });
    expect(reorderRes.status).toBe(200);
  });

  it("POST /processes/:id/draft (start a draft) 403s a real request lacking Admin.Configure", async () => {
    const setupKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${setupKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/processes/p1/draft", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(403);
  });

  it("POST /processes/:id/draft 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/processes/p1/draft", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /processes/:id/draft succeeds for Admin.Configure, and never collides with DELETE on the same path", async () => {
    const apiKey = await keyForPermission("Admin.Configure");
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "Standard AP" }),
    });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }),
    });

    const startRes = await SELF.fetch("https://example.com/processes/p1/draft", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(startRes.status).toBe(200);

    // The draft this just started is real, and DELETE on the very
    // same path still discards it rather than clashing with POST.
    const discardRes = await SELF.fetch("https://example.com/processes/p1/draft", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(discardRes.status).toBe(200);
  });
});

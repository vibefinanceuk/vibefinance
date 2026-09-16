import type { RouteResult } from "./org-route.js";

/**
 * CRUD for process definitions, stages, and their versioned membership
 * — the definition layer of the workflow engine. See docs/decisions/
 * 0018-process-definitions-and-tasks.md, 0015-process-workflow-engine.md,
 * 0150-versioning-a-process.md, and 0160-finishing-the-versioning-skeleton.md.
 *
 * **Gated to `Admin.Configure` — decision 0349.** `POST /processes`
 * and `POST /processes/:id/stages` had been unauthenticated since
 * decisions 0018/0128, on the reasoning that this is definition-time
 * setup rather than gated product usage — the same reasoning `/org/units`
 * carried before decision 0335 closed the identical gap there. Checked
 * directly rather than assumed: `GET /processes` already required
 * `Admin.Configure`; the two write routes never did. Closed here,
 * building a real screen on top of them rather than leaving the gap
 * for whoever builds one next.
 */

interface CreateProcessBody {
  id?: unknown;
  name?: unknown;
}

export async function handleCreateProcess(db: D1Database, body: CreateProcessBody): Promise<RouteResult> {
  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  const existing = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `process ${id} already exists` } };
  }
  await db.prepare("INSERT INTO processes (id, name) VALUES (?, ?)").bind(id, name).run();
  return { status: 201, body: { id, name } };
}

interface CreateStageBody {
  id?: unknown;
  name?: unknown;
  sequence?: unknown;
  ruleSetId?: unknown;
  evaluationScope?: unknown;
}

const KNOWN_EVALUATION_SCOPES = ["header", "line"] as const;

export async function handleCreateStage(
  db: D1Database,
  processId: string,
  body: CreateStageBody
): Promise<RouteResult> {
  const { id, name, sequence, ruleSetId, evaluationScope } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name || typeof sequence !== "number") {
    return { status: 400, body: { error: "id, name (strings) and sequence (number) are required" } };
  }
  if (ruleSetId !== undefined && (typeof ruleSetId !== "string" || !ruleSetId)) {
    return { status: 400, body: { error: "ruleSetId, if provided, must be a non-empty string" } };
  }
  if (
    evaluationScope !== undefined &&
    !KNOWN_EVALUATION_SCOPES.includes(evaluationScope as (typeof KNOWN_EVALUATION_SCOPES)[number])
  ) {
    return { status: 400, body: { error: `evaluationScope, if provided, must be one of: ${KNOWN_EVALUATION_SCOPES.join(", ")}` } };
  }

  const processExists = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!processExists) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  if (ruleSetId) {
    const ruleSetExists = await db.prepare("SELECT id FROM rule_sets WHERE id = ?").bind(ruleSetId).first();
    if (!ruleSetExists) {
      return { status: 404, body: { error: `rule set ${ruleSetId} does not exist` } };
    }
  }
  const existing = await db.prepare("SELECT id FROM process_stages WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `stage ${id} already exists` } };
  }
  const sequenceTaken = await db
    .prepare("SELECT id FROM process_stages WHERE process_id = ? AND sequence = ?")
    .bind(processId, sequence)
    .first();
  if (sequenceTaken) {
    return { status: 409, body: { error: `sequence ${sequence} is already used by another stage in this process` } };
  }

  const scope = (evaluationScope as string) ?? "header";
  await db
    .prepare("INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id, evaluation_scope) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, processId, name, sequence, (ruleSetId as string) ?? null, scope)
    .run();

  /**
   * The stage joins the process's current version — decision 0150.
   *
   * **A stage in no version is a stage nothing can reach.** The
   * workflow engine reads a version's membership to find what comes
   * next, so a stage created outside one would exist and never be
   * visited — which is worse than not existing.
   *
   * `INSERT OR IGNORE`, because publishing a version writes its own
   * membership and this must not fight it.
   */
  await db
    .prepare(
      `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
       SELECT ?, p.version, ?, ? FROM processes p WHERE p.id = ?`
    )
    .bind(processId, id, sequence, processId)
    .run();

  return { status: 201, body: { id, processId, name, sequence, ruleSetId: ruleSetId ?? null, evaluationScope: scope } };
}

/**
 * **A draft is a version nobody has published yet — decision 0349.**
 * No new table, no new column: `process_stage_versions` already
 * stores membership for any version number, so a draft is simply the
 * rows already sitting at `processes.version + 1` — real before
 * publishing changes anything, and gone entirely once discarded.
 *
 * Lazy, not eager: a process with no draft has no rows at that
 * version at all, and the first real edit is what creates one — by
 * copying the live version's own membership forward, so an edit is
 * always a change to what already exists rather than a blank slate
 * somebody has to rebuild from nothing.
 */
async function ensureDraftExists(db: D1Database, processId: string, liveVersion: number): Promise<number> {
  const draftVersion = liveVersion + 1;
  const existing = await db
    .prepare("SELECT 1 FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .first();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
         SELECT process_id, ?, stage_id, sequence FROM process_stage_versions
         WHERE process_id = ? AND version = ?`
      )
      .bind(draftVersion, processId, liveVersion)
      .run();
  }
  return draftVersion;
}

interface StageDetail {
  id: string;
  name: string;
  sequence: number;
  ruleSetId: string | null;
  ruleSetName: string | null;
  evaluationScope: string;
}

async function stagesAtVersion(db: D1Database, processId: string, version: number): Promise<StageDetail[]> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.name, v.sequence, s.rule_set_id, r.name AS rule_set_name, s.evaluation_scope
       FROM process_stage_versions v
       JOIN process_stages s ON s.id = v.stage_id
       LEFT JOIN rule_sets r ON r.id = s.rule_set_id
       WHERE v.process_id = ? AND v.version = ?
       ORDER BY v.sequence ASC`
    )
    .bind(processId, version)
    .all<{
      id: string;
      name: string;
      sequence: number;
      rule_set_id: string | null;
      rule_set_name: string | null;
      evaluation_scope: string;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    sequence: r.sequence,
    ruleSetId: r.rule_set_id,
    ruleSetName: r.rule_set_name,
    evaluationScope: r.evaluation_scope,
  }));
}

/**
 * **One process, its live stages, and its own draft if it has one —
 * decision 0349.** The read a configuration screen needs and nothing
 * before this gave it: `handleRuleStages` (decision 0128) returns
 * every stage across every process at once, with no `process_id`
 * filter and no version awareness at all — the wrong shape for a
 * screen managing one process's own draft.
 */
export async function handleGetProcess(db: D1Database, processId: string): Promise<RouteResult> {
  const process = await db
    .prepare("SELECT id, name, version FROM processes WHERE id = ?")
    .bind(processId)
    .first<{ id: string; name: string; version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const liveStages = await stagesAtVersion(db, processId, process.version);
  const draftVersion = process.version + 1;
  const draftStages = await stagesAtVersion(db, processId, draftVersion);

  return {
    status: 200,
    body: {
      id: process.id,
      name: process.name,
      version: process.version,
      stages: liveStages,
      draft: draftStages.length > 0 ? { version: draftVersion, stages: draftStages } : null,
    },
  };
}

interface AddDraftStageBody {
  id?: unknown;
  name?: unknown;
  ruleSetId?: unknown;
  evaluationScope?: unknown;
}

/**
 * **Add a new stage to a process's own draft — decision 0349.**
 * Deliberately narrower than `handleCreateStage`: this always appends
 * to the end of the draft's own order rather than accepting a
 * `sequence` from the caller, since a configuration screen reorders
 * by dragging, not by typing a number. `process_stages.sequence`
 * itself still needs a value the table's own `UNIQUE(process_id,
 * sequence)` constraint accepts — assigned as the next free number
 * *for that column*, never read by the workflow engine (which reads
 * `process_stage_versions.sequence` only — see `workflow-engine.ts`'s
 * own comment on `nextStageInSequence`), so what value it holds only
 * has to be valid, never meaningful.
 */
export async function handleAddDraftStage(
  db: D1Database,
  processId: string,
  body: AddDraftStageBody
): Promise<RouteResult> {
  const { id, name, ruleSetId, evaluationScope } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  if (ruleSetId !== undefined && ruleSetId !== null && (typeof ruleSetId !== "string" || !ruleSetId)) {
    return { status: 400, body: { error: "ruleSetId, if provided, must be a non-empty string" } };
  }
  if (
    evaluationScope !== undefined &&
    !KNOWN_EVALUATION_SCOPES.includes(evaluationScope as (typeof KNOWN_EVALUATION_SCOPES)[number])
  ) {
    return { status: 400, body: { error: `evaluationScope, if provided, must be one of: ${KNOWN_EVALUATION_SCOPES.join(", ")}` } };
  }

  const process = await db.prepare("SELECT version FROM processes WHERE id = ?").bind(processId).first<{ version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  if (ruleSetId) {
    const ruleSetExists = await db.prepare("SELECT id FROM rule_sets WHERE id = ?").bind(ruleSetId).first();
    if (!ruleSetExists) {
      return { status: 404, body: { error: `rule set ${ruleSetId} does not exist` } };
    }
  }
  const stageExists = await db.prepare("SELECT id FROM process_stages WHERE id = ?").bind(id).first();
  if (stageExists) {
    return { status: 409, body: { error: `stage ${id} already exists` } };
  }

  const draftVersion = await ensureDraftExists(db, processId, process.version);

  const nextDraftSequence = await db
    .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .first<{ next: number }>();
  const nextTableSequence = await db
    .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM process_stages WHERE process_id = ?")
    .bind(processId)
    .first<{ next: number }>();

  const scope = (evaluationScope as string) ?? "header";
  await db
    .prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id, evaluation_scope) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, processId, name, nextTableSequence!.next, (ruleSetId as string) ?? null, scope)
    .run();
  await db
    .prepare("INSERT INTO process_stage_versions (process_id, version, stage_id, sequence) VALUES (?, ?, ?, ?)")
    .bind(processId, draftVersion, id, nextDraftSequence!.next)
    .run();

  return {
    status: 201,
    body: { id, processId, name, ruleSetId: ruleSetId ?? null, evaluationScope: scope, draftVersion },
  };
}

/**
 * **Remove a stage from a process's own draft — decision 0349.**
 * Never a `DELETE` on `process_stages` itself: decision 0150's own
 * point is that a stage is not deleted, only absent from a version's
 * membership — its history, completed tasks, and any in-flight
 * instance still on an earlier version all still resolve.
 */
export async function handleRemoveDraftStage(db: D1Database, processId: string, stageId: string): Promise<RouteResult> {
  const process = await db.prepare("SELECT version FROM processes WHERE id = ?").bind(processId).first<{ version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  const draftVersion = await ensureDraftExists(db, processId, process.version);

  const inDraft = await db
    .prepare("SELECT 1 FROM process_stage_versions WHERE process_id = ? AND version = ? AND stage_id = ?")
    .bind(processId, draftVersion, stageId)
    .first();
  if (!inDraft) {
    return { status: 404, body: { error: `stage ${stageId} is not in the current draft` } };
  }

  const remaining = await db
    .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .first<{ n: number }>();
  if (remaining!.n <= 1) {
    return { status: 422, body: { error: "a draft cannot be published with no stages in it — add a replacement before removing the last one" } };
  }

  await db
    .prepare("DELETE FROM process_stage_versions WHERE process_id = ? AND version = ? AND stage_id = ?")
    .bind(processId, draftVersion, stageId)
    .run();

  return { status: 200, body: { processId, draftVersion, removed: stageId } };
}

/**
 * **Publish the draft as the new live version — decision 0349.**
 * `processes.version` is the only thing this changes: the draft's own
 * `process_stage_versions` rows already exist, written as each edit
 * was made, so publishing is a single number moving to point at rows
 * already there rather than a bulk copy happening at this moment.
 *
 * **Nothing about an in-flight instance changes.** `process_instances.
 * process_version` was stamped at creation (decision 0150) and this
 * update never touches that column — confirmed the operator's own
 * requirement directly: "anything already on a process version would
 * complete that version; only new items entering the process would
 * follow a new version."
 */
export async function handlePublishDraft(db: D1Database, processId: string): Promise<RouteResult> {
  const process = await db.prepare("SELECT version FROM processes WHERE id = ?").bind(processId).first<{ version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  const draftVersion = process.version + 1;
  const draftStageCount = await db
    .prepare("SELECT count(*) AS n FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .first<{ n: number }>();
  if (!draftStageCount || draftStageCount.n === 0) {
    return { status: 422, body: { error: "there is no draft to publish" } };
  }

  await db.prepare("UPDATE processes SET version = ? WHERE id = ?").bind(draftVersion, processId).run();

  return { status: 200, body: { id: processId, version: draftVersion } };
}

/**
 * **Discard a draft entirely — decision 0349.** Deletes only the
 * draft's own membership rows; the stages themselves, and any earlier,
 * already-published version, are untouched. A stage created only
 * within the discarded draft is left with no membership anywhere,
 * the same "exists for history, appears in no process" state decision
 * 0150 named and left undescribed — a real gap, not new here.
 */
export async function handleDiscardDraft(db: D1Database, processId: string): Promise<RouteResult> {
  const process = await db.prepare("SELECT version FROM processes WHERE id = ?").bind(processId).first<{ version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  const draftVersion = process.version + 1;
  await db
    .prepare("DELETE FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .run();

  return { status: 200, body: { id: processId } };
}

/**
 * **Reorder a draft's own stages — decision 0352**, reported live:
 * "I like the drag to re-order, if that is possible?" Safe in exactly
 * the way the draft mechanism already is: `process_stage_versions.
 * sequence` is scoped to one version, so reordering a draft never
 * touches the live version's own order, and never touches an
 * in-flight instance already visiting a stage under it — the same
 * "anything already on a version completes that version" boundary
 * decision 0349 already established for adding and removing a stage.
 *
 * **The whole set, not a partial move — checked, not assumed.** A
 * caller names every stage id in the draft, in the new order; anything
 * missing, extra, or duplicated is refused outright rather than
 * silently dropping a stage's own membership, the same discipline
 * `route_to`'s own "more than one distinct target" refusal already
 * applies elsewhere in this engine.
 */
export async function handleReorderDraftStages(
  db: D1Database,
  processId: string,
  orderedStageIds: unknown
): Promise<RouteResult> {
  if (!Array.isArray(orderedStageIds) || orderedStageIds.some((id) => typeof id !== "string")) {
    return { status: 400, body: { error: "orderedStageIds must be an array of stage id strings" } };
  }
  const ids = orderedStageIds as string[];

  const process = await db.prepare("SELECT version FROM processes WHERE id = ?").bind(processId).first<{ version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  const draftVersion = process.version + 1;

  const current = await db
    .prepare("SELECT stage_id FROM process_stage_versions WHERE process_id = ? AND version = ?")
    .bind(processId, draftVersion)
    .all<{ stage_id: string }>();
  if (current.results.length === 0) {
    return { status: 422, body: { error: "there is no draft to reorder" } };
  }

  const currentSet = new Set(current.results.map((r) => r.stage_id));
  const givenSet = new Set(ids);
  const sameSize = currentSet.size === givenSet.size && ids.length === givenSet.size;
  const sameMembers = sameSize && ids.every((id) => currentSet.has(id));
  if (!sameMembers) {
    return {
      status: 422,
      body: { error: "orderedStageIds must name exactly the stages already in the draft, once each — no fewer, no more, no duplicates" },
    };
  }

  for (let i = 0; i < ids.length; i++) {
    await db
      .prepare("UPDATE process_stage_versions SET sequence = ? WHERE process_id = ? AND version = ? AND stage_id = ?")
      .bind(i + 1, processId, draftVersion, ids[i])
      .run();
  }

  return { status: 200, body: { id: processId, draftVersion, order: ids } };
}

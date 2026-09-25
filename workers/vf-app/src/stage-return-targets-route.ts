import type { RouteResult } from "./org-route.js";

/**
 * Configuring where Return can send a document, and who receives it —
 * decision 0490.
 *
 * A sibling to `stage-actions-route.ts` in what it configures (a
 * stage's own button behaviour), but not built on the same table:
 * see migrations/0085_stage_return_targets.sql for why this is its
 * own table rather than a new column on `stage_actions` — a stage can
 * offer more than one return target, and a flag-per-row shape cannot
 * express a list.
 */

interface AddStageReturnTargetBody {
  targetStageId?: unknown;
  teamId?: unknown;
}

/**
 * Adding one configured target to a stage's own return list.
 *
 * **Both stages must belong to the same process** — a return that
 * named a stage from a different process would not be "somewhere this
 * document has been," the same reasoning the visited-stage check in
 * `return-route.ts` already applies at the moment somebody actually
 * returns something; this route just refuses the nonsensical
 * configuration before it can be saved at all.
 */
export async function handleAddStageReturnTarget(
  db: D1Database,
  sourceStageId: string,
  body: AddStageReturnTargetBody
): Promise<RouteResult> {
  const { targetStageId, teamId } = body;
  if (typeof targetStageId !== "string" || !targetStageId) {
    return { status: 400, body: { error: "targetStageId is required" } };
  }
  if (typeof teamId !== "string" || !teamId) {
    return { status: 400, body: { error: "teamId is required" } };
  }
  if (targetStageId === sourceStageId) {
    return { status: 422, body: { error: "a stage cannot be its own return target" } };
  }

  const source = await db
    .prepare("SELECT process_id FROM process_stages WHERE id = ?")
    .bind(sourceStageId)
    .first<{ process_id: string }>();
  if (!source) return { status: 404, body: { error: `stage ${sourceStageId} does not exist` } };

  const target = await db
    .prepare("SELECT process_id FROM process_stages WHERE id = ?")
    .bind(targetStageId)
    .first<{ process_id: string }>();
  if (!target) return { status: 404, body: { error: `stage ${targetStageId} does not exist` } };
  if (target.process_id !== source.process_id) {
    return { status: 422, body: { error: "the target stage must belong to the same process" } };
  }

  const team = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
  if (!team) return { status: 404, body: { error: `team ${teamId} does not exist` } };

  const existing = await db
    .prepare("SELECT id FROM stage_return_targets WHERE source_stage_id = ? AND target_stage_id = ?")
    .bind(sourceStageId, targetStageId)
    .first<{ id: string }>();
  if (existing) {
    return { status: 409, body: { error: "this target is already configured for this stage" } };
  }

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO stage_return_targets (id, source_stage_id, target_stage_id, team_id) VALUES (?, ?, ?, ?)")
    .bind(id, sourceStageId, targetStageId, teamId)
    .run();

  const row = await db
    .prepare(
      `SELECT ts.name AS target_stage_name, tm.name AS team_name
       FROM process_stages ts, org_teams tm
       WHERE ts.id = ? AND tm.id = ?`
    )
    .bind(targetStageId, teamId)
    .first<{ target_stage_name: string; team_name: string }>();

  return {
    status: 201,
    body: {
      id,
      sourceStageId,
      targetStageId,
      targetStageName: row?.target_stage_name ?? null,
      teamId,
      teamName: row?.team_name ?? null,
    },
  };
}

export async function handleRemoveStageReturnTarget(db: D1Database, id: string): Promise<RouteResult> {
  const result = await db.prepare("DELETE FROM stage_return_targets WHERE id = ?").bind(id).run();
  if (!result.meta.changes) {
    return { status: 404, body: { error: `return target ${id} does not exist` } };
  }
  return { status: 200, body: { id } };
}

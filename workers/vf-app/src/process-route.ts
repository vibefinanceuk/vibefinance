import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for process definitions and stages — the definition
 * layer of the workflow engine. See docs/decisions/
 * 0018-process-definitions-and-tasks.md and docs/decisions/
 * 0015-process-workflow-engine.md. Deliberately unauthenticated,
 * matching /org/* and /org/teams — this is the same class of
 * administrative/setup activity, not gated product usage.
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
}

export async function handleCreateStage(
  db: D1Database,
  processId: string,
  body: CreateStageBody
): Promise<RouteResult> {
  const { id, name, sequence, ruleSetId } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name || typeof sequence !== "number") {
    return { status: 400, body: { error: "id, name (strings) and sequence (number) are required" } };
  }
  if (ruleSetId !== undefined && (typeof ruleSetId !== "string" || !ruleSetId)) {
    return { status: 400, body: { error: "ruleSetId, if provided, must be a non-empty string" } };
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

  await db
    .prepare("INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id) VALUES (?, ?, ?, ?, ?)")
    .bind(id, processId, name, sequence, (ruleSetId as string) ?? null)
    .run();

  return { status: 201, body: { id, processId, name, sequence, ruleSetId: ruleSetId ?? null } };
}

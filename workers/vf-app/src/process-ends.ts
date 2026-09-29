/**
 * A process's entry and exit stages — decision 0557.
 *
 * Stored on the process (migration 0107). **A stored stage that the
 * process's current version no longer has is not used**: a draft
 * published since may have removed it. Then, as for a process created
 * after 0107, the first and last stages of the current version stand in.
 */
export async function processEnds(
  db: D1Database,
  processId: string
): Promise<{ stages: { id: string; name: string; sequence: number }[]; entryStageId: string | null; exitStageId: string | null }> {
  const process = await db
    .prepare("SELECT version, entry_stage_id, exit_stage_id FROM processes WHERE id = ?")
    .bind(processId)
    .first<{ version: number; entry_stage_id: string | null; exit_stage_id: string | null }>();
  if (!process) return { stages: [], entryStageId: null, exitStageId: null };
  const stages = await db
    .prepare(
      `SELECT s.id, s.name, v.sequence FROM process_stage_versions v
       JOIN process_stages s ON s.id = v.stage_id
       WHERE v.process_id = ? AND v.version = ? ORDER BY v.sequence`
    )
    .bind(processId, process.version)
    .all<{ id: string; name: string; sequence: number }>();
  /**
   * **A process whose stages belong to no version** (created before
   * versions, 0160, or seeded directly) falls back to its stages by
   * sequence, which is what 0552's payment-eligible read before 0558.
   */
  let list = stages.results;
  if (list.length === 0) {
    list = (
      await db
        .prepare("SELECT id, name, sequence FROM process_stages WHERE process_id = ? ORDER BY sequence")
        .bind(processId)
        .all<{ id: string; name: string; sequence: number }>()
    ).results;
  }
  const has = (id: string | null) => id !== null && list.some((s) => s.id === id);
  return {
    stages: list,
    entryStageId: has(process.entry_stage_id) ? process.entry_stage_id : list.at(0)?.id ?? null,
    exitStageId: has(process.exit_stage_id) ? process.exit_stage_id : list.at(-1)?.id ?? null,
  };
}

/**
 * **Every process's exit stage — decision 0558**, for the ERP export's
 * payment-eligible: an invoice at its process's exit stage (or whose
 * process has completed) is ready to go out.
 */
export async function exitStageIds(db: D1Database): Promise<string[]> {
  const processes = await db.prepare("SELECT id FROM processes").all<{ id: string }>();
  const ids: string[] = [];
  for (const p of processes.results) {
    const exit = (await processEnds(db, p.id)).exitStageId;
    if (exit) ids.push(exit);
  }
  return ids;
}

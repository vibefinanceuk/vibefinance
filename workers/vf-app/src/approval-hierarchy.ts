import { unitLineage } from "./unit-config.js";
import { resolveApprovalChain } from "./ledger-route.js";

/**
 * Who approves an invoice, resolved at the moment a task is created —
 * decision 0439.
 *
 * **One resolver, the same discipline `unit-config.ts` already
 * established** (decision 0196's own risk: forgetting the unit does
 * not fail, it returns the group's answer). Every lookup here goes
 * through `unitLineage()`, most-specific-wins, exactly the walk rule
 * sets and field visibility already use.
 *
 * **Only Employee-Supervisor and Cost-Object actually resolve
 * anything.** Manual and API are named in `org_approval_config`'s own
 * vocabulary so the setting is complete, not grown one migration at a
 * time (the same choice permissions.ts already made for `AP.Match`
 * and `AP.Code`) — but neither has a resolver yet, and selecting
 * either here reports that plainly rather than faking a result.
 */

export interface ApprovalResolution {
  targetUserId: string;
  reasoning: string;
}

export interface ApprovalUnresolved {
  unresolved: true;
  reason: string;
}

export type ApprovalMode = "employee_supervisor" | "cost_object" | "manual" | "api";

interface ApprovalConfig {
  mode: ApprovalMode;
  defaultApproverUserId: string | null;
}

/** The one, customer-wide setting — decision 0439's own answer to "where does the choice live." */
export async function loadApprovalConfig(db: D1Database): Promise<ApprovalConfig> {
  const row = await db
    .prepare("SELECT mode, default_approver_user_id FROM org_approval_config WHERE id = 1")
    .first<{ mode: ApprovalMode; default_approver_user_id: string | null }>();
  // The row is inserted by its own migration and never deleted (the
  // CHECK (id = 1) primary key forbids a second one) — this fallback
  // is belt-and-braces for a database this resolver's own tests build
  // by hand, not a real path in production.
  return { mode: row?.mode ?? "employee_supervisor", defaultApproverUserId: row?.default_approver_user_id ?? null };
}

/**
 * What this person may approve, at this unit, in this currency.
 *
 * **The override first, most specific unit wins; the group-wide
 * default (`org_authority_limits`, decision 0009, untouched) after.**
 * `null` means no limit is recorded anywhere for them — a
 * configuration gap for the caller to escalate past, not an unlimited
 * approver (see `resolveEmployeeSupervisor`'s own comment on why that
 * reads the other way `resolveApprovalChain`'s null limit does).
 */
export async function resolveApprovalLimit(
  db: D1Database,
  userId: string,
  unitId: string | null,
  currency: string
): Promise<number | null> {
  const lineage = await unitLineage(db, unitId);
  if (lineage.length > 0) {
    const placeholders = lineage.map(() => "?").join(", ");
    const overrides = await db
      .prepare(
        `SELECT unit_id, max_amount FROM org_authority_limit_overrides
         WHERE user_id = ? AND currency = ? AND unit_id IN (${placeholders})`
      )
      .bind(userId, currency, ...lineage)
      .all<{ unit_id: string; max_amount: number }>();

    for (const unit of lineage) {
      const match = overrides.results.find((o) => o.unit_id === unit);
      if (match) return match.max_amount;
    }
  }

  const base = await db
    .prepare("SELECT max_amount FROM org_authority_limits WHERE user_id = ? AND currency = ?")
    .bind(userId, currency)
    .first<{ max_amount: number }>();
  return base ? base.max_amount : null;
}

/**
 * Who this person's supervisor is, at this unit.
 *
 * **The override first, most specific unit wins; `org_users.
 * manager_id` (decision 0334, untouched) after.** `null` means nobody
 * is recorded — the chain ends here, unresolved by this route.
 */
export async function resolveSupervisorId(
  db: D1Database,
  userId: string,
  unitId: string | null
): Promise<string | null> {
  const lineage = await unitLineage(db, unitId);
  if (lineage.length > 0) {
    const placeholders = lineage.map(() => "?").join(", ");
    const overrides = await db
      .prepare(
        `SELECT unit_id, supervisor_id FROM org_user_supervisor_overrides
         WHERE user_id = ? AND unit_id IN (${placeholders})`
      )
      .bind(userId, ...lineage)
      .all<{ unit_id: string; supervisor_id: string }>();

    for (const unit of lineage) {
      const match = overrides.results.find((o) => o.unit_id === unit);
      if (match) return match.supervisor_id;
    }
  }

  const base = await db.prepare("SELECT manager_id FROM org_users WHERE id = ?").bind(userId).first<{ manager_id: string | null }>();
  return base?.manager_id ?? null;
}

/** The stage immediately before this one, in this instance's own process version — the mirror of `nextStageInSequence`. */
async function previousStageInSequence(
  db: D1Database,
  processId: string,
  currentSequence: number,
  processVersion: number
): Promise<{ id: string; sequence: number } | null> {
  return db
    .prepare(
      `SELECT s.id, v.sequence
       FROM process_stage_versions v
       JOIN process_stages s ON s.id = v.stage_id
       WHERE v.process_id = ? AND v.version = ? AND v.sequence < ?
       ORDER BY v.sequence DESC LIMIT 1`
    )
    .bind(processId, processVersion, currentSequence)
    .first<{ id: string; sequence: number }>();
}

/**
 * **Whoever coded this line** — the operator's own answer to where an
 * Employee-Supervisor chain starts. Not a new field: the stage
 * immediately before Approval, whichever it is, already leaves a real
 * `tasks.completed_by` for this line once its own task is done — this
 * reads that back rather than naming a stage by id.
 *
 * Only the immediately preceding stage is consulted. A gap here (an
 * automatic stage with no tasks, or nobody has completed the line
 * yet) is reported to the caller as "no coder found," which escalates
 * to the configured Default Approver — the same honest-gap discipline
 * `resolveApprovalChain` already uses for a cost centre with no owner.
 */
export async function findLineCoder(
  db: D1Database,
  instanceId: string,
  processId: string,
  currentSequence: number,
  processVersion: number,
  lineNumber: number
): Promise<string | null> {
  const prev = await previousStageInSequence(db, processId, currentSequence, processVersion);
  if (!prev) return null;

  const row = await db
    .prepare(
      `SELECT t.completed_by FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       WHERE v.process_instance_id = ? AND v.stage_id = ? AND t.line_number = ? AND t.completed_by IS NOT NULL
       ORDER BY t.completed_at DESC LIMIT 1`
    )
    .bind(instanceId, prev.id, lineNumber)
    .first<{ completed_by: string }>();

  return row?.completed_by ?? null;
}

export interface ResolveApprovalParams {
  instanceId: string;
  processId: string;
  currentSequence: number;
  processVersion: number;
  /** null for a document-scope stage — see the doc comment on `resolveEmployeeSupervisor` for what that means for this mode today. */
  lineNumber: number | null;
  unitId: string | null;
  currency: string | null;
  amount: number | null;
  costCentreId: string | null;
}

/**
 * **Employee-Supervisor.** Start at whoever coded this line; if their
 * own limit (unit-scoped, falling back to the group default) covers
 * the amount, they approve it. If not — or if they have no limit
 * recorded at all — climb to their supervisor (same unit-scoped
 * fallback) and ask again.
 *
 * **A missing limit escalates; it does not approve everything.** That
 * is the opposite of `resolveApprovalChain`'s own convention, where a
 * cost centre owner with `approval_limit IS NULL` is deliberately the
 * unlimited top of the chain (a group CFO, configured that way on
 * purpose). Here, a person with no currency-specific limit recorded
 * is simply not set up as an approver yet — treating that as
 * unlimited would let a configuration gap silently approve anything,
 * which is the exact hazard decision 0192 named for unit-scoped
 * configuration generally.
 *
 * **Document-scope stages aren't resolved yet.** Without a line
 * number there is no `findLineCoder` starting point — a document-
 * scope Approval stage always lands on the Default Approver today,
 * reported plainly in the reasoning rather than guessed at.
 */
async function resolveEmployeeSupervisor(
  db: D1Database,
  config: ApprovalConfig,
  params: ResolveApprovalParams
): Promise<ApprovalResolution | ApprovalUnresolved> {
  const toDefault = (reason: string): ApprovalResolution | ApprovalUnresolved =>
    config.defaultApproverUserId
      ? { targetUserId: config.defaultApproverUserId, reasoning: `${reason} Sent to the configured Default Approver.` }
      : { unresolved: true, reason: `${reason} No Default Approver is configured.` };

  if (params.lineNumber === null) {
    return toDefault("This Approval stage evaluates the whole document, not a line, and Employee-Supervisor routing has no document-level starting point yet.");
  }

  const starter = await findLineCoder(db, params.instanceId, params.processId, params.currentSequence, params.processVersion, params.lineNumber);
  if (!starter) {
    return toDefault(`No recorded coder for line ${params.lineNumber}.`);
  }

  const seen = new Set<string>();
  const chain: string[] = [];
  let current: string | null = starter;

  while (current && !seen.has(current)) {
    seen.add(current);
    const person = await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(current).first<{ name: string }>();
    const label = person?.name ?? current;

    const limit = params.currency ? await resolveApprovalLimit(db, current, params.unitId, params.currency) : null;

    if (limit !== null && (params.amount === null || params.amount <= limit)) {
      const climbed = chain.length > 0 ? ` Escalated via: ${chain.join(" → ")}.` : "";
      return {
        targetUserId: current,
        reasoning: `${label}'s own ${params.currency ?? ""} ${limit} limit covers this amount.${climbed}`,
      };
    }

    chain.push(limit === null ? `${label} (no ${params.currency ?? ""} limit recorded)` : `${label} (${params.currency ?? ""} ${limit} limit, exceeded)`);
    current = await resolveSupervisorId(db, current, params.unitId);
  }

  return toDefault(`The supervisor chain ran out without a covering limit: ${chain.join(" → ")}.`);
}

/**
 * **Cost-Object.** A thin caller over `resolveApprovalChain`
 * (decision 0195) — that resolver was already fully built and
 * already unused; this is the first thing that calls it.
 */
async function resolveCostObject(
  db: D1Database,
  config: ApprovalConfig,
  params: ResolveApprovalParams
): Promise<ApprovalResolution | ApprovalUnresolved> {
  const toDefault = (reason: string): ApprovalResolution | ApprovalUnresolved =>
    config.defaultApproverUserId
      ? { targetUserId: config.defaultApproverUserId, reasoning: `${reason} Sent to the configured Default Approver.` }
      : { unresolved: true, reason: `${reason} No Default Approver is configured.` };

  if (!params.costCentreId) {
    return toDefault("No cost centre recorded for this line.");
  }

  const result = await resolveApprovalChain(db, params.costCentreId, params.amount ?? 0);
  if (result.covered && result.chain.length > 0) {
    const last = result.chain[result.chain.length - 1];
    const path = result.chain.map((c) => c.costCentreId).join(" → ");
    return { targetUserId: last.ownerUserId, reasoning: `Cost centre chain: ${path}.` };
  }

  const path = result.chain.map((c) => c.costCentreId).join(" → ");
  return toDefault(`The cost centre chain ran out uncovered: ${path || params.costCentreId}.`);
}

/**
 * The single entry point `workflow-engine.ts` calls for a stage
 * marked `uses_approval_hierarchy` — resolves the configured mode's
 * target, or explains why it could not.
 */
export async function resolveApprovalHierarchy(
  db: D1Database,
  params: ResolveApprovalParams
): Promise<ApprovalResolution | ApprovalUnresolved> {
  const config = await loadApprovalConfig(db);

  if (config.mode === "employee_supervisor") return resolveEmployeeSupervisor(db, config, params);
  if (config.mode === "cost_object") return resolveCostObject(db, config, params);

  // manual / api — named in the vocabulary (org_approval_config's own
  // CHECK), not built. Never faked as a resolved result.
  return config.defaultApproverUserId
    ? {
        targetUserId: config.defaultApproverUserId,
        reasoning: `${config.mode} routing is not built yet. Sent to the configured Default Approver.`,
      }
    : { unresolved: true, reason: `${config.mode} routing is not built yet, and no Default Approver is configured.` };
}

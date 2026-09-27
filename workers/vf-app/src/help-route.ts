import type { CompilerModel } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import type { AuthenticatedUser } from "./user-auth.js";
import type { Permission } from "./permissions.js";
import { hasPermission } from "./enforce.js";
import { nextStageInSequence } from "./workflow-engine.js";
import { loadApprovalConfig, resolveApprovalLimit } from "./approval-hierarchy.js";
import { rerouteContext } from "./route-to-approver-route.js";
import { codingGapsForTask } from "./coding-validation.js";
import { stageAllowsDiscard } from "./stage-actions-route.js";

/**
 * In-app Help, stage-aware — decision 0518.
 *
 * The operator's own request: *"a help button at the top, between the
 * language and sign-out options... default to the page that the user
 * is in and be stage aware. So someone asking for help as an approver
 * would be able to see actions available to them, and be able to
 * understand why they see a complete, or route to approver button."*
 *
 * **Two halves, both chosen by the operator:**
 *
 * - **Written help plus live reasons.** The written help is ordinary
 *   translated strings in `vf-ui`. The *live* half is this route:
 *   `handleHelpContext` works out, for one task and one person, the
 *   facts behind the buttons they see. It never decides what the
 *   buttons are itself — the task list already did (`actionsFor`) —
 *   it explains them, using the same functions that decided. So an
 *   explanation can never disagree with what the server enforces.
 * - **An AI answer to a free question** (`handleHelpAsk`). It uses the
 *   same `CompilerModel` wrapper the rule compiler and AP Expert use
 *   (decisions 0002, 0430). The model is given only the help text the
 *   person is already looking at and these same server-computed facts,
 *   and is told to answer from nothing else.
 */

export interface HelpReason {
  /** Which action it explains, or null for the task as a whole. */
  action: string | null;
  code: string;
  params: Record<string, string | number | null>;
}

export interface HelpContext {
  stage: { id: string; name: string } | null;
  approvalMode: string;
  reasons: HelpReason[];
}

/**
 * The facts behind one person's buttons on one task.
 *
 * **Who may ask:** anyone who could act on the task at all — its owner,
 * its claimer, or a holder of its permission. Help about a task you
 * could never see would itself be a leak.
 */
export async function handleHelpContext(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await db
    .prepare(
      `SELECT t.id, t.status, t.owner_user_id, t.owner_team_id, t.claimed_by, t.required_permission,
              s.id AS stage_id, s.name AS stage_name, s.process_id, s.sequence, s.uses_approval_hierarchy,
              pi.process_version, h.org_unit_id, h.currency, h.total_with_vat,
              c.name AS claimer_name
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN org_users c ON c.id = t.claimed_by
       WHERE t.id = ?`
    )
    .bind(taskId)
    .first<{
      id: string;
      status: string;
      owner_user_id: string | null;
      owner_team_id: string | null;
      claimed_by: string | null;
      required_permission: string;
      stage_id: string;
      stage_name: string;
      process_id: string;
      sequence: number;
      uses_approval_hierarchy: number | null;
      process_version: number | null;
      org_unit_id: string | null;
      currency: string | null;
      total_with_vat: number | null;
      claimer_name: string | null;
    }>();
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };

  const mine = task.owner_user_id === user.id || task.claimed_by === user.id;
  const holds = await hasPermission(db, user.id, task.required_permission as Permission, task.org_unit_id);
  if (!mine && !holds) return { status: 403, body: { error: "you cannot see this task" } };

  const config = await loadApprovalConfig(db);
  const reasons: HelpReason[] = [];

  // Whose task it is — the first thing that decides every button.
  if (task.status !== "open") {
    reasons.push({ action: null, code: "task_closed", params: { status: task.status } });
  } else if (task.claimed_by && task.claimed_by !== user.id) {
    reasons.push({ action: null, code: "claimed_by_other", params: { name: task.claimer_name ?? task.claimed_by } });
  } else if (!task.owner_user_id && !task.claimed_by) {
    reasons.push({ action: "claim", code: "team_task_unclaimed", params: {} });
  }
  if (!holds) {
    reasons.push({ action: null, code: "lacks_permission", params: { permission: task.required_permission } });
  }

  if (task.status === "open" && mine) {
    // Complete vs Route To Approver — the operator's own example.
    const reroute = await rerouteContext(db, taskId, user.id);
    // Which button moves the invoice on for this person — the one the
    // coding reason below belongs to.
    let primaryAction = "complete";
    if (reroute) {
      primaryAction = "route_to_approver";
      reasons.push({
        action: "route_to_approver",
        code: "limit_insufficient",
        params: { limit: reroute.limit, amount: reroute.amount, currency: reroute.currency },
      });
    } else {
      const next =
        task.process_version !== null
          ? await nextStageInSequence(db, task.process_id, task.sequence, task.process_version)
          : null;
      if (next?.uses_approval_hierarchy && config.mode === "manual") {
        primaryAction = "route_to_approver";
        const name = await db.prepare("SELECT name FROM process_stages WHERE id = ?").bind(next.id).first<{ name: string }>();
        reasons.push({ action: "route_to_approver", code: "choose_next_approver", params: { stage: name?.name ?? next.id } });
      } else if (task.uses_approval_hierarchy && config.mode === "manual" && task.currency) {
        const limit = await resolveApprovalLimit(db, user.id, task.org_unit_id, task.currency);
        reasons.push({
          action: "complete",
          code: "limit_covers",
          params: { limit, amount: task.total_with_vat, currency: task.currency },
        });
      } else {
        reasons.push({ action: "complete", code: "complete_moves_on", params: { mode: config.mode } });
      }
    }

    const gaps = await codingGapsForTask(db, taskId);
    if (gaps.length > 0) {
      reasons.push({
        action: primaryAction,
        code: "coding_incomplete",
        params: { lines: new Set(gaps.map((g) => g.line)).size },
      });
    }

    if (await hasPermission(db, user.id, "AP.Return", task.org_unit_id)) {
      const targets = await db
        .prepare(
          `SELECT DISTINCT ts.name
           FROM stage_return_targets rt
           JOIN process_stages ts ON ts.id = rt.target_stage_id
           WHERE rt.source_stage_id = ?
             AND EXISTS (
               SELECT 1 FROM stage_visits v
               JOIN tasks me ON me.id = ?
               JOIN stage_visits mv ON mv.id = me.stage_visit_id
               WHERE v.process_instance_id = mv.process_instance_id AND v.stage_id = rt.target_stage_id
             )
           ORDER BY ts.name`
        )
        .bind(task.stage_id, taskId)
        .all<{ name: string }>();
      reasons.push(
        targets.results.length > 0
          ? { action: "return", code: "return_targets", params: { stages: targets.results.map((r) => r.name).join(", ") } }
          : { action: "return", code: "return_no_targets", params: {} }
      );
    }

    if ((await hasPermission(db, user.id, "AP.Discard", task.org_unit_id)) && !(await stageAllowsDiscard(db, task.stage_id))) {
      reasons.push({ action: "discard", code: "discard_not_here", params: { stage: task.stage_name } });
    }
  }

  return {
    status: 200,
    body: {
      stage: { id: task.stage_id, name: task.stage_name },
      approvalMode: config.mode,
      reasons,
    } satisfies HelpContext,
  };
}

const MAX_QUESTION = 500;
const MAX_HELP_TEXT = 8000;

/**
 * **An AI answer, grounded in what the person is already reading —
 * decision 0518.**
 *
 * The prompt carries three things and nothing else: the help text the
 * panel is showing (sent by the screen, and capped), the live facts
 * from `handleHelpContext` when a task is open (computed here, never
 * taken from the request), and the question. The model is told to
 * answer only from those, to say plainly when they don't cover the
 * question, and to answer in the reader's language. It has no tools
 * and sees no invoice data beyond those facts.
 */
export async function handleHelpAsk(
  db: D1Database,
  model: CompilerModel,
  user: AuthenticatedUser,
  body: { question?: unknown; screen?: unknown; taskId?: unknown; helpText?: unknown; locale?: unknown }
): Promise<RouteResult> {
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return { status: 400, body: { error: "a question is required" } };
  if (question.length > MAX_QUESTION) return { status: 400, body: { error: "that question is too long" } };

  const helpText = typeof body.helpText === "string" ? body.helpText.slice(0, MAX_HELP_TEXT) : "";
  const screen = typeof body.screen === "string" ? body.screen.slice(0, 40) : "";
  const language = body.locale === "de" ? "German" : "English";

  let facts: HelpContext | null = null;
  if (typeof body.taskId === "string" && body.taskId) {
    const context = await handleHelpContext(db, body.taskId, user);
    if (context.status === 200) facts = context.body as unknown as HelpContext;
  }

  const prompt = [
    "You are the in-app help for VibeFinance, an accounts payable application.",
    "Answer the user's question using ONLY the HELP TEXT and LIVE FACTS below.",
    "If they do not cover the question, say so plainly and suggest asking an AP manager. Never invent screens, buttons, rules or numbers.",
    `Answer in ${language}, in at most 120 words, as plain text without markdown.`,
    "",
    `SCREEN: ${screen || "unknown"}`,
    "",
    "HELP TEXT:",
    helpText || "(none)",
    "",
    "LIVE FACTS (about the task the user has open, computed by the server):",
    facts ? JSON.stringify(facts) : "(no task open)",
    "",
    `QUESTION: ${question}`,
  ].join("\n");

  const answer = (await model.compile(prompt)).trim();
  return { status: 200, body: { answer } };
}

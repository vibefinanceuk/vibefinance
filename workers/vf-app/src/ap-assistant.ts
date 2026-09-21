import type { CompilerModel } from "@vibefinance/shared";
import { extractJson } from "@vibefinance/shared";
import { hasPermission } from "./enforce.js";
import type { Permission } from "./permissions.js";
import type { RouteResult } from "./org-route.js";
import { handleSupplierSpend } from "./supplier-performance-route.js";
import { handleAccruals } from "./accruals-route.js";
import { handleFraudExceptionTrends } from "./fraud-exception-trends-route.js";
import { handleOverdueBalance } from "./overdue-balance-route.js";

/**
 * Talk to an AP Expert — decision 0430, Screen 6 of the Management
 * Dashboard design, sequenced last on purpose: *"its tool palette
 * wraps the scoped query functions the earlier phases already build,
 * so it has the least to stand on until they exist."* Everything below
 * wraps a real, already-shipped, already-permission-checked handler —
 * this file introduces no new SQL of its own, aside from
 * `overdue-balance-route.ts`, built alongside it for one of the four.
 *
 * **The model never sees or produces raw data.** Function-calling
 * against a small, fixed set of named tools — never open text-to-SQL
 * against D1, the design's own explicit words. Two model calls, each
 * with one narrow job:
 *
 * 1. **Tool selection.** Given the question, the model picks one of
 *    four named tools (or refuses). Parsed and validated exactly like
 *    `shared/compiler/parse.ts`'s own `parseModelOutput` — a closed
 *    vocabulary, refusal-by-default, `extractJson` reused rather than
 *    reimplemented a third time.
 * 2. **Answer phrasing.** The chosen tool is then actually run —
 *    real SQL, real permission checks, no model involvement — and its
 *    real result is handed back to the model with an explicit
 *    instruction to use only those numbers. The operator's own choice,
 *    asked directly: a second call so the reply reads like an actual
 *    answer rather than a raw JSON card, at the cost of a second
 *    Workers AI call per question.
 *
 * **Every tool call is gated by that tool's own real permission**, not
 * merely `AP.Assistant` — the design's own Role-Based Access Model row
 * for this screen: *"each tool call runs through the same
 * hasPermission/unitClause checks as the screen it stands in for."*
 * `AP.Assistant` gates whether a person can use the chat at all;
 * `AP.Supplier`/`AP.Analysis`/`AP.FraudReview` still gate what it can
 * tell them, checked again here rather than assumed from the model's
 * own say-so.
 */

export const AP_ASSISTANT_TOOL_NAMES = ["supplier_spend", "overdue_balance", "accrual_summary", "exception_counts"] as const;
export type ApAssistantToolName = (typeof AP_ASSISTANT_TOOL_NAMES)[number];

export interface ApAssistantToolArgs {
  /** A supplier's name, as the person said it — matched loosely (case-insensitive substring) against real supplier records, never used to build SQL. */
  supplier?: string;
}

export interface ApAssistantToolCall {
  kind: "tool";
  tool: ApAssistantToolName;
  args: ApAssistantToolArgs;
}

export interface ApAssistantNoTool {
  kind: "none";
  /** The model's own plain-language reason — prose to show the person directly, never data, so it needs no further validation. */
  reason: string;
}

export type ApAssistantSelection = ApAssistantToolCall | ApAssistantNoTool;

const DEFAULT_REFUSAL_REASON =
  "That's not something I can answer today — I can only look at supplier spend, overdue balances, the accrual summary, and exception counts.";

/**
 * Parse and validate the model's tool-selection response — the same
 * refusal-by-default discipline `shared/compiler/parse.ts`'s own
 * `parseModelOutput` established: anything that doesn't cleanly match
 * one of the two known shapes becomes a refusal, never a guess.
 */
export function parseToolSelection(raw: string): ApAssistantSelection {
  const parsed = extractJson(raw);
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    return { kind: "none", reason: DEFAULT_REFUSAL_REASON };
  }
  const v = parsed as Record<string, unknown>;

  if (typeof v.tool !== "string" || v.tool === "none") {
    const reason = typeof v.reason === "string" && v.reason.trim() ? v.reason.trim() : DEFAULT_REFUSAL_REASON;
    return { kind: "none", reason };
  }

  if (!(AP_ASSISTANT_TOOL_NAMES as readonly string[]).includes(v.tool)) {
    return { kind: "none", reason: DEFAULT_REFUSAL_REASON };
  }

  const rawArgs = v.args && typeof v.args === "object" ? (v.args as Record<string, unknown>) : {};
  const supplier = typeof rawArgs.supplier === "string" && rawArgs.supplier.trim() ? rawArgs.supplier.trim() : undefined;

  return { kind: "tool", tool: v.tool as ApAssistantToolName, args: supplier ? { supplier } : {} };
}

function matchesSupplier(name: string | null | undefined, wanted?: string): boolean {
  if (!wanted) return true;
  if (!name) return false;
  return name.toLowerCase().includes(wanted.toLowerCase());
}

interface SupplierSpendCurrency {
  currency: string;
  suppliers: { supplierId: string; supplierName: string; spend: number; invoiceCount: number }[];
}

async function runSupplierSpend(db: D1Database, currentOrg: string | null, userId: string, args: ApAssistantToolArgs) {
  const result = await handleSupplierSpend(db, currentOrg, userId, 10);
  const body = result.body as { currencies: SupplierSpendCurrency[] };
  const currencies = body.currencies
    .map((c) => ({ currency: c.currency, suppliers: c.suppliers.filter((s) => matchesSupplier(s.supplierName, args.supplier)) }))
    .filter((c) => c.suppliers.length > 0);
  return { tool: "supplier_spend", currencies };
}

async function runOverdueBalance(db: D1Database, currentOrg: string | null, userId: string, args: ApAssistantToolArgs) {
  const result = await handleOverdueBalance(db, currentOrg, userId);
  const body = result.body as { suppliers: { supplierId: string | null; supplierName: string | null; currency: string; total: number; count: number }[] };
  const suppliers = body.suppliers.filter((s) => matchesSupplier(s.supplierName, args.supplier));
  return { tool: "overdue_balance", suppliers };
}

async function runAccrualSummary(db: D1Database, currentOrg: string | null, userId: string) {
  const result = await handleAccruals(db, currentOrg, userId);
  return { tool: "accrual_summary", ...(result.body as object) };
}

interface FraudExceptionTrendsBody {
  weekStartDates: string[];
  bySupplier: { supplierId: string | null; supplierName: string | null; total: number }[];
  byUser: { userId: string; userName: string | null; total: number }[];
  byType: { type: string; total: number }[];
}

async function runExceptionCounts(db: D1Database, currentOrg: string | null, userId: string, args: ApAssistantToolArgs) {
  const result = await handleFraudExceptionTrends(db, currentOrg, userId);
  const body = result.body as FraudExceptionTrendsBody;
  const bySupplier = args.supplier ? body.bySupplier.filter((s) => matchesSupplier(s.supplierName, args.supplier)) : body.bySupplier;
  return {
    tool: "exception_counts",
    weeksCovered: body.weekStartDates.length,
    totalExceptions: body.byType.reduce((sum, t) => sum + t.total, 0),
    topSuppliers: [...bySupplier].sort((a, b) => b.total - a.total).slice(0, 5),
    topUsers: [...body.byUser].sort((a, b) => b.total - a.total).slice(0, 5),
    byType: [...body.byType].sort((a, b) => b.total - a.total),
  };
}

interface ApAssistantToolDef {
  /** The permission that tool's own real route already checks — never `AP.Assistant` itself, which only gates the chat. */
  requiredPermission: Permission;
  run: (db: D1Database, currentOrg: string | null, userId: string, args: ApAssistantToolArgs) => Promise<unknown>;
}

const AP_ASSISTANT_TOOLS: Record<ApAssistantToolName, ApAssistantToolDef> = {
  supplier_spend: { requiredPermission: "AP.Supplier", run: runSupplierSpend },
  overdue_balance: { requiredPermission: "AP.Analysis", run: runOverdueBalance },
  accrual_summary: { requiredPermission: "AP.Analysis", run: (db, org, userId) => runAccrualSummary(db, org, userId) },
  exception_counts: { requiredPermission: "AP.FraudReview", run: runExceptionCounts },
};

function buildSelectionPrompt(question: string): string {
  return `You are answering questions for an Accounts Payable manager using VibeFinance, an AP automation product. You can only answer using one of these four tools — you cannot look anything else up, and you must never invent a number yourself.

Tools:
- supplier_spend: total spend by supplier, ranked, grouped by currency. Optional arg "supplier": a supplier's name, to look at one in particular.
- overdue_balance: the value of invoices still open in our workflow whose stated due date has already passed, grouped by supplier and currency. Optional arg "supplier".
- accrual_summary: the value of invoices received but not yet at the final, payment-eligible stage of our workflow, grouped by currency and stage. No arguments.
- exception_counts: how many invoices failed a validation check in roughly the last eight weeks, broken down by supplier, by user, and by type. Optional arg "supplier".

None of these tools can say whether an invoice was actually paid, or when — this product does not capture that anywhere, so never claim otherwise.

The person asked: "${question}"

Reply with ONLY a JSON object, no other text, no markdown fences. Either:
{"tool": "<one of the four tool names above>", "args": {"supplier": "<a name, only if they named one, otherwise omit args entirely>"}}
or, if their question cannot be answered with any of these four tools:
{"tool": "none", "reason": "<one honest sentence explaining why, in plain language, to show them directly>"}`;
}

function buildAnswerPrompt(question: string, tool: ApAssistantToolName, toolResult: unknown): string {
  return `You are answering an Accounts Payable manager's question using VibeFinance. They asked: "${question}"

You looked this up using the ${tool} tool and got back this real, verified data:
${JSON.stringify(toolResult)}

Write one short, direct, natural-language answer using ONLY the numbers in that data. Do not invent, estimate, or add any figure that isn't there. If the data is empty or shows nothing relevant to what they asked, say so plainly rather than guessing. Never claim to know whether an invoice was actually paid — this data never says that. Do not mention "tools", "JSON", or how you looked this up; answer like a knowledgeable colleague would, in a sentence or two.`;
}

export interface ApAssistantAnswer {
  question: string;
  tool: ApAssistantToolName | null;
  answer: string;
}

/**
 * The chat itself. `AP.Assistant` is checked by the caller (the route
 * in `index.ts`, the same place every other AP Analytics tab checks
 * its own gate) before this is ever reached — this function's own job
 * starts one level in, at "which tool, and does this person actually
 * hold what that tool needs."
 */
export async function handleAskApAssistant(
  db: D1Database,
  model: CompilerModel,
  currentOrg: string | null,
  userId: string,
  question: unknown
): Promise<RouteResult> {
  const trimmed = typeof question === "string" ? question.trim() : "";
  if (!trimmed) return { status: 400, body: { error: "a question is required" } };
  if (trimmed.length > 500) return { status: 400, body: { error: "that question is too long — try asking something shorter and more specific" } };

  const selectionRaw = await model.compile(buildSelectionPrompt(trimmed));
  const selection = parseToolSelection(selectionRaw);

  if (selection.kind === "none") {
    return { status: 200, body: { question: trimmed, tool: null, answer: selection.reason } satisfies ApAssistantAnswer };
  }

  const toolDef = AP_ASSISTANT_TOOLS[selection.tool];
  if (!(await hasPermission(db, userId, toolDef.requiredPermission))) {
    return {
      status: 200,
      body: {
        question: trimmed,
        tool: selection.tool,
        answer: `I can't answer that — it needs the ${toolDef.requiredPermission} permission, which you don't currently hold.`,
      } satisfies ApAssistantAnswer,
    };
  }

  const toolResult = await toolDef.run(db, currentOrg, userId, selection.args);
  const answerRaw = await model.compile(buildAnswerPrompt(trimmed, selection.tool, toolResult));
  const answer = answerRaw.trim() || "I found the data but couldn't put together an answer — please try rephrasing the question.";

  return { status: 200, body: { question: trimmed, tool: selection.tool, answer } satisfies ApAssistantAnswer };
}

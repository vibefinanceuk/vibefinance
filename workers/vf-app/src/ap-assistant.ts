import type { CompilerModel } from "@vibefinance/shared";
import { extractJson } from "@vibefinance/shared";
import { hasPermission } from "./enforce.js";
import type { Permission } from "./permissions.js";
import type { RouteResult } from "./org-route.js";
import { handleSupplierSpend } from "./supplier-performance-route.js";
import { handleAccruals } from "./accruals-route.js";
import { handleFraudExceptionTrends } from "./fraud-exception-trends-route.js";
import { handleOverdueBalance } from "./overdue-balance-route.js";
import { handleWorkloadOpenTasks } from "./workload-open-tasks-route.js";
import { handleGetPurchaseOrderStatusCounts, handleGetPurchaseOrder } from "./purchase-order-route.js";
import { handlePossibleDuplicates } from "./fraud-duplicates-route.js";
import { handleInvoiceLookup, type InvoiceLookupReport } from "./invoice-lookup-route.js";
import { handleMintDocumentUrl } from "./document-route.js";

/**
 * Talk to an AP Expert — decision 0430, Screen 6 of the Management
 * Dashboard design, sequenced last on purpose: *"its tool palette
 * wraps the scoped query functions the earlier phases already build,
 * so it has the least to stand on until they exist."* Everything below
 * wraps a real, already-shipped, already-permission-checked handler —
 * this file introduces no new SQL of its own, aside from
 * `overdue-balance-route.ts` (0430) and `invoice-lookup-route.ts`
 * (0430's own addendum, below).
 *
 * **The model never sees or produces raw data.** Function-calling
 * against a small, fixed set of named tools — never open text-to-SQL
 * against D1, the design's own explicit words. Two model calls, each
 * with one narrow job:
 *
 * 1. **Tool selection.** Given the question, the model picks one of
 *    the named tools (or refuses). Parsed and validated exactly like
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
 * `AP.Assistant` gates whether a person can use the chat at all; each
 * tool's own real permission still gates what it can tell them,
 * checked again here rather than assumed from the model's own say-so.
 *
 * **Nine tools now, decision 0430's own addendum.** Live use surfaced
 * two real problems with the original four (`supplier_spend`,
 * `overdue_balance`, `accrual_summary`, `exception_counts`): the
 * operator asked for real coverage of purchase orders, invoices,
 * duplicates, tasks, and document links that the design document's
 * own four-tool sketch never mentioned; and a real question — "who
 * has the most tasks assigned" — had no matching tool at all, so the
 * selection model picked the closest-sounding one (`exception_counts`,
 * whose own description says "by user") and the answer-phrasing model
 * then relabeled a count of *exceptions* as a count of *tasks* to
 * match the question's own wording. That specific data — exception
 * counts, per person — is the same ranked-by-individual metric
 * decision 0428's own second addendum pulled from the Workload screen
 * live, over a real governance concern about naming individuals in a
 * ranked list; this bug let it resurface anyway, mislabeled and
 * ungated by that same concern. Fixed two ways at once, not one:
 * `tasks_by_user` is now a real, correctly-matching tool for that
 * question, and every tool description below is written to contrast
 * explicitly with its nearest neighbour rather than merely describe
 * itself, and the answer-phrasing prompt is now told never to rename
 * what a number counts.
 */

export const AP_ASSISTANT_TOOL_NAMES = [
  "supplier_spend",
  "overdue_balance",
  "accrual_summary",
  "exception_counts",
  "tasks_by_user",
  "purchase_order_status",
  "purchase_order_lookup",
  "duplicate_invoices",
  "invoice_lookup",
] as const;
export type ApAssistantToolName = (typeof AP_ASSISTANT_TOOL_NAMES)[number];

export interface ApAssistantToolArgs {
  /** A supplier's name, as the person said it — matched loosely (case-insensitive substring) against real supplier records, never used to build SQL. */
  supplier?: string;
  /** A purchase order's own order number, exactly as the person gave it — required by `purchase_order_lookup` only. */
  orderNumber?: string;
  /** An invoice's own printed number, exactly as the person gave it — required by `invoice_lookup` only. */
  invoiceNumber?: string;
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
  "That's not something I can answer today — I can look at supplier spend, overdue balances, the accrual summary, exception counts, open tasks by person, purchase order status, one purchase order or invoice by its own number, and possible duplicate invoices.";

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
  const args: ApAssistantToolArgs = {};
  if (typeof rawArgs.supplier === "string" && rawArgs.supplier.trim()) args.supplier = rawArgs.supplier.trim();
  if (typeof rawArgs.orderNumber === "string" && rawArgs.orderNumber.trim()) args.orderNumber = rawArgs.orderNumber.trim();
  if (typeof rawArgs.invoiceNumber === "string" && rawArgs.invoiceNumber.trim()) args.invoiceNumber = rawArgs.invoiceNumber.trim();

  return { kind: "tool", tool: v.tool as ApAssistantToolName, args };
}

function matchesSupplier(name: string | null | undefined, wanted?: string): boolean {
  if (!wanted) return true;
  if (!name) return false;
  return name.toLowerCase().includes(wanted.toLowerCase());
}

/** Everything a tool's own `run` function might need — one shape for all nine, even though most ignore most of it. */
interface ToolRunContext {
  db: D1Database;
  currentOrg: string | null;
  userId: string;
  args: ApAssistantToolArgs;
  /** Only `invoice_lookup` mints a document link; every other tool ignores these two. */
  documentUrlSecret: string | undefined;
  origin: string;
}

interface SupplierSpendCurrency {
  currency: string;
  suppliers: { supplierId: string; supplierName: string; spend: number; invoiceCount: number }[];
}

async function runSupplierSpend(ctx: ToolRunContext) {
  const result = await handleSupplierSpend(ctx.db, ctx.currentOrg, ctx.userId, 10);
  const body = result.body as { currencies: SupplierSpendCurrency[] };
  const currencies = body.currencies
    .map((c) => ({ currency: c.currency, suppliers: c.suppliers.filter((s) => matchesSupplier(s.supplierName, ctx.args.supplier)) }))
    .filter((c) => c.suppliers.length > 0);
  return { tool: "supplier_spend", currencies };
}

async function runOverdueBalance(ctx: ToolRunContext) {
  const result = await handleOverdueBalance(ctx.db, ctx.currentOrg, ctx.userId);
  const body = result.body as { suppliers: { supplierId: string | null; supplierName: string | null; currency: string; total: number; count: number }[] };
  const suppliers = body.suppliers.filter((s) => matchesSupplier(s.supplierName, ctx.args.supplier));
  return { tool: "overdue_balance", suppliers };
}

async function runAccrualSummary(ctx: ToolRunContext) {
  const result = await handleAccruals(ctx.db, ctx.currentOrg, ctx.userId);
  return { tool: "accrual_summary", ...(result.body as object) };
}

interface FraudExceptionTrendsBody {
  weekStartDates: string[];
  bySupplier: { supplierId: string | null; supplierName: string | null; total: number }[];
  byUser: { userId: string; userName: string | null; total: number }[];
  byType: { type: string; total: number }[];
}

async function runExceptionCounts(ctx: ToolRunContext) {
  const result = await handleFraudExceptionTrends(ctx.db, ctx.currentOrg, ctx.userId);
  const body = result.body as FraudExceptionTrendsBody;
  const bySupplier = ctx.args.supplier ? body.bySupplier.filter((s) => matchesSupplier(s.supplierName, ctx.args.supplier)) : body.bySupplier;
  return {
    tool: "exception_counts",
    // Named `exceptionsPerPerson`, not `byUser` — decision 0430's own
    // addendum, so the shape itself says what it counts rather than
    // leaving that to a field name a smaller model can misread as
    // "tasks" or "workload." See this file's own top comment.
    weeksCovered: body.weekStartDates.length,
    totalExceptions: body.byType.reduce((sum, t) => sum + t.total, 0),
    topSuppliersByExceptionCount: [...bySupplier].sort((a, b) => b.total - a.total).slice(0, 5),
    exceptionsPerPerson: [...body.byUser].sort((a, b) => b.total - a.total).slice(0, 5),
    byType: [...body.byType].sort((a, b) => b.total - a.total),
  };
}

async function runTasksByUser(ctx: ToolRunContext) {
  const result = await handleWorkloadOpenTasks(ctx.db, ctx.currentOrg, ctx.userId);
  const body = result.body as { users: { userId: string; userName: string; openCount: number }[]; available: number };
  return {
    tool: "tasks_by_user",
    // Named `openTasksPerPerson` for the same reason `exception_counts`
    // above was renamed — a field called `byUser` on two different
    // tools, counting two different things, is exactly what caused the
    // original bug.
    openTasksPerPerson: body.users,
    unclaimedAndAvailable: body.available,
  };
}

async function runPurchaseOrderStatus(ctx: ToolRunContext) {
  const result = await handleGetPurchaseOrderStatusCounts(ctx.db, ctx.currentOrg, ctx.userId);
  return { tool: "purchase_order_status", ...(result.body as object) };
}

async function runPurchaseOrderLookup(ctx: ToolRunContext) {
  const orderNumber = ctx.args.orderNumber as string; // required arg — enforced before `run` is ever called
  const result = await handleGetPurchaseOrder(ctx.db, orderNumber, ctx.userId);
  if (result.status !== 200) {
    return { tool: "purchase_order_lookup", found: false, orderNumber };
  }
  const body = result.body as { order: Record<string, unknown>; lines: unknown[] };
  return {
    tool: "purchase_order_lookup",
    found: true,
    orderNumber: body.order.order_number,
    status: body.order.effective_status,
    holdReason: body.order.hold_reason ?? null,
    currency: body.order.currency,
    payableAmount: body.order.payable_amount,
    issueDate: body.order.issue_date,
    lineCount: body.lines.length,
  };
}

interface DuplicateInvoicesBody {
  invoices: { id: string; invoiceNumber: string | null; supplierName: string | null; totalWithVat: number | null; currency: string | null; issueDate: string | null; duplicateConfidence: number }[];
}

async function runDuplicateInvoices(ctx: ToolRunContext) {
  const result = await handlePossibleDuplicates(ctx.db, ctx.currentOrg, ctx.userId);
  const body = result.body as DuplicateInvoicesBody;
  const filtered = ctx.args.supplier ? body.invoices.filter((i) => matchesSupplier(i.supplierName, ctx.args.supplier)) : body.invoices;
  return { tool: "duplicate_invoices", flaggedCount: filtered.length, invoices: filtered.slice(0, 10) };
}

async function runInvoiceLookup(ctx: ToolRunContext) {
  const invoiceNumber = ctx.args.invoiceNumber as string; // required arg — enforced before `run` is ever called
  const result = await handleInvoiceLookup(ctx.db, ctx.currentOrg, ctx.userId, invoiceNumber);
  const body = result.body as InvoiceLookupReport;

  if (body.matches.length === 0) {
    return { tool: "invoice_lookup", found: false, invoiceNumber };
  }
  if (body.matches.length > 1) {
    return {
      tool: "invoice_lookup",
      ambiguous: true,
      invoiceNumber,
      // No document link for an ambiguous match — minting one for
      // every candidate would hand over a document before anyone
      // confirmed which invoice was meant.
      matches: body.matches.map((m) => ({ supplierName: m.supplierName, totalWithVat: m.totalWithVat, currency: m.currency, stage: m.stage })),
    };
  }

  const match = body.matches[0];
  let documentUrl: string | null = null;
  if (match.hasDocument) {
    const minted = await handleMintDocumentUrl(ctx.db, ctx.documentUrlSecret, match.id, null, ctx.origin);
    if (minted.status === 200) documentUrl = (minted.body as { url: string }).url;
  }

  return {
    tool: "invoice_lookup",
    found: true,
    invoiceNumber: match.invoiceNumber,
    supplierName: match.supplierName,
    totalWithVat: match.totalWithVat,
    currency: match.currency,
    stage: match.stage,
    inProgress: match.inProgress,
    documentUrl,
  };
}

interface ApAssistantToolDef {
  /** The permission that tool's own real route already checks — never `AP.Assistant` itself, which only gates the chat. */
  requiredPermission: Permission;
  /** When set, the model must supply this arg — checked before `run` is called, never left to `run` to discover a required value is missing. */
  requiredArg?: "orderNumber" | "invoiceNumber";
  missingArgMessage?: string;
  run: (ctx: ToolRunContext) => Promise<unknown>;
}

const AP_ASSISTANT_TOOLS: Record<ApAssistantToolName, ApAssistantToolDef> = {
  supplier_spend: { requiredPermission: "AP.Supplier", run: runSupplierSpend },
  overdue_balance: { requiredPermission: "AP.Analysis", run: runOverdueBalance },
  accrual_summary: { requiredPermission: "AP.Analysis", run: runAccrualSummary },
  exception_counts: { requiredPermission: "AP.FraudReview", run: runExceptionCounts },
  tasks_by_user: { requiredPermission: "AP.Analysis", run: runTasksByUser },
  purchase_order_status: { requiredPermission: "AP.Validate", run: runPurchaseOrderStatus },
  purchase_order_lookup: {
    requiredPermission: "AP.Validate",
    requiredArg: "orderNumber",
    missingArgMessage: "I'd need a purchase order number to look that up — which one did you mean?",
    run: runPurchaseOrderLookup,
  },
  duplicate_invoices: { requiredPermission: "AP.FraudReview", run: runDuplicateInvoices },
  invoice_lookup: {
    requiredPermission: "AP.Validate",
    requiredArg: "invoiceNumber",
    missingArgMessage: "I'd need an invoice number to look that up — which one did you mean?",
    run: runInvoiceLookup,
  },
};

function buildSelectionPrompt(question: string): string {
  return `You are answering questions for an Accounts Payable manager using VibeFinance, an AP automation product. You can only answer using one of these nine tools — you cannot look anything else up, and you must never invent a number yourself. Read every tool's own description carefully: several sound similar but count genuinely different things, and picking the wrong one because the wording sounds close is worse than refusing.

Tools:
- supplier_spend: total spend by supplier, ranked, grouped by currency. Optional arg "supplier": a supplier's name, to look at one in particular.
- overdue_balance: the value of invoices still open in our workflow whose stated due date has already passed, grouped by supplier and currency. Optional arg "supplier".
- accrual_summary: the value of invoices received but not yet at the final, payment-eligible stage of our workflow, grouped by currency and stage. No arguments.
- exception_counts: how many invoices failed a validation check in roughly the last eight weeks, broken down by supplier, by the person who was assigned the exception, and by type. This is about validation failures on invoices — never about how many tasks someone currently has open, which is a different tool below. Optional arg "supplier".
- tasks_by_user: how many tasks are open and currently assigned to each person right now, plus how many are unclaimed and available to anyone — today's real workload by person. This is the right tool for "who has the most tasks," "who's busiest," or "workload by person." It has nothing to do with validation failures or exceptions. No arguments.
- purchase_order_status: how many purchase orders are in each status (active, on hold, closed, partially invoiced, fully invoiced) right now. No arguments.
- purchase_order_lookup: full detail on one specific purchase order. Requires arg "orderNumber": the order's own number, exactly as given.
- invoice_lookup: full detail on one specific invoice, including which workflow stage it is at and a link to its document if one is on file. Requires arg "invoiceNumber": the invoice's own printed number, exactly as given. This tool cannot find "the latest" or "the most recent" invoice — only one named by its own number.
- duplicate_invoices: invoices flagged as possible duplicates of another invoice already on file (same supplier, similar amount, similar date), ranked by how confident that match is. Optional arg "supplier".

None of these tools can say whether an invoice was actually paid, or when — this product does not capture that anywhere, so never claim otherwise. None of them can produce a list of system users, a count of documents received in a date range, or any data not named above.

The person asked: "${question}"

Reply with ONLY a JSON object, no other text, no markdown fences. Either:
{"tool": "<one of the nine tool names above>", "args": {"supplier": "<a name, only if relevant and named>", "orderNumber": "<only for purchase_order_lookup>", "invoiceNumber": "<only for invoice_lookup>"}}
(omit any arg key that doesn't apply — most questions need none at all)
or, if their question cannot be answered with any of these nine tools:
{"tool": "none", "reason": "<one honest sentence explaining why, in plain language, to show them directly>"}`;
}

function buildAnswerPrompt(question: string, tool: ApAssistantToolName, toolResult: unknown): string {
  return `You are answering an Accounts Payable manager's question using VibeFinance. They asked: "${question}"

You looked this up using the ${tool} tool and got back this real, verified data:
${JSON.stringify(toolResult)}

Write one short, direct, natural-language answer using ONLY the numbers and facts in that data. Do not invent, estimate, or add any figure that isn't there. State plainly what each number represents, using the data's own field names as your guide — never rename or reinterpret what a number counts (for example, a count of exceptions is never "tasks," and a count of open tasks is never "exceptions"). If the data is empty or shows nothing relevant to what they asked, say so plainly rather than guessing. If the data includes a "documentUrl" that is not null, include that exact URL in your answer so they can open it; if it is null, say plainly that no document is on file rather than inventing a link. If the data shows "ambiguous": true with more than one match, briefly list what you found (supplier and amount for each) and ask which one they meant, rather than picking one for them. If the data shows "found": false, say plainly you could not find anything with that number. Never claim to know whether an invoice was actually paid — this data never says that. Do not mention "tools", "JSON", or how you looked this up; answer like a knowledgeable colleague would, in a sentence or two.`;
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
 *
 * `documentUrlSecret`/`origin` exist only for `invoice_lookup`'s own
 * document-link minting (`handleMintDocumentUrl`, `document-route.ts`)
 * — every other tool ignores both.
 */
export async function handleAskApAssistant(
  db: D1Database,
  model: CompilerModel,
  currentOrg: string | null,
  userId: string,
  question: unknown,
  documentUrlSecret?: string,
  origin: string = ""
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

  if (toolDef.requiredArg && !selection.args[toolDef.requiredArg]) {
    return {
      status: 200,
      body: { question: trimmed, tool: selection.tool, answer: toolDef.missingArgMessage ?? "I need a bit more detail to look that up." } satisfies ApAssistantAnswer,
    };
  }

  const toolResult = await toolDef.run({ db, currentOrg, userId, args: selection.args, documentUrlSecret, origin });
  const answerRaw = await model.compile(buildAnswerPrompt(trimmed, selection.tool, toolResult));
  const answer = answerRaw.trim() || "I found the data but couldn't put together an answer — please try rephrasing the question.";

  return { status: 200, body: { question: trimmed, tool: selection.tool, answer } satisfies ApAssistantAnswer };
}

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
import { preferredDocumentType } from "./document-storage.js";
import { handleListDocuments } from "./documents-route.js";
import { handleInvoiceCount, type InvoiceCountReport } from "./invoice-count-route.js";
import { unitsWherePermitted, scopedToChosenOrg } from "./enforce.js";
import { firstOfThisMonth, firstOfThisQuarter } from "./dates.js";

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
 *
 * **Ten tools now, a second addendum to the same decision.** Further
 * live testing asked plain questions — "a link to the latest invoice
 * document," "invoices received this month," "lookup all invoices" —
 * that no tool, and in fact no route anywhere in this codebase, could
 * answer: every existing invoice route was either one invoice by id
 * or by its own printed number, or an aggregate summary. Nothing did
 * "a set of invoices matching a filter." `invoice_search` fills that,
 * wrapping the real Documents screen's own route
 * (`documents-route.ts`'s `handleListDocuments`) rather than a new
 * query, scoped by the same `AP.Review` permission and the same unit
 * scoping that screen already enforces, capped at 50 results with an
 * honest "more may exist, try Documents" rather than a silent
 * truncation — the operator's own choice, asked directly.
 *
 * **A third addendum, three more real gaps from further live
 * testing.** "How many invoices were received this month" refused
 * correctly — `invoice_search` only ever returned a capped, 50-row
 * list, never a true count — fixed with a small, separate, unbounded
 * `COUNT(*)` (`invoice-count-route.ts`), always exact regardless of
 * how many rows match. An ambiguous `invoice_lookup` ("two invoices
 * share this number, which one?") was a dead end every time, because
 * this chat had **zero memory between questions** — the operator's
 * own original, explicit choice for the first build — so a reply to
 * the assistant's own clarifying question could never reach back to
 * it. Fixed two ways, both the operator's own explicit choices, asked
 * directly rather than assumed: an ambiguous lookup now returns every
 * match's own document link immediately rather than withholding all
 * of them, and a bounded slice of recent history (at most
 * `MAX_RECENT_TURNS` turns, further bounded to the last fifteen
 * minutes by the client that sends it — `ap-assistant.js`'s own
 * `recentTurnsToSend()`) now travels with each question, so an actual
 * follow-up like "and the year before that?" can be understood. No
 * server-side storage of any kind was added for this — the browser
 * already kept this history for display; only where it also gets sent
 * changed.
 *
 * **A fourth addendum, three more findings from live use with real
 * conversation memory now flowing.** "Share the most recent invoices"
 * then "share the document links" answered every invoice with a
 * fabricated "no document on file" — `invoice_search`'s own data never
 * carries document status at all (checking retention for up to 50 rows
 * would mean up to 50 signed-URL mints per browsing question, the same
 * cost reasoning that already kept links out of the real Documents
 * screen's own list), but the answer-phrasing prompt only ever told the
 * model what to say when a `documentUrl` field is *present and null* —
 * nothing told it what an *absent* field means, so it improvised.
 * Fixed by telling the answer prompt explicitly that this tool's data
 * never states document availability, so it must never claim one way
 * or the other. The very next question then asked for a specific
 * invoice's link by a number named nowhere in that question itself —
 * exactly what `recentTurns` exists to let the model infer — and
 * `invoice_lookup` answered "not found" for a number `invoice_search`
 * had shown three times moments before. Root-caused as far as this
 * session's own tools allow (no access to the live database or
 * request logs): the number reaching `invoice_lookup` this time had
 * passed through a model's own hands at least once, retyped out of its
 * own prior phrased answer rather than typed by a person, and nothing
 * stops a model from cosmetically restyling a hyphen when it writes
 * prose — `COLLATE NOCASE` folds case, never Unicode code points, so a
 * different dash character is a different string to SQLite. Fixed
 * defensively either way: `invoice-lookup-route.ts` now normalizes
 * dash-like characters on the query side before matching, and the
 * answer prompt is now told to reproduce identifiers exactly as given,
 * never restyled. Separately, "total invoice amount for this quarter"
 * was refused correctly — no tool anywhere sums invoice amounts over a
 * calendar period, and `period` only ever understood "this_month." The
 * operator's own choice, asked directly: build it now, covering both
 * month and quarter. `invoice-count-route.ts` gained an exact,
 * unbounded total by currency (never blended, the same discipline
 * every other money total in this app already keeps) alongside its
 * existing count; `period` now also accepts `"this_quarter"`
 * (`firstOfThisQuarter`, `dates.ts`). The operator's own second
 * choice, also asked directly: for the one-row `latestOnly` case
 * specifically — asked for in two separate live tests now — a document
 * link is minted for that single invoice, the same bounded cost
 * `invoice_lookup` already pays for one match; the general up-to-50
 * list still mints nothing.
 *
 * **A sixth addendum, two more findings from the next live test.**
 * First: every document link this chat had ever returned, since the
 * very first build, pointed at the raw signed-bytes URL
 * `handleMintDocumentUrl` mints (`document-route.ts`) — the exact
 * pattern `viewer.js`'s own doc comment says decision 0384 already
 * retired everywhere else in this app, for opening "a blank tab with
 * no app chrome at all... nothing but the bytes," in favor of a real
 * second page of this app, `document-window.html?task=<id>`, same
 * origin, same session. This chat had simply never been updated to
 * follow that same decision. Fixed by dropping the mint entirely —
 * `preferredDocumentType` (`document-storage.ts`) answers the same
 * "does a document exist" question `handleMintDocumentUrl`'s own 404
 * used to, with no token, no secret, no expiry, and a link that (unlike
 * the one it replaces) never goes stale before someone clicks it,
 * since this chat only ever runs inside an already-authenticated
 * session. Second: that same live test's own displayed invoice total
 * did not match the sum of the very rows sitting right above it in the
 * same answer — traced to `invoice-count-route.ts`'s total only ever
 * summing the structured, confirmed `total_with_vat`/`currency`
 * columns (correct, and unchanged here — an unconfirmed, merely
 * extracted figure can never be allowed into a total this tool calls
 * exact), while `invoice_search`'s own list shows whatever a
 * document's raw extracted facts say regardless. The total was never
 * wrong; nothing ever said it could be narrower than the list beside
 * it. Fixed by exposing `unconfirmedCount` (`invoice-count-route.ts`)
 * and telling the answer prompt to disclose it in plain language
 * whenever it is not zero, rather than a total that silently does not
 * add up to what the person can see for themselves.
 *
 * **A seventh addendum: a real download, not just a nicer chat
 * bubble.** The same conversation that asked for a clickable link also
 * asked, directly, for "something I can download" when a question asks
 * for a report — this chat's own text-only bubble has no way to hand
 * someone a file. `ApAssistantAnswer` gained `table`, real rows behind
 * an `invoice_search` answer (`invoiceSearchTable` below), so
 * `ap-assistant.js` can build a CSV or a PDF from the exact numbers
 * already shown, never a second pass through a model. Two forks put to
 * the operator directly: which format(s) to support — answered "both,
 * CSV and PDF, the person's own choice" — and when to offer a download
 * at all — answered "only when they explicitly ask, same as the table
 * request before it," so an ordinary answer stays uncluttered.
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
  "invoice_search",
] as const;
export type ApAssistantToolName = (typeof AP_ASSISTANT_TOOL_NAMES)[number];

export interface ApAssistantToolArgs {
  /** A supplier's name, as the person said it — matched loosely (case-insensitive substring) against real supplier records, never used to build SQL. */
  supplier?: string;
  /** A purchase order's own order number, exactly as the person gave it — required by `purchase_order_lookup` only. */
  orderNumber?: string;
  /** An invoice's own printed number, exactly as the person gave it — required by `invoice_lookup` only. */
  invoiceNumber?: string;
  /** `invoice_search` only: narrows to the current calendar month or quarter, when the person asked for that. Absent means no date narrowing at all. */
  period?: "this_month" | "this_quarter";
  /** `invoice_search` only: true when the person asked for one single most-recent invoice ("the latest") rather than a list. */
  latestOnly?: boolean;
  /** `invoice_search` only: a workflow stage's own name, as the person said it ("Validation," "Matching") — never an id, which they would never know. Absent means no stage narrowing. */
  stage?: string;
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
  "That's not something I can answer today — I can look at supplier spend, overdue balances, the accrual summary, exception counts, open tasks by person, purchase order status, one purchase order or invoice by its own number, possible duplicate invoices, and recent invoices by date or supplier.";

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
  if (rawArgs.period === "this_month" || rawArgs.period === "this_quarter") args.period = rawArgs.period;
  if (rawArgs.latestOnly === true) args.latestOnly = true;
  if (typeof rawArgs.stage === "string" && rawArgs.stage.trim()) args.stage = rawArgs.stage.trim();

  return { kind: "tool", tool: v.tool as ApAssistantToolName, args };
}

function matchesSupplier(name: string | null | undefined, wanted?: string): boolean {
  if (!wanted) return true;
  if (!name) return false;
  return name.toLowerCase().includes(wanted.toLowerCase());
}

/** Everything a tool's own `run` function might need — one shape for all ten, even though most ignore most of it. */
interface ToolRunContext {
  db: D1Database;
  currentOrg: string | null;
  userId: string;
  args: ApAssistantToolArgs;
}

/**
 * The in-app Document Viewer's own link — decision 0384's already-
 * established page for this, `document-window.html?task=<invoiceId>`
 * (`viewer.js`'s own `popoutUrl`), never the raw signed-bytes URL
 * `handleMintDocumentUrl` mints, which that same file's own doc
 * comment names as retired: "no app chrome at all... nothing but the
 * bytes." Decision 0430's sixth addendum, after live testing showed
 * this chat had never been updated to follow decision 0384 like the
 * rest of the app. Deliberately relative, resolved by the person's own
 * browser against wherever this chat is actually running (vf-ui's own
 * origin) — this file only ever knows vf-app's own origin, which was
 * never the right one for a vf-ui page anyway. No secret, no token, no
 * expiry: the person asking is already inside a real vf-ui session by
 * the time any tool call here ever runs, the same session that page
 * itself would need.
 */
function documentViewerUrl(invoiceId: string): string {
  return `/document-window.html?task=${encodeURIComponent(invoiceId)}`;
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
    // A document link for every match, not none — decision 0430's
    // third addendum, reversing this tool's own original choice.
    // Withholding every link and asking "which one did you mean?"
    // only works if a follow-up reply can reach back to this
    // question, and this chat has no memory of its own beyond what
    // the caller explicitly sends as `recentTurns` (see this file's
    // own top comment) — so until that changes, a bare "which one?"
    // is frequently a dead end. Returning every match's own link
    // immediately means an ambiguous lookup never blocks someone from
    // getting a document. Capped at 10 candidates, matching
    // `duplicate_invoices`' own existing cap — a number this large
    // would itself be a data problem, not a normal case.
    const capped = body.matches.slice(0, 10);
    const matches = capped.map((m) => ({
      supplierName: m.supplierName,
      totalWithVat: m.totalWithVat,
      currency: m.currency,
      stage: m.stage,
      // `hasDocument` (`invoice-lookup-route.ts`) already answers "does
      // a document exist" — no separate lookup needed to build the link.
      documentUrl: m.hasDocument ? documentViewerUrl(m.id) : null,
    }));
    return {
      tool: "invoice_lookup",
      ambiguous: true,
      invoiceNumber,
      matches,
      moreMatchesNotShown: body.matches.length > capped.length,
    };
  }

  const match = body.matches[0];
  return {
    tool: "invoice_lookup",
    found: true,
    invoiceNumber: match.invoiceNumber,
    supplierName: match.supplierName,
    totalWithVat: match.totalWithVat,
    currency: match.currency,
    stage: match.stage,
    inProgress: match.inProgress,
    documentUrl: match.hasDocument ? documentViewerUrl(match.id) : null,
  };
}

interface InvoiceSearchDocument {
  /** The row's own real database id — never included in this tool's output; used only, internally, to mint a document link for the `latestOnly` case below. */
  id: string;
  number: string | null;
  supplier: string | null;
  amount: number | null;
  currency: string | null;
  issueDate: string | null;
  receivedAt: string;
  stageName: string | null;
  status: string;
}

/**
 * A browsable list of recent invoices — "the latest," "received this
 * month" — decision 0430's second addendum. Live testing surfaced
 * this gap the same way as the first addendum's bug: the operator
 * asked plain questions ("Please list invoices received this month")
 * that no tool, and no route anywhere in this codebase, could answer
 * at all. `invoice_lookup` finds one invoice by its own printed
 * number; this finds a set, by recency and an optional month or
 * supplier narrowing.
 *
 * **Wraps the real Documents screen's own route
 * (`documents-route.ts`'s `handleListDocuments`), not a new query** —
 * the same discipline `invoice_lookup` followed for document-link
 * minting. Scoped by unit and chosen org exactly like that screen
 * (`AP.Review`, the same permission), so this tool can never show
 * someone an invoice the Documents screen itself would hide from
 * them.
 *
 * **Capped, honestly.** The operator's own choice: cap at 50, and
 * when the cap is hit, say so and point at the real Documents screen
 * rather than silently truncating or trying to fetch everything into
 * one chat answer.
 *
 * **Never checks document existence for the general list — except the
 * one case where the cap already makes it cheap.** Checking document
 * retention for up to 50 rows would mean up to 50 existence checks for
 * one browsing question — the same cost reasoning that already kept
 * links off the real Documents screen's own list. `latestOnly` caps
 * the result at exactly one row, so decision 0430's fourth addendum
 * built a link for that one row at the same bounded cost `invoice_
 * lookup` already pays for a single match — asked for in two separate
 * live tests now ("please show the most recent invoice" immediately
 * followed by "can you provide the link"). The sixth addendum changed
 * what that link *is* (the in-app Document Viewer, never a signed
 * bytes URL — `documentViewerUrl`'s own doc comment above explains
 * why) without touching this cost reasoning at all — `preferredDocumentType`
 * answers the same existence question `handleMintDocumentUrl`'s own
 * 404 used to, at the same cost.
 *
 * **A stage narrows by name, resolved to real ids first.** A live test
 * asked to "list the invoices held at the Validation stage" and was
 * refused outright — `documents-route.ts`'s own `stage` filter already
 * existed, but nothing exposed it here. A person says a stage's own
 * *name*, never an id, and `process_stages` is customer-configurable
 * (decision 0415's own reasoning), so the same name can genuinely
 * exist on more than one real process — `resolveStageIds` below
 * resolves to every real id sharing that name, never just the first
 * one found, and both the list and the exact count/total are narrowed
 * by all of them together via `documents-route.ts`'s own `stageIds`
 * and `invoice-count-route.ts`'s own `stageIds` filter, the same
 * `EXISTS`-based, never-a-`JOIN` shape that route's own doc comment
 * explains. A name matching no real stage is reported honestly as
 * such, not silently treated as "no filter" (which would answer a
 * different question than the one asked) or as "zero invoices" (which
 * would claim to have checked a real stage that was never found).
 */
async function resolveStageIds(db: D1Database, stageName: string): Promise<string[]> {
  const rows = await db.prepare("SELECT id FROM process_stages WHERE name = ? COLLATE NOCASE").bind(stageName).all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

async function runInvoiceSearch(ctx: ToolRunContext) {
  let stageIds: string[] | null = null;
  if (ctx.args.stage) {
    stageIds = await resolveStageIds(ctx.db, ctx.args.stage);
    if (stageIds.length === 0) {
      return { tool: "invoice_search", stageRecognized: false, stageRequested: ctx.args.stage };
    }
  }

  const cap = ctx.args.latestOnly ? 1 : 50;
  const params = new URLSearchParams();
  if (ctx.args.supplier) params.set("q", ctx.args.supplier);
  params.set("limit", String(cap));
  const since =
    ctx.args.period === "this_month" ? firstOfThisMonth() : ctx.args.period === "this_quarter" ? firstOfThisQuarter() : null;
  if (since) params.set("since", since);
  if (stageIds) params.set("stageIds", JSON.stringify(stageIds));

  const visible = await unitsWherePermitted(ctx.db, ctx.userId, "AP.Review");
  const scoped = await scopedToChosenOrg(ctx.db, visible, ctx.currentOrg);
  const result = await handleListDocuments(ctx.db, params, scoped, ctx.userId);
  const body = result.body as { documents: InvoiceSearchDocument[]; searched: number };

  // An exact, unbounded count and total-by-currency — decision 0430's
  // third addendum built the count, so "how many" never has to be
  // guessed from a capped, 50-row list; the fourth addendum added the
  // total, for the same reason. `invoice-count-route.ts`'s own doc
  // comment explains why this is a separate small query rather than
  // derived from `body` above.
  const countResult = await handleInvoiceCount(ctx.db, ctx.currentOrg, ctx.userId, {
    since,
    supplier: ctx.args.supplier ?? null,
    stageIds,
  });
  const { count: totalMatching, totalByCurrency, unconfirmedCount } = countResult.body as InvoiceCountReport;

  let latestDocumentUrl: string | null = null;
  if (ctx.args.latestOnly && body.documents.length > 0) {
    // documents-route.ts's own list carries no "has a document" flag
    // (checking that for up to 50 rows is exactly the cost this list
    // deliberately avoids) — `latestOnly` caps the result to the one
    // row this bounded existence check is for, the same cost
    // `invoice_lookup` already pays for a single match.
    const hasDocument = await preferredDocumentType(ctx.db, body.documents[0].id);
    if (hasDocument) latestDocumentUrl = documentViewerUrl(body.documents[0].id);
  }

  return {
    tool: "invoice_search",
    period: ctx.args.period ?? null,
    invoices: body.documents.map((d, i) => ({
      number: d.number,
      supplier: d.supplier,
      amount: d.amount,
      currency: d.currency,
      issueDate: d.issueDate,
      receivedAt: d.receivedAt,
      stage: d.stageName,
      status: d.status,
      // Only ever present for the single `latestOnly` row — see this
      // function's own doc comment. Every other invoice_search call
      // carries no document information at all; the answer prompt is
      // told explicitly never to infer one from its absence.
      ...(ctx.args.latestOnly && i === 0 ? { documentUrl: latestDocumentUrl } : {}),
    })),
    countReturned: body.documents.length,
    // Exact, not a heuristic — answers "how many" directly. Distinct
    // from `countReturned`, which can be smaller than this when a
    // supplier filter narrows the (already capped) fetched rows.
    totalMatching,
    // Exact, unbounded, by currency — never blended into one number.
    // Empty when nothing matched, or when every match is missing an
    // amount or a currency.
    totalAmountByCurrency: totalByCurrency,
    // How many matching invoices this total leaves out because they
    // have no confirmed amount/currency yet — decision 0430's sixth
    // addendum. Present even when zero, so the answer prompt can check
    // it plainly rather than guessing from its absence, the same
    // present-vs-absent discipline `documentUrl` already established.
    unconfirmedAmountCount: unconfirmedCount,
    moreMayExist: totalMatching > body.documents.length,
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
  invoice_search: { requiredPermission: "AP.Review", run: runInvoiceSearch },
};

/** One immediately-preceding question and its answer, exactly as the person saw it — see `sanitizeRecentTurns` below. */
export interface ApAssistantRecentTurn {
  question: string;
  answer: string;
}

/**
 * At most this many turns of real context — decision 0430's third
 * addendum. The operator's own choice, revised after checking the
 * real Workers AI cost: at the exact per-model pricing for
 * `@cf/openai/gpt-oss-120b` this app already calls
 * ($0.35/M input tokens), even 50 turns adds a small fraction of a
 * cent per question — negligible, and this screen has no users yet
 * and is being limited to AP Managers and C-Suite, per the operator's
 * own words. Still bounded on turn count, not just the client's own
 * 15-minute recency window, so a long, fast conversation cannot grow
 * this without bound the way a time-only cap would allow.
 */
const MAX_RECENT_TURNS = 50;
/** Each remembered turn's own question/answer text, trimmed to this — shorter than the live question's own 500-character cap, since this is supporting context, not the thing being answered. */
const MAX_RECENT_TURN_CHARS = 300;

/**
 * Validates whatever the client sent as `recentTurns` — untrusted
 * input, the same trust level `question` itself has always had.
 * Never assumes the client's own 4-turn/15-minute limits were
 * actually applied; re-caps here regardless.
 */
function sanitizeRecentTurns(raw: unknown): ApAssistantRecentTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ApAssistantRecentTurn[] = [];
  for (const entry of raw.slice(-MAX_RECENT_TURNS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.question !== "string" || typeof e.answer !== "string") continue;
    const question = e.question.trim().slice(0, MAX_RECENT_TURN_CHARS);
    const answer = e.answer.trim().slice(0, MAX_RECENT_TURN_CHARS);
    if (!question || !answer) continue;
    turns.push({ question, answer });
  }
  return turns;
}

/**
 * The recent-context block shared by both prompts below — absent
 * entirely (not an empty header) when there is no real history yet,
 * so a first question in a session reads exactly as it always did.
 */
function recentTurnsBlock(recentTurns: ApAssistantRecentTurn[]): string {
  if (recentTurns.length === 0) return "";
  const lines = recentTurns.map((t, i) => `${i + 1}. They asked: "${t.question}"\n   You answered: "${t.answer}"`).join("\n");
  return `\n\nFor context, here is what was asked and answered immediately before this (oldest first) — use it only to understand what a short follow-up like "both," "the second one," or "and its total?" refers back to, never as a source of numbers or facts for the new question itself:\n${lines}\n`;
}

function buildSelectionPrompt(question: string, recentTurns: ApAssistantRecentTurn[] = []): string {
  return `You are answering questions for an Accounts Payable manager using VibeFinance, an AP automation product. You can only answer using one of these ten tools — you cannot look anything else up, and you must never invent a number yourself. Read every tool's own description carefully: several sound similar but count genuinely different things, and picking the wrong one because the wording sounds close is worse than refusing.

Tools:
- supplier_spend: total spend by supplier, ranked, grouped by currency. Optional arg "supplier": a supplier's name, to look at one in particular.
- overdue_balance: the value of invoices still open in our workflow whose stated due date has already passed, grouped by supplier and currency. Optional arg "supplier".
- accrual_summary: the value of invoices received but not yet at the final, payment-eligible stage of our workflow, grouped by currency and stage. No arguments.
- exception_counts: how many invoices failed a validation check in roughly the last eight weeks, broken down by supplier, by the person who was assigned the exception, and by type. This is about validation failures on invoices — never about how many tasks someone currently has open, which is a different tool below. Optional arg "supplier".
- tasks_by_user: how many tasks are open and currently assigned to each person right now, plus how many are unclaimed and available to anyone — today's real workload by person. This is the right tool for "who has the most tasks," "who's busiest," or "workload by person." It has nothing to do with validation failures or exceptions. No arguments.
- purchase_order_status: how many purchase orders are in each status (active, on hold, closed, partially invoiced, fully invoiced) right now. No arguments.
- purchase_order_lookup: full detail on one specific purchase order. Requires arg "orderNumber": the order's own number, exactly as given.
- invoice_lookup: full detail on one specific, already-identified invoice, including which workflow stage it is at and a link to its document if one is on file. Requires arg "invoiceNumber": the invoice's own printed number, exactly as given. Use this only when the person already named a specific invoice number — never for "the latest" or "invoices from this month," which is the next tool.
- invoice_search: a list of recent invoices (newest first, up to 50 at a time), an exact, unbounded count of how many match, AND an exact, unbounded total amount by currency — use this for "the latest invoice," "invoices received this month/quarter," "how many invoices this month," "total invoice amount this quarter," "how many/how much from [supplier]," "invoices at the Validation stage," or just browsing what's come in, optionally narrowed to one supplier and/or one workflow stage. The count and the total are always exact even when the list itself is capped at 50 — always answer a "how many" question from the exact count and a "total amount" question from the exact total, never by counting or adding up the list yourself, and never add the total across two different currencies. Only ever returns a document link for one single most-recent invoice (see "latestOnly" below) — for any other specific invoice's link, ask invoice_lookup once you know its number. Optional arg "period": set to "this_month" or "this_quarter" only when they asked about that specific calendar window. Optional arg "latestOnly": set to true only when they asked for one single most recent invoice ("the latest," "the most recent"), never for a general list or a count or a total. Optional arg "supplier". Optional arg "stage": a workflow stage's own name exactly as they said it ("Validation," "Matching," "Payment-eligible") when they asked about invoices at a specific stage — if that name matches no real stage, the data will say so plainly; never guess a close-sounding name instead.
- duplicate_invoices: invoices flagged as possible duplicates of another invoice already on file (same supplier, similar amount, similar date), ranked by how confident that match is. Optional arg "supplier".

None of these tools can say whether an invoice was actually paid, or when — this product does not capture that anywhere, so never claim otherwise. None of them can produce a list of system users, or narrow by any date range other than the current calendar month or quarter.

If the current question asks only for a different presentation of the answer immediately before it — "as a table," "sort that," "just the totals," "can I download that," "export this," "as a CSV," "as a PDF" — and names no new criteria of its own, treat it as the same request as whichever question immediately before it actually named real criteria: pick that same tool, with the same arguments, rather than refusing just because this question alone names nothing. This re-runs the lookup fresh rather than reusing a remembered answer, so the numbers stay real. Only do this when the current question is genuinely just asking for a different presentation — never invent criteria for a question that is honestly asking something new.
${recentTurnsBlock(recentTurns)}
The person asked: "${question}"

Reply with ONLY a JSON object, no other text, no markdown fences. Either:
{"tool": "<one of the ten tool names above>", "args": {"supplier": "<a name, only if relevant and named>", "orderNumber": "<only for purchase_order_lookup>", "invoiceNumber": "<only for invoice_lookup, copied exactly character-for-character from wherever it came from — never restyled, reformatted, or re-punctuated>", "period": "<only \\"this_month\\" or \\"this_quarter\\", only for invoice_search>", "latestOnly": <true, only for invoice_search, only when they asked for a single most-recent invoice>, "stage": "<a workflow stage's own name, only for invoice_search, only when they asked about a specific stage>"}}
(omit any arg key that doesn't apply — most questions need none at all)
or, if their question cannot be answered with any of these ten tools:
{"tool": "none", "reason": "<one honest sentence explaining why, in plain language, to show them directly>"}`;
}

/**
 * What each tool's own data does and does not cover — a short version
 * of that tool's own selection-prompt description above, repeated here
 * because `buildAnswerPrompt` below never otherwise sees it. Found
 * necessary directly from two separate live-test bugs that turned out
 * to share one root cause: the phrasing model only ever sees the raw
 * JSON a tool returned, never the tool's own real boundaries, so
 * nothing stopped it from generalizing past them — `invoice_search`'s
 * data was read as proof no document exists anywhere (it never checks
 * that at all), and `accrual_summary`'s own "no invoices in any other
 * stage" read as a claim about every invoice in the system, when that
 * tool structurally excludes anything already at its process's final,
 * payment-eligible stage or already completed. Decision 0430's fifth
 * addendum.
 */
const AP_ASSISTANT_TOOL_SCOPE: Record<ApAssistantToolName, string> = {
  supplier_spend: "total spend by supplier, ranked and grouped by currency — nothing here says which workflow stage an invoice is at, or whether it has been paid.",
  overdue_balance: "invoices still open in the workflow whose stated due date has already passed — says nothing about invoices that are not overdue, or about payment status.",
  accrual_summary:
    "invoices received but not yet at the final, payment-eligible stage of the workflow, and still in progress. An invoice already at that final stage, or whose process instance has already completed, is never included here — this can never be read as a full account of every invoice in the system, only the ones still accruing, so never say or imply there are no other invoices anywhere else.",
  exception_counts: "validation failures on invoices from roughly the last eight weeks — never a count of anyone's current open tasks.",
  tasks_by_user: "today's open tasks by person, plus how many are unclaimed right now — never a count of validation failures or exceptions.",
  purchase_order_status: "how many purchase orders are in each status right now — says nothing about individual invoices.",
  purchase_order_lookup: "full detail on one specific purchase order, matched by its own number.",
  invoice_lookup: "full detail on one specific, already-identified invoice, matched by its own printed number.",
  invoice_search:
    "a list of recent invoices, capped at 50 even though the count and total beside it are always exact, optionally narrowed by supplier, calendar period, or workflow stage — never states whether a document is on file for any invoice except the single most-recent one, when asked for specifically. The total can be smaller than what the visible list appears to add up to, when unconfirmedAmountCount is above zero — that is correct, not an error, since the total only ever sums confirmed amounts.",
  duplicate_invoices: "invoices flagged as possible duplicates of another already on file, ranked by how confident that match is.",
};

function buildAnswerPrompt(question: string, tool: ApAssistantToolName, toolResult: unknown, recentTurns: ApAssistantRecentTurn[] = []): string {
  return `You are answering an Accounts Payable manager's question using VibeFinance. They asked: "${question}"
${recentTurnsBlock(recentTurns)}
You looked this up using the ${tool} tool, which only ever covers: ${AP_ASSISTANT_TOOL_SCOPE[tool]} Never say or imply anything outside that scope as though you checked and found nothing there — if this tool's data doesn't cover something, you simply don't know, so answer only what the data below actually shows. It returned this real, verified data:
${JSON.stringify(toolResult)}

Write one short, direct, natural-language answer using ONLY the numbers and facts in that data. Do not invent, estimate, or add any figure that isn't there. Reproduce any invoice number, order number, or other identifier exactly character-for-character as it appears in the data — never restyle its punctuation (for example, never change a hyphen to a different dash character) even for readability, since a person may need to type or paste it back exactly. State plainly what each number represents, using the data's own field names as your guide — never rename or reinterpret what a number counts (for example, a count of exceptions is never "tasks," and a count of open tasks is never "exceptions"). If the data is empty or shows nothing relevant to what they asked, say so plainly rather than guessing. If a specific invoice entry includes a "documentUrl" field at all (present, whether a real URL or null), that entry's document status is known: a non-null value is a real link to include; a null value means say plainly no document is on file for that one. Give a non-null "documentUrl" as a markdown link, "[View document](<the documentUrl value, exactly as given>)" — never write the raw path out as plain text, since the chat window turns exactly this markdown form into something clickable and nothing else. If an invoice entry has no "documentUrl" field at all, its document status is simply not known from this data — never say a document is or isn't on file for it; if they want that specific invoice's link, tell them to ask for it by its own invoice number. If the data shows "ambiguous": true with more than one match, briefly list each one (supplier and amount) with its own document link exactly as given (as a markdown link, per above) — a "documentUrl" that is null for a given match means no document is on file for that one, so say so for that match specifically rather than omitting it; do not ask which one they meant, since every match's own information and link are already included. If "moreMatchesNotShown" is true, say plainly that there were more matches than shown. If the data shows "found": false, say plainly you could not find anything with that number. If the data shows "stageRecognized": false, say plainly that "stageRequested" is not a real workflow stage in this system, rather than guessing which one they meant. If the data has an "invoices" list, describe what's in it rather than reading out every single row when there are many; if asked "how many," state the exact "totalMatching" number rather than counting the "invoices" list yourself (that list can be capped at 50 while "totalMatching" never is); if asked for a total amount, state the exact "totalAmountByCurrency" figures rather than adding up the list yourself, one figure per currency, and never combine two currencies into one number; if "unconfirmedAmountCount" is above zero, say plainly that the total does not include every invoice shown — that many do not have a confirmed amount yet — rather than letting the total look like it should match what someone could add up from the list themselves; if "moreMayExist" is true, say plainly that the list shown is not the complete set and that the Documents screen can browse all of them. Never claim to know whether an invoice was actually paid — this data never says that. Do not mention "tools", "JSON", or how you looked this up; answer like a knowledgeable colleague would. If they explicitly asked for a table, a list, or another specific layout, give them that — a short markdown table or list is fine — but every value in it must still come only from the data above, never from a table you remember writing in an earlier answer. Otherwise, keep it to a sentence or two.`;
}

/**
 * A downloadable report's own raw material — decision 0430's seventh
 * addendum, real rows straight from a tool's own result, never text
 * the phrasing model wrote. Built once, server-side, so a CSV or PDF
 * the person downloads is built from the exact same numbers the
 * sentence above it already used — never a second, separate trip
 * through a model that could quietly drift from the first.
 */
export interface ApAssistantAnswerTable {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface ApAssistantAnswer {
  question: string;
  tool: ApAssistantToolName | null;
  answer: string;
  /**
   * Real, tabular data behind this answer, when the tool that ran
   * naturally has some — `invoice_search` today, the only tool this
   * addendum builds it for (see this file's own top comment). `null`
   * for every other tool, and for a refused or permission-denied
   * question. Always present, never merely absent, so the client never
   * has to guess whether a download is possible from silence.
   */
  table: ApAssistantAnswerTable | null;
}

/**
 * `invoice_search`'s own result, reshaped into `ApAssistantAnswerTable`
 * — decision 0430's seventh addendum, so a person asking to download
 * an invoice list gets one built from these exact rows, never text a
 * model wrote. Only `invoice_search` today: the one tool whose result
 * is already a real row-per-invoice list, and the one this whole
 * addendum was asked for directly, live-testing's own "can you provide
 * a table of results?" and "give me something I can download" in the
 * same conversation. A future addendum can widen this to another
 * tool's own list shape (`duplicate_invoices`, say) the same way,
 * without touching this one.
 */
function invoiceSearchTable(toolResult: unknown): ApAssistantAnswerTable | null {
  const body = toolResult as {
    tool?: string;
    invoices?: { number: string | null; supplier: string | null; amount: number | null; currency: string | null; issueDate: string | null; receivedAt: string; stage: string | null; status: string }[];
  };
  if (body.tool !== "invoice_search" || !Array.isArray(body.invoices)) return null;
  return {
    columns: ["Invoice #", "Supplier", "Amount", "Currency", "Issue date", "Received at", "Stage", "Status"],
    rows: body.invoices.map((i) => [i.number, i.supplier, i.amount, i.currency, i.issueDate, i.receivedAt, i.stage, i.status]),
  };
}

/**
 * The chat itself. `AP.Assistant` is checked by the caller (the route
 * in `index.ts`, the same place every other AP Analytics tab checks
 * its own gate) before this is ever reached — this function's own job
 * starts one level in, at "which tool, and does this person actually
 * hold what that tool needs."
 *
 * **No `documentUrlSecret`/`origin` any more, decision 0430's sixth
 * addendum.** Every document link this chat returns used to be minted
 * through `handleMintDocumentUrl`, the only reason these two
 * parameters existed at all; now every link is `documentViewerUrl`'s
 * own relative, in-app path instead, needing neither. Removed rather
 * than left in place unused, so a reader never has to wonder what
 * still depends on them.
 *
 * `recentTurns` is optional, untrusted client input — decision 0430's
 * third addendum. Nothing is stored server-side; the browser already
 * keeps this history for display (`ap-assistant.js`'s own `history`
 * array) and now sends a bounded, recent slice of it alongside each
 * new question, purely so a short follow-up like "both" or "the
 * second one" can be understood. Absent or malformed entirely, this
 * behaves exactly as it always did.
 */
export async function handleAskApAssistant(
  db: D1Database,
  model: CompilerModel,
  currentOrg: string | null,
  userId: string,
  question: unknown,
  recentTurns?: unknown
): Promise<RouteResult> {
  const trimmed = typeof question === "string" ? question.trim() : "";
  if (!trimmed) return { status: 400, body: { error: "a question is required" } };
  if (trimmed.length > 500) return { status: 400, body: { error: "that question is too long — try asking something shorter and more specific" } };

  const recent = sanitizeRecentTurns(recentTurns);

  const selectionRaw = await model.compile(buildSelectionPrompt(trimmed, recent));
  const selection = parseToolSelection(selectionRaw);

  if (selection.kind === "none") {
    return { status: 200, body: { question: trimmed, tool: null, answer: selection.reason, table: null } satisfies ApAssistantAnswer };
  }

  const toolDef = AP_ASSISTANT_TOOLS[selection.tool];
  if (!(await hasPermission(db, userId, toolDef.requiredPermission))) {
    return {
      status: 200,
      body: {
        question: trimmed,
        tool: selection.tool,
        answer: `I can't answer that — it needs the ${toolDef.requiredPermission} permission, which you don't currently hold.`,
        table: null,
      } satisfies ApAssistantAnswer,
    };
  }

  if (toolDef.requiredArg && !selection.args[toolDef.requiredArg]) {
    return {
      status: 200,
      body: {
        question: trimmed,
        tool: selection.tool,
        answer: toolDef.missingArgMessage ?? "I need a bit more detail to look that up.",
        table: null,
      } satisfies ApAssistantAnswer,
    };
  }

  const toolResult = await toolDef.run({ db, currentOrg, userId, args: selection.args });
  const answerRaw = await model.compile(buildAnswerPrompt(trimmed, selection.tool, toolResult, recent));
  const answer = answerRaw.trim() || "I found the data but couldn't put together an answer — please try rephrasing the question.";

  return { status: 200, body: { question: trimmed, tool: selection.tool, answer, table: invoiceSearchTable(toolResult) } satisfies ApAssistantAnswer };
}

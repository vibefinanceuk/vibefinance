import {
  scopedToChosenOrg,
  unitClause,
  unitsFor,
  unitsWherePermitted,
} from "./enforce.js";
import type { Permission } from "./permissions.js";
import { readLicenceState } from "./licence-cache.js";

/**
 * **Agents: asking the data — decision 0633 (the query layer, slice 1).**
 *
 * An agent may ask its own question instead of one of the fixed
 * reports. The question is a structured query (`AgentQuery`), never
 * SQL: a dataset from the catalogue below, filters, grouping, measures,
 * columns, a sort and a limit, each chosen from closed lists.
 *
 * Our code checks the query against the catalogue (`checkQuery`) and
 * writes the SQL itself (`runQuery`) from fixed fragments with bound
 * values. Every run adds the dataset's permission and the person's
 * organisation scope (`unitsWherePermitted`, `scopedToChosenOrg`,
 * `unitClause`, where nowhere means nowhere), caps the rows it reads and
 * returns, and says when it was cut short. Fields an administrator has
 * hidden (decision 0038) are neither offered nor run.
 */

export type FieldKind = "text" | "enum" | "money" | "days" | "date";

export interface QueryField {
  key: string;
  kind: FieldKind;
  /** What it means, in plain English, for the AI (decision 0634). */
  words: string;
  /** A fixed SQL fragment. `{now}` is bound to the run's time. */
  sql: string;
  /** The column's label key, as the reports' own (`agents.col.supplier`). */
  label: string;
  /** May rows be grouped by it. */
  group?: boolean;
  /** The closed set of values, for an enum. */
  values?: string[];
  /** Where each value's words are (`agents.qstatus` → `agents.qstatus.open`). */
  enumKey?: string;
  /** The vocabulary field it shows, so a hidden field is not offered. */
  bt?: string;
}

export interface QueryDataset {
  id: string;
  permission: Permission;
  /** The fixed FROM and joins. */
  from: string;
  /**
   * The organisation unit column the scope is applied to. Null for what
   * belongs to no organisation (received files, decision 0637): asked
   * once, and only by someone holding the permission somewhere.
   */
  scope: string | null;
  /** Decision 0637: a fixed condition every row meets (a return is a returned process). */
  where?: string;
  /** One row's own id, to count each once across organisations. */
  rowId: string;
  /** The invoice a row is about, for Documents (decision 0629); null where rows are not invoices'. */
  invoiceId: string | null;
  /** What "new since the last run" is measured by; null where nothing records when a row arrived. */
  since: string | null;
  /** The currency a money field is in. */
  currency: string | null;
  /** The total and currency of a row, for the report's totals. */
  totals: { total: string; currency: string } | null;
  fields: QueryField[];
}

const LATEST_INSTANCE = `(SELECT p2.id FROM process_instances p2 WHERE p2.subject_type = 'invoice' AND p2.subject_id = h.id ORDER BY p2.created_at DESC, p2.rowid DESC LIMIT 1)`;

const SUPPLIER = `COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"'))`;
const INVOICE_NUMBER = `COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"'))`;

function daysSince(expr: string): string {
  return `CAST(julianday({now}) - julianday(${expr}) AS INTEGER)`;
}

/**
 * **A returned invoice's corrected one has arrived — decision 0632**: a
 * later invoice with the same number from the same supplier (matched, or
 * the same printed name). Uses `h` and `pi`. Kept here since 0637, so the
 * returns dataset and the report share it.
 */
export const REPLY_ARRIVED_SQL = `SELECT 1 FROM invoice_headers n
  WHERE n.id <> h.id AND replace(n.created_at, ' ', 'T') > substr(pi.ended_at, 1, 19)
    AND COALESCE(n.invoice_number, json_extract(n.facts_json, '$."BT-1"')) = COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"'))
    AND ((h.supplier_id IS NOT NULL AND n.supplier_id = h.supplier_id)
      OR (h.supplier_id IS NULL AND json_extract(n.facts_json, '$."BT-27"') = json_extract(h.facts_json, '$."BT-27"')))`;

/**
 * **The invoice a row belongs to, joined the one way we define —
 * decision 0637.** Lines, coding, stage visits, returns and deliveries
 * each offer these of their invoice; a field is only ever reached
 * through this join, never one the AI makes.
 */
function invoiceFields(skip: string[] = []): QueryField[] {
  const all: QueryField[] = [
    { key: "invoice", words: "the invoice number", kind: "text", sql: INVOICE_NUMBER, label: "agents.col.invoice", bt: "BT-1" },
    { key: "supplier", words: "the invoice's supplier", kind: "text", sql: SUPPLIER, label: "agents.col.supplier", group: true, bt: "BT-27" },
    { key: "currency", words: "the invoice's currency code (GBP, EUR, ...)", kind: "text", sql: "h.currency", label: "agents.col.currency", group: true, bt: "BT-5" },
    { key: "issued", words: "the invoice date", kind: "date", sql: `COALESCE(h.issue_date, json_extract(h.facts_json, '$."BT-2"'))`, label: "agents.col.issued", bt: "BT-2" },
    { key: "received", words: "when the invoice was received", kind: "date", sql: "h.created_at", label: "agents.col.received" },
    {
      key: "status",
      words: "where the invoice is in processing: in_progress, completed, returned_manually, archived, none",
      kind: "enum",
      sql: "COALESCE(pi.status, 'none')",
      label: "agents.col.status",
      group: true,
      values: ["in_progress", "completed", "returned_manually", "archived", "none"],
      enumKey: "agents.qstatus",
    },
    { key: "stage", words: "the stage the invoice is at", kind: "text", sql: "s.name", label: "agents.col.stage", group: true },
  ];
  return all.filter((f) => !skip.includes(f.key));
}

const INVOICE_JOINS = `LEFT JOIN process_instances pi ON pi.id = ${LATEST_INSTANCE}
      LEFT JOIN process_stages s ON s.id = pi.current_stage_id
      LEFT JOIN suppliers sup ON sup.id = h.supplier_id`;

export const QUERY_DATASETS: QueryDataset[] = [
  {
    id: "invoices",
    permission: "AP.Analysis",
    from: `invoice_headers h
      LEFT JOIN process_instances pi ON pi.id = ${LATEST_INSTANCE}
      LEFT JOIN process_stages s ON s.id = pi.current_stage_id
      LEFT JOIN suppliers sup ON sup.id = h.supplier_id`,
    scope: "h.org_unit_id",
    rowId: "h.id",
    invoiceId: "h.id",
    since: "h.created_at",
    currency: "h.currency",
    totals: { total: "h.total_with_vat", currency: "h.currency" },
    fields: [
      { key: "invoice", words: "the invoice number", kind: "text", sql: INVOICE_NUMBER, label: "agents.col.invoice", bt: "BT-1" },
      { key: "supplier", words: "the supplier's name", kind: "text", sql: SUPPLIER, label: "agents.col.supplier", group: true, bt: "BT-27" },
      { key: "supplierCountry", words: "the supplier's country code (GB, DE, ...)", kind: "text", sql: `json_extract(h.facts_json, '$."BT-40"')`, label: "agents.col.country", group: true, bt: "BT-40" },
      { key: "issued", words: "the invoice date", kind: "date", sql: `COALESCE(h.issue_date, json_extract(h.facts_json, '$."BT-2"'))`, label: "agents.col.issued", bt: "BT-2" },
      { key: "due", words: "the due date", kind: "date", sql: `json_extract(h.facts_json, '$."BT-9"')`, label: "agents.col.due", bt: "BT-9" },
      { key: "received", words: "when the invoice was received", kind: "date", sql: "h.created_at", label: "agents.col.received" },
      { key: "total", words: "the total including VAT", kind: "money", sql: "h.total_with_vat", label: "agents.col.total", bt: "BT-112" },
      { key: "net", words: "the net total", kind: "money", sql: `CAST(json_extract(h.facts_json, '$."BT-109"') AS REAL)`, label: "agents.col.net", bt: "BT-109" },
      { key: "vat", words: "the VAT total", kind: "money", sql: `CAST(json_extract(h.facts_json, '$."BT-110"') AS REAL)`, label: "agents.col.vat", bt: "BT-110" },
      { key: "currency", words: "the currency code (GBP, EUR, ...)", kind: "text", sql: "h.currency", label: "agents.col.currency", group: true, bt: "BT-5" },
      { key: "buyerReference", words: "the buyer reference", kind: "text", sql: `json_extract(h.facts_json, '$."BT-10"')`, label: "agents.col.buyerref", group: true, bt: "BT-10" },
      { key: "purchaseOrder", words: "the purchase order number", kind: "text", sql: `json_extract(h.facts_json, '$."BT-13"')`, label: "agents.col.ponumber", bt: "BT-13" },
      {
        key: "status",
        words: "where it is in processing: in_progress (still being processed), completed (through the process: payment-eligible or sent on), returned_manually (returned to the supplier), archived, none",
        kind: "enum",
        sql: "COALESCE(pi.status, 'none')",
        label: "agents.col.status",
        group: true,
        values: ["in_progress", "completed", "returned_manually", "archived", "none"],
        enumKey: "agents.qstatus",
      },
      { key: "stage", words: "the stage it is at (approval, coding, ...)", kind: "text", sql: "s.name", label: "agents.col.stage", group: true },
      {
        key: "daysAtStage",
        words: "days at its current stage",
        kind: "days",
        sql: daysSince(
          "(SELECT MAX(v.created_at) FROM stage_visits v WHERE v.process_instance_id = pi.id AND v.stage_id = pi.current_stage_id)",
        ),
        label: "agents.col.daysatstage",
      },
      {
        key: "daysPastDue",
        words: "days since the due date (negative when not yet due)",
        kind: "days",
        sql: daysSince(`json_extract(h.facts_json, '$."BT-9"')`),
        label: "agents.col.dayspastdue",
        bt: "BT-9",
      },
      {
        key: "deliveredToErp",
        words: "whether it has been delivered to the ERP: yes or no",
        kind: "enum",
        sql: `CASE WHEN EXISTS (SELECT 1 FROM destination_deliveries d WHERE d.invoice_id = h.id AND d.status = 'delivered') THEN 'yes' ELSE 'no' END`,
        label: "agents.col.delivered",
        group: true,
        values: ["yes", "no"],
        enumKey: "agents.qyesno",
      },
    ],
  },
  {
    id: "tasks",
    permission: "AP.Analysis",
    from: `tasks t
      JOIN process_stages s ON s.id = t.stage_id
      LEFT JOIN org_users u ON u.id = COALESCE(t.owner_user_id, t.claimed_by)
      LEFT JOIN org_teams tm ON tm.id = t.owner_team_id
      LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
      LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
      LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
      LEFT JOIN suppliers sup ON sup.id = h.supplier_id`,
    scope: "h.org_unit_id",
    rowId: "t.id",
    invoiceId: "h.id",
    since: "t.created_at",
    currency: null,
    totals: null,
    fields: [
      { key: "stage", words: "the stage of the task", kind: "text", sql: "s.name", label: "agents.col.stage", group: true },
      { key: "person", words: "who holds it", kind: "text", sql: "COALESCE(u.name, u.email)", label: "agents.col.person", group: true },
      { key: "team", words: "the team that owns it", kind: "text", sql: "tm.name", label: "agents.col.team", group: true },
      {
        key: "taskStatus",
        words: "open, completed, returned or cancelled",
        kind: "enum",
        sql: "t.status",
        label: "agents.col.taskstatus",
        group: true,
        values: ["open", "completed", "returned", "cancelled"],
        enumKey: "agents.qtaskstatus",
      },
      { key: "created", words: "when the task was created", kind: "date", sql: "t.created_at", label: "agents.col.created" },
      { key: "ageDays", words: "days since it was created", kind: "days", sql: daysSince("t.created_at"), label: "agents.col.agedays" },
      { key: "claimed", words: "when it was claimed", kind: "date", sql: "t.claimed_at", label: "agents.col.claimed" },
      { key: "ended", words: "when it was completed or ended", kind: "date", sql: "COALESCE(t.completed_at, t.ended_at)", label: "agents.col.ended" },
      { key: "invoice", words: "the invoice number it is about", kind: "text", sql: INVOICE_NUMBER, label: "agents.col.invoice", bt: "BT-1" },
      { key: "supplier", words: "the supplier of that invoice", kind: "text", sql: SUPPLIER, label: "agents.col.supplier", group: true, bt: "BT-27" },
    ],
  },
  // Decision 0637: invoice lines, with their invoice.
  {
    id: "lines",
    permission: "AP.Analysis",
    from: `invoice_lines l
      JOIN invoice_headers h ON h.id = l.invoice_id
      ${INVOICE_JOINS}`,
    scope: "h.org_unit_id",
    rowId: "l.id",
    invoiceId: "h.id",
    since: "h.created_at",
    currency: "h.currency",
    totals: { total: "l.amount", currency: "h.currency" },
    fields: [
      { key: "description", words: "the line's description", kind: "text", sql: "COALESCE(l.description, json_extract(l.facts_json, '$.\"BT-153\"'))", label: "agents.col.description", bt: "BT-154" },
      { key: "item", words: "the item's name", kind: "text", sql: "json_extract(l.facts_json, '$.\"BT-153\"')", label: "agents.col.item", group: true, bt: "BT-153" },
      { key: "amount", words: "the line's net amount", kind: "money", sql: "l.amount", label: "agents.col.amount", bt: "BT-131" },
      { key: "vatRate", words: "the line's VAT rate, as written (20, 19, ...)", kind: "text", sql: "CAST(json_extract(l.facts_json, '$.\"BT-152\"') AS TEXT)", label: "agents.col.vatrate", group: true, bt: "BT-152" },
      { key: "costCentre", words: "the cost centre on the line as received", kind: "text", sql: "l.cost_centre", label: "agents.col.costcentre", group: true },
      {
        key: "purchaseOrder",
        words: "the purchase order the line is paired with",
        kind: "text",
        sql: "(SELECT pp.order_number FROM invoice_line_po_pairings pp WHERE pp.invoice_id = l.invoice_id AND pp.line_number = l.line_number)",
        label: "agents.col.ponumber",
        group: true,
      },
      ...invoiceFields(),
    ],
  },
  // Decision 0637: coding — each split of a line to a cost centre, project and GL code.
  {
    id: "coding",
    permission: "AP.Analysis",
    from: `invoice_line_coding_splits c
      JOIN invoice_headers h ON h.id = c.invoice_id
      LEFT JOIN invoice_lines l ON l.invoice_id = c.invoice_id AND l.line_number = c.line_number
      ${INVOICE_JOINS}`,
    scope: "h.org_unit_id",
    rowId: "c.invoice_id || ':' || c.line_number || ':' || c.seq",
    invoiceId: "h.id",
    since: "h.created_at",
    currency: "h.currency",
    totals: { total: "c.amount", currency: "h.currency" },
    fields: [
      { key: "glCode", words: "the GL code it is coded to", kind: "text", sql: "c.gl_code", label: "agents.col.glcode", group: true },
      { key: "costCentre", words: "the cost centre it is coded to", kind: "text", sql: "c.cost_centre", label: "agents.col.costcentre", group: true },
      { key: "project", words: "the project it is coded to", kind: "text", sql: "c.project", label: "agents.col.project", group: true },
      { key: "amount", words: "the amount coded", kind: "money", sql: "c.amount", label: "agents.col.amount" },
      { key: "description", words: "the line's description", kind: "text", sql: "l.description", label: "agents.col.description", bt: "BT-154" },
      ...invoiceFields(),
    ],
  },
  // Decision 0637: each time an invoice was at a stage, and for how long.
  {
    id: "stage_visits",
    permission: "AP.Analysis",
    from: `stage_visits v
      JOIN process_instances pi ON pi.id = v.process_instance_id AND pi.subject_type = 'invoice'
      JOIN invoice_headers h ON h.id = pi.subject_id
      JOIN process_stages vs ON vs.id = v.stage_id
      LEFT JOIN process_stages s ON s.id = pi.current_stage_id
      LEFT JOIN suppliers sup ON sup.id = h.supplier_id`,
    scope: "h.org_unit_id",
    rowId: "v.id",
    invoiceId: "h.id",
    since: "v.created_at",
    currency: "h.currency",
    totals: null,
    fields: [
      { key: "visitStage", words: "the stage of this visit", kind: "text", sql: "vs.name", label: "agents.col.visitstage", group: true },
      { key: "entered", words: "when the invoice reached the stage", kind: "date", sql: "v.created_at", label: "agents.col.entered" },
      {
        key: "left",
        words: "when it moved on from the stage (empty while still there)",
        kind: "date",
        sql: "(SELECT MIN(v2.created_at) FROM stage_visits v2 WHERE v2.process_instance_id = v.process_instance_id AND v2.created_at > v.created_at)",
        label: "agents.col.left",
      },
      {
        key: "daysSpent",
        words: "days spent at the stage (until now while still there)",
        kind: "days",
        sql: "CAST(julianday(COALESCE((SELECT MIN(v2.created_at) FROM stage_visits v2 WHERE v2.process_instance_id = v.process_instance_id AND v2.created_at > v.created_at), {now})) - julianday(v.created_at) AS INTEGER)",
        label: "agents.col.daysspent",
      },
      { key: "outcome", words: "what the stage's rules decided (matched, exception, ...)", kind: "text", sql: "v.outcome", label: "agents.col.outcome", group: true },
      { key: "total", words: "the invoice's total including VAT", kind: "money", sql: "h.total_with_vat", label: "agents.col.total", bt: "BT-112" },
      ...invoiceFields(),
    ],
  },
  // Decision 0637: invoices returned to their supplier.
  {
    id: "returns",
    permission: "AP.Analysis",
    from: `process_instances pi
      JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
      LEFT JOIN process_stages s ON s.id = pi.current_stage_id
      LEFT JOIN suppliers sup ON sup.id = h.supplier_id
      LEFT JOIN supplier_return_reasons rr ON rr.id = pi.return_reason_id`,
    where: "pi.status = 'returned_manually'",
    scope: "h.org_unit_id",
    rowId: "pi.id",
    invoiceId: "h.id",
    since: "pi.ended_at",
    currency: "h.currency",
    totals: { total: "h.total_with_vat", currency: "h.currency" },
    fields: [
      { key: "returned", words: "when it was returned", kind: "date", sql: "pi.ended_at", label: "agents.col.returned" },
      { key: "daysSince", words: "days since it was returned", kind: "days", sql: daysSince("pi.ended_at"), label: "agents.col.dayssince" },
      { key: "reason", words: "why it was returned", kind: "text", sql: "COALESCE(rr.label, pi.return_reason_id)", label: "agents.col.returnreason", group: true },
      { key: "comment", words: "the comment made when it was returned", kind: "text", sql: "pi.supplier_comment", label: "agents.col.comment" },
      {
        key: "replyArrived",
        words: "whether a corrected invoice has arrived since: yes or no",
        kind: "enum",
        sql: `CASE WHEN EXISTS (${REPLY_ARRIVED_SQL}) THEN 'yes' ELSE 'no' END`,
        label: "agents.col.replyarrived",
        group: true,
        values: ["yes", "no"],
        enumKey: "agents.qyesno",
      },
      { key: "total", words: "the invoice's total including VAT", kind: "money", sql: "h.total_with_vat", label: "agents.col.total", bt: "BT-112" },
      ...invoiceFields(["status", "stage"]),
    ],
  },
  // Decision 0637: suppliers, as the Suppliers screen shows them (AP.Supplier, scoped by their organisation).
  {
    id: "suppliers",
    permission: "AP.Supplier",
    from: "suppliers sup",
    scope: "sup.org_unit_id",
    rowId: "sup.id",
    invoiceId: null,
    since: null,
    currency: null,
    totals: null,
    fields: [
      { key: "supplier", words: "the supplier's name", kind: "text", sql: "sup.name", label: "agents.col.supplier", group: true },
      { key: "erpId", words: "the supplier's ERP identifier", kind: "text", sql: "sup.erp_identifier", label: "agents.col.erpid" },
      { key: "vatId", words: "the supplier's VAT number", kind: "text", sql: "sup.vat_id", label: "agents.col.vatid" },
      { key: "country", words: "the supplier's country code (GB, DE, ...)", kind: "text", sql: "sup.country", label: "agents.col.country", group: true },
      { key: "city", words: "the supplier's city", kind: "text", sql: "sup.city", label: "agents.col.city", group: true },
      { key: "supplierStatus", words: "active or inactive", kind: "enum", sql: "sup.status", label: "agents.col.status", group: true, values: ["active", "inactive"], enumKey: "agents.qsupplierstatus" },
      { key: "onHold", words: "whether the supplier is on hold: yes or no", kind: "enum", sql: "CASE WHEN sup.on_hold = 1 THEN 'yes' ELSE 'no' END", label: "agents.col.onhold", group: true, values: ["yes", "no"], enumKey: "agents.qyesno" },
      { key: "holdReason", words: "why the supplier is on hold", kind: "text", sql: "sup.hold_reason", label: "agents.col.holdreason" },
      { key: "paymentTerms", words: "the supplier's payment terms", kind: "text", sql: "sup.payment_terms", label: "agents.col.paymentterms", group: true },
      { key: "matchOption", words: "how its invoices are matched: two_way, three_way or none", kind: "enum", sql: "COALESCE(sup.match_option, 'none')", label: "agents.col.matchoption", group: true, values: ["two_way", "three_way", "none"], enumKey: "agents.qmatch" },
    ],
  },
  // Decision 0637: purchase order lines, as Purchase Orders shows them (AP.Validate, scoped by the order's organisation).
  {
    id: "purchase_orders",
    permission: "AP.Validate",
    from: `purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.purchase_order_id`,
    scope: "po.org_unit_id",
    rowId: "pl.id",
    invoiceId: null,
    since: "pl.created_at",
    currency: "po.currency",
    totals: { total: "pl.line_extension_amount", currency: "po.currency" },
    fields: [
      { key: "order", words: "the order number", kind: "text", sql: "po.order_number", label: "agents.col.ponumber", group: true },
      { key: "ordered", words: "the order date", kind: "date", sql: "po.issue_date", label: "agents.col.ordered" },
      { key: "supplier", words: "the order's supplier", kind: "text", sql: "(SELECT s2.name FROM suppliers s2 WHERE s2.vat_id = po.seller_party_id LIMIT 1)", label: "agents.col.supplier", group: true },
      { key: "orderStatus", words: "active, on_hold or closed", kind: "enum", sql: "po.status", label: "agents.col.status", group: true, values: ["active", "on_hold", "closed"], enumKey: "agents.qpostatus" },
      { key: "item", words: "the item ordered", kind: "text", sql: "COALESCE(pl.item_name, pl.item_description)", label: "agents.col.item", group: true },
      { key: "amount", words: "the line's net amount", kind: "money", sql: "pl.line_extension_amount", label: "agents.col.amount" },
      { key: "currency", words: "the order's currency code", kind: "text", sql: "po.currency", label: "agents.col.currency", group: true },
      {
        key: "invoiced",
        words: "whether an invoice line has been paired with it: yes or no",
        kind: "enum",
        sql: "CASE WHEN EXISTS (SELECT 1 FROM invoice_line_po_pairings pp WHERE pp.order_number = po.order_number AND pp.po_line_number = pl.line_number) THEN 'yes' ELSE 'no' END",
        label: "agents.col.invoiced",
        group: true,
        values: ["yes", "no"],
        enumKey: "agents.qyesno",
      },
    ],
  },
  // Decision 0637: deliveries of invoices to the ERP and other destinations (Integration.Monitor, scoped by the invoice).
  {
    id: "deliveries",
    permission: "Integration.Monitor",
    from: `destination_deliveries d
      JOIN invoice_headers h ON h.id = d.invoice_id
      LEFT JOIN route_instances ri ON ri.id = d.instance_id
      ${INVOICE_JOINS}`,
    scope: "h.org_unit_id",
    rowId: "d.instance_id || ':' || d.invoice_id",
    invoiceId: "h.id",
    since: "d.created_at",
    currency: "h.currency",
    totals: { total: "h.total_with_vat", currency: "h.currency" },
    fields: [
      { key: "destination", words: "where it is delivered to", kind: "text", sql: "COALESCE(ri.name, d.instance_id)", label: "agents.col.destination", group: true },
      { key: "deliveryStatus", words: "pending, retrying, delivered, failed or skipped", kind: "enum", sql: "d.status", label: "agents.col.deliverystatus", group: true, values: ["pending", "retrying", "delivered", "failed", "skipped"], enumKey: "agents.qdelivery" },
      { key: "queued", words: "when it was queued to be sent", kind: "date", sql: "d.created_at", label: "agents.col.queued" },
      { key: "delivered", words: "when it was delivered", kind: "date", sql: "d.delivered_at", label: "agents.col.deliveredat" },
      { key: "error", words: "the last error, if any", kind: "text", sql: "d.last_error", label: "agents.col.problem" },
      { key: "total", words: "the invoice's total including VAT", kind: "money", sql: "h.total_with_vat", label: "agents.col.total", bt: "BT-112" },
      ...invoiceFields(["status", "stage"]),
    ],
  },
  // Decision 0637: files received from suppliers and channels (Integration.Monitor; they belong to no organisation).
  {
    id: "files",
    permission: "Integration.Monitor",
    from: "route_messages m",
    where: "m.direction = 'in'",
    scope: null,
    rowId: "m.id",
    invoiceId: null,
    since: "m.received_at",
    currency: null,
    totals: null,
    fields: [
      { key: "received", words: "when the file arrived", kind: "date", sql: "m.received_at", label: "agents.col.received" },
      { key: "from", words: "who sent it", kind: "text", sql: "m.counterparty", label: "agents.col.from", group: true },
      { key: "subject", words: "its subject or file name", kind: "text", sql: "m.subject", label: "agents.col.subject" },
      { key: "fileStatus", words: "received, delivered, partial, failed or dismissed", kind: "enum", sql: "m.status", label: "agents.col.status", group: true, values: ["received", "delivered", "partial", "failed", "dismissed"], enumKey: "agents.qfile" },
      { key: "failedAt", words: "where it failed: gateway, format, translation or delivery", kind: "text", sql: "m.failed_part", label: "agents.col.failedat", group: true },
      { key: "error", words: "what went wrong", kind: "text", sql: "m.error_text", label: "agents.col.problem" },
    ],
  },
];

/** The operators each kind of field takes. */
export const OPS: Record<FieldKind, string[]> = {
  text: ["is", "is_not", "in", "contains", "is_empty", "not_empty"],
  enum: ["is", "is_not", "in"],
  money: ["over", "under", "between"],
  days: ["is", "over", "under", "between"],
  date: ["in_last_days", "older_than_days", "before", "after", "between", "is_empty", "not_empty"],
};

export const MEASURE_FNS = ["count", "sum", "avg", "min", "max"] as const;
export type MeasureFn = (typeof MEASURE_FNS)[number];

export const QUERY_LIMITS = {
  filters: 10,
  inValues: 50,
  text: 200,
  show: 12,
  groupBy: 2,
  measures: 4,
  sort: 2,
  limitDefault: 100,
  limitMax: 500,
  /** Rows read for a grouped question; past this it is cut short and says so. */
  scanMax: 5000,
  /** D1's own limit on bound values in one statement. */
  binds: 100,
};

export interface QueryFilter {
  field: string;
  op: string;
  value?: unknown;
  /** Money only: the currency it is compared in. */
  currency?: string;
}

export interface QueryMeasure {
  fn: MeasureFn;
  field?: string;
}

export interface AgentQuery {
  dataset: string;
  /**
   * Decision 0638: started by an event — looked at every hour, each person
   * sent only the rows they have not had (as decision 0630's reports).
   * Rows one each only, so each has its own key.
   */
  event?: boolean;
  where: QueryFilter[];
  since: "all" | "last_run";
  show: string[];
  groupBy: string[];
  measures: QueryMeasure[];
  sort: { key: string; dir: "asc" | "desc" }[];
  limit: number;
}

export function datasetById(id: unknown): QueryDataset | null {
  return QUERY_DATASETS.find((d) => d.id === id) ?? null;
}

function fieldOf(d: QueryDataset, key: unknown): QueryField | null {
  return d.fields.find((f) => f.key === key) ?? null;
}

export function measureKey(m: QueryMeasure): string {
  return m.fn === "count" ? "count" : `${m.fn}_${m.field}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function isDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function isAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12;
}

function isDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 36500;
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= QUERY_LIMITS.text;
}

type Refusal = { reason: string; detail?: string };

const SYMBOLS: Record<string, string> = { "£": "GBP", "€": "EUR", $: "USD", "¥": "JPY" };

/** A currency as a three-letter code: "GBP", "gbp" or "£". Null when it is not one. */
export function currencyCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (SYMBOLS[t]) return SYMBOLS[t];
  const up = t.toUpperCase();
  return CURRENCY.test(up) ? up : null;
}

/**
 * An amount as the model may write it: 100000, "100000", "100,000",
 * "£100,000", "100k", "1.5m", "GBP 100000", or {"amount": 100000,
 * "currency": "GBP"}. The currency, where it carries one. Undefined when
 * it is not an amount.
 */
export function readAmount(v: unknown): { amount: number; currency: string | null } | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? { amount: v, currency: null } : undefined;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const inner = readAmount(o.amount ?? o.value);
    if (!inner) return undefined;
    return { amount: inner.amount, currency: currencyCode(o.currency) ?? inner.currency };
  }
  if (typeof v !== "string") return undefined;
  let text = v.trim();
  let currency: string | null = null;
  for (const [sym, code] of Object.entries(SYMBOLS)) {
    if (text.includes(sym)) {
      currency = code;
      text = text.split(sym).join("");
    }
  }
  const code = text.match(/\b([A-Za-z]{3})\b/);
  if (code && CURRENCY.test(code[1].toUpperCase())) {
    currency = currency ?? code[1].toUpperCase();
    text = text.replace(code[0], "");
  }
  const m = text.replace(/[\s,]/g, "").match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1);
  return { amount: Math.round(n * 100) / 100, currency };
}

function checkFilter(d: QueryDataset, raw: unknown): { filter: QueryFilter } | Refusal {
  if (!raw || typeof raw !== "object") return { reason: "query_filter_invalid" };
  const r = raw as Record<string, unknown>;
  const f = fieldOf(d, r.field);
  if (!f) return { reason: "query_field_unknown", detail: String(r.field) };
  const op = typeof r.op === "string" ? r.op : "";
  if (!OPS[f.kind].includes(op)) return { reason: "query_op_invalid", detail: `${f.key} ${op}` };
  const v = r.value;
  const bad = { reason: "query_value_invalid", detail: f.key };
  if (op === "is_empty" || op === "not_empty") return { filter: { field: f.key, op } };
  if (f.kind === "money") {
    // Decision 0635: an amount and its currency, however the model wrote them, when it is plain which.
    const amounts = (op === "between" ? (Array.isArray(v) ? v : []) : [v]).map(readAmount);
    const currency = currencyCode(r.currency) ?? amounts.map((a) => a?.currency).find((c) => c) ?? null;
    if (!currency) return { reason: "query_currency_missing", detail: f.key };
    const nums = amounts.map((a) => a?.amount);
    if (nums.some((n) => n === undefined || !isAmount(n))) return bad;
    if (op === "between") {
      if (nums.length !== 2 || nums[0]! > nums[1]!) return bad;
      return { filter: { field: f.key, op, value: [nums[0], nums[1]], currency } };
    }
    return { filter: { field: f.key, op, value: nums[0], currency } };
  }
  if (f.kind === "days") {
    if (op === "between") {
      if (!Array.isArray(v) || v.length !== 2 || !isDays(v[0]) || !isDays(v[1]) || v[0] > v[1]) return bad;
      return { filter: { field: f.key, op, value: [v[0], v[1]] } };
    }
    if (!isDays(v)) return bad;
    return { filter: { field: f.key, op, value: v } };
  }
  if (f.kind === "date") {
    if (op === "in_last_days" || op === "older_than_days") {
      if (!isDays(v) || v < 1) return bad;
      return { filter: { field: f.key, op, value: v } };
    }
    if (op === "between") {
      if (!Array.isArray(v) || v.length !== 2 || !isDate(v[0]) || !isDate(v[1]) || v[0] > v[1]) return bad;
      return { filter: { field: f.key, op, value: [v[0], v[1]] } };
    }
    if (!isDate(v)) return bad;
    return { filter: { field: f.key, op, value: v } };
  }
  if (f.kind === "enum") {
    const allowed = f.values ?? [];
    if (op === "in") {
      if (!Array.isArray(v) || v.length === 0 || v.length > QUERY_LIMITS.inValues) return bad;
      if (v.some((x) => typeof x !== "string" || !allowed.includes(x))) return bad;
      return { filter: { field: f.key, op, value: [...new Set(v as string[])] } };
    }
    if (typeof v !== "string" || !allowed.includes(v)) return bad;
    return { filter: { field: f.key, op, value: v } };
  }
  // text
  if (op === "in") {
    if (!Array.isArray(v) || v.length === 0 || v.length > QUERY_LIMITS.inValues || v.some((x) => !isText(x))) return bad;
    return { filter: { field: f.key, op, value: [...new Set(v as string[])] } };
  }
  if (!isText(v)) return bad;
  return { filter: { field: f.key, op, value: v } };
}

/**
 * **The check on a query — anything not in the catalogue is refused.**
 * Returns the query as it will run (defaults filled in, a currency
 * column added beside money, rows grouped by currency where money is
 * summed), or why not. It does not look at the database: who may see
 * what is checked when it runs, and hidden fields by `hiddenInQuery`.
 */
export function checkQuery(input: unknown): { query: AgentQuery } | Refusal {
  if (!input || typeof input !== "object") return { reason: "query_missing" };
  const q = input as Record<string, unknown>;
  const d = datasetById(q.dataset);
  if (!d) return { reason: "query_dataset_unknown", detail: String(q.dataset) };

  const whereIn = q.where === undefined ? [] : q.where;
  if (!Array.isArray(whereIn)) return { reason: "query_filter_invalid" };
  if (whereIn.length > QUERY_LIMITS.filters) return { reason: "query_too_many_filters" };
  const where: QueryFilter[] = [];
  for (const raw of whereIn) {
    const c = checkFilter(d, raw);
    if ("reason" in c) return c;
    where.push(c.filter);
  }

  const since = q.since === undefined || q.since === "all" ? "all" : q.since === "last_run" ? "last_run" : null;
  if (!since) return { reason: "query_since_invalid" };
  // Decision 0637: only where something records when a row arrived.
  if (since === "last_run" && !d.since) return { reason: "query_since_invalid", detail: d.id };

  const groupIn = q.groupBy === undefined ? [] : q.groupBy;
  if (!Array.isArray(groupIn) || groupIn.length > QUERY_LIMITS.groupBy) return { reason: "query_group_invalid" };
  const groupBy: string[] = [];
  for (const g of groupIn) {
    const f = fieldOf(d, g);
    if (!f) return { reason: "query_field_unknown", detail: String(g) };
    if (!f.group) return { reason: "query_group_invalid", detail: f.key };
    if (!groupBy.includes(f.key)) groupBy.push(f.key);
  }

  const measuresIn = q.measures === undefined ? [] : q.measures;
  if (!Array.isArray(measuresIn) || measuresIn.length > QUERY_LIMITS.measures) return { reason: "query_measure_invalid" };
  const measures: QueryMeasure[] = [];
  for (const raw of measuresIn) {
    const m = (raw ?? {}) as Record<string, unknown>;
    if (!MEASURE_FNS.includes(m.fn as MeasureFn)) return { reason: "query_measure_invalid" };
    const fn = m.fn as MeasureFn;
    if (fn === "count") {
      if (!measures.some((x) => x.fn === "count")) measures.push({ fn });
      continue;
    }
    const f = fieldOf(d, m.field);
    if (!f) return { reason: "query_field_unknown", detail: String(m.field) };
    const ok =
      fn === "sum" || fn === "avg"
        ? f.kind === "money" || f.kind === "days"
        : f.kind === "money" || f.kind === "days" || f.kind === "date";
    if (!ok) return { reason: "query_measure_invalid", detail: `${fn} ${f.key}` };
    if (!measures.some((x) => measureKey(x) === measureKey({ fn, field: f.key }))) measures.push({ fn, field: f.key });
  }
  if (groupBy.length > 0 && measures.length === 0) measures.push({ fn: "count" });
  if (groupBy.length === 0 && measures.length > 0) return { reason: "query_measure_without_group" };

  // Money is never added up across currencies: rows are grouped by currency too.
  const moneyMeasured = measures.some((m) => m.field && fieldOf(d, m.field)?.kind === "money");
  if (moneyMeasured && !groupBy.includes("currency")) {
    if (!fieldOf(d, "currency")) return { reason: "query_measure_invalid" };
    if (groupBy.length >= QUERY_LIMITS.groupBy) return { reason: "query_money_needs_currency" };
    groupBy.push("currency");
  }

  let show: string[] = [];
  if (groupBy.length === 0) {
    const showIn = q.show === undefined ? [] : q.show;
    if (!Array.isArray(showIn)) return { reason: "query_show_invalid" };
    for (const s of showIn) {
      const f = fieldOf(d, s);
      if (!f) return { reason: "query_field_unknown", detail: String(s) };
      if (!show.includes(f.key)) show.push(f.key);
    }
    if (show.length === 0) return { reason: "query_show_missing" };
    if (show.some((k) => fieldOf(d, k)?.kind === "money") && fieldOf(d, "currency") && !show.includes("currency")) {
      const at = show.findIndex((k) => fieldOf(d, k)?.kind === "money");
      show.splice(at + 1, 0, "currency");
    }
    if (show.length > QUERY_LIMITS.show) return { reason: "query_show_too_many" };
  } else {
    show = [];
  }

  const columns = groupBy.length ? [...groupBy, ...measures.map(measureKey)] : show;
  const sortIn = q.sort === undefined ? [] : q.sort;
  if (!Array.isArray(sortIn) || sortIn.length > QUERY_LIMITS.sort) return { reason: "query_sort_invalid" };
  const sort: AgentQuery["sort"] = [];
  for (const raw of sortIn) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (typeof s.key !== "string" || !columns.includes(s.key)) return { reason: "query_sort_invalid", detail: String(s.key) };
    const dir = s.dir === undefined || s.dir === "desc" ? "desc" : s.dir === "asc" ? "asc" : null;
    if (!dir) return { reason: "query_sort_invalid" };
    sort.push({ key: s.key, dir });
  }

  const limit = q.limit === undefined ? QUERY_LIMITS.limitDefault : q.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > QUERY_LIMITS.limitMax)
    return { reason: "query_limit_invalid" };

  // Decision 0638: an event needs rows one each, so each row has its own key.
  if (q.event !== undefined && typeof q.event !== "boolean") return { reason: "query_event_invalid" };
  if (q.event === true && groupBy.length > 0) return { reason: "query_event_grouped" };

  return { query: { dataset: d.id, ...(q.event === true ? { event: true } : {}), where, since, show, groupBy, measures, sort, limit } };
}

/** Every field a query reads, to find any that are hidden. */
export function fieldsUsed(q: AgentQuery): string[] {
  return [
    ...new Set([
      ...q.where.map((w) => w.field),
      ...q.show,
      ...q.groupBy,
      ...q.measures.flatMap((m) => (m.field ? [m.field] : [])),
    ]),
  ];
}

/** Vocabulary fields an administrator has hidden (decision 0038). */
export async function hiddenFields(db: D1Database): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT field FROM field_visibility WHERE visibility = 'hidden'")
    .all<{ field: string }>();
  return new Set(rows.results.map((r) => r.field));
}

/** The first field the query uses that is hidden here, or null. */
export async function hiddenInQuery(db: D1Database, q: AgentQuery): Promise<string | null> {
  const d = datasetById(q.dataset);
  if (!d) return null;
  const hidden = await hiddenFields(db);
  for (const key of fieldsUsed(q)) {
    const f = fieldOf(d, key);
    if (f?.bt && hidden.has(f.bt)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The SQL: written here, from fixed fragments, with every value bound.
// ---------------------------------------------------------------------------

class Sql {
  text = "";
  binds: unknown[] = [];
  constructor(private now: string) {}
  /** A fixed fragment; `{now}` is bound to the run's time. */
  frag(s: string): this {
    const parts = s.split("{now}");
    parts.forEach((p, i) => {
      if (i > 0) {
        this.text += "?";
        this.binds.push(this.now);
      }
      this.text += p;
    });
    return this;
  }
  bind(v: unknown): this {
    this.text += "?";
    this.binds.push(v);
    return this;
  }
}

function addFilter(sql: Sql, d: QueryDataset, w: QueryFilter) {
  const f = fieldOf(d, w.field)!;
  const e = `(${f.sql})`;
  const v = w.value;
  sql.frag(" AND ");
  switch (w.op) {
    case "is":
      sql.frag(`${e} = `).bind(v);
      return;
    case "is_not":
      sql.frag(`(${e} IS NULL OR ${e} <> `).bind(v).frag(")");
      return;
    case "in": {
      const list = v as string[];
      sql.frag(`${e} IN (`);
      list.forEach((x, i) => {
        if (i) sql.frag(", ");
        sql.bind(x);
      });
      sql.frag(")");
      return;
    }
    case "contains":
      sql.frag(`instr(lower(${e}), lower(`).bind(v).frag(")) > 0");
      return;
    case "is_empty":
      sql.frag(`(${e} IS NULL OR ${e} = '')`);
      return;
    case "not_empty":
      sql.frag(`(${e} IS NOT NULL AND ${e} <> '')`);
      return;
    case "over":
      sql.frag(`${e} > `).bind(v);
      break;
    case "under":
      sql.frag(`${e} < `).bind(v);
      break;
    case "between": {
      const [a, b] = v as [unknown, unknown];
      if (f.kind === "date") sql.frag(`date(${e}) BETWEEN `).bind(a).frag(" AND ").bind(b);
      else sql.frag(`${e} BETWEEN `).bind(a).frag(" AND ").bind(b);
      break;
    }
    case "in_last_days":
      sql.frag(`julianday(${e}) >= julianday({now}) - `).bind(v);
      return;
    case "older_than_days":
      sql.frag(`julianday(${e}) < julianday({now}) - `).bind(v);
      return;
    case "before":
      sql.frag(`date(${e}) < `).bind(v);
      return;
    case "after":
      sql.frag(`date(${e}) > `).bind(v);
      return;
    default:
      throw new Error("query_op_invalid");
  }
  // Money is compared in the currency named, never another.
  if (f.kind === "money" && d.currency) sql.frag(` AND ${d.currency} = `).bind(w.currency);
}

export interface QueryOrg {
  id: string;
  name: string;
}

export interface QueryColumn {
  key: string;
  label: string;
  kind: "text" | "money" | "count" | "date" | "days";
  enumKey?: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Record<string, string | number | null>[];
  totals: { currency: string | null; total: number | null; count: number }[];
  /** Set when the limit or the rows read cut it short. */
  cutShort?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function columnKind(k: FieldKind): QueryColumn["kind"] {
  return k === "enum" ? "text" : k;
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * **Run a checked query for one person** over the organisations given.
 * The dataset's permission and the person's scope are added to every
 * statement; each row is counted once, in the first organisation it is
 * found under, as the reports do.
 */
export async function runQuery(
  db: D1Database,
  personId: string,
  orgs: QueryOrg[],
  q: AgentQuery,
  now: Date,
  ctx: { since: string | null } = { since: null },
): Promise<QueryResult> {
  const d = datasetById(q.dataset);
  if (!d) throw new Error("query_dataset_unknown");
  const hidden = await hiddenInQuery(db, q);
  if (hidden) throw new Error("query_field_hidden");
  const grouped = q.groupBy.length > 0;
  const read = grouped ? q.groupBy : q.show;
  const measureFields = [...new Set(q.measures.flatMap((m) => (m.field ? [m.field] : [])))];
  const sqlFields = [...new Set([...read, ...measureFields])];
  const cap = grouped ? QUERY_LIMITS.scanMax : q.limit;
  const visible = await unitsWherePermitted(db, personId, d.permission);
  const nowIso = now.toISOString();

  type Raw = { _rid: string; _inv: string | null; _t: number | null; _c: string | null; [k: string]: unknown };
  const seen = new Set<string>();
  const found: { org: QueryOrg | null; row: Raw }[] = [];
  let cut = false;
  // Decision 0637: what belongs to no organisation is asked once, by someone holding the permission somewhere.
  const unscoped = d.scope === null;
  const asked: (QueryOrg | null)[] = unscoped ? (visible !== null && visible.length === 0 ? [] : [null]) : orgs;
  for (const org of asked) {
    const units = org ? await scopedToChosenOrg(db, visible, org.id) : null;
    const clause = d.scope ? unitClause({ units }, d.scope) : { sql: "", binds: [] };
    const sql = new Sql(nowIso);
    sql.frag(`SELECT ${d.rowId} AS _rid, ${d.invoiceId ?? "NULL"} AS _inv`);
    if (d.totals) sql.frag(`, ${d.totals.total} AS _t, ${d.totals.currency} AS _c`);
    sqlFields.forEach((key, i) => sql.frag(`, (${fieldOf(d, key)!.sql}) AS f${i}`));
    sql.frag(` FROM ${d.from} WHERE ${d.where ?? "1 = 1"}`);
    for (const w of q.where) addFilter(sql, d, w);
    if (q.since === "last_run" && ctx.since) sql.frag(` AND julianday(${d.since}) > julianday(`).bind(ctx.since).frag(")");
    sql.text += clause.sql;
    sql.binds.push(...clause.binds);
    if (!grouped && q.sort.length) {
      sql.frag(" ORDER BY ");
      q.sort.forEach((s, i) => {
        const at = sqlFields.indexOf(s.key);
        sql.frag(`${i ? ", " : ""}f${at} IS NULL, f${at} ${s.dir === "asc" ? "ASC" : "DESC"}`);
      });
    } else if (!grouped) {
      sql.frag(` ORDER BY ${d.since ?? d.rowId} DESC`);
    }
    sql.frag(` LIMIT ${cap + 1}`);
    if (sql.binds.length > QUERY_LIMITS.binds) throw new Error("query_too_large");
    const res = await db.prepare(sql.text).bind(...sql.binds).all<Raw>();
    if (res.results.length > cap) cut = true;
    for (const raw of res.results.slice(0, cap)) {
      if (seen.has(raw._rid)) continue;
      seen.add(raw._rid);
      const row: Raw = { _rid: raw._rid, _inv: raw._inv, _t: raw._t ?? null, _c: raw._c ?? null };
      sqlFields.forEach((key, i) => (row[key] = raw[`f${i}`]));
      found.push({ org, row });
    }
  }

  const orgColumn: QueryColumn[] = unscoped ? [] : [{ key: "org", label: "agents.col.org", kind: "text" }];
  const fieldColumns = (keys: string[]): QueryColumn[] =>
    keys.map((k) => {
      const f = fieldOf(d, k)!;
      return { key: k, label: f.label, kind: columnKind(f.kind), ...(f.enumKey ? { enumKey: f.enumKey } : {}) };
    });
  const value = (f: QueryField, v: unknown): string | number | null => {
    if (v === null || v === undefined) return null;
    if (f.kind === "money") return typeof v === "number" ? round2(v) : Number.isFinite(Number(v)) ? round2(Number(v)) : null;
    if (f.kind === "days") return typeof v === "number" ? Math.trunc(v) : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null;
    if (f.kind === "date") return String(v).slice(0, 10);
    return typeof v === "number" ? v : String(v);
  };
  const sortRows = (rows: Record<string, string | number | null>[]) => {
    if (!q.sort.length) return rows;
    return rows.sort((a, b) => {
      for (const s of q.sort) {
        const c = compare(a[s.key], b[s.key]);
        if (c !== 0) return s.dir === "asc" ? c : -c;
      }
      return 0;
    });
  };

  if (!grouped) {
    const totals = new Map<string, { currency: string | null; total: number | null; count: number }>();
    let rows = found.map(({ org, row }) => {
      const out: Record<string, string | number | null> = unscoped ? {} : { org: org?.name ?? null };
      for (const k of q.show) out[k] = value(fieldOf(d, k)!, row[k]);
      if (row._inv) out.invoiceId = row._inv;
      out._key = `q:${row._rid}`;
      return out;
    });
    rows = sortRows(rows);
    if (rows.length > q.limit) {
      cut = true;
      rows = rows.slice(0, q.limit);
    }
    const kept = new Set(rows.map((r) => String(r._key)));
    let count = 0;
    for (const { row } of found) {
      if (!kept.has(`q:${row._rid}`)) continue;
      count += 1;
      if (d.totals && row._c && typeof row._t === "number") {
        const t = totals.get(row._c) ?? { currency: row._c, total: 0, count: 0 };
        t.total = (t.total ?? 0) + row._t;
        t.count += 1;
        totals.set(row._c, t);
      }
    }
    return {
      columns: [...orgColumn, ...fieldColumns(q.show)],
      rows,
      totals: d.totals
        ? [...totals.values()].map((t) => ({ ...t, total: t.total === null ? null : round2(t.total) }))
        : count > 0
          ? [{ currency: null, total: null, count }]
          : [],
      ...(cut ? { cutShort: grouped ? QUERY_LIMITS.scanMax : q.limit } : {}),
    };
  }

  // Grouped: each organisation's groups, with their measures.
  type Group = { org: string | null; keys: Record<string, string | number | null>; rows: Raw[]; ids: Set<string> };
  const groups = new Map<string, Group>();
  for (const { org, row } of found) {
    const keys: Record<string, string | number | null> = {};
    for (const k of q.groupBy) keys[k] = value(fieldOf(d, k)!, row[k]);
    const id = JSON.stringify([org?.id ?? "", ...q.groupBy.map((k) => keys[k])]);
    const g = groups.get(id) ?? { org: org?.name ?? null, keys, rows: [], ids: new Set<string>() };
    g.rows.push(row);
    if (row._inv) g.ids.add(row._inv);
    groups.set(id, g);
  }
  let count = 0;
  let rows = [...groups.values()].map((g) => {
    const out: Record<string, string | number | null> = { ...(unscoped ? {} : { org: g.org }), ...g.keys };
    for (const m of q.measures) {
      const key = measureKey(m);
      if (m.fn === "count") {
        out[key] = g.rows.length;
        continue;
      }
      const f = fieldOf(d, m.field)!;
      const vals = g.rows.map((r) => value(f, r[f.key])).filter((v): v is string | number => v !== null);
      if (vals.length === 0) {
        out[key] = null;
        continue;
      }
      if (f.kind === "date") {
        const sorted = (vals as string[]).slice().sort();
        out[key] = m.fn === "min" ? sorted[0] : m.fn === "max" ? sorted[sorted.length - 1] : null;
        continue;
      }
      const nums = vals.map(Number);
      const sum = nums.reduce((a, b) => a + b, 0);
      const r =
        m.fn === "sum" ? sum : m.fn === "avg" ? sum / nums.length : m.fn === "min" ? Math.min(...nums) : Math.max(...nums);
      out[key] = f.kind === "money" ? round2(r) : f.kind === "days" && m.fn !== "avg" ? Math.trunc(r) : round2(r);
    }
    count += g.rows.length;
    if (g.ids.size) out._ids = [...g.ids].join(",");
    return out;
  });
  rows = sortRows(rows);
  if (rows.length > q.limit) {
    cut = true;
    rows = rows.slice(0, q.limit);
  }
  const measureColumns: QueryColumn[] = q.measures.map((m) => {
    if (m.fn === "count") return { key: "count", label: "agents.col.m.count", kind: "count" };
    const f = fieldOf(d, m.field)!;
    return {
      key: measureKey(m),
      label: `agents.col.m.${f.kind === "date" ? (m.fn === "min" ? "first" : "last") : m.fn}|${f.label}`,
      kind: f.kind === "date" ? "date" : f.kind === "money" ? "money" : "days",
    };
  });
  return {
    columns: [...orgColumn, ...fieldColumns(q.groupBy), ...measureColumns],
    rows,
    totals: count > 0 ? [{ currency: null, total: null, count }] : [],
    ...(cut ? { cutShort: found.length >= QUERY_LIMITS.scanMax ? QUERY_LIMITS.scanMax : q.limit } : {}),
  };
}

/**
 * **What this person may ask about**: the datasets whose permission they
 * hold somewhere, and their fields, less those hidden here. For the
 * query builder and the plain-words prompt (slices 2 and 3).
 */
export async function queryCatalogue(db: D1Database, personId: string) {
  const hidden = await hiddenFields(db);
  const { units } = await unitsFor(db, personId);
  const out = [];
  // Decision 0638: nothing to ask where the licence leaves questions out.
  const inLicence = (await queryLimit(db)) > 0;
  for (const d of inLicence ? QUERY_DATASETS : []) {
    const visible = await unitsWherePermitted(db, personId, d.permission);
    if (visible !== null && visible.length === 0) continue;
    out.push({
      id: d.id,
      label: `agents.dataset.${d.id}`,
      permission: d.permission,
      // Decision 0637: the organisations it may be asked about, by its own permission.
      orgIds: units.filter((u) => visible === null || visible.includes(u.id)).map((u) => u.id),
      // Decision 0637: whether "only what is new" can be asked of it.
      since: Boolean(d.since),
      fields: d.fields
        .filter((f) => !(f.bt && hidden.has(f.bt)))
        .map((f) => ({
          key: f.key,
          kind: f.kind,
          label: f.label,
          words: f.words,
          ops: OPS[f.kind],
          group: Boolean(f.group),
          ...(f.values ? { values: f.values, enumKey: f.enumKey } : {}),
        })),
    });
  }
  return { datasets: out, measures: MEASURE_FNS, limits: QUERY_LIMITS };
}

/** The catalogue as the AI is shown it: each dataset, field, kind and meaning (decision 0634). */
/** Decision 0637: what one row of each dataset is, for the AI. */
const DATASET_WORDS: Record<string, string> = {
  invoices: "one row per invoice",
  tasks: "one row per task on an invoice",
  lines: "one row per invoice line, with its invoice's fields",
  coding: "one row per coding split of an invoice line (GL code, cost centre, project), with its invoice's fields; use for spend by GL code, cost centre or project",
  stage_visits: "one row per time an invoice was at a stage, with how long; use for time spent at stages",
  returns: "one row per invoice returned to its supplier",
  suppliers: "one row per supplier on file",
  purchase_orders: "one row per purchase order line",
  deliveries: "one row per delivery of an invoice to the ERP or another destination",
  files: "one row per file received from a supplier or channel",
};

export function catalogueWords(cat: Awaited<ReturnType<typeof queryCatalogue>>): string {
  return cat.datasets
    .map(
      (d) =>
        `Dataset "${d.id}" (${DATASET_WORDS[d.id] ?? d.id}${d.since ? "" : "; \"since\" must be \"all\""}):\n${d.fields
          .map((f) => `  - ${f.key} (${f.kind}${f.group ? ", can group by" : ""}): ${f.words}`)
          .join("\n")}`,
    )
    .join("\n");
}

/**
 * **What the plan assumed, to be marked "(usual)" — decision 0634.** The
 * parts the AI says it chose without being told, if they are parts of
 * this query, and what our check filled in itself.
 */
export function assumedParts(said: unknown, raw: unknown, q: AgentQuery): string[] {
  const parts = new Set<string>();
  const known = new Set([
    ...q.where.map((w) => `where:${w.field}`),
    ...(q.since === "last_run" || q.since === "all" ? ["since"] : []),
    ...(q.sort.length ? ["sort"] : []),
    "limit",
  ]);
  for (const x of Array.isArray(said) ? said : []) {
    if (typeof x !== "string") continue;
    const p = x.startsWith("where:") || ["since", "sort", "limit"].includes(x) ? x : `where:${x}`;
    if (known.has(p)) parts.add(p);
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const groupSaid = Array.isArray(r.groupBy) ? r.groupBy : [];
  if (q.groupBy.includes("currency") && !groupSaid.includes("currency")) parts.add("group:currency");
  if (r.since === undefined) parts.add("since");
  if (r.limit === undefined) parts.add("limit");
  const measuresSaid = Array.isArray(r.measures) ? r.measures : [];
  if (q.groupBy.length && measuresSaid.length === 0) parts.add("measure:count");
  return [...parts];
}

// ---------------------------------------------------------------------------
// Decision 0638: the day's allowance of questions, on the licence.
// ---------------------------------------------------------------------------

/** Questions a day when the licence names none. */
export const DEFAULT_QUERY_LIMIT = 500;

/** The licence's questions a day: 0 leaves them out of the tier. */
export async function queryLimit(db: D1Database): Promise<number> {
  const state = await readLicenceState(db);
  const limit = state.known ? (state.claims as { queryLimit?: unknown }).queryLimit : undefined;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_QUERY_LIMIT;
}

/**
 * Take one of today's questions (UTC day), in one statement so two runs
 * at once cannot both take the last. The reason when none is left, or
 * when the licence leaves questions out.
 */
export async function takeQuery(db: D1Database, now: Date): Promise<null | "query_not_in_licence" | "query_limit_reached"> {
  const limit = await queryLimit(db);
  if (limit <= 0) return "query_not_in_licence";
  const result = await db
    .prepare(
      `INSERT INTO agent_query_days (day, queries) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET queries = queries + 1 WHERE queries < ?`,
    )
    .bind(now.toISOString().slice(0, 10), limit)
    .run();
  return (result.meta?.changes ?? 0) > 0 ? null : "query_limit_reached";
}

/** Questions asked today, and the day's limit. */
export async function queriesToday(db: D1Database, now: Date): Promise<{ used: number; max: number }> {
  const row = await db
    .prepare("SELECT queries FROM agent_query_days WHERE day = ?")
    .bind(now.toISOString().slice(0, 10))
    .first<{ queries: number }>();
  return { used: row?.queries ?? 0, max: await queryLimit(db) };
}

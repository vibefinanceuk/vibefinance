import { t } from "/strings.js";
import { buildReceiptTimeline, describe as describeReceiptItem } from "/receipt-timeline.js";

/**
 * **A purchase order's Timeline and Chat — decision 0754.** Dan: "The
 * Timeline / Chat should make note of PO changes, modifications, and
 * history." Drawn as a goods receipt's (0658, 0675): each order, change
 * and cancellation that came in and what its release changed, line by
 * line, from what to what; Hold, Release hold and Close; goods received
 * and returned; invoices and credit notes; the supplier; and the
 * conversation here, with the people and teams in it.
 */

const fill = (key, values) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v === null || v === undefined || v === "" ? "—" : String(v)), t(key));

/** A number as a person reads it: no trailing zeros, grouped. */
const num = (v) => (typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : v === null || v === undefined || v === "" ? "—" : String(v));

const STATUS = { active: "purchaseorders.status.active", on_hold: "purchaseorders.status.onhold", closed: "purchaseorders.status.closed" };
const status = (s) => (STATUS[s] ? t(STATUS[s]) : s ?? "—");

/** The labels the order's own page shows for each fact compared. */
const FIELD = {
  issueDate: "purchaseorders.issuedate",
  currency: "purchaseorders.currency",
  seller: "purchaseorders.seller",
  buyer: "purchaseorders.buyer",
  requisition: "purchaseorders.requisition",
  orderType: "purchaseorders.ordertype",
  netAmount: "purchaseorders.netamount",
  payable: "purchaseorders.payable",
  item: "purchaseorders.item",
  description: "purchaseorders.description",
  sellersItem: "purchaseorders.sku",
  quantity: "purchaseorders.quantity",
  unit: "purchaseorders.unit",
  price: "purchaseorders.price",
  amount: "purchaseorders.amount",
};
const fieldName = (f) => (FIELD[f] ? t(FIELD[f]) : f);
const change = (c) => fill("purchaseorders.tl.diff.field", { field: fieldName(c.field), from: num(c.from), to: num(c.to) });

/** What a load, change or release changed, a line each. Exported for its test. */
export function changeLines(changes) {
  if (!changes) return [];
  const out = [];
  if (changes.status && changes.status.from !== changes.status.to) out.push(fill("purchaseorders.tl.diff.field", { field: t("purchaseorders.statuslabel"), from: status(changes.status.from), to: status(changes.status.to) }));
  for (const c of changes.header ?? []) out.push(change(c));
  for (const l of changes.lines ?? []) {
    if (l.change === "added") {
      const f = Object.fromEntries((l.fields ?? []).map((x) => [x.field, x.to]));
      out.push(fill("purchaseorders.tl.diff.added", { line: l.line, item: l.item, quantity: num(f.quantity), unit: f.unit ?? "", price: num(f.price) }).replace(/\s+,/g, ",").replace(/\s{2,}/g, " "));
    } else if (l.change === "removed") {
      out.push(fill("purchaseorders.tl.diff.removed", { line: l.line, item: l.item }));
    } else {
      out.push(fill("purchaseorders.tl.diff.line", { line: l.line, item: l.item, changes: (l.fields ?? []).map(change).join("; ") }));
    }
  }
  for (const w of changes.receiptWarnings ?? []) {
    out.push(fill(`purchaseorders.receiptwarn.${w.kind}`, { order: w.orderNumber, line: w.line, net: num(w.net), ordered: num(w.ordered) }));
  }
  return out;
}

/** What one thing that happened says, in words. Exported for its test. */
export function describeOrderItem(item) {
  const d = item.detail ?? {};
  const by = item.by ?? t("receipts.tl.someone");
  switch (item.kind) {
    case "order_arrived":
      return fill(`purchaseorders.tl.arrived.${d.orderKind ?? "order"}.${d.uploaded ? "upload" : "route"}`, { by, source: d.source ?? t("receipts.tl.aroute"), sender: d.sender, lines: d.lines });
    case "order_released": {
      const kind = d.orderKind === "change" ? "change" : d.orderKind === "cancellation" ? "cancellation" : "order";
      return fill(`purchaseorders.tl.released.${kind}${item.by ? "by" : ""}`, { by });
    }
    case "order_rejected":
      return fill(`purchaseorders.tl.rejected.${d.orderKind ?? "order"}`, { by, reason: d.reason });
    case "order_loaded":
      if (d.earlier) return t("purchaseorders.tl.loaded.earlier");
      return fill(item.by ? "purchaseorders.tl.loadedby" : "purchaseorders.tl.loaded", { by, lines: d.lines });
    case "order_changed":
      return fill(item.by ? "purchaseorders.tl.changedby" : "purchaseorders.tl.changed", { by });
    case "order_held":
      return fill("purchaseorders.tl.held", { by, reason: d.reason });
    case "order_hold_released":
      return fill("purchaseorders.tl.holdreleased", { by });
    case "order_closed":
      return fill("purchaseorders.tl.closed", { by });
    case "goods_received":
    case "goods_returned":
      return fill(item.kind === "goods_received" ? "purchaseorders.tl.received" : "purchaseorders.tl.returned", { receipt: d.receiptNumber, quantity: num(d.quantity), lines: (d.lines ?? []).join(", ") });
    case "order_invoiced":
    case "order_credited": {
      const kind = item.kind === "order_invoiced" ? "invoiced" : "credited";
      const total = typeof d.total === "number" ? `${num(d.total)}${d.currency ? ` ${d.currency}` : ""}` : null;
      return fill(`purchaseorders.tl.${kind}${total ? "" : ".nototal"}`, { number: d.number, total });
    }
    case "supplier_opened":
      return t("purchaseorders.tl.supplieropened");
    // Decision 0759: Orders to suppliers.
    case "sent_to_supplier":
      return fill(`purchaseorders.tl.sent.${d.kind ?? "order"}`, { to: (d.to ?? []).join(", "), by });
    case "send_failed":
      return fill("purchaseorders.tl.sendfailed", { to: (d.to ?? []).join(", "), error: d.error });
    case "not_sent":
      return t(d.reason === "no_address" ? "purchaseorders.tl.notsent.noaddress" : "purchaseorders.tl.notsent.own");
    case "supplier_asked":
      return fill("purchaseorders.tl.supplierasked", { by });
    case "supplier_written":
      return fill("purchaseorders.tl.supplierwritten", { by });
    case "supplier_replied":
      return fill("purchaseorders.tl.supplierreplied", { by });
    default:
      // Checking's task, and people added or removed: said as a receipt's.
      return describeReceiptItem(item);
  }
}

/** The grey lines beneath: what changed, and anything else worth knowing. Exported for its test. */
export function orderSubs(item) {
  const d = item.detail ?? {};
  switch (item.kind) {
    case "order_arrived":
      return [d.changeReference ? fill("purchaseorders.tl.changeref", { ref: d.changeReference }) : null, d.note ? fill("purchaseorders.tl.note", { note: d.note }) : null];
    case "order_released": {
      const lines = changeLines(d.changes);
      return [
        d.override ? t("purchaseorders.tl.released.override") : null,
        ...lines,
        d.orderKind === "change" && d.changes && lines.length === 0 ? t("purchaseorders.tl.nochange") : null,
        d.changes?.reconstructed ? t("purchaseorders.tl.reconstructed") : null,
      ];
    }
    case "order_changed": {
      const lines = changeLines(d.changes);
      return lines.length ? lines : [t("purchaseorders.tl.nochange")];
    }
    case "goods_received":
    case "goods_returned":
      return [d.pending ? t("purchaseorders.tl.receipt.pending") : null, d.cancelled ? t("purchaseorders.tl.receipt.cancelled") : null];
    // Decision 0759: which address, and how it went.
    case "sent_to_supplier":
      return [t(`ordersout.from.${d.from}`), d.how === "by_hand" ? t("purchaseorders.tl.sent.byhand").replace("{by}", item.by ?? "") : t("purchaseorders.tl.sent.onrelease"), d.pdf ? t("purchaseorders.tl.sent.pdf") : null, d.ubl ? t("purchaseorders.tl.sent.ubl") : null];
    default:
      return [];
  }
}

/** Which card an item is drawn as (decision 0675's look). */
function cardKey(item) {
  const d = item.detail ?? {};
  switch (item.kind) {
    case "order_arrived":
      return "received";
    case "order_released":
      return d.orderKind === "change" ? "order_changed" : d.orderKind === "cancellation" ? "cancelled" : "order_released";
    case "order_rejected":
      return "rejected";
    case "goods_received":
      return "receipt_closed";
    case "goods_returned":
      return "return";
    case "claimed":
      return "claim";
    case "released":
      return "release";
    case "reassigned":
      return "reassign";
    default:
      return item.kind;
  }
}

export function buildOrderTimeline(orderNumber, { countBadge = null } = {}) {
  return buildReceiptTimeline(orderNumber, {
    countBadge,
    base: `/purchase-orders/${encodeURIComponent(orderNumber)}`,
    prefix: "po",
    describeItem: describeOrderItem,
    subsOf: orderSubs,
    cardKey,
    words: {
      nobody: "purchaseorders.tl.nobody",
      nobodyhint: "purchaseorders.tl.nobodyhint",
      needspermission: "purchaseorders.tl.needspermission",
      errorPrefix: "purchaseorders.error",
    },
  });
}

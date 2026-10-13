import type { ParsedOrder } from "@vibefinance/shared";

/**
 * **What a load or a change did to a purchase order — decision 0754.**
 * Dan: "The Timeline / Chat should make note of PO changes, modifications,
 * and history." An order is deleted and written again whenever a load or a
 * change replaces it (0081), so what it was is gone afterwards; it is
 * compared here, before and after, and what differs is kept on the event.
 *
 * Compared: the header facts a person reads on the order, and each line by
 * its number — added, removed, or which of its facts changed, from what to
 * what. Absent and empty are the same.
 */

export interface OrderSnapshot {
  header: Record<string, string | number | null>;
  lines: Map<number, Record<string, string | number | null>>;
}

export interface FieldChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface LineChange {
  line: number;
  change: "added" | "removed" | "changed";
  item: string | null;
  fields: FieldChange[];
}

export interface OrderDiff {
  header: FieldChange[];
  lines: LineChange[];
  status?: { from: string | null; to: string };
}

/** The header facts compared, in the order they are shown. */
export const HEADER_FIELDS = ["issueDate", "currency", "seller", "buyer", "requisition", "orderType", "netAmount", "payable"] as const;
/** The line facts compared, in the order they are shown. */
export const LINE_FIELDS = ["item", "description", "sellersItem", "quantity", "unit", "price", "amount"] as const;

const value = (v: unknown): string | number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export function snapshotOfParsed(o: ParsedOrder): OrderSnapshot {
  return {
    header: {
      issueDate: value(o.issueDate),
      currency: value(o.currency),
      seller: value(o.sellerPartyId),
      buyer: value(o.buyerPartyId),
      requisition: value(o.originatorReference),
      orderType: value(o.orderTypeCode),
      netAmount: value(o.lineExtensionAmount),
      payable: value(o.payableAmount),
    },
    lines: new Map(
      o.lines.map((l) => [
        l.lineNumber,
        {
          item: value(l.itemName),
          description: value(l.itemDescription),
          sellersItem: value(l.sellersItemId),
          quantity: value(l.quantity),
          unit: value(l.unitCode),
          price: value(l.priceAmount),
          amount: value(l.lineExtensionAmount),
        },
      ])
    ),
  };
}

type Row = Record<string, unknown>;

/** The order as stored: `purchase_orders` and its `purchase_order_lines`. */
export function snapshotOfStored(order: Row, lines: Row[]): OrderSnapshot {
  return {
    header: {
      issueDate: value(order.issue_date),
      currency: value(order.currency),
      seller: value(order.seller_party_id),
      buyer: value(order.buyer_party_id),
      requisition: value(order.originator_reference),
      orderType: value(order.order_type_code),
      netAmount: value(order.line_extension_amount),
      payable: value(order.payable_amount),
    },
    lines: new Map(
      lines.map((l) => [
        Number(l.line_number),
        {
          item: value(l.item_name),
          description: value(l.item_description),
          sellersItem: value(l.sellers_item_id),
          quantity: value(l.quantity),
          unit: value(l.unit_code),
          price: value(l.price_amount),
          amount: value(l.line_extension_amount),
        },
      ])
    ),
  };
}

const same = (a: string | number | null, b: string | number | null) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;

/** What differs between two versions of an order; nothing, when they are the same. */
export function diffOrders(before: OrderSnapshot, after: OrderSnapshot): OrderDiff {
  const header: FieldChange[] = [];
  for (const field of HEADER_FIELDS) {
    const from = before.header[field] ?? null;
    const to = after.header[field] ?? null;
    if (!same(from, to)) header.push({ field, from, to });
  }
  const lines: LineChange[] = [];
  const numbers = [...new Set([...before.lines.keys(), ...after.lines.keys()])].sort((a, b) => a - b);
  for (const n of numbers) {
    const was = before.lines.get(n);
    const now = after.lines.get(n);
    if (!was && now) {
      lines.push({ line: n, change: "added", item: (now.item as string | null) ?? null, fields: LINE_FIELDS.filter((f) => now[f] !== null && now[f] !== undefined).map((f) => ({ field: f, from: null, to: now[f] ?? null })) });
    } else if (was && !now) {
      lines.push({ line: n, change: "removed", item: (was.item as string | null) ?? null, fields: [] });
    } else if (was && now) {
      const fields = LINE_FIELDS.filter((f) => !same(was[f] ?? null, now[f] ?? null)).map((f) => ({ field: f, from: was[f] ?? null, to: now[f] ?? null }));
      if (fields.length) lines.push({ line: n, change: "changed", item: ((now.item ?? was.item) as string | null) ?? null, fields });
    }
  }
  return { header, lines };
}

/** Whether a diff says anything. */
export const isEmptyDiff = (d: OrderDiff) => d.header.length === 0 && d.lines.length === 0 && (!d.status || d.status.from === d.status.to);

/** One thing that happened to an order, for its Timeline. Returns the statement, to batch with the change itself. */
export function orderEvent(
  db: D1Database,
  orderNumber: string,
  kind: string,
  actorId: string | null,
  detail: Record<string, unknown> | null,
  at: string,
  intakeId: string | null = null
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO purchase_order_events (id, order_number, at, actor_id, kind, intake_id, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), orderNumber, at, actorId, kind, intakeId, detail ? JSON.stringify(detail) : null);
}

/** Whether a person is in an order's conversation, by name or through a team (decision 0754). */
export async function isOrderCollaborator(db: D1Database, userId: string, orderNumber: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM purchase_order_collaborators c
       WHERE c.order_number = ?1 AND c.removed_at IS NULL
         AND (c.user_id = ?2 OR c.team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?2)) LIMIT 1`
    )
    .bind(orderNumber, userId)
    .first();
  return row !== null;
}

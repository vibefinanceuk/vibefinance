import type { PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { orderEvent } from "./order-history.js";
import { portalMayReadOrder } from "./order-sharing.js";
import type { OrderKind } from "./orders-out.js";

/**
 * **The supplier confirms it has the order — decision 0762**, slice 4c
 * of purchase orders.
 *
 * Each order emailed to the supplier carries a link of its own. Dan
 * asked for one click, then the supplier network:
 *
 * > "I would prefer the link to confirm receipt and also take the user to
 * > the supplier network, where they can see that the purchase order is
 * > confirmed."
 *
 * The secret sits after the `#` in the link, so it never reaches a server
 * that merely fetches the URL. The supplier network's page posts it here
 * once it has loaded in a browser. Mail scanners that only fetch links
 * confirm nothing; the browser that confirmed is kept, so the rarer
 * scanner that runs pages can be told apart.
 *
 * A supplier who never saw the email confirms on the order in the
 * supplier network instead:
 *
 * > "If the supplier does not see the email, they should be able to log
 * > into the supplier network, and click confirm manually."
 *
 * A confirmation is of one version: the order as released, or a change or
 * cancellation released after it. A change needs confirming again, and an
 * earlier email's link still confirms only the version it carried.
 */

export interface Confirmation {
  at: string;
  how: "link" | "network";
  by: string | null;
  kind: OrderKind;
}

export interface OrderConfirmationState {
  /** The version the supplier has now: the latest released. */
  kind: OrderKind;
  /** Its confirmation, or null while it waits for one. */
  confirmed: Confirmation | null;
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashConfirmToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/** A new link's secret (32 random bytes, base64url) and the hash kept of it. */
export async function newConfirmToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { token, hash: await hashConfirmToken(token) };
}

/** The link in the email: the supplier network's confirm page, which instance, and the secret after the `#`. */
export function confirmUrl(networkUrl: string, environmentId: string, token: string): string {
  return `${networkUrl.replace(/\/+$/, "")}/confirm#${encodeURIComponent(environmentId)}.${token}`;
}

/** The version released last, which is the one the supplier has now. */
async function currentVersion(db: D1Database, orderNumber: string): Promise<{ intakeId: string | null; kind: OrderKind }> {
  const row = await db
    .prepare("SELECT id, kind FROM purchase_order_intake WHERE order_number = ? AND status = 'released' ORDER BY released_at DESC, rowid DESC LIMIT 1")
    .bind(orderNumber)
    .first<{ id: string; kind: OrderKind }>();
  return row ? { intakeId: row.id, kind: row.kind } : { intakeId: null, kind: "order" };
}

interface ConfirmationRow {
  kind: OrderKind;
  how: "link" | "network";
  by_email: string | null;
  created_at: string;
}

const view = (r: ConfirmationRow): Confirmation => ({ at: r.created_at, how: r.how, by: r.by_email, kind: r.kind });

async function confirmationOf(db: D1Database, orderNumber: string, intakeId: string | null): Promise<ConfirmationRow | null> {
  return db
    .prepare("SELECT kind, how, by_email, created_at FROM purchase_order_confirmations WHERE order_number = ? AND intake_id IS ?")
    .bind(orderNumber, intakeId)
    .first<ConfirmationRow>();
}

/** Whether the supplier has confirmed the order as it stands, for the order's page here and in the supplier network. */
export async function orderConfirmation(db: D1Database, orderNumber: string): Promise<OrderConfirmationState> {
  const version = await currentVersion(db, orderNumber);
  const row = await confirmationOf(db, orderNumber, version.intakeId);
  return { kind: version.kind, confirmed: row ? view(row) : null };
}

/** One confirmation, and what the order's Timeline says of it. Once per version: a second is the first. */
async function record(
  db: D1Database,
  c: { orderNumber: string; intakeId: string | null; kind: OrderKind; sendId: string | null; how: "link" | "network"; by: string | null; agent: string | null; current: boolean },
  now: Date
): Promise<{ confirmation: Confirmation; already: boolean }> {
  const existing = await confirmationOf(db, c.orderNumber, c.intakeId);
  if (existing) return { confirmation: view(existing), already: true };
  const at = now.toISOString();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO purchase_order_confirmations (id, order_number, intake_id, kind, send_id, how, by_email, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), c.orderNumber, c.intakeId, c.kind, c.sendId, c.how, c.by, c.agent ? c.agent.slice(0, 300) : null, at),
      orderEvent(db, c.orderNumber, "supplier_confirmed", null, { how: c.how, kind: c.kind, by: c.by, current: c.current, agent: c.agent ? c.agent.slice(0, 300) : null }, at),
    ]);
  } catch {
    // Confirmed at the same moment another way: that one stands.
    const raced = await confirmationOf(db, c.orderNumber, c.intakeId);
    if (raced) return { confirmation: view(raced), already: true };
    throw new Error("the confirmation could not be recorded");
  }
  return { confirmation: { at, how: c.how, by: c.by, kind: c.kind }, already: false };
}

/**
 * `POST /portal/order-confirm` `{ token }` — the email's link, posted by
 * the supplier network's confirm page once it has loaded in a browser. No
 * sign-in: the link is the proof. Says which order, from whom, and its
 * id, for the supplier network to open it.
 */
export async function confirmByLink(db: D1Database, body: unknown, agent: string | null, now = new Date()): Promise<RouteResult> {
  const token = typeof (body as { token?: unknown })?.token === "string" ? (body as { token: string }).token.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: 404, body: { error: "unknown_link" } };
  const send = await db
    .prepare("SELECT id, order_number, intake_id, kind FROM purchase_order_sends WHERE confirm_token_hash = ? AND status = 'sent'")
    .bind(await hashConfirmToken(token))
    .first<{ id: string; order_number: string; intake_id: string | null; kind: OrderKind }>();
  if (!send) return { status: 404, body: { error: "unknown_link" } };
  const order = await db
    .prepare("SELECT po.id, u.name AS company FROM purchase_orders po LEFT JOIN org_units u ON u.id = po.org_unit_id WHERE po.order_number = ?")
    .bind(send.order_number)
    .first<{ id: string; company: string | null }>();
  if (!order) return { status: 404, body: { error: "unknown_link" } };
  const version = await currentVersion(db, send.order_number);
  const current = version.intakeId === send.intake_id;
  const { confirmation, already } = await record(db, { orderNumber: send.order_number, intakeId: send.intake_id, kind: send.kind, sendId: send.id, how: "link", by: null, agent, current }, now);
  return {
    status: 200,
    body: { confirmed: true, already, current, orderNumber: send.order_number, orderId: order.id, company: order.company, kind: send.kind, at: confirmation.at },
  };
}

/**
 * `POST /portal/orders/:id/confirm` — the supplier confirms in the
 * supplier network, on an order shared with them: the version they have
 * now, as the person signed in.
 */
export async function confirmInNetwork(db: D1Database, claims: PortalAccessClaims, orderId: string, now = new Date()): Promise<RouteResult> {
  const orderNumber = await portalMayReadOrder(db, claims, orderId);
  if (!orderNumber) return { status: 404, body: { error: "not found" } };
  const version = await currentVersion(db, orderNumber);
  const { confirmation, already } = await record(db, { orderNumber, intakeId: version.intakeId, kind: version.kind, sendId: null, how: "network", by: claims.email, agent: null, current: true }, now);
  return { status: 200, body: { confirmation: { kind: version.kind, confirmed: confirmation }, already } };
}

import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { applyOrderChange, handleSetUpOrdersProcess, settleOrderInstance } from "../src/purchase-orders-in.js";
import { handleFixIntake, handleGetIntake, handleListIntake, handleRejectIntake, handleReleaseIntake } from "../src/order-checking.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateSourceKey } from "../src/https-in-route.js";
import { handleClaimTask } from "../src/task-route.js";
import { handleListMyTasks } from "../src/task-list-route.js";
import { handleLoadPurchaseOrdersCsv } from "../src/purchase-order-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Checking, in the Purchase Orders process — decision 0750.** Pat holds
 * AP.Purchasing and is in the Purchasing team; Dan configures. Acme UK is
 * GB907856452; Northwind (GB111) is an active supplier, Old Co (GB222) an
 * inactive one.
 */

const NS = `xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"`;
const line = (n: number, qty: number | null, opts: { price?: number | null; code?: string } = {}) =>
  `<cac:OrderLine><cac:LineItem><cbc:ID>${n}</cbc:ID>${opts.code ? `<cbc:LineStatusCode>${opts.code}</cbc:LineStatusCode>` : ""}${qty === null ? "" : `<cbc:Quantity unitCode="EA">${qty}</cbc:Quantity>`}<cac:Item><cbc:Name>Item ${n}</cbc:Name></cac:Item>${opts.price === null ? "" : `<cac:Price><cbc:PriceAmount currencyID="GBP">${opts.price ?? 2}</cbc:PriceAmount></cac:Price>`}</cac:LineItem></cac:OrderLine>`;
const parties = (buyer: string, seller: string | null) =>
  `${seller ? `<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${seller}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>` : ""}
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>${buyer}</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>`;
const ORDER = (number: string, lines: string, o: { buyer?: string; seller?: string | null; currency?: string | null } = {}) => `<?xml version="1.0"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" ${NS}>
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>2026-10-12</cbc:IssueDate>
  ${o.currency === null ? "" : `<cbc:DocumentCurrencyCode>${o.currency ?? "GBP"}</cbc:DocumentCurrencyCode>`}
  ${parties(o.buyer ?? "GB907856452", o.seller === undefined ? "GB111" : o.seller)}
  ${lines}
</Order>`;
const CHANGE = (number: string, lines: string) => `<?xml version="1.0"?>
<OrderChange xmlns="urn:oasis:names:specification:ubl:schema:xsd:OrderChange-2" ${NS}>
  <cbc:ID>CHG-1</cbc:ID><cbc:SequenceNumberID>1</cbc:SequenceNumberID><cbc:IssueDate>2026-10-13</cbc:IssueDate>
  <cac:OrderReference><cbc:ID>${number}</cbc:ID></cac:OrderReference>
  ${parties("GB907856452", "GB111")}
  ${lines}
</OrderChange>`;
const CANCEL = (number: string) => `<?xml version="1.0"?>
<OrderCancellation xmlns="urn:oasis:names:specification:ubl:schema:xsd:OrderCancellation-2" ${NS}>
  <cbc:ID>CAN-1</cbc:ID><cbc:IssueDate>2026-10-14</cbc:IssueDate><cbc:CancellationNote>Project stopped</cbc:CancellationNote>
  <cac:OrderReference><cbc:ID>${number}</cbc:ID></cac:OrderReference>
  ${parties("GB907856452", "GB111")}
</OrderCancellation>`;

let key = "";
beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan'), ('u-pat', 'p@x.com', 'Pat'), ('u-kim', 'k@x.com', 'Kim')").run();
  await env.DB.prepare(
    `INSERT INTO org_roles (id, name, permissions_json) VALUES ('admin', 'admin', '["Admin.Configure","AP.Validate"]'), ('purchasing', 'Purchasing', '["AP.Purchasing","AP.TaskView"]')`
  ).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-dan', 'admin'), ('u-pat', 'purchasing'), ('u-kim', 'purchasing')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-uk', 'Acme UK', 'legal_entity', 'GB907856452'), ('acme-ie', 'Acme Ireland', 'legal_entity', 'IE123')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', datetime('now')), ('old', 'O1', 'Old Co', 'GB222', 'inactive', datetime('now'))"
  ).run();
  await handleSetUpOrdersProcess(env.DB, {});
  await handleCreateSource(env.DB, "purchase-orders", { id: "erp-po", name: "Procurement", mechanism: "https" });
  key = ((await handleCreateSourceKey(env.DB, "u-dan", "erp-po", { name: "Coupa" })).body as { key: string }).key;
});

const send = async (xml: string) => {
  const res = await SELF.fetch("https://example.com/v1/sources/erp-po/orders", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/xml" }, body: xml });
  return (await res.json()) as { orders: { orderNumber: string; status: string; stage?: string; change: boolean; cancellation?: boolean }[] };
};
const intakeId = async (number: string) => (await env.DB.prepare("SELECT id FROM purchase_order_intake WHERE order_number = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(number).first<{ id: string }>())!.id;
const order = async (id: string, user = "u-pat") => ((await handleGetIntake(env.DB, user, id)).body as { order: Record<string, unknown> & { problems: { code: string; lines?: number[] }[]; task: { id: string } | null } }).order;
const claim = async (id: string, user = "u-pat") => {
  const task = (await order(id, user)).task!;
  expect((await handleClaimTask(env.DB, task.id, user)).status).toBe(200);
};
const inForce = async (number: string) => env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = ?").bind(number).first<{ status: string }>();

describe("setting up Checking", () => {
  it("gives Checking its own check, AP.Purchasing on its tasks, and the Purchasing team with everyone holding it", async () => {
    expect(await env.DB.prepare("SELECT builtin_check, required_permission FROM process_stages WHERE id = 'purchase-orders-checking'").first()).toEqual({ builtin_check: "order_checking", required_permission: "AP.Purchasing" });
    expect((await env.DB.prepare("SELECT user_id FROM org_team_members WHERE team_id = 'purchasing' ORDER BY user_id").all()).results).toEqual([{ user_id: "u-kim" }, { user_id: "u-pat" }]);
  });
});

describe("the Purchasing team keeps up", () => {
  it("someone given AP.Purchasing later joins it when Checking next raises a task", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-new', 'n@x.com', 'Nia')").run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-new', 'purchasing')").run();
    await send(ORDER("PO-20", line(1, null)));
    expect((await env.DB.prepare("SELECT user_id FROM org_team_members WHERE team_id = 'purchasing' ORDER BY user_id").all()).results.map((r) => r.user_id)).toEqual(["u-kim", "u-new", "u-pat"]);
  });
});

describe("what Checking finds", () => {
  it("passes a whole order straight through", async () => {
    expect((await send(ORDER("PO-1", line(1, 10)))).orders).toEqual([{ orderNumber: "PO-1", status: "released", change: false }]);
  });

  it("holds an order with an unknown or inactive supplier, no currency, or a line with no quantity, unit or price, with one task for Purchasing", async () => {
    const r = await send(ORDER("PO-2", line(1, 10) + line(2, null) + line(3, 5, { price: null }), { seller: "GB999", currency: null }));
    expect(r.orders).toEqual([{ orderNumber: "PO-2", status: "pending", stage: "Checking", change: false }]);
    const o = await order(await intakeId("PO-2"));
    expect(o.problems).toEqual([
      { code: "supplier_unknown", detail: "GB999" },
      { code: "currency_missing" },
      { code: "line_incomplete", lines: [2, 3] },
    ]);
    expect(await inForce("PO-2")).toBeNull();
    expect((await env.DB.prepare("SELECT owner_team_id, required_permission, status FROM tasks").all()).results).toEqual([{ owner_team_id: "purchasing", required_permission: "AP.Purchasing", status: "open" }]);
    await send(ORDER("PO-3", line(1, 10), { seller: "GB 222", currency: "XXQ" }));
    expect((await order(await intakeId("PO-3"))).problems).toEqual([
      { code: "supplier_inactive", detail: "Old Co" },
      { code: "currency_unknown", detail: "XXQ" },
    ]);
  });

  it("shows the order on the Purchasing team's Tasks, by its number and supplier, and its task is not done by Complete", async () => {
    await send(ORDER("PO-4", line(1, null)));
    const tasks = ((await handleListMyTasks(env.DB, "u-pat")).body as { tasks: { id: string; subject: { type: string; invoiceNumber: string; supplierName: string } }[] }).tasks;
    expect(tasks.map((t) => [t.subject.type, t.subject.invoiceNumber, t.subject.supplierName])).toEqual([["purchase_order", "PO-4", "Northwind"]]);
    const apiKey = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-pat'").bind(await hashApiKey(apiKey)).run();
    await handleClaimTask(env.DB, tasks[0].id, "u-pat");
    const done = await SELF.fetch(`https://example.com/tasks/${tasks[0].id}/complete`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: "{}" });
    expect(done.status).toBe(409);
    expect(((await done.json()) as { reason: string }).reason).toBe("release_order");
  });

  it("holds an order for an unknown company instead of refusing it, and it cannot be released until the company is set", async () => {
    await send(ORDER("PO-5", line(1, 10), { buyer: "DE999" }));
    const id = await intakeId("PO-5");
    expect((await order(id)).problems).toEqual([{ code: "company_unknown", detail: "DE999" }]);
    expect((await handleReleaseIntake(env.DB, "u-pat", id, { anyway: true }, settleOrderInstance)).body).toMatchObject({ reason: "task_not_claimed" });
    await claim(id);
    expect((await handleReleaseIntake(env.DB, "u-pat", id, { anyway: true }, settleOrderInstance)).body).toMatchObject({ reason: "order_blocked" });
    const fixed = (await handleFixIntake(env.DB, "u-pat", id, { orgUnitId: "acme-ie" })).body as { order: { company: { id: string }; problems: unknown[] } };
    expect(fixed.order).toMatchObject({ company: { id: "acme-ie" }, problems: [] });
    const released = await handleReleaseIntake(env.DB, "u-pat", id, {}, settleOrderInstance);
    expect(released.body).toMatchObject({ status: "released" });
    expect(released.released).toEqual(["PO-5"]);
    expect(await env.DB.prepare("SELECT org_unit_id FROM purchase_orders WHERE order_number = 'PO-5'").first()).toEqual({ org_unit_id: "acme-ie" });
    expect((await env.DB.prepare("SELECT status, completed_by FROM tasks").first())).toEqual({ status: "completed", completed_by: "u-pat" });
  });
});

describe("working an order held at Checking", () => {
  it("only the person who claimed it acts; Release asks to see what was found, then releases it anyway", async () => {
    await send(ORDER("PO-6", line(1, 10), { seller: "GB999" }));
    const id = await intakeId("PO-6");
    await claim(id);
    expect((await handleReleaseIntake(env.DB, "u-kim", id, {}, settleOrderInstance)).body).toMatchObject({ reason: "task_claimed_by_other" });
    expect((await handleReleaseIntake(env.DB, "u-pat", id, {}, settleOrderInstance)).body).toMatchObject({ reason: "order_has_problems", problems: [{ code: "supplier_unknown" }] });
    const r = await handleReleaseIntake(env.DB, "u-pat", id, { anyway: true }, settleOrderInstance);
    expect(r.body).toMatchObject({ status: "released", order: { released: { by: "Pat", anyway: true } } });
    expect(await inForce("PO-6")).toEqual({ status: "active" });
  });

  it("setting the supplier checks it again", async () => {
    await send(ORDER("PO-7", line(1, 10), { seller: "GB999" }));
    const id = await intakeId("PO-7");
    await claim(id);
    const fixed = (await handleFixIntake(env.DB, "u-pat", id, { supplierId: "nw" })).body as { order: { supplier: { name: string }; sellerPartyId: string; problems: unknown[] } };
    expect(fixed.order).toMatchObject({ supplier: { name: "Northwind" }, sellerPartyId: "GB111", problems: [] });
  });

  it("Reject needs a reason, ends the instance and cancels the task; the order is never in force", async () => {
    await send(ORDER("PO-8", line(1, null)));
    const id = await intakeId("PO-8");
    await claim(id);
    expect((await handleRejectIntake(env.DB, "u-pat", id, {})).body).toMatchObject({ reason: "reject_reason_missing" });
    const r = await handleRejectIntake(env.DB, "u-pat", id, { reason: "Duplicate of PO-1" });
    expect(r.body).toMatchObject({ order: { status: "rejected", rejected: { by: "Pat", reason: "Duplicate of PO-1" } } });
    expect(await env.DB.prepare("SELECT status FROM process_instances WHERE subject_id = ?").bind(id).first()).toEqual({ status: "rejected" });
    expect(await env.DB.prepare("SELECT status, end_reason FROM tasks").first()).toEqual({ status: "cancelled", end_reason: "order_rejected" });
    expect(await inForce("PO-8")).toBeNull();
    expect((await handleReleaseIntake(env.DB, "u-pat", id, {}, settleOrderInstance)).body).toMatchObject({ reason: "order_rejected" });
  });

  it("lists the orders waiting, with what was found and who has them", async () => {
    await send(ORDER("PO-9", line(1, null)));
    await claim(await intakeId("PO-9"));
    const list = (await handleListIntake(env.DB, null)).body as { orders: Record<string, unknown>[] };
    expect(list.orders).toEqual([expect.objectContaining({ orderNumber: "PO-9", kind: "order", company: "Acme UK", supplier: "Northwind", stage: "Checking", claimedBy: "Pat", problems: ["line_incomplete"] })]);
  });
});

describe("changes and cancellations", () => {
  async function received(number: string, lineNo: number, qty: number) {
    await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_by, created_at, status) VALUES ('gr1', 'GR-1', '2026-10-12', 'screen', 'u-dan', '2026-10-12T09:00:00Z', 'registered')").run();
    await env.DB.prepare("INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, created_at) VALUES ('gl1', 'gr1', 1, ?, ?, 'received', ?, '2026-10-12T09:00:00Z')")
      .bind(number, lineNo, qty)
      .run();
  }

  it("a change taking a line below what was received is held, and the order in force keeps its lines", async () => {
    await send(ORDER("PO-10", line(1, 10) + line(2, 4)));
    await received("PO-10", 1, 8);
    const r = await send(ORDER("PO-10", line(1, 5)));
    expect(r.orders).toEqual([{ orderNumber: "PO-10", status: "pending", stage: "Checking", change: true }]);
    expect((await order(await intakeId("PO-10"))).problems).toEqual([{ code: "below_received", lines: [1] }]);
    expect((await env.DB.prepare("SELECT l.line_number, l.quantity FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id WHERE p.order_number = 'PO-10' ORDER BY 1").all()).results).toEqual([
      { line_number: 1, quantity: 10 },
      { line_number: 2, quantity: 4 },
    ]);
  });

  it("applies a Peppol Order Change line by line: a changed line replaced, a deleted one removed, one not sent kept", async () => {
    await send(ORDER("PO-11", line(1, 10) + line(2, 4) + line(3, 6)));
    const r = await send(CHANGE("PO-11", line(1, 12, { code: "3" }) + line(2, null, { code: "2", price: null })));
    expect(r.orders).toEqual([{ orderNumber: "PO-11", status: "released", change: true }]);
    expect((await env.DB.prepare("SELECT l.line_number, l.quantity, l.price_amount FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id WHERE p.order_number = 'PO-11' ORDER BY 1").all()).results).toEqual([
      { line_number: 1, quantity: 12, price_amount: 2 },
      { line_number: 3, quantity: 6, price_amount: 2 },
    ]);
    expect(await env.DB.prepare("SELECT kind, change_reference, sequence_number FROM purchase_order_intake WHERE order_number = 'PO-11' ORDER BY created_at DESC, rowid DESC").first()).toEqual({ kind: "change", change_reference: "CHG-1", sequence_number: "1" });
  });

  it("applying a change keeps what a line does not say, and with no order in force it is the order less its deleted lines", () => {
    const base = { orderNumber: "PO-X", currency: "GBP", lines: [{ lineNumber: 1, quantity: 1, unitCode: "EA", priceAmount: 5, itemName: "A" }] };
    expect(applyOrderChange(base, { orderNumber: "PO-X", currency: "EUR", lines: [{ lineNumber: 1, quantity: 3, statusCode: "3" }] })).toEqual({
      orderNumber: "PO-X",
      currency: "EUR",
      lines: [{ lineNumber: 1, quantity: 3, unitCode: "EA", priceAmount: 5, itemName: "A" }],
    });
    expect(applyOrderChange(null, { orderNumber: "PO-Y", lines: [{ lineNumber: 1, quantity: 2, statusCode: "1" }, { lineNumber: 2, statusCode: "2" }] }).lines).toEqual([{ lineNumber: 1, quantity: 2 }]);
  });

  it("a Peppol Order Cancellation closes the order in force; with goods received it waits for a person first", async () => {
    await send(ORDER("PO-12", line(1, 10)));
    expect((await send(CANCEL("PO-12"))).orders).toEqual([{ orderNumber: "PO-12", status: "released", change: false, cancellation: true }]);
    expect(await inForce("PO-12")).toEqual({ status: "closed" });
    expect(await env.DB.prepare("SELECT note FROM purchase_order_intake WHERE kind = 'cancellation'").first()).toEqual({ note: "Project stopped" });

    await send(ORDER("PO-13", line(1, 10)));
    await received("PO-13", 1, 3);
    expect((await send(CANCEL("PO-13"))).orders[0]).toMatchObject({ status: "pending", stage: "Checking" });
    const id = await intakeId("PO-13");
    expect((await order(id)).problems).toEqual([{ code: "cancel_received", lines: [1] }]);
    await claim(id);
    await handleReleaseIntake(env.DB, "u-pat", id, { anyway: true }, settleOrderInstance);
    expect(await inForce("PO-13")).toEqual({ status: "closed" });
  });

  it("a cancellation of an order not in force cannot be released, only rejected", async () => {
    await send(CANCEL("PO-NONE"));
    const id = await intakeId("PO-NONE");
    expect((await order(id)).problems).toEqual([{ code: "nothing_to_cancel" }]);
    await claim(id);
    expect((await handleReleaseIntake(env.DB, "u-pat", id, { anyway: true }, settleOrderInstance)).body).toMatchObject({ reason: "order_blocked" });
    expect((await handleRejectIntake(env.DB, "u-pat", id, { reason: "Never ordered" })).status).toBe(200);
  });

  it("a status of Cancelled cancels by CSV through the process; loaded directly, it closes the order", async () => {
    await send(ORDER("PO-14", line(1, 10)));
    const apiKey = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(apiKey)).run();
    const res = await SELF.fetch("https://example.com/purchase-orders/csv-load", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "text/csv" },
      body: "order_number,buyer_party_id,line_number,item_name,status,hold_reason\nPO-14,GB907856452,1,Tape,Cancelled,No longer needed",
    });
    expect(((await res.json()) as { process: { sent: { kind: string; status: string }[] } }).process.sent).toEqual([expect.objectContaining({ kind: "cancellation", status: "released" })]);
    expect(await inForce("PO-14")).toEqual({ status: "closed" });
    // Without the process, the same file closes it at once (and opens nothing).
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,buyer_party_id,line_number,item_name,status\nPO-15,GB907856452,1,Tape,Active");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,buyer_party_id,line_number,item_name,status\nPO-15,GB907856452,1,Tape,Cancelled");
    expect(await inForce("PO-15")).toEqual({ status: "closed" });
  });
});

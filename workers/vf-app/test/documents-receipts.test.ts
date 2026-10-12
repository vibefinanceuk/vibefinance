import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleListDocuments } from "../src/documents-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Goods receipts as rows of Documents — decision 0737.** Two invoices
 * and a credit note, and three receipts: GR-1 against Acme UK's order,
 * GR-2 against Acme France's with goods sent back, GR-3 cancelled.
 */

type Doc = { id: string; kind: string; number: string; status: string; supplier: string | null; amount: number | null; dueDate: string | null; receivedAt: string; orgUnitName: string | null; po: string | null; hands: number };
type Body = { documents: Doc[]; total?: number; receipts?: boolean };

const EVERYWHERE = { units: null };

async function list(params: string, receipts: { units: string[] | null } | null = EVERYWHERE, visible: string[] | null = null) {
  return (await handleListDocuments(env.DB, new URLSearchParams(params), visible, "u1", receipts)).body as Body;
}

async function seedInvoice(id: string, number: string, created: string, extra: Record<string, unknown> = {}) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, created_at, org_unit_id) VALUES (?, ?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": number, "BT-3": "380", "BT-27": "Northwind Packaging", "BT-112": 120, "BT-5": "GBP", ...extra }), created, extra.unit ?? null)
    .run();
}

async function seedReceipt(id: string, number: string, date: string, created: string, order: string, opts: { returned?: boolean; cancelled?: boolean; status?: string } = {}) {
  await env.DB.prepare(
    "INSERT INTO goods_receipts (id, receipt_number, receipt_date, delivery_note, source, created_at, status, cancelled_at, cancel_reason) VALUES (?, ?, ?, ?, 'screen', ?, ?, ?, ?)"
  )
    .bind(id, number, date, `DN-${number}`, created, opts.status ?? "registered", opts.cancelled ? created : null, opts.cancelled ? "Entered twice" : null)
    .run();
  await env.DB.prepare(
    "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, return_reason_id, created_at) VALUES (?, ?, 1, ?, 1, ?, 2, ?, ?)"
  )
    .bind(`${id}-1`, id, order, opts.returned ? "returned" : "received", opts.returned ? "damaged" : null, created)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('uk', 'Acme UK', 'operating_unit'), ('fr', 'Acme France', 'operating_unit')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('northwind', 'N1', 'Northwind Packaging', 'GB111', 'active', 'three_way', datetime('now'))"
  ).run();
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, seller_party_id, org_unit_id) VALUES ('po1', 'PO-4501', 'GB111', 'uk'), ('po2', 'PO-7000', 'FR222', 'fr')").run();
  await seedInvoice("inv-1", "INV-1", "2026-10-01 09:00:00", { "BT-13": "PO-4501", "BT-9": "2026-10-31" });
  await seedInvoice("inv-2", "INV-2", "2026-10-03 09:00:00");
  await seedInvoice("cn-1", "CN-1", "2026-10-05 09:00:00", { "BT-3": "381", "BT-112": -40 });
  await seedReceipt("gr-1", "GR-1", "2026-10-02", "2026-10-02T10:00:00.000Z", "PO-4501");
  await seedReceipt("gr-2", "GR-2", "2026-10-04", "2026-10-06T10:00:00.000Z", "PO-7000", { returned: true });
  await seedReceipt("gr-3", "GR-3", "2026-10-06", "2026-10-06T11:00:00.000Z", "PO-4501", { cancelled: true });
});

describe("goods receipts beside invoices (decision 0737)", () => {
  it("interleaves them newest first, a receipt by the day its goods arrived", async () => {
    const body = await list("page=1&pageSize=25");
    expect(body.receipts).toBe(true);
    expect(body.total).toBe(6);
    expect(body.documents.map((d) => d.number)).toEqual(["GR-3", "CN-1", "GR-2", "INV-2", "GR-1", "INV-1"]);
    expect(body.documents.map((d) => d.kind)).toEqual(["goods_receipt", "credit_note", "goods_receipt", "invoice", "goods_receipt", "invoice"]);
  });

  it("reads a receipt's row from its order: the supplier, the unit and the order; no money and no due date", async () => {
    const gr1 = (await list("page=1&pageSize=25")).documents.find((d) => d.number === "GR-1")!;
    expect(gr1).toMatchObject({ supplier: "Northwind Packaging", orgUnitName: "Acme UK", po: "PO-4501", amount: null, dueDate: null, receivedAt: "2026-10-02", status: "receipt_registered", hands: 0 });
    const statuses = Object.fromEntries((await list("page=1&pageSize=25")).documents.map((d) => [d.number, d.status]));
    expect(statuses).toMatchObject({ "GR-2": "receipt_returned", "GR-3": "receipt_cancelled" });
    // An order whose supplier is not on file shows the party it names.
    expect((await list("page=1&pageSize=25")).documents.find((d) => d.number === "GR-2")!.supplier).toBe("FR222");
  });

  it("pages across both kinds", async () => {
    for (let n = 10; n < 32; n++) await seedReceipt(`gr-${n}`, `GR-${n}`, "2026-10-07", `2026-10-07T${n - 10 < 10 ? "0" : ""}${n - 10}:00:00.000Z`, "PO-4501");
    const one = await list("page=1&pageSize=25");
    const two = await list("page=2&pageSize=25");
    expect(one.total).toBe(28);
    expect(one.documents).toHaveLength(25);
    expect(two.documents.map((d) => d.number)).toEqual(["INV-2", "GR-1", "INV-1"]);
    expect(new Set([...one.documents, ...two.documents].map((d) => d.id)).size).toBe(28);
  });

  it("filters by type: invoices, credit notes, or receipts alone", async () => {
    expect((await list("page=1&pageSize=25&type=invoice")).documents.map((d) => d.number)).toEqual(["INV-2", "INV-1"]);
    expect((await list("page=1&pageSize=25&type=credit_note")).documents.map((d) => d.number)).toEqual(["CN-1"]);
    const receipts = await list("page=1&pageSize=25&type=goods_receipt");
    expect(receipts.documents.map((d) => d.number)).toEqual(["GR-3", "GR-2", "GR-1"]);
    expect(receipts.total).toBe(3);
  });

  it("searches a receipt by its number, delivery note, order or supplier", async () => {
    expect((await list("page=1&pageSize=25&q=GR-2")).documents.map((d) => d.number)).toEqual(["GR-2"]);
    expect((await list("page=1&pageSize=25&q=DN-GR-1")).documents.map((d) => d.number)).toEqual(["GR-1"]);
    expect((await list("page=1&pageSize=25&q=PO-7000")).documents.map((d) => d.number)).toEqual(["GR-2"]);
    expect((await list("page=1&pageSize=25&q=Northwind&type=goods_receipt")).documents.map((d) => d.number)).toEqual(["GR-3", "GR-1"]);
  });

  it("narrows receipts to the unit chosen, and to the units the person may see receipts in", async () => {
    expect((await list("page=1&pageSize=25&type=goods_receipt&unit=fr")).documents.map((d) => d.number)).toEqual(["GR-2"]);
    expect((await list("page=1&pageSize=25&type=goods_receipt", { units: ["uk"] })).documents.map((d) => d.number)).toEqual(["GR-3", "GR-1"]);
    // Scoped to no units at all: no receipts, though the person may see them elsewhere.
    expect((await list("page=1&pageSize=25", { units: [] })).documents.every((d) => d.kind !== "goods_receipt")).toBe(true);
  });

  it("shows none to someone who may not see receipts, nor to the AP Assistant, nor under a card's drill-through", async () => {
    const none = await list("page=1&pageSize=25", null);
    expect(none.receipts).toBe(false);
    expect(none.documents.map((d) => d.number)).toEqual(["CN-1", "INV-2", "INV-1"]);
    expect((await list("page=1&pageSize=25&type=goods_receipt", null)).documents).toEqual([]);
    // Unpaginated: the AP Assistant's own call.
    expect((await list("limit=50")).documents.every((d) => d.kind !== "goods_receipt")).toBe(true);
    expect((await list("page=1&pageSize=25&duplicates=1")).documents.every((d) => d.kind !== "goods_receipt")).toBe(true);
  });

  it("counts a receipt waiting in its process as held, as an invoice's tasks are", async () => {
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('wr', 'Warehouse Receipts')").run();
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('check', 'wr', 'Matching', 1)").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence) SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id"
    ).run();
    await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id) VALUES ('pi-gr', 'wr', 'goods_receipt', 'gr-1', 'check')").run();
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv-gr', 'pi-gr', 'check', 'matched')").run();
    await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status) VALUES ('t-gr', 'check', 'sv-gr', 'AP.Receive', 'open')").run();
    const gr1 = (await list("page=1&pageSize=25")).documents.find((d) => d.number === "GR-1") as Doc & { stageName: string };
    expect(gr1.hands).toBe(1);
    expect(gr1.stageName).toBe("Matching");
  });
});

async function personWith(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@example.com`, "Someone", await hashApiKey(apiKey)).run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(roleId, roleId, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

describe("GET /documents, who sees receipts (decision 0737)", () => {
  const get = async (key: string) =>
    (await (await SELF.fetch("https://example.com/documents?page=1&pageSize=25", { headers: { Authorization: `Bearer ${key}` } })).json()) as Body;

  it("someone who receives or validates sees them; someone who only reviews does not", async () => {
    const receiver = await get(await personWith(["AP.Review", "AP.Receive"]));
    expect(receiver.receipts).toBe(true);
    expect(receiver.documents.filter((d) => d.kind === "goods_receipt")).toHaveLength(3);
    const validator = await get(await personWith(["AP.Review", "AP.Validate"]));
    expect(validator.documents.filter((d) => d.kind === "goods_receipt")).toHaveLength(3);
    const reviewer = await get(await personWith(["AP.Review"]));
    expect(reviewer.receipts).toBe(false);
    expect(reviewer.documents.map((d) => d.kind)).toEqual(["credit_note", "invoice", "invoice"]);
  });
});

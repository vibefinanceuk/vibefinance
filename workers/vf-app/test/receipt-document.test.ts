import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { handlePutNetworkSharingConfig } from "../src/receipt-sharing.js";
import { receiptDocument, receiptFile } from "../src/receipt-document.js";
import { receiptCsv, receiptPdf } from "../src/receipt-pdf.js";
import { readPdf } from "../src/pdf-read.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **A goods receipt as a PDF and CSV — decision 0773**, on the receipts
 * of decision 0738's tests.
 * Lager Nord (VAT DE123456789) supplies PO-1 (Acme UK) and PO-2 (Acme
 * Ireland); Other Ltd supplies PO-9 (Acme UK).
 */

// The test keypair whose public half is in wrangler.test.jsonc (see session-routes.test.ts).
const PRIVATE_KEY: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  y: "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  crv: "P-256",
  d: "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk",
};

function access(o: Partial<PortalAccessClaims> = {}): Promise<string> {
  const now = new Date();
  return signPortalToken(
    {
      kind: "portal_access",
      email: "jo@lager-nord.example",
      supplierOrgId: "so-1",
      linkId: "pl-1",
      environmentId: "test-environment",
      supplierId: "sup-ln",
      orgUnitIds: ["uk"],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString(),
      ...o,
    },
    PRIVATE_KEY
  );
}

const get = (path: string, token?: string) => SELF.fetch(`https://app.example.com${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function licence(features: string[]) {
  const claims = { customerId: "c", plan: "standard", features, volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
}


async function receipt(id: string, number: string, date: string, order: string, o: { status?: string; cancelled?: boolean; lines?: [string, number, number, string | null, string | null][] } = {}) {
  await env.DB.prepare(
    "INSERT INTO goods_receipts (id, receipt_number, receipt_date, delivery_note, note, source, created_at, status, cancelled_at, cancel_reason) VALUES (?, ?, ?, ?, 'Pallet wrap torn, driver late', 'screen', ?, ?, ?, ?)"
  )
    .bind(id, number, date, `DN-${number}`, `${date}T09:30:00.000Z`, o.status ?? "registered", o.cancelled ? date : null, o.cancelled ? "Twice" : null)
    .run();
  // [movement, order line, quantity, return reason, line status]
  const lines = o.lines ?? [["received", 1, 10, null, null]];
  for (const [i, [movement, orderLine, quantity, reason, lineStatus]] of lines.entries()) {
    await env.DB.prepare(
      "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, unit_code, return_reason_id, note, line_status, reject_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'EA', ?, 'Internal note', ?, ?, ?)"
    )
      .bind(`${id}-${i}`, id, i + 1, order, orderLine, movement, quantity, reason, lineStatus ?? "active", lineStatus === "rejected" ? "Wrong colour, Sam to chase" : null, date)
      .run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await licence(["supplier_portal"]);
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id, erp_identifier) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE 123 456 789', 'LN-01'), ('sup-x', 'Other Ltd', 'GB999', NULL)").run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, seller_party_id, org_unit_id) VALUES ('po1', 'PO-1', 'DE123456789', 'uk'), ('po2', 'PO-2', 'LN-01', 'ie'), ('po9', 'PO-9', 'GB999', 'uk')"
  ).run();
  await env.DB.prepare("INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, item_name) VALUES ('pl1', 'po1', 1, 10, 'EA', 'Office chair'), ('pl2', 'po1', 2, 10, 'EA', 'Footrest')").run();
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id, created_at) VALUES ('inv-uk', ?, 'sup-ln', 'uk', '2026-10-02 10:00:00')"
  )
    .bind(JSON.stringify({ "BT-1": "LN-1", "BT-5": "GBP", "BT-112": 120, "BT-13": "PO-1" }))
    .run();
  await receipt("gr-1", "GR-1", "2026-10-03", "PO-1", {
    lines: [
      ["received", 1, 10, null, null],
      ["received", 2, 8, null, null],
      ["returned", 1, 2, "damaged", null],
      ["received", 2, 1, null, "rejected"],
    ],
  });
  await receipt("gr-ie", "GR-IE", "2026-10-04", "PO-2");
  await receipt("gr-other", "GR-X", "2026-10-05", "PO-9");
  await receipt("gr-pending", "GR-P", "2026-10-06", "PO-1", { status: "pending" });
  await receipt("gr-cancelled", "GR-C", "2026-10-07", "PO-1", { cancelled: true });
});

async function staff(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const key = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.example`, "Staff", await hashApiKey(key)).run();
  const role = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(role, role, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, role).run();
  return key;
}


const text = async (bytes: Uint8Array) => {
  const read = await readPdf(bytes);
  expect(read.kind).toBe("text");
  return (read as { pages: string[] }).pages.map((p) => p.replace(/\s+/g, " "));
};

describe("the document", () => {
  it("is what the supplier may see: the company and its letterhead, the supplier, each line and the reason from the list", async () => {
    await env.DB.prepare("UPDATE org_units SET kind = 'legal_entity', vat_id = 'GB907856452', address_line = '1 Handover Street', city = 'London', country = 'GB' WHERE id = 'uk'").run();
    const doc = (await receiptDocument(env.DB, "gr-1"))!;
    expect(doc.company).toMatchObject({ name: "Acme UK Ltd", vatId: "GB907856452", city: "London" });
    expect(doc.supplier?.name).toBe("Lager Nord GmbH");
    expect(doc.receipt).toEqual({ number: "GR-1", date: "2026-10-03", deliveryNote: "DN-GR-1", cancelled: false, status: "registered" });
    const [page, ...more] = await text(await receiptPdf(doc));
    expect(more).toEqual([]);
    for (const words of ["Acme UK Ltd", "1 Handover Street", "VAT GB907856452", "Goods receipt", "Receipt number GR-1", "Received on 2026-10-03", "Delivery note DN-GR-1", "Order PO-1", "Lager Nord GmbH", "RECEIVED BY", "Office chair", "Footrest", "Reason: Damaged", "In all", "Page 1 of 1"]) {
      expect(page).toContain(words);
    }
    for (const secret of ["Pallet wrap", "Internal note", "Sam to chase"]) expect(page).not.toContain(secret);
  });

  it("says across the page when the receipt was cancelled", async () => {
    const [page] = await text(await receiptPdf((await receiptDocument(env.DB, "gr-cancelled"))!));
    expect(page).toContain("This receipt was cancelled.");
    expect(await receiptDocument(env.DB, "nope")).toBeNull();
  });

  it("runs onto more pages with the table's header on each", async () => {
    const doc = (await receiptDocument(env.DB, "gr-1"))!;
    const many = { ...doc, lines: Array.from({ length: 80 }, (_, i) => ({ ...doc.lines[0], lineNumber: i + 1 })) };
    const pages = await text(await receiptPdf(many));
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p, i) => {
      expect(p).toContain("Ordered");
      expect(p).toContain(`Page ${i + 1} of ${pages.length}`);
    });
  });

  it("as CSV is in the columns the receipt load reads: a rejected line was still received, and no notes", async () => {
    expect(receiptCsv((await receiptDocument(env.DB, "gr-1"))!).split("\n")).toEqual([
      "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity,movement,return_reason,unit_code,delivery_note,note",
      "GR-1,1,2026-10-03,PO-1,1,10,received,,EA,DN-GR-1,",
      "GR-1,2,2026-10-03,PO-1,2,8,received,,EA,DN-GR-1,",
      "GR-1,3,2026-10-03,PO-1,1,2,returned,Damaged,EA,DN-GR-1,",
      "GR-1,4,2026-10-03,PO-1,2,1,received,,EA,DN-GR-1,",
      "",
    ]);
    const doc = (await receiptDocument(env.DB, "gr-1"))!;
    // A spreadsheet never runs a cell as a formula.
    expect(receiptCsv({ ...doc, receipt: { ...doc.receipt, deliveryNote: "=HYPERLINK(1)" } })).toContain("'=HYPERLINK(1)");
    expect((await receiptFile(env.DB, "gr-1", "csv"))!.filename).toBe("GR-1.csv");
  });
});

describe("in VibeFinance", () => {
  it("shows the PDF inline, downloads PDF and CSV, and gives none to whoever may not see receipts", async () => {
    const key = await staff(["AP.Receive"]);
    const get = (k: string, q: string) => SELF.fetch(`https://app.example.com/goods-receipts/gr-1/document${q}`, { headers: { Authorization: `Bearer ${k}` } });
    const pdf = await get(key, "");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Content-Disposition")).toBe('inline; filename="GR-1.pdf"');
    expect(pdf.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect((await get(key, "?format=pdf&download=1")).headers.get("Content-Disposition")).toBe('attachment; filename="GR-1.pdf"');
    const csv = await get(key, "?format=csv");
    expect([csv.headers.get("Content-Type"), csv.headers.get("Content-Disposition")]).toEqual(["text/csv; charset=utf-8", 'attachment; filename="GR-1.csv"']);
    expect((await SELF.fetch("https://app.example.com/goods-receipts/nope/document", { headers: { Authorization: `Bearer ${key}` } })).status).toBe(404);
    expect((await get(await staff(["AP.Review"]), "")).status).toBe(403);
  });
});

describe("in the supplier network", () => {
  it("is for a receipt shared with this supplier, and the same 404 for any other", async () => {
    const token = await access();
    expect((await get("/portal/receipts/gr-1/document", token)).status).toBe(404);
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    const pdf = await get("/portal/receipts/gr-1/document", token);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Disposition")).toBe('inline; filename="GR-1.pdf"');
    const csv = await get("/portal/receipts/gr-1/document?format=csv&download=1", token);
    expect(csv.headers.get("Content-Disposition")).toBe('attachment; filename="GR-1.csv"');
    expect(await csv.text()).not.toContain("Internal note");
    for (const id of ["gr-other", "gr-ie", "gr-cancelled", "gr-pending", "nope"]) expect((await get(`/portal/receipts/${id}/document`, token)).status).toBe(404);
    expect((await get("/portal/receipts/gr-1/document")).status).toBe(401);
  });
});

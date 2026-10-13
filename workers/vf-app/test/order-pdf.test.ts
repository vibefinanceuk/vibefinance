import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedOrder } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { storeOrder, readOrdersCsv } from "../src/purchase-order-route.js";
import { releaseOrder } from "../src/purchase-orders-in.js";
import { orderDocument, orderFile } from "../src/orders-out.js";
import { orderCsv, orderPdf } from "../src/order-pdf.js";
import { readPdf } from "../src/pdf-read.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **A purchase order as a PDF, UBL and CSV — decision 0760.** Acme UK Ltd
 * orders from Kingsway Interiors (GB). What the PDF says is read back with
 * the PDF reader the app already has (0684).
 */

const ORDER: ParsedOrder = {
  orderNumber: "PO-7",
  issueDate: "2026-10-12",
  currency: "GBP",
  sellerPartyId: "GB111",
  buyerPartyId: "GB907856452",
  originatorReference: "REQ-4410",
  lineExtensionAmount: 1450,
  payableAmount: 1740,
  lines: [
    { lineNumber: 1, itemName: "Office chair, mesh", itemDescription: "Ergonomic, black", sellersItemId: "KI-CH-01", quantity: 10, unitCode: "EA", priceAmount: 125, lineExtensionAmount: 1250 },
    { lineNumber: 2, itemName: "Footrest", quantity: 10, unitCode: "EA", priceAmount: 20, lineExtensionAmount: 200 },
  ],
};

const text = async (bytes: Uint8Array) => {
  const read = await readPdf(bytes);
  expect(read.kind).toBe("text");
  return (read as { pages: string[] }).pages.map((p) => p.replace(/\s+/g, " "));
};

let n = 0;
async function release(order: ParsedOrder, kind: "order" | "change" | "cancellation" = "order", extra: { note?: string; changeReference?: string } = {}) {
  const id = `i-${++n}`;
  await env.DB.prepare("INSERT INTO purchase_order_intake (id, order_number, order_json, org_unit_id, kind, is_change, note, change_reference, created_at) VALUES (?, ?, ?, 'acme-uk', ?, ?, ?, ?, ?)")
    .bind(id, order.orderNumber, JSON.stringify(order), kind, kind === "change" ? 1 : 0, extra.note ?? null, extra.changeReference ?? null, new Date().toISOString())
    .run();
  await releaseOrder(env.DB, id, new Date(Date.now() + n * 1000));
}

beforeEach(async () => {
  await applyTestSchema();
  n = 0;
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-pat', 'pat@acme.example', 'Pat Lee'), ('u-nia', 'nia@acme.example', 'Nia None')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-pat', 'p', '["AP.Purchasing"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('u-pat', 'r-pat', NULL)").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id, address_line, city, postal_code, country) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity', 'GB907856452', '1 Handover Street', 'London', 'EC1A 1AA', 'GB')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, vat_id, address_line, city, postal_code, country, status, loaded_at) VALUES ('kw', 'K1', 'Kingsway Interiors', 'GB111', '12 High Street', 'Thornbury', 'BS35 2AA', 'GB', 'active', datetime('now'))").run();
});

describe("the PDF", () => {
  it("has the company as its letterhead, the order's facts, both parties, its lines and its totals", async () => {
    await storeOrder(env.DB, ORDER, "acme-uk");
    const doc = (await orderDocument(env.DB, "PO-7"))!;
    const [page, ...more] = await text(await orderPdf(doc, { kind: "order" }));
    expect(more).toEqual([]);
    for (const words of [
      "Acme UK Ltd",
      "1 Handover Street",
      "VAT GB907856452",
      "Purchase order",
      "Order number PO-7",
      "Order date 2026-10-12",
      "Requisition REQ-4410",
      "Kingsway Interiors",
      "12 High Street",
      "Office chair, mesh",
      "Ergonomic, black",
      "Your item no. KI-CH-01",
      "£125.00",
      "£1,250.00",
      "Footrest",
      "Total £1,740.00",
      "Page 1 of 1",
    ]) {
      expect(page).toContain(words);
    }
  });

  it("runs across pages with the table's heading on each, and says which page of how many", async () => {
    const lines = Array.from({ length: 70 }, (_, i) => ({ lineNumber: i + 1, itemName: `Item number ${i + 1}`, quantity: 1, unitCode: "EA", priceAmount: 2, lineExtensionAmount: 2 }));
    await storeOrder(env.DB, { ...ORDER, lines }, "acme-uk");
    const pages = await text(await orderPdf((await orderDocument(env.DB, "PO-7"))!, { kind: "order" }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]).toContain("Purchase order PO-7");
    expect(pages[1]).toContain("Quantity");
    expect(pages.at(-1)).toContain(`Page ${pages.length} of ${pages.length}`);
    const all = pages.join(" ");
    for (let i = 1; i <= 70; i++) expect(all).toContain(`Item number ${i} `);
  });

  it("marks a change's new and changed lines, lists those it removed and the facts it changed", async () => {
    await release(ORDER);
    await release({ ...ORDER, payableAmount: 1900, lines: [{ ...ORDER.lines[0], quantity: 12, lineExtensionAmount: 1500 }, { lineNumber: 3, itemName: "Desk lamp", quantity: 2, unitCode: "EA", priceAmount: 55, lineExtensionAmount: 110 }] }, "change", { changeReference: "CHG-2" });
    const file = (await orderFile(env.DB, "PO-7", "pdf"))!;
    expect(file).toMatchObject({ contentType: "application/pdf", filename: "PO-7-change.pdf" });
    const [page] = await text(file.bytes);
    for (const words of ["Change to purchase order", "This replaces the order sent before.", "Change CHG-2", "Changed", "Quantity: 10 -> 12", "New", "Desk lamp", "Removed lines", "Line 2: Footrest", "What changed", "Total: 1740 -> 1900"]) {
      expect(page).toContain(words);
    }
  });

  it("says a cancellation across the top, with its note; and is written in German to a German supplier", async () => {
    await env.DB.prepare("UPDATE suppliers SET country = 'DE'").run();
    await release(ORDER);
    await release(ORDER, "cancellation", { note: "Projekt gestoppt" });
    const file = (await orderFile(env.DB, "PO-7", "pdf"))!;
    expect(file.filename).toBe("PO-7-cancellation.pdf");
    const [page] = await text(file.bytes);
    for (const words of ["Stornierung der Bestellung", "Bitte weder liefern noch fakturieren", "Hinweis: Projekt gestoppt", "Bestellnummer PO-7", "Seite 1 von 1"]) expect(page).toContain(words);
  });

  it("writes what its font cannot as near as it can, never failing", async () => {
    await storeOrder(env.DB, { ...ORDER, lines: [{ ...ORDER.lines[0], itemName: "Ωmega stand → shelf 椅子" }] }, "acme-uk");
    const [page] = await text(await orderPdf((await orderDocument(env.DB, "PO-7"))!, { kind: "order" }));
    expect(page).toContain("mega stand -> shelf");
  });
});

describe("the CSV and UBL", () => {
  it("the CSV loads back as the same order; the UBL is the order", async () => {
    await storeOrder(env.DB, { ...ORDER, sellerContactEmail: "jo@kingsway.example" }, "acme-uk");
    const doc = (await orderDocument(env.DB, "PO-7"))!;
    const read = readOrdersCsv(orderCsv(doc));
    expect("entries" in read && read.entries[0]).toMatchObject({ order: { parsed: { orderNumber: "PO-7", currency: "GBP", sellerContactEmail: "jo@kingsway.example", payableAmount: 1740, lines: [{ lineNumber: 1, itemName: "Office chair, mesh", itemDescription: "Ergonomic, black", quantity: 10, priceAmount: 125 }, { lineNumber: 2 }] } } });
    const ubl = (await orderFile(env.DB, "PO-7", "ubl"))!;
    expect(ubl).toMatchObject({ contentType: "application/xml; charset=utf-8", filename: "PO-7.xml" });
    expect(new TextDecoder().decode(ubl.bytes)).toContain("<cbc:ID>PO-7</cbc:ID>");
  });
});

describe("through the router", () => {
  it("shows the PDF inline, downloads each, and gives none to whoever may not open the order", async () => {
    await storeOrder(env.DB, ORDER, "acme-uk");
    const key = async (id: string) => {
      const k = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(k), id).run();
      return k;
    };
    const pat = await key("u-pat");
    const get = (k: string, q: string) => SELF.fetch(`https://app.example.com/purchase-orders/PO-7/document${q}`, { headers: { Authorization: `Bearer ${k}` } });
    const pdf = await get(pat, "");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Content-Disposition")).toBe('inline; filename="PO-7.pdf"');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect((await get(pat, "?format=pdf&download=1")).headers.get("Content-Disposition")).toBe('attachment; filename="PO-7.pdf"');
    const csv = await get(pat, "?format=csv");
    expect([csv.headers.get("Content-Type"), csv.headers.get("Content-Disposition")]).toEqual(["text/csv; charset=utf-8", 'attachment; filename="PO-7.csv"']);
    expect((await get(pat, "?format=ubl")).headers.get("Content-Disposition")).toBe('attachment; filename="PO-7.xml"');
    expect((await get(await key("u-nia"), "")).status).toBe(403);
  });
});

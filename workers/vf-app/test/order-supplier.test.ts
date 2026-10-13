import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { ORDER_SUPPLIER_SQL, bareVat, sameVat } from "../src/order-supplier.js";
import { orderFigures } from "../src/goods-receipts.js";
import { supplierOfParty } from "../src/order-checking.js";

/**
 * **An order's supplier, however its seller is written — decision 0756.**
 * Lager Nord is kept as "DE 123 456 789", ERP number LN-01, matched
 * three-way; a closed record of the same number sits behind it.
 */

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, name, vat_id, erp_identifier, match_option, quantity_tolerance_pct, status) VALUES ('sup-old', 'Lager Nord (old)', 'DE123456789', NULL, NULL, NULL, 'inactive'), ('sup-ln', 'Lager Nord GmbH', 'DE 123 456 789', 'LN-01', 'three_way', 5, 'active')"
  ).run();
});

const order = (seller: string) =>
  env.DB.prepare("INSERT INTO purchase_orders (id, order_number, seller_party_id, org_unit_id) VALUES (?, ?, ?, 'uk')").bind(`po-${seller}`, `PO-${seller}`, seller).run();

describe("the VAT number however written, or the ERP number", () => {
  it("compares VAT numbers without spaces, dots, hyphens or the country prefix", () => {
    expect(bareVat("de 123.456-789")).toBe("123456789");
    expect(sameVat("DE123456789", "DE 123 456 789")).toBe(true);
    expect(sameVat("123456789", "DE-123.456.789")).toBe(true);
    expect(sameVat("DE123456789", "DE123456780")).toBe(false);
    expect(sameVat("", "")).toBe(false);
    // Both name their country: they must name the same one.
    expect(sameVat("GB123456789", "DE123456789")).toBe(false);
    expect(sameVat(null, "DE1")).toBe(false);
  });

  it.each(["DE123456789", "de 123 456 789", "123456789", "DE-123-456-789", "LN-01"])("finds the active supplier for an order whose seller is %s, three-way with its tolerance", async (seller) => {
    await order(seller);
    const figures = await orderFigures(env.DB, `PO-${seller}`);
    expect(figures).toMatchObject({ receiptingRequired: true, tolerancePct: 5, supplier: { id: "sup-ln", name: "Lager Nord GmbH" } });
    const row = await env.DB.prepare(`SELECT ${ORDER_SUPPLIER_SQL("name", "po.seller_party_id")} AS supplier FROM purchase_orders po WHERE po.order_number = ?`).bind(`PO-${seller}`).first<{ supplier: string }>();
    expect(row?.supplier).toBe("Lager Nord GmbH");
    expect((await supplierOfParty(env.DB, seller))?.id).toBe("sup-ln");
  });

  it("finds nobody for another number or another country's, and never matches an ERP number loosely", async () => {
    await order("DE999999999");
    await order("ln-01");
    await order("GB123456789");
    expect((await orderFigures(env.DB, "PO-DE999999999"))?.supplier).toBeNull();
    expect((await orderFigures(env.DB, "PO-ln-01"))?.supplier).toBeNull();
    expect((await orderFigures(env.DB, "PO-GB123456789"))?.supplier).toBeNull();
  });
});

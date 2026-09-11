import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { matchSupplier } from "../src/match-supplier.js";

/**
 * Which supplier an arriving invoice is from — decision 0209.
 *
 * **Matched means we can name it to the ERP**, not that we recognise
 * the company. The operator:
 *
 *   Key to the mirror is having an ERP Identifier. If we do not have
 *   that, it indicates a new supplier record. Otherwise when we pass
 *   the information to the ERP, it will not know who it belongs to.
 */

async function supplier(
  id: string,
  fields: { erp?: string; vat?: string; endpoint?: string; site?: string; status?: string } = {}
) {
  await env.DB.prepare(
    `INSERT INTO suppliers (id, erp_identifier, name, vat_id, electronic_address,
                            erp_site_identifier, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      fields.erp ?? `ERP-${id}`,
      id,
      fields.vat ?? null,
      fields.endpoint ?? null,
      fields.site ?? null,
      fields.status ?? "active"
    )
    .run();
}

async function recordLoad(when = "2026-09-01 09:00:00") {
  await env.DB.prepare(
    "INSERT INTO supplier_loads (id, loaded_at, loaded_by, row_count) VALUES (?, ?, 'alice', 1)"
  )
    .bind(crypto.randomUUID(), when)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("matching a seller", () => {
  it("matches on the electronic address", async () => {
    // **Unambiguous**: issued under a scheme and identifying one party,
    // where a VAT number is shared by every site of a company.
    await supplier("northwind", { endpoint: "0088:7300010000001" });

    const result = await matchSupplier(env.DB, { "BT-34": "0088:7300010000001" });
    expect(result.supplierId).toBe("northwind");
    expect(result.matchedOn).toBe("BT-34");
  });

  it("matches on the VAT id", async () => {
    /**
     * **The one real documents carry.** A photographed invoice has the
     * seller's VAT number on it and almost never an endpoint — the same
     * asymmetry decision 0204 found on the buyer's side.
     */
    await supplier("northwind", { vat: "GB447711223" });

    const result = await matchSupplier(env.DB, { "BT-31": "GB447711223" });
    expect(result.supplierId).toBe("northwind");
    expect(result.matchedOn).toBe("BT-31");
  });

  it("gives back the ERP identifier, which is the point", async () => {
    // **An invoice we cannot name to the ERP cannot be paid**, however
    // familiar the name on it.
    await supplier("northwind", { erp: "40118", vat: "GB1" });

    const result = await matchSupplier(env.DB, { "BT-31": "GB1" });
    expect(result.erpIdentifier).toBe("40118");
  });

  it("ignores spacing and case", async () => {
    // An ERP export and a document write the same number differently,
    // and neither person should have to know what the other used.
    await supplier("northwind", { vat: "GB447711223" });

    const result = await matchSupplier(env.DB, { "BT-31": "gb 447 711 223" });
    expect(result.supplierId).toBe("northwind");
  });

  it("prefers the endpoint where both are present", async () => {
    await supplier("by-endpoint", { endpoint: "0088:X" });
    await supplier("by-vat", { vat: "GB1" });

    const result = await matchSupplier(env.DB, { "BT-34": "0088:X", "BT-31": "GB1" });
    expect(result.supplierId).toBe("by-endpoint");
  });

  it("falls through where the first does not match", async () => {
    await supplier("northwind", { vat: "GB1" });

    const result = await matchSupplier(env.DB, { "BT-34": "0088:nobody", "BT-31": "GB1" });
    expect(result.supplierId).toBe("northwind");
  });
});

describe("when it cannot say", () => {
  it("says so where the document names no seller", async () => {
    const result = await matchSupplier(env.DB, { "BT-1": "INV-1" });
    expect(result.reason).toBe("no_identifier");
  });

  it("says so where nobody in the list matches", async () => {
    // **This is what routes a new supplier for review.**
    await supplier("northwind", { vat: "GB1" });

    const result = await matchSupplier(env.DB, { "BT-31": "FR9" });
    expect(result.reason).toBe("no_match");
    expect(result.erpIdentifier).toBeNull();
  });

  it("refuses to choose between sites sharing a VAT number", async () => {
    /**
     * **Normal rather than a data fault**: a company has one VAT
     * registration across every site, and Oracle's site is the
     * relationship rather than the address (decision 0207).
     *
     * Picking one would attach an invoice to terms nobody agreed for
     * it.
     */
    await supplier("northwind-uk", { erp: "40118", site: "UK", vat: "GB1" });
    await supplier("northwind-ie", { erp: "40118", site: "IE", vat: "GB1" });

    const result = await matchSupplier(env.DB, { "BT-31": "GB1" });
    expect(result.supplierId).toBeNull();
    expect(result.reason).toBe("ambiguous_site");
  });

  it("does not match an inactive supplier", async () => {
    // **Absent from a later load is inactive, never deleted** (decision
    // 0208) — and matching a closed supplier would produce a payment
    // instruction the ERP refuses.
    await supplier("gone", { vat: "GB1", status: "inactive" });

    const result = await matchSupplier(env.DB, { "BT-31": "GB1" });
    expect(result.reason).toBe("no_match");
  });
});

describe("a stale mirror", () => {
  /**
   * **It lies confidently.** A supplier added to the ERP on Monday and
   * loaded here on Friday means four days of invoices routed for
   * review, each correct according to this system and wrong in fact.
   */
  it("reports when the list was last loaded", async () => {
    await recordLoad("2026-08-30 09:00:00");
    const result = await matchSupplier(env.DB, { "BT-31": "GB9" });

    expect(result.reason).toBe("no_match");
    expect(result.listLoadedAt).toBe("2026-08-30 09:00:00");
  });

  it("reports the most recent load, not the first", async () => {
    await recordLoad("2026-08-01 09:00:00");
    await recordLoad("2026-09-05 09:00:00");

    const result = await matchSupplier(env.DB, { "BT-31": "GB9" });
    expect(result.listLoadedAt).toBe("2026-09-05 09:00:00");
  });

  it("says nothing was ever loaded, which is a different thing", async () => {
    /**
     * **A mirror nobody has filled is not a stale mirror.** One means
     * *"we were told and this supplier was not in it"*; the other means
     * *"we have never been told anything"*, and only the second is
     * fixed by asking the customer for a file.
     */
    const result = await matchSupplier(env.DB, { "BT-31": "GB9" });
    expect(result.listLoadedAt).toBeNull();
  });
});

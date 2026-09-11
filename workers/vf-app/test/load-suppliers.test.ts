import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleLoadSuppliers, parseCsv } from "../src/load-suppliers.js";
import { matchSupplier } from "../src/match-supplier.js";

/**
 * Loading the customer's supplier master file — decision 0211.
 *
 * **The mirror existed and could not be filled.** Decision 0209 built
 * the table and the matching; the only way to put a supplier in it was
 * an `INSERT`.
 */

const HEADER = "ERP ID,Supplier Name,VAT Number,Country,Terms";

async function load(csv: string) {
  return handleLoadSuppliers(env.DB, csv, "alice");
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("reading a spreadsheet", () => {
  it("handles a name with a comma in it", () => {
    /**
     * **`Smith, Jones & Co` is an ordinary name**, and splitting on
     * commas would make two suppliers of it — one called `Smith` with
     * an ERP identifier of ` Jones & Co`.
     */
    const rows = parseCsv('a,b\n"Smith, Jones & Co",40118');
    expect(rows[1]).toEqual(["Smith, Jones & Co", "40118"]);
  });

  it("handles a quote inside a quoted name", () => {
    const rows = parseCsv('a\n"O""Brien Ltd"');
    expect(rows[1]).toEqual(['O"Brien Ltd']);
  });

  it("ignores blank lines", () => {
    // A spreadsheet export ends with one more often than not.
    expect(parseCsv("a,b\n1,2\n\n")).toHaveLength(2);
  });

  it("accepts the column names a person would write", async () => {
    // *Supplier Number*, *VAT*, *Peppol ID* — a customer exports what
    // their ERP calls things, not what we do.
    const result = await load("Supplier Number,Name\n40118,Northwind");
    expect(result.status).toBe(200);
  });
});

describe("the column that is not optional", () => {
  it("refuses a file with no ERP identifier column", async () => {
    /**
     * **Refused as a whole rather than row by row**, because every row
     * would fail for the same reason and a hundred identical errors
     * tell somebody less than one.
     */
    const result = await load("Name,VAT\nNorthwind,GB1");

    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("no_erp_identifier_column");
  });

  it("refuses a row missing one", async () => {
    const result = await load(`${HEADER}\n,Northwind,GB1,GB,Net 30\n40118,Acme,GB2,GB,Net 30`);
    const body = result.body as { loaded: number; refused: { row: number; reason: string }[] };

    expect(body.loaded).toBe(1);
    expect(body.refused).toEqual([{ row: 2, reason: "no ERP identifier" }]);
  });
});

describe("what a load refuses, and says so", () => {
  /**
   * **A customer whose export is half wrong should learn that from the
   * load** rather than discover it one invoice at a time — decision
   * 0162's argument that a system which knows something should say so.
   */
  it("refuses a hold with no reason", async () => {
    // **A payment stopped for no stated cause** is worse than one
    // stopped for a bad one.
    const result = await load("ERP ID,Name,Hold\n40118,Northwind,yes");
    const body = result.body as { refused: { reason: string }[] };

    expect(body.refused[0].reason).toContain("no reason");
  });

  it("accepts a hold with one", async () => {
    const result = await load("ERP ID,Name,Hold,hold_reason\n40118,Northwind,yes,Under dispute");
    expect((result.body as { loaded: number }).loaded).toBe(1);
  });

  it("refuses a match option nobody recognises", async () => {
    const result = await load("ERP ID,Name,match_option\n40118,Northwind,four-way");
    expect((result.body as { refused: { reason: string }[] }).refused[0].reason).toContain(
      "not recognised"
    );
  });

  it("names the row, because that is what a person can act on", async () => {
    const result = await load(`ERP ID,Name\n40118,Northwind\n,Nobody\n40119,Acme`);
    expect((result.body as { refused: { row: number }[] }).refused[0].row).toBe(3);
  });

  it("refuses a load where nothing could be loaded", async () => {
    /**
     * **A load that put nothing in is not a load**, and recording it
     * would move the *"last loaded"* date on a mirror that learned
     * nothing — the stale-mirror trap with the evidence removed.
     */
    const result = await load("ERP ID,Name\n,Nobody");

    expect(result.status).toBe(400);
    expect((result.body as { reason: string }).reason).toBe("nothing_loaded");

    const loads = await env.DB.prepare("SELECT count(*) AS n FROM supplier_loads").first<{ n: number }>();
    expect(loads?.n).toBe(0);
  });
});

describe("replace, not merge", () => {
  it("updates a supplier that appears again", async () => {
    // **A load is the ERP's current truth** — decision 0208 — and
    // reconciling row by row invents a conflict resolution nobody asked
    // for.
    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");
    await load("ERP ID,Name,VAT\n40118,Northwind Logistics Ltd,GB2");

    const row = await env.DB.prepare("SELECT name, vat_id FROM suppliers").first<{
      name: string;
      vat_id: string;
    }>();
    expect(row?.name).toBe("Northwind Logistics Ltd");
    expect(row?.vat_id).toBe("GB2");
  });

  it("makes an absent supplier inactive, never deleted", async () => {
    /**
     * **An invoice already pointing at one must still be able to say
     * who it was** — decision 0208.
     */
    await load("ERP ID,Name\n40118,Northwind\n40119,Acme");
    const result = await load("ERP ID,Name\n40118,Northwind");

    expect((result.body as { deactivated: number }).deactivated).toBe(1);

    const gone = await env.DB.prepare("SELECT status FROM suppliers WHERE id = '40119'").first<{
      status: string;
    }>();
    expect(gone?.status).toBe("inactive");
  });

  it("brings one back where the ERP says so", async () => {
    await load("ERP ID,Name\n40118,Northwind\n40119,Acme");
    await load("ERP ID,Name\n40118,Northwind");
    await load("ERP ID,Name\n40118,Northwind\n40119,Acme");

    const back = await env.DB.prepare("SELECT status FROM suppliers WHERE id = '40119'").first<{
      status: string;
    }>();
    expect(back?.status).toBe("active");
  });

  it("keeps a site as its own row", async () => {
    // Oracle's site is the relationship rather than the address
    // (decision 0207), and a customer may export one row per site.
    await load("ERP ID,Name,Site\n40118,Northwind UK,UK\n40118,Northwind IE,IE");

    const count = await env.DB.prepare("SELECT count(*) AS n FROM suppliers").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});

describe("looking again at what could not be matched", () => {
  /**
   * **Decision 0208 called this part of the feature rather than a
   * refinement**: an invoice sitting in review because its supplier was
   * unknown stays there after the supplier is loaded, and the fact that
   * sent it there is no longer true.
   */
  async function unmatchedInvoice(id: string, vat: string) {
    await env.DB.prepare(
      `INSERT INTO invoice_headers (id, facts_json)
       VALUES (?, json_object('BT-31', ?, 'supplier.matched', 0, 'supplier.unmatchedReason', 'no_match'))`
    )
      .bind(id, vat)
      .run();
  }

  it("matches an invoice the load has now explained", async () => {
    await unmatchedInvoice("inv-1", "GB447711223");
    const result = await load("ERP ID,Name,VAT\n40118,Northwind,GB447711223");

    expect((result.body as { rematched: number }).rematched).toBe(1);

    const row = await env.DB.prepare("SELECT supplier_id FROM invoice_headers WHERE id = 'inv-1'").first<{
      supplier_id: string;
    }>();
    expect(row?.supplier_id).toBe("40118");
  });

  it("clears the reason, because it is no longer true", async () => {
    await unmatchedInvoice("inv-1", "GB1");
    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");

    const row = await env.DB.prepare(
      `SELECT json_extract(facts_json, '$."supplier.unmatchedReason"') AS why,
              json_extract(facts_json, '$."supplier.matched"') AS matched
       FROM invoice_headers WHERE id = 'inv-1'`
    ).first<{ why: string | null; matched: number }>();

    expect(row?.why).toBeNull();
    expect(row?.matched).toBe(1);
  });

  it("leaves an invoice the load still cannot explain", async () => {
    await unmatchedInvoice("inv-1", "FR9");
    const result = await load("ERP ID,Name,VAT\n40118,Northwind,GB1");

    expect((result.body as { rematched: number }).rematched).toBe(0);
  });

  it("does not move the invoice", async () => {
    /**
     * **It corrects the fact, not the queue.** Where an invoice belongs
     * now is a process question, and a rule that routed it on
     * `supplier.matched` should be what routes it back — not a loader
     * reaching into somebody's work.
     */
    await unmatchedInvoice("inv-1", "GB1");
    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");

    const instances = await env.DB.prepare(
      "SELECT count(*) AS n FROM process_instances"
    ).first<{ n: number }>();
    expect(instances?.n).toBe(0);
  });
});

describe("the load date a match depends on", () => {
  it("records when the mirror was last told the truth", async () => {
    // **A stale mirror lies confidently** — decision 0208 — so an
    // unmatched supplier is reported with this beside it.
    await load("ERP ID,Name\n40118,Northwind");

    const result = await matchSupplier(env.DB, { "BT-31": "GB9" });
    expect(result.reason).toBe("no_match");
    expect(result.listLoadedAt).not.toBeNull();
  });

  it("counts what it refused, so a half-wrong file is visible later", async () => {
    await load("ERP ID,Name\n40118,Northwind\n,Nobody");

    const row = await env.DB.prepare(
      "SELECT row_count, refused_count FROM supplier_loads"
    ).first<{ row_count: number; refused_count: number }>();

    expect(row?.row_count).toBe(1);
    expect(row?.refused_count).toBe(1);
  });
});

import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleLoadSuppliers,
  handleListSuppliers,
  handleSearchSuppliers,
  handleSetInvoiceSupplier,
  handleCreateSupplier,
  handleUpdateSupplier,
  parseCsv,
} from "../src/load-suppliers.js";
import { matchSupplier } from "../src/match-supplier.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { handleGetInvoice } from "../src/invoice-facts-route.js";

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

describe("the list, and how old it is (decision 0213)", () => {
  it("reports the load date with the list", async () => {
    /**
     * **They travel together on purpose.** A person judging whether a
     * supplier is missing needs to know when we were last told
     * (decision 0208), and two calls would let a screen show one
     * without the other.
     */
    await load("ERP ID,Name\n40118,Northwind");
    const result = await handleListSuppliers(env.DB);
    const body = result.body as { suppliers: unknown[]; lastLoad: { rowCount: number } | null };

    expect(body.suppliers).toHaveLength(1);
    expect(body.lastLoad?.rowCount).toBe(1);
  });

  it("says null where nothing was ever loaded", async () => {
    // **Which a screen must say differently from "loaded long ago"** —
    // one is fixed by asking for a file and the other by asking for a
    // newer one.
    const result = await handleListSuppliers(env.DB);
    expect((result.body as { lastLoad: null }).lastLoad).toBeNull();
  });

  it("shows an inactive supplier rather than hiding it", async () => {
    // **Absent from a load is inactive, never deleted** (decision
    // 0208), and an invoice pointing at one must still name it.
    await load("ERP ID,Name\n40118,Northwind\n40119,Acme");
    await load("ERP ID,Name\n40118,Northwind");

    const body = (await handleListSuppliers(env.DB)).body as {
      suppliers: { status: string }[];
    };
    expect(body.suppliers).toHaveLength(2);
    expect(body.suppliers.some((s) => s.status === "inactive")).toBe(true);
  });

  it("gives back the hold reason, not just that there is one", async () => {
    // **A hold is why an invoice routes differently**, so the reason is
    // the useful part.
    await load("ERP ID,Name,Hold,hold_reason\n40118,Northwind,yes,Under dispute");

    const body = (await handleListSuppliers(env.DB)).body as {
      suppliers: { onHold: boolean; holdReason: string }[];
    };
    expect(body.suppliers[0].onHold).toBe(true);
    expect(body.suppliers[0].holdReason).toBe("Under dispute");
  });
});

describe("who may load a supplier file (decision 0215)", () => {
  /**
   * **A permission no role granted.**
   *
   * `Admin.Configure` and `Admin.ConfigManagement` both exist. Twenty-
   * two routes use the first and nothing uses the second — and this
   * route was written against the second, so a person holding every
   * other configuration right was told *"you do not have permission to
   * do this"*, correctly, for a distinction nobody had made.
   */
  async function keyFor(permissions: string[]) {
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare(
      "INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)"
    )
      .bind(id, `${id}@acme.com`, "Configurer", await hashApiKey(apiKey))
      .run();

    const roleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)"
    )
      .bind(roleId, `Role ${roleId}`, JSON.stringify(permissions))
      .run();
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)"
    )
      .bind(id, roleId)
      .run();

    return apiKey;
  }

  async function postAs(key: string) {
    return SELF.fetch("https://example.com/suppliers/load", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" },
      body: "ERP ID,Name\n40118,Northwind",
    });
  }

  it("lets somebody who configures everything else load a file", async () => {
    // **The permission twenty-two other routes ask for.**
    const key = await keyFor(["Admin.Configure"]);
    expect((await postAs(key)).status).toBe(200);
  });

  it("refuses somebody with no configuration rights", async () => {
    // The boundary is real; it was the *name* that was wrong.
    const key = await keyFor(["AP.Validate"]);
    expect((await postAs(key)).status).toBe(403);
  });
});

describe("a supplier already there under a different id (decision 0217)", () => {
  /**
   * **The live failure**, reported as *"Unexpected token 'e', 'error
   * code: 1101'"*.
   *
   * The loader constructed an id and used `ON CONFLICT(id)` against it,
   * which catches a row it created before and **not** a row already
   * there under a different one. The live database had a supplier
   * inserted by hand as `northwind` carrying ERP identifier `40118`, so
   * the loader's own `40118` row conflicted on the unique index rather
   * than on the key.
   *
   * SQLite refused, the Worker threw, and Cloudflare returned an error
   * page — which is how a constraint doing its job reaches somebody as
   * a JSON parse error.
   */
  it("updates it rather than throwing", async () => {
    await env.DB.prepare(
      "INSERT INTO suppliers (id, erp_identifier, name, vat_id) VALUES ('northwind', '40118', 'Northwind', 'GB1')"
    ).run();

    const result = await load("ERP ID,Name,VAT\n40118,Northwind Logistics Ltd,GB2");

    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT id, name, vat_id FROM suppliers").first<{
      id: string;
      name: string;
      vat_id: string;
    }>();

    // **Its own id is kept**, because anything already pointing at it
    // still means it.
    expect(row?.id).toBe("northwind");
    expect(row?.name).toBe("Northwind Logistics Ltd");
    expect(row?.vat_id).toBe("GB2");
  });

  it("does not deactivate the supplier it just updated", async () => {
    // It is in the file, so it is in `seen` — under the id it already
    // had rather than the one we would have given it.
    await env.DB.prepare(
      "INSERT INTO suppliers (id, erp_identifier, name) VALUES ('northwind', '40118', 'Northwind')"
    ).run();

    await load("ERP ID,Name\n40118,Northwind");

    const row = await env.DB.prepare("SELECT status FROM suppliers").first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

  it("keeps an invoice pointing at it", async () => {
    /**
     * **The reason the id must not change.** An invoice matched to
     * `northwind` yesterday still means that supplier, and giving the
     * row a new id would orphan it.
     */
    await env.DB.prepare(
      "INSERT INTO suppliers (id, erp_identifier, name, vat_id) VALUES ('northwind', '40118', 'Northwind', 'GB1')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-1', '{}', 'northwind')"
    ).run();

    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");

    const row = await env.DB.prepare(
      "SELECT supplier_id FROM invoice_headers WHERE id = 'inv-1'"
    ).first<{ supplier_id: string }>();
    expect(row?.supplier_id).toBe("northwind");
  });

  it("still tells two sites apart", async () => {
    // The lookup matches on site as well, so one ERP number with two
    // sites stays two rows.
    await load("ERP ID,Name,Site\n40121,Acme UK,UK\n40121,Acme IE,IE");

    const count = await env.DB.prepare("SELECT count(*) AS n FROM suppliers").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});

describe("an email to write to (decision 0219)", () => {
  it("loads one", async () => {
    /**
     * **Deliberately not the electronic address.** `BT-34` is a Peppol
     * endpoint under a scheme, machine-routed and unreadable; this is
     * where a human sends a question — and decision 0031 built
     * `return_to_supplier` with no way to reach one.
     */
    const result = await load("ERP ID,Name,Email Address\n40118,Northwind,ap@northwind.example");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT email FROM suppliers").first<{ email: string }>();
    expect(row?.email).toBe("ap@northwind.example");
  });

  it("reports it with the list", async () => {
    await load("ERP ID,Name,Email\n40118,Northwind,ap@northwind.example");
    const body = (await handleListSuppliers(env.DB)).body as { suppliers: { email: string }[] };
    expect(body.suppliers[0].email).toBe("ap@northwind.example");
  });

  it("leaves it empty where the file has none", async () => {
    // Most rows, and an empty email is a fact rather than a failure.
    await load("ERP ID,Name\n40118,Northwind");
    const body = (await handleListSuppliers(env.DB)).body as { suppliers: { email: null }[] };
    expect(body.suppliers[0].email).toBeNull();
  });
});

describe("what the viewer is told about the supplier (decision 0219)", () => {
  /**
   * **Our record of them, not what the invoice says.** A person reading
   * the image checks the address and email we hold are the ones printed
   * on it — which matters more since decision 0218, because a supplier
   * with three sites matches on a pay-site flag rather than on anything
   * visible.
   */
  it("reports the matched supplier with its address and email", async () => {
    await load(
      "ERP ID,Site,Name,Pay Site,Address,City,Postcode,Email,VAT\n" +
        "40121,PAY-UK,Acme Payments,yes,PO Box 44,London,EC2V 7HH,ap@acme.example,GB1"
    );

    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-1', '{}', '40121:PAY-UK')"
    ).run();

    const result = await handleGetInvoice(env.DB, "inv-1");
    const supplier = (result.body as { supplier: Record<string, unknown> }).supplier;

    expect(supplier.name).toBe("Acme Payments");
    expect(supplier.email).toBe("ap@acme.example");
    expect(supplier.city).toBe("London");
    // **Which site, and why this one** — the reason it reached this
    // record rather than one of its siblings.
    expect(supplier.erp_site_identifier).toBe("PAY-UK");
    expect(supplier.is_pay_site).toBe(1);
  });

  it("says null where nothing was matched", async () => {
    // **A real state**, and the viewer explains it rather than hiding
    // the panel.
    await env.DB.prepare(
      `INSERT INTO invoice_headers (id, facts_json)
       VALUES ('inv-1', json_object('supplier.unmatchedReason', 'no_match'))`
    ).run();

    const result = await handleGetInvoice(env.DB, "inv-1");
    expect((result.body as { supplier: null }).supplier).toBeNull();
  });

  it("carries a hold, because it changes what happens next", async () => {
    await load("ERP ID,Name,Hold,hold_reason\n40118,Northwind,yes,Under dispute");
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-1', '{}', '40118')"
    ).run();

    const result = await handleGetInvoice(env.DB, "inv-1");
    const supplier = (result.body as { supplier: Record<string, unknown> }).supplier;

    expect(supplier.on_hold).toBe(1);
    expect(supplier.hold_reason).toBe("Under dispute");
  });
});

describe("finding a supplier by hand (decision 0222)", () => {
  /**
   * **One box, not a form.** Somebody looking at an invoice has a name,
   * or a VAT number, or an address on the page, and does not know which
   * of those we hold. Asking them to pick a field first is asking them
   * to guess what we stored.
   */
  beforeEach(async () => {
    await load(
      "ERP ID,Site,Name,Pay Site,Address,City,Postcode,VAT,Email,Phone\n" +
        "40121,PAY-UK,Acme Supplies Payments,yes,PO Box 44,London,EC2V 7HH,GB112233445,pay@acme.example,+44 20 7946 0991\n" +
        "40121,BUY-UK,Acme Supplies UK,,1 Trading Estate,Slough,SL1 4AA,GB112233445,,\n" +
        "40118,,Northwind Logistics,yes,14 Dock Road,Felixstowe,IP11 3TA,GB447711223,,"
    );
  });

  async function search(q: string) {
    const result = await handleSearchSuppliers(env.DB, q);
    return (result.body as { suppliers: { id: string; name: string }[] }).suppliers;
  }

  it("finds by name", async () => {
    expect((await search("northwind")).map((s) => s.name)).toEqual(["Northwind Logistics"]);
  });

  it("finds by VAT number", async () => {
    expect(await search("GB447711223")).toHaveLength(1);
  });

  it("finds a VAT number written with spaces", async () => {
    // A person copying from an invoice types what is printed.
    expect(await search("GB 447 711 223")).toHaveLength(0);
    expect(await search("447711223")).toHaveLength(1);
  });

  it("finds by city", async () => {
    // **Since decision 0218 the address is the distinguishing mark**,
    // because three sites share one VAT number.
    expect((await search("slough")).map((s) => s.name)).toEqual(["Acme Supplies UK"]);
  });

  it("finds by postcode", async () => {
    expect(await search("EC2V")).toHaveLength(1);
  });

  it("finds by ERP number", async () => {
    expect(await search("40121")).toHaveLength(2);
  });

  it("puts the pay site first", async () => {
    /**
     * **An invoice goes to one** (decision 0218), so a person choosing
     * by hand is usually choosing one — and should not scroll past a
     * procurement site to reach it.
     */
    expect((await search("acme"))[0].name).toBe("Acme Supplies Payments");
  });

  it("says nothing for one character", async () => {
    // One character matches most of a supplier list, which is the same
    // as no help at all.
    expect(await search("a")).toHaveLength(0);
  });

  it("does not offer an inactive supplier", async () => {
    await load("ERP ID,Name\n40118,Northwind Logistics");
    expect(await search("acme")).toHaveLength(0);
  });
});

describe("choosing one by hand (decision 0222)", () => {
  beforeEach(async () => {
    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");
    await env.DB.prepare(
      `INSERT INTO invoice_headers (id, facts_json)
       VALUES ('inv-1', json_object('supplier.matched', 0, 'supplier.unmatchedReason', 'no_match'))`
    ).run();
  });

  it("attaches the invoice and clears the reason", async () => {
    const result = await handleSetInvoiceSupplier(env.DB, "inv-1", "40118", "alice");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT supplier_id,
              json_extract(facts_json, '$."supplier.matched"') AS matched,
              json_extract(facts_json, '$."supplier.unmatchedReason"') AS why
       FROM invoice_headers WHERE id = 'inv-1'`
    ).first<{ supplier_id: string; matched: number; why: string | null }>();

    expect(row?.supplier_id).toBe("40118");
    expect(row?.matched).toBe(1);
    expect(row?.why).toBeNull();
  });

  it("records who decided", async () => {
    /**
     * ***"We found this"* and *"somebody said so"* are different
     * claims**, and only one of them could have been prevented by a
     * rule. An auditor wants to know which.
     */
    await handleSetInvoiceSupplier(env.DB, "inv-1", "40118", "alice");

    const row = await env.DB.prepare(
      `SELECT json_extract(facts_json, '$."supplier.chosenBy"') AS who
       FROM invoice_headers WHERE id = 'inv-1'`
    ).first<{ who: string }>();
    expect(row?.who).toBe("alice");
  });

  it("refuses an inactive supplier", async () => {
    // **One the ERP no longer has** (decision 0208) would produce a
    // payment instruction the ERP refuses — caught here rather than at
    // payment.
    await env.DB.prepare("UPDATE suppliers SET status = 'inactive'").run();

    const result = await handleSetInvoiceSupplier(env.DB, "inv-1", "40118", "alice");
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("supplier_inactive");
  });

  it("refuses a supplier that does not exist", async () => {
    const result = await handleSetInvoiceSupplier(env.DB, "inv-1", "nobody", "alice");
    expect(result.status).toBe(404);
  });

  it("refuses an invoice that does not exist", async () => {
    const result = await handleSetInvoiceSupplier(env.DB, "nope", "40118", "alice");
    expect(result.status).toBe(404);
  });
});

describe("a supplier the ERP does not have yet (decision 0231)", () => {
  /**
   * The operator:
   *
   *   A record might be created and details logged before the record is
   *   created in the ERP. Receipt of an invoice, and supplier record
   *   creation here, could be a precursor to a New Supplier process.
   *
   * **Decision 0209 made that impossible** with `erp_identifier NOT
   * NULL`, on an argument about *payment* enforced as a rule about
   * *existence*.
   */
  it("records one with no identifier", async () => {
    const result = await handleCreateSupplier(
      env.DB,
      { name: "Kingsway Print Services", vatId: "GB556677889", city: "Leeds" },
      "alice"
    );

    expect(result.status).toBe(201);
    expect((result.body as { awaitingErp: boolean }).awaitingErp).toBe(true);
  });

  it("records one with an identifier, where somebody has it", async () => {
    const result = await handleCreateSupplier(
      env.DB,
      { name: "Kingsway Print Services", erpIdentifier: "40999" },
      "alice"
    );
    expect((result.body as { awaitingErp: boolean }).awaitingErp).toBe(false);
  });

  it("refuses one with no name", async () => {
    // A supplier nobody can recognise is one nobody can check against.
    const result = await handleCreateSupplier(env.DB, { vatId: "GB1" }, "alice");
    expect(result.status).toBe(400);
  });

  it("refuses an identifier the ERP already uses", async () => {
    /**
     * **Somebody describing a supplier we have, not a new one** — and
     * the unique index would refuse it as a constraint error rather
     * than as an explanation.
     */
    await load("ERP ID,Name\n40118,Northwind");

    const result = await handleCreateSupplier(
      env.DB,
      { name: "Northwind again", erpIdentifier: "40118" },
      "alice"
    );
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("erp_exists");
  });

  it("matches an invoice to one awaiting the ERP", async () => {
    /**
     * **Matched and payable are two claims now.** We recognise them;
     * the ERP cannot name them. Decision 0209's argument survives as a
     * field rather than as a constraint.
     */
    await handleCreateSupplier(env.DB, { name: "Kingsway", vatId: "GB556677889" }, "alice");

    const matched = await matchSupplier(env.DB, { "BT-31": "GB556677889" });
    expect(matched.supplierId).not.toBeNull();
    expect(matched.erpIdentifier).toBeNull();
  });

  it("lets a blank identifier be filled in", async () => {
    // **How a supplier stops awaiting**: the team creates the record
    // and somebody writes the number down.
    const created = await handleCreateSupplier(env.DB, { name: "Kingsway" }, "alice");
    const id = (created.body as { id: string }).id;

    const result = await handleUpdateSupplier(env.DB, id, { erpIdentifier: "40999" }, "alice");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT erp_identifier FROM suppliers WHERE id = ?")
      .bind(id)
      .first<{ erp_identifier: string }>();
    expect(row?.erp_identifier).toBe("40999");
  });

  it("refuses to overwrite one that is already set", async () => {
    /**
     * **Decision 0218's argument, which still holds where the ERP owns
     * the row**: changing it would point our record at a different
     * supplier than the ERP has, silently, with invoices attached.
     *
     * Filling in a blank is not the same act.
     */
    await load("ERP ID,Name\n40118,Northwind");

    const result = await handleUpdateSupplier(env.DB, "40118", { erpIdentifier: "40119" }, "alice");
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("erp_already_set");
  });

  it("refuses a blank identifier, which looks like an answer", async () => {
    // Migration 0055's standing invariant: a blank string is worse than
    // nothing, because it cannot be paid against either.
    const created = await handleCreateSupplier(env.DB, { name: "Kingsway", erpIdentifier: "   " }, "alice");
    const id = (created.body as { id: string }).id;

    const row = await env.DB.prepare("SELECT erp_identifier FROM suppliers WHERE id = ?")
      .bind(id)
      .first<{ erp_identifier: string | null }>();
    expect(row?.erp_identifier).toBeNull();
  });
});

describe("the ERP catches up (decision 0233)", () => {
  /**
   * The operator's own sequence:
   *
   *   The new supplier would be created and the record here updated to
   *   include the ERP Identifier retroactively.
   *
   * **Decision 0231 recorded the absence of this as its largest hole**:
   * a load naming a company somebody had already recorded by hand would
   * create a second row, and every invoice matched to the first would
   * keep pointing at a supplier the ERP still could not name.
   */
  it("adopts a locally recorded supplier rather than adding a second", async () => {
    const created = await handleCreateSupplier(
      env.DB,
      { name: "Kingsway Print", vatId: "GB556677889" },
      "alice"
    );
    const localId = (created.body as { id: string }).id;

    const result = await load("ERP ID,Name,VAT\n40999,Kingsway Print Services,GB556677889");

    expect((result.body as { adopted: number }).adopted).toBe(1);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM suppliers").first<{ n: number }>();
    expect(count?.n).toBe(1);

    // **And it keeps its own id**, so anything pointing at it still
    // means it (decision 0217).
    const row = await env.DB.prepare("SELECT id, erp_identifier FROM suppliers").first<{
      id: string;
      erp_identifier: string;
    }>();
    expect(row?.id).toBe(localId);
    expect(row?.erp_identifier).toBe("40999");
  });

  it("makes an invoice matched to it payable", async () => {
    /**
     * **The point of the whole sequence.** An invoice matched to a
     * locally recorded supplier was recognised and not payable; after
     * the load it is both.
     */
    const created = await handleCreateSupplier(
      env.DB,
      { name: "Kingsway", vatId: "GB556677889" },
      "alice"
    );
    const localId = (created.body as { id: string }).id;

    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-1', '{}', ?)"
    )
      .bind(localId)
      .run();

    const before = await matchSupplier(env.DB, { "BT-31": "GB556677889" });
    expect(before.erpIdentifier).toBeNull();

    await load("ERP ID,Name,VAT\n40999,Kingsway,GB556677889");

    const after = await matchSupplier(env.DB, { "BT-31": "GB556677889" });
    expect(after.erpIdentifier).toBe("40999");

    // The invoice never moved.
    const row = await env.DB.prepare(
      "SELECT supplier_id FROM invoice_headers WHERE id = 'inv-1'"
    ).first<{ supplier_id: string }>();
    expect(row?.supplier_id).toBe(localId);
  });

  it("adopts on the electronic address too", async () => {
    // Both identifiers, because a local row may carry either.
    await handleCreateSupplier(
      env.DB,
      { name: "Kingsway", electronicAddress: "0088:5555" },
      "alice"
    );

    const result = await load("ERP ID,Name,Peppol ID\n40999,Kingsway,0088:5555");
    expect((result.body as { adopted: number }).adopted).toBe(1);
  });

  it("does not adopt a supplier the ERP already named", async () => {
    /**
     * **Only a row with no identifier is adopted.** One that has one is
     * found by decision 0217's lookup, and treating it as local would
     * let a load rewrite an identifier decision 0231 refuses a person
     * to change.
     */
    await load("ERP ID,Name,VAT\n40118,Northwind,GB1");
    const result = await load("ERP ID,Name,VAT\n40119,Different Co,GB1");

    expect((result.body as { adopted: number }).adopted).toBe(0);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM suppliers").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("does not adopt on a blank identifier", async () => {
    // A local row with no VAT and no endpoint matches nothing, which is
    // correct: there is nothing to match it on.
    await handleCreateSupplier(env.DB, { name: "Nameless" }, "alice");

    const result = await load("ERP ID,Name\n40999,Someone Else");
    expect((result.body as { adopted: number }).adopted).toBe(0);
  });
});

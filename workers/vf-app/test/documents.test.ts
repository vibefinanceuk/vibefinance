import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleListDocuments } from "../src/documents-route.js";
import { mondayOfThisWeek } from "../src/dates.js";

/**
 * Every document that has arrived — decision 0164.
 *
 * **Every way into a document was a task.** An invoice that went
 * straight through has none, so it was invisible: correctly processed
 * and unreachable.
 */

async function seedProcess() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  for (const [id, name, seq] of [
    ["validation", "Validation", 1],
    ["payment", "Payment-eligible", 2],
  ] as [string, string, number][]) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap', ?, ?)"
    )
      .bind(id, name, seq)
      .run();
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
}

async function seedDocument(
  id: string,
  facts: Record<string, unknown>,
  stage: string | null = "validation",
  createdAt?: string
) {
  /**
   * **The structured columns, derived the same way `handleUpsertInvoice`
   * derives them — decision 0448.** A real row always carries
   * `invoice_number`/`total_with_vat` alongside `facts_json`, kept in
   * lockstep with it (`mergeStructuredInvoiceFacts()`'s own comment in
   * `invoice-facts-route.ts` states the invariant directly). This
   * fixture only ever wrote `facts_json` — already one step removed
   * from a real row — and now that `documentSearchPattern()` in
   * `documents-route.ts` searches these columns directly rather than
   * `facts_json` itself, it would be a *wrong* step: every test seeding
   * a `BT-1`/`BT-112` fact gets the matching real column for free, the
   * same as a genuine invoice would.
   */
  const invoiceNumber = (facts["BT-1"] as string) ?? null;
  const totalWithVat = (facts["BT-112"] as number) ?? null;

  if (createdAt) {
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, invoice_number, total_with_vat, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, JSON.stringify(facts), invoiceNumber, totalWithVat, createdAt)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json, invoice_number, total_with_vat) VALUES (?, ?, ?, ?)"
    )
      .bind(id, JSON.stringify(facts), invoiceNumber, totalWithVat)
      .run();
  }

  if (stage) {
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
       VALUES (?, 'ap', 'invoice', ?, ?)`
    )
      .bind(`pi-${id}`, id, stage)
      .run();
  }
}

async function list(params = "", visibleUnits: string[] | null = null, userId: string | null = null) {
  return (await handleListDocuments(env.DB, new URLSearchParams(params), visibleUnits, userId)).body as {
    documents: {
      id: string;
      number: string | null;
      supplier: string | null;
      sender: string | null;
      amount: number | null;
      currency: string | null;
      status: string;
      stageName: string | null;
      orgUnitId: string | null;
      orgUnitName: string | null;
      hands: number;
    }[];
    searched: number;
    // Only present when `page`/`pageSize` was sent — decision 0448.
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

beforeEach(async () => {
  await applyTestSchema();
  await seedProcess();
});

describe("what the list shows", () => {
  it("shows a document nobody has a task for", async () => {
    // **The whole point.** A straight-through invoice has no task, so
    // it was unreachable before this.
    await seedDocument("inv-1", { "BT-1": "MCD2001321-010", "BT-112": 251.88, "BT-5": "GBP" }, "payment");

    const body = await list();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].number).toBe("MCD2001321-010");
  });

  it("counts how many people touched it", async () => {
    // *"Straight through"* is the product's own claim, and nothing
    // anywhere counted it.
    await seedDocument("inv-1", { "BT-1": "A" }, "payment");
    expect((await list()).documents[0].hands).toBe(0);
  });

  it("names the stage it is at", async () => {
    await seedDocument("inv-1", { "BT-1": "A" }, "validation");
    expect((await list()).documents[0].stageName).toBe("Validation");
  });

  it("shows an invoice that never entered a process", async () => {
    // An inline test document, or one captured outside a process
    // (decision 0071). It exists, so it is listed.
    await seedDocument("inv-loose", { "BT-1": "A" }, null);
    const body = await list();
    expect(body.documents[0].status).toBe("outside");
    expect(body.documents[0].stageName).toBeNull();
  });

  /**
   * **`returned_manually` and `archived` — decision 0501.** Reported
   * live: "I placed the Return to Supplier button... the item...
   * appears to still be in the matching Matching stage." Both statuses
   * predate this fix at the data layer (decision 0055/0498) — only
   * `statusOf()` itself, which predates both by many decisions, had
   * never been taught them, so a returned or archived instance fell
   * through to "waiting"/"moving" exactly as though nothing had
   * happened. `current_stage_id` is deliberately left set to wherever
   * the instance was returned from (0055's own design), so the stage
   * name still shows — only the status itself needed to stop lying
   * about what that stage name means.
   */
  it("says 'returned' for an instance sent back to its supplier, not 'waiting' or 'moving'", async () => {
    await seedDocument("inv-1", { "BT-1": "A" }, "validation");
    await env.DB.prepare("UPDATE process_instances SET status = 'returned_manually' WHERE id = 'pi-inv-1'").run();

    const doc = (await list()).documents[0];
    expect(doc.status).toBe("returned");
    // Still names the stage it was returned from — decision 0055's own
    // "instance status, not process structure," unchanged by this fix.
    expect(doc.stageName).toBe("Validation");
  });

  it("says 'archived' for an instance nobody needs to look at again", async () => {
    await seedDocument("inv-1", { "BT-1": "A" }, "validation");
    await env.DB.prepare("UPDATE process_instances SET status = 'archived' WHERE id = 'pi-inv-1'").run();

    expect((await list()).documents[0].status).toBe("archived");
  });

  it("still calls a genuinely completed instance 'done', not 'returned' or 'archived'", async () => {
    // The one existing terminal status this fix must leave alone —
    // checked directly, not assumed.
    await seedDocument("inv-1", { "BT-1": "A" }, "payment");
    await env.DB.prepare("UPDATE process_instances SET status = 'completed' WHERE id = 'pi-inv-1'").run();

    expect((await list()).documents[0].status).toBe("done");
  });
});

describe("'since', decision 0430's second addendum", () => {
  /**
   * No screen sends this yet — added for the AP Assistant's own
   * `invoice_search` tool answering "received this month." Tested
   * here directly, at the route it actually lives in, not only
   * indirectly through the assistant.
   */
  it("excludes a document received before the given date", async () => {
    await seedDocument("old", { "BT-1": "OLD" }, "validation", "2020-01-01T00:00:00Z");
    await seedDocument("new", { "BT-1": "NEW" }, "validation", "2020-06-01T00:00:00Z");

    const body = await list("since=2020-03-01");
    expect(body.documents.map((d) => d.number)).toEqual(["NEW"]);
  });

  it("is inert when absent, same as every other optional filter here", async () => {
    await seedDocument("old", { "BT-1": "OLD" }, "validation", "2020-01-01T00:00:00Z");
    await seedDocument("new", { "BT-1": "NEW" }, "validation", "2020-06-01T00:00:00Z");

    const body = await list();
    expect(body.documents).toHaveLength(2);
  });
});

describe("a document nothing could read", () => {
  it("is called out rather than shown as blank", async () => {
    // **Four empty cells say nothing.** Decision 0161 stores what was
    // tried; this reports the consequence.
    await seedDocument("inv-bad", {
      "intake.structure": "",
      "intake.attempted": "pdf_header,embedded_invoice_xml",
    });

    const body = await list();
    expect(body.documents[0].status).toBe("unreadable");
    expect(body.documents[0].number).toBeNull();
  });
});

describe("searching — real SQL now, decision 0448", () => {
  it("finds by supplier", async () => {
    await seedDocument("inv-1", { "BT-27": "Nordwind Logistik", "BT-1": "NL-1" });
    await seedDocument("inv-2", { "BT-27": "Munch GmbH", "BT-1": "MG-1" });

    const body = await list("q=nordwind");
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].supplier).toBe("Nordwind Logistik");
  });

  it("finds by document number", async () => {
    await seedDocument("inv-1", { "BT-1": "MCD2001321-010" });
    await seedDocument("inv-2", { "BT-1": "NL-88213" });

    expect((await list("q=88213")).documents).toHaveLength(1);
  });

  it("finds by amount", async () => {
    // **A person types what they remember**, and an amount is often
    // the only thing they do.
    await seedDocument("inv-1", { "BT-1": "A", "BT-112": 251.88 });
    await seedDocument("inv-2", { "BT-1": "B", "BT-112": 900 });

    expect((await list("q=251.88")).documents).toHaveLength(1);
  });

  it("finds a whole-number amount too, despite SQLite's own text form of a REAL carrying a trailing .0", async () => {
    await seedDocument("inv-1", { "BT-1": "A", "BT-112": 900 });
    expect((await list("q=900")).documents).toHaveLength(1);
  });

  it("finds by sender, a real joined column that was never in facts_json at all", async () => {
    await seedDocument("inv-1", { "BT-1": "A" });
    await env.DB.prepare(
      `INSERT INTO inbound_email_events (id, source_id, sender, recipient, outcome, occurred_at)
       VALUES ('ev-1', NULL, 'ap@nordwind.example', 'invoices@vibefinance.example', 'captured', datetime('now'))`
    ).run();
    // seedDocument() defaults created_at to now, so the email's own
    // occurred_at (also now) satisfies the `<=` join this route's own
    // sender/recipient subquery uses.
    expect((await list("q=nordwind")).documents[0]?.sender).toBe("ap@nordwind.example");
  });

  it("ignores case", async () => {
    await seedDocument("inv-1", { "BT-27": "Nordwind Logistik", "BT-1": "A" });
    expect((await list("q=NORDWIND")).documents).toHaveLength(1);
  });

  it("escapes a literal % or _ in the term rather than treating it as a SQL wildcard", async () => {
    await seedDocument("inv-1", { "BT-1": "INV_100%" });
    await seedDocument("inv-2", { "BT-1": "INVX100Y" });

    // A literal search for "_100%" must not also match "X100Y" — which
    // an unescaped LIKE pattern (`%_100%%`) would, since `_` and `%`
    // are themselves SQL wildcards there.
    expect((await list("q=_100%")).documents.map((d) => d.number)).toEqual(["INV_100%"]);
  });

  it("finds a match beyond the old load window — the actual bug this decision fixes", async () => {
    // **The point of pushing search into SQL.** The old behaviour
    // loaded only `limit` (default 50) most-recent rows and filtered
    // those in the Worker — a matching document older than the most
    // recent 50 was invisible to search, not merely on a later page.
    // Fifty-one rows here, the oldest one the only match: the old code
    // would never have seen it at all.
    for (let i = 0; i < 50; i++) {
      await seedDocument(`inv-recent-${i}`, { "BT-1": `RECENT-${i}` }, "validation", "2024-06-01T00:00:00Z");
    }
    await seedDocument("inv-old", { "BT-1": "FINDME" }, "validation", "2020-01-01T00:00:00Z");

    const body = await list("q=findme");
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].number).toBe("FINDME");
  });

  it("says how many matched, now that it means the same thing as how many were found", async () => {
    // **The field's own meaning changed, not just its number** — see
    // `documents-route.ts`'s own comment on `searched` in the return.
    // It used to report "how many were loaded before filtering," an
    // honest admission the search might have missed something past the
    // load window. Now the search runs inside the same query the load
    // window comes from, so there is no window it could miss within.
    await seedDocument("inv-1", { "BT-27": "Nordwind", "BT-1": "A" });
    await seedDocument("inv-2", { "BT-27": "Munch", "BT-1": "B" });

    const body = await list("q=nordwind");
    expect(body.documents).toHaveLength(1);
    expect(body.searched).toBe(1);
  });

  it("returns nothing rather than everything when nothing matches", async () => {
    await seedDocument("inv-1", { "BT-27": "Nordwind", "BT-1": "A" });
    expect((await list("q=zzzz")).documents).toHaveLength(0);
  });

  it("composes with the org focus — a match outside the focused org's own visible units stays hidden", async () => {
    // **The operator's own requirement, checked directly**: search
    // must stay inside the org currently in focus, not run against
    // everything and merely label the result. `visibleUnits` here is
    // exactly what `scopedToChosenOrg()`/`unitsWherePermitted()` would
    // have already narrowed to before this route is ever called
    // (`index.ts`'s own wiring) — this route must never widen it back
    // out just because a search term was also given.
    await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme Deutschland', 'legal_entity')").run();
    await seedDocument("inv-fr", { "BT-1": "FINDME-FR" });
    await seedDocument("inv-de", { "BT-1": "FINDME-DE" });
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-de' WHERE id = 'inv-de'").run();

    const body = await list("q=findme", ["acme-fr"]);
    expect(body.documents.map((d) => d.number)).toEqual(["FINDME-FR"]);
  });
});

describe("real, server-side pagination — decision 0448", () => {
  async function seedMany(n: number) {
    for (let i = 0; i < n; i++) {
      await seedDocument(`inv-${i}`, { "BT-1": `INV-${String(i).padStart(3, "0")}` }, "validation", `2024-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`);
    }
  }

  it("total/page/pageSize are absent unless page or pageSize was actually sent", async () => {
    await seedDocument("inv-1", { "BT-1": "A" });
    const body = await list();
    expect(body.total).toBeUndefined();
    expect(body.page).toBeUndefined();
    expect(body.pageSize).toBeUndefined();
  });

  it("total reflects every matching row, not just the page returned", async () => {
    await seedMany(60);
    const body = await list("page=1&pageSize=25");
    expect(body.documents).toHaveLength(25);
    expect(body.total).toBe(60);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
  });

  it("page 2 returns a disjoint set from page 1", async () => {
    await seedMany(60);
    const page1 = (await list("page=1&pageSize=25")).documents.map((d) => d.id);
    const page2 = (await list("page=2&pageSize=25")).documents.map((d) => d.id);
    expect(page1).toHaveLength(25);
    expect(page2).toHaveLength(25);
    expect(page1.some((id) => page2.includes(id))).toBe(false);
  });

  it("a real, partial last page", async () => {
    await seedMany(60);
    const body = await list("page=3&pageSize=25");
    expect(body.documents).toHaveLength(10);
    expect(body.total).toBe(60);
  });

  it("normalizes a bad page number back to 1", async () => {
    await seedMany(5);
    const body = await list("page=notanumber&pageSize=25");
    expect(body.page).toBe(1);
  });

  it("normalizes an unlisted page size back to the default", async () => {
    await seedMany(5);
    const body = await list("page=1&pageSize=17");
    expect(body.pageSize).toBe(50);
  });

  it("every allowed page size is honoured", async () => {
    await seedMany(60);
    for (const size of [25, 50, 100, 200]) {
      const body = await list(`page=1&pageSize=${size}`);
      expect(body.pageSize).toBe(size);
      expect(body.documents.length).toBeLessThanOrEqual(size);
    }
  });

  it("total narrows with a search term, same as the page itself", async () => {
    await seedMany(10);
    await seedDocument("inv-findme", { "BT-1": "FINDME" });
    const body = await list("q=findme&page=1&pageSize=25");
    expect(body.total).toBe(1);
    expect(body.documents).toHaveLength(1);
  });
});

describe("what a document with unparseable facts does", () => {
  it("appears, rather than breaking the list", async () => {
    // One bad row must not lose the others.
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-bad', 'not json')"
    ).run();
    await seedDocument("inv-ok", { "BT-1": "A" });

    expect((await list()).documents).toHaveLength(2);
  });
});

describe("which part of the business a document belongs to (decision 0193)", () => {
  /**
   * **`invoice_headers.org_unit_id` has existed since decision 0036 and
   * no screen has ever shown it.** A customer with France, Germany and
   * UK sees one undifferentiated list and cannot tell which invoices
   * are theirs to care about.
   *
   * Shown, not enforced: a label to read and filter by, **not a
   * boundary**. Decision 0192 records what making it one would take.
   */
  async function seedUnits() {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-fr', 'AP France', 'operating_unit', 'acme-fr')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme Deutschland', 'legal_entity')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-de', 'AP Deutschland', 'operating_unit', 'acme-de')"
    ).run();
  }

  async function assign(invoiceId: string, unitId: string) {
    await env.DB.prepare(
      // **How it was assigned, not who** -- 'rule', 'source' or
      // 'manual'. A source carrying a default unit is the usual route.
      "UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'source' WHERE id = ?"
    )
      .bind(unitId, invoiceId)
      .run();
  }

  it("names the unit, not just its identifier", async () => {
    // An identifier tells a person nothing; a name is what they know
    // the part of the business by.
    await seedUnits();
    await seedDocument("inv-1", { "BT-1": "FR-1" });
    await assign("inv-1", "ap-fr");

    expect((await list()).documents[0].orgUnitName).toBe("AP France");
  });

  it("says nothing where an invoice has not been assigned", async () => {
    // Most of them. Null means unassigned, which is a fact about the
    // document rather than a gap in the answer.
    await seedUnits();
    await seedDocument("inv-1", { "BT-1": "FR-1" });

    const doc = (await list()).documents[0];
    expect(doc.orgUnitId).toBeNull();
    expect(doc.orgUnitName).toBeNull();
  });

  it("narrows to one unit when asked", async () => {
    await seedUnits();
    await seedDocument("inv-fr", { "BT-1": "FR-1" });
    await seedDocument("inv-de", { "BT-1": "DE-1" });
    await assign("inv-fr", "ap-fr");
    await assign("inv-de", "ap-de");

    const body = await list("unit=ap-fr");
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].number).toBe("FR-1");
  });

  it("shows everything when no unit is asked for", async () => {
    // **Not a boundary.** Everybody still sees everything, and decision
    // 0192 records what changing that would take.
    await seedUnits();
    await seedDocument("inv-fr", { "BT-1": "FR-1" });
    await seedDocument("inv-de", { "BT-1": "DE-1" });
    await assign("inv-fr", "ap-fr");
    await assign("inv-de", "ap-de");

    expect((await list()).documents).toHaveLength(2);
  });

  it("narrows in the query, not after loading", async () => {
    // **The difference matters at scale**: a person asking for France
    // gets France's most recent, not France's share of everybody's most
    // recent.
    await seedUnits();
    for (let i = 0; i < 5; i++) {
      await seedDocument(`inv-de-${i}`, { "BT-1": `DE-${i}` });
      await assign(`inv-de-${i}`, "ap-de");
    }
    await seedDocument("inv-fr", { "BT-1": "FR-1" });
    await assign("inv-fr", "ap-fr");

    const body = await list("unit=ap-fr&limit=2");
    expect(body.documents).toHaveLength(1);
    expect(body.searched).toBe(1);
  });
});

describe("linking a dashboard alert to the documents it names (decision 0259)", () => {
  /**
   * **The operator asked each \"needs somebody\" fact for its own card,
   * with a link to the documents behind it.** A combined count could
   * never honestly link anywhere; splitting it is what makes a link
   * possible at all.
   *
   * `unplacedDocuments()` in `dashboard-route.ts` counts with no scope
   * clause at all, because decision 0255 made a null-unit document
   * visible to everyone. Wiring its click through to this list without
   * checking would have reproduced exactly that bug one layer over: the
   * card's count built from an unscoped query, landing on a list this
   * route's own decision 0199 scopes the opposite way.
   */
  async function listAs(visibleUnits: string[] | null, params = "") {
    return (await handleListDocuments(env.DB, new URLSearchParams(params), visibleUnits)).body as {
      documents: { id: string; orgUnitId: string | null }[];
      searched: number;
    };
  }

  describe("unplaced=1", () => {
    it("shows an unplaced document to somebody scoped to a unit", async () => {
      /**
       * **The load-bearing case.** Decision 0199 hides a null-unit
       * document from anyone restricted, because it might belong to a
       * region they cannot see. That policy is right for ordinary
       * browsing and wrong here: the dashboard already told this exact
       * person there is one unplaced document, and the click has to
       * agree.
       */
      await seedDocument("inv-unplaced", { "BT-1": "UNPLACED-1" }, null);
      await env.DB.prepare(
        `UPDATE invoice_headers
         SET facts_json = json_set(facts_json, '$."org.unplaced"', 'no_match')
         WHERE id = 'inv-unplaced'`
      ).run();

      const body = await listAs(["some-other-unit"], "unplaced=1");
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0].id).toBe("inv-unplaced");
    });

    it("still excludes a document that does have a unit", async () => {
      // The filter's whole job — only the ones genuinely unplaced.
      await env.DB.prepare(
        "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
      ).run();
      await seedDocument("inv-placed", { "BT-1": "PLACED-1" }, null);
      await env.DB.prepare(
        "UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-placed'"
      ).run();
      await seedDocument("inv-unplaced", { "BT-1": "UNPLACED-1" }, null);
      await env.DB.prepare(
        `UPDATE invoice_headers
         SET facts_json = json_set(facts_json, '$."org.unplaced"', 'no_match')
         WHERE id = 'inv-unplaced'`
      ).run();

      const body = await listAs(null, "unplaced=1");
      expect(body.documents.map((d) => d.id)).toEqual(["inv-unplaced"]);
    });

    it("shows nothing when there is nothing unplaced", async () => {
      await seedDocument("inv-1", { "BT-1": "ORDINARY-1" });
      expect((await listAs(null, "unplaced=1")).documents).toHaveLength(0);
    });
  });

  describe("duplicates=1", () => {
    /**
     * **Writes the real column, not the stored-`facts_json` key —
     * decision 0411.** This test used to `json_set` a key,
     * `"invoice.duplicate_confidence"`, that the real write path
     * (`handleUpsertInvoice()`, `invoice-facts-route.ts`) never
     * actually puts into stored `facts_json` — so it was exercising a
     * shape of data that could never occur outside the test itself,
     * and never would have caught the query reading the wrong place.
     * Decision 0410 found and fixed the identical mistake on the
     * dashboard tile's own count; this route had the same bug in its
     * own click-through, still present after that fix because 0410
     * never touched this file. Seeding `duplicate_confidence` directly
     * is what the real column actually holds.
     */
    async function seedDuplicate(id: string, confidence: number) {
      await seedDocument(id, { "BT-1": id });
      await env.DB.prepare(`UPDATE invoice_headers SET duplicate_confidence = ? WHERE id = ?`)
        .bind(confidence, id)
        .run();
    }

    it("shows only invoices at or above the suspicion threshold", async () => {
      await seedDuplicate("inv-suspect", 0.82);
      await seedDuplicate("inv-fine", 0.1);

      const body = await listAs(null, "duplicates=1");
      expect(body.documents.map((d) => d.id)).toEqual(["inv-suspect"]);
    });

    it("respects the ordinary unit scope, unlike unplaced", async () => {
      /**
       * **Deliberately the opposite of the unplaced carve-out.** A
       * duplicate suspicion has a real unit — decision 0239's
       * `possibleDuplicates()` scopes it normally — so there is no
       * disclosure problem to work around, and a scoped person should
       * see only their own region's duplicates, same as any other
       * document.
       */
      await env.DB.prepare(
        "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
      ).run();
      await env.DB.prepare(
        "INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme Deutschland', 'legal_entity')"
      ).run();
      await seedDuplicate("inv-fr", 0.9);
      await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
      await seedDuplicate("inv-de", 0.9);
      await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-de' WHERE id = 'inv-de'").run();

      const body = await listAs(["acme-fr"], "duplicates=1");
      expect(body.documents.map((d) => d.id)).toEqual(["inv-fr"]);
    });
  });

  it("leaves the ordinary list unchanged when neither flag is set", async () => {
    // A regression guard on the two new bind parameters: present and
    // inert unless asked for.
    await seedDocument("inv-1", { "BT-1": "ORDINARY-1" });
    expect((await listAs(null, "")).documents).toHaveLength(1);
  });
});


describe("the ordinary screen, with an empty unit exactly as the frontend sends it (decision 0260)", () => {
  /**
   * **Reported live: the Documents screen looked empty, and searching
   * found nothing.**
   *
   * `documents.js` builds its request with `new URLSearchParams({ q:
   * query, unit })`, which includes `unit` even when it is `""` —
   * unlike every existing test here, which built its request from a
   * query *string* via `new URLSearchParams("")`, omitting the key
   * entirely and getting a real `null`. The two constructions are not
   * the same request, and the difference is exactly where this hid.
   *
   * This test builds the request the way the real screen actually
   * does, not the way it was convenient to write for.
   */
  it("shows documents when the frontend's real, empty unit param arrives", async () => {
    await seedDocument("inv-1", { "BT-1": "ORDINARY-1" });

    const asTheScreenSendsIt = new URLSearchParams({ q: "", unit: "" });
    const body = (await handleListDocuments(env.DB, asTheScreenSendsIt)).body as {
      documents: { id: string }[];
    };

    expect(body.documents).toHaveLength(1);
  });

  it("still narrows correctly when a real unit is chosen", async () => {
    // The fix must not break the case it was not breaking.
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await seedDocument("inv-fr", { "BT-1": "FR-1" });
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
    await seedDocument("inv-none", { "BT-1": "NONE-1" });

    const params = new URLSearchParams({ q: "", unit: "acme-fr" });
    const body = (await handleListDocuments(env.DB, params)).body as { documents: { id: string }[] };
    expect(body.documents.map((d) => d.id)).toEqual(["inv-fr"]);
  });
});

describe("filtering documents by stage, for the dashboard's own donut (decision 0264)", () => {
  /**
   * **Must match `whereThingsAre()`'s exact scope** — process instances
   * at a stage with `status = 'in_progress'`, one per document. A
   * looser filter here would show more documents than the card counted
   * at that stage; a tighter one would show fewer — either way the
   * click and the count would disagree, which is the fault decisions
   * 0252 through 0260 kept finding in other pairs of screens.
   */
  async function seedAt(id: string, stage: string, status = "in_progress") {
    await seedDocument(id, { "BT-1": id }, null);
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES (?, 'ap', 'invoice', ?, ?, ?)`
    )
      .bind(`pi-${id}`, id, stage, status)
      .run();
  }

  it("shows the documents at a chosen stage, and none at another", async () => {
    await seedAt("inv-val", "validation");
    await seedAt("inv-app", "payment");

    const body = await list("stage=validation");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-val"]);
  });

  it("excludes an instance that has finished, even if it ended at that stage", async () => {
    /**
     * **The load-bearing case.** `whereThingsAre()` only counts
     * `status = 'in_progress'`; a completed instance whose
     * `current_stage_id` still names its last stage must not appear
     * here, or the list would show a document the card never counted.
     */
    await seedAt("inv-done", "validation", "completed");
    await seedAt("inv-live", "validation", "in_progress");

    const body = await list("stage=validation");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-live"]);
  });

  it("still applies the ordinary unit scope alongside a stage", async () => {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await seedAt("inv-fr", "validation");
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
    await seedAt("inv-none", "validation");

    const scoped = await list("stage=validation", ["acme-fr"]);
    expect(scoped.documents.map((d) => d.id)).toEqual(["inv-fr"]);
  });

  it("leaves the ordinary list unaffected when no stage is asked for", async () => {
    await seedAt("inv-1", "validation");
    expect((await list("")).documents).toHaveLength(1);
  });
});

describe("'stageIds', decision 0430's fifth addendum — several real stage ids at once", () => {
  /**
   * A second, additive filter alongside `stage` above, for the AP
   * Assistant's own `invoice_search` tool: a person names a stage by
   * its own *name* ("Validation"), and `process_stages` is customer-
   * configurable, so the same name can resolve to more than one real
   * id across different processes — `ap-assistant.ts`'s own job to
   * resolve that, this route's own job only to filter by whatever ids
   * it is handed. `stage` above stays untouched, a single id, exactly
   * as the real Documents screen has always sent.
   */
  async function seedAt(id: string, stage: string, status = "in_progress") {
    await seedDocument(id, { "BT-1": id }, null);
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES (?, 'ap', 'invoice', ?, ?, ?)`
    )
      .bind(`pi-${id}`, id, stage, status)
      .run();
  }

  it("shows documents at any of several stage ids, and none at another", async () => {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('other', 'ap', 'Other', 3)").run();
    await seedAt("inv-val", "validation");
    await seedAt("inv-pay", "payment");
    await seedAt("inv-neither", "other");

    const body = await list(`stageIds=${encodeURIComponent(JSON.stringify(["validation", "payment"]))}`);
    expect(body.documents.map((d) => d.id).sort()).toEqual(["inv-pay", "inv-val"]);
  });

  it("excludes an instance that has finished, the same as the single-id 'stage' filter", async () => {
    await seedAt("inv-done", "validation", "completed");
    await seedAt("inv-live", "validation", "in_progress");

    const body = await list(`stageIds=${encodeURIComponent(JSON.stringify(["validation"]))}`);
    expect(body.documents.map((d) => d.id)).toEqual(["inv-live"]);
  });

  it("leaves the ordinary list, and the single-id 'stage' filter, unaffected when absent", async () => {
    await seedAt("inv-1", "validation");
    expect((await list("")).documents).toHaveLength(1);
    expect((await list("stage=validation")).documents).toHaveLength(1);
  });
});

describe("filtering documents by what I completed this week (decision 0265)", () => {
  /**
   * **Must match `done()`'s exact scope** — `completed_by = me`, on or
   * after the Monday of the current calendar week. A looser or
   * tighter filter here and the dashboard's own total would disagree
   * with what a click on it shows, the same fault decisions 0252
   * through 0264 kept finding in other pairs of screens.
   */
  async function completedByOnDayOfWeek(
    docId: string,
    completedBy: string,
    offsetFromMonday: number
  ) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES (?, ?, ?)"
    )
      .bind(completedBy, `${completedBy}@acme.com`, completedBy)
      .run();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(docId).run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')`
    )
      .bind(`pi-${docId}`, docId)
      .run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'validation', 'matched')"
    )
      .bind(`v-${docId}`, `pi-${docId}`)
      .run();

    const monday = mondayOfThisWeek();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status, completed_by, completed_at)
       VALUES (?, 'validation', ?, 'AP.Validate', 'completed', ?, datetime(?, ?))`
    )
      .bind(`t-${docId}`, `v-${docId}`, completedBy, monday, `+${offsetFromMonday} days`)
      .run();
  }

  it("shows a document I completed this week", async () => {
    await completedByOnDayOfWeek("inv-1", "alice", 2);

    const body = await list("doneByMe=1", null, "alice");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-1"]);
  });

  it("excludes a document someone else completed", async () => {
    await completedByOnDayOfWeek("inv-1", "mo", 2);

    const body = await list("doneByMe=1", null, "alice");
    expect(body.documents).toHaveLength(0);
  });

  it("excludes a document I completed last week", async () => {
    /**
     * **The load-bearing case for the week boundary.** `-1` is the
     * Sunday just before this week's Monday — the last day of the
     * previous calendar week, not this one.
     */
    await completedByOnDayOfWeek("inv-1", "alice", -1);

    const body = await list("doneByMe=1", null, "alice");
    expect(body.documents).toHaveLength(0);
  });

  it("leaves the ordinary list unaffected when the filter is not asked for", async () => {
    await completedByOnDayOfWeek("inv-1", "alice", 2);
    expect((await list("", null, "alice")).documents).toHaveLength(1);
  });

  it("is inert without a real userId, even if the flag is set", async () => {
    // The route accepts userId as optional; a caller that forgets it
    // must not accidentally match everyone's completions.
    await completedByOnDayOfWeek("inv-1", "alice", 2);
    expect((await list("doneByMe=1")).documents).toHaveLength(0);
  });
});

describe("filtering documents by a supplier's own recent exceptions (decision 0411)", () => {
  /**
   * **Must match `exceptionsBySupplier()`'s exact definition** —
   * `stage_visits.validation_passed = 0` within the last 30 days,
   * grouped by `COALESCE(sup.name, BT-27, 'Unknown')`. A looser or
   * tighter filter here and the dashboard's own bar would disagree
   * with what a click on it shows — the same fault decisions 0252
   * through 0265 kept finding in other pairs of screens.
   */
  async function seedException(
    id: string,
    facts: Record<string, unknown>,
    opts: { daysAgo?: number; passed?: 0 | 1 } = {}
  ) {
    await seedDocument(id, facts, "validation");
    const passed = opts.passed ?? 0;
    await env.DB.prepare(
      `INSERT INTO stage_visits
         (id, process_instance_id, stage_id, outcome, validation_passed, validation_checked, validation_failures, created_at)
       VALUES (?, ?, 'validation', 'held', ?, 'some_check', ?, datetime('now', ?))`
    )
      .bind(`v-${id}`, `pi-${id}`, passed, passed === 1 ? "" : "some_check", `-${opts.daysAgo ?? 1} days`)
      .run();
  }

  async function seedSupplier(id: string, name: string) {
    await env.DB.prepare(
      `INSERT INTO suppliers (id, erp_identifier, name, status) VALUES (?, NULL, ?, 'active')`
    )
      .bind(id, name)
      .run();
  }

  it("shows a supplier's own recent, failed-validation document", async () => {
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind Logistics" });

    const body = await list("exceptionSupplier=" + encodeURIComponent("Northwind Logistics"));
    expect(body.documents.map((d) => d.id)).toEqual(["inv-1"]);
  });

  it("matches on the supplier's own master record name, not just the free-text field", async () => {
    await seedSupplier("s-1", "Northwind Logistics Ltd");
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind (as typed on the invoice)" });
    await env.DB.prepare("UPDATE invoice_headers SET supplier_id = 's-1' WHERE id = 'inv-1'").run();

    const body = await list("exceptionSupplier=" + encodeURIComponent("Northwind Logistics Ltd"));
    expect(body.documents.map((d) => d.id)).toEqual(["inv-1"]);
  });

  it("matches 'Unknown' the same way the card's own label does, for a document naming no supplier", async () => {
    await seedException("inv-1", { "BT-1": "inv-1" });

    const body = await list("exceptionSupplier=Unknown");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-1"]);
  });

  it("excludes a document whose validation actually passed", async () => {
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind Logistics" }, { passed: 1 });

    const body = await list("exceptionSupplier=" + encodeURIComponent("Northwind Logistics"));
    expect(body.documents).toHaveLength(0);
  });

  it("excludes a failure older than 30 days", async () => {
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind Logistics" }, { daysAgo: 40 });

    const body = await list("exceptionSupplier=" + encodeURIComponent("Northwind Logistics"));
    expect(body.documents).toHaveLength(0);
  });

  it("excludes a different supplier's own exception", async () => {
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind Logistics" });

    const body = await list("exceptionSupplier=" + encodeURIComponent("A Different Supplier"));
    expect(body.documents).toHaveLength(0);
  });

  it("still applies the ordinary unit scope alongside a supplier", async () => {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await seedException("inv-fr", { "BT-1": "inv-fr", "BT-27": "Northwind Logistics" });
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
    await seedException("inv-none", { "BT-1": "inv-none", "BT-27": "Northwind Logistics" });

    const scoped = await list(
      "exceptionSupplier=" + encodeURIComponent("Northwind Logistics"),
      ["acme-fr"]
    );
    expect(scoped.documents.map((d) => d.id)).toEqual(["inv-fr"]);
  });

  it("leaves the ordinary list unaffected when no supplier is asked for", async () => {
    await seedException("inv-1", { "BT-1": "inv-1", "BT-27": "Northwind Logistics" });
    expect((await list("")).documents).toHaveLength(1);
  });
});

describe("filtering documents by an aging bucket's own open work (decision 0411)", () => {
  /**
   * **Must match `ageing()`'s exact definition** — an open task whose
   * `created_at` falls in the given day range. `agingMinDays`/
   * `agingMaxDays` are the same two numbers `ageing()`
   * (`dashboard-route.ts`) already computed for the bucket being
   * clicked, never a boundary this route decides on its own.
   */
  async function seedOpenTask(id: string, daysOld: number) {
    await seedDocument(id, { "BT-1": id }, "validation");
    await env.DB.prepare(
      `INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome)
       VALUES (?, ?, 'validation', 'held')`
    )
      .bind(`v-${id}`, `pi-${id}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status, created_at)
       VALUES (?, 'validation', ?, 'AP.Validate', 'open', datetime('now', ?))`
    )
      .bind(`t-${id}`, `v-${id}`, `-${daysOld} days`)
      .run();
  }

  it("shows a document whose open task falls inside the bucket", async () => {
    await seedOpenTask("inv-mid", 5);

    const body = await list("agingMinDays=4&agingMaxDays=8");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-mid"]);
  });

  it("excludes a document just outside the bucket's own boundary", async () => {
    await seedOpenTask("inv-young", 3);
    await seedOpenTask("inv-old", 8);

    const body = await list("agingMinDays=4&agingMaxDays=8");
    expect(body.documents).toHaveLength(0);
  });

  it("leaves the top bucket open-ended when no max is given", async () => {
    await seedOpenTask("inv-ancient", 90);

    const body = await list("agingMinDays=31");
    expect(body.documents.map((d) => d.id)).toEqual(["inv-ancient"]);
  });

  it("excludes a task that has already been completed", async () => {
    await seedOpenTask("inv-done", 40);
    await env.DB.prepare("UPDATE tasks SET status = 'completed' WHERE id = 't-inv-done'").run();

    const body = await list("agingMinDays=31");
    expect(body.documents).toHaveLength(0);
  });

  it("still applies the ordinary unit scope alongside an aging bucket", async () => {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await seedOpenTask("inv-fr", 40);
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'acme-fr' WHERE id = 'inv-fr'").run();
    await seedOpenTask("inv-none", 40);

    const scoped = await list("agingMinDays=31", ["acme-fr"]);
    expect(scoped.documents.map((d) => d.id)).toEqual(["inv-fr"]);
  });

  it("leaves the ordinary list unaffected when no aging bucket is asked for", async () => {
    await seedOpenTask("inv-1", 5);
    expect((await list("")).documents).toHaveLength(1);
  });
});

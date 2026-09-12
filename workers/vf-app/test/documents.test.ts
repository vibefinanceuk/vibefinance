import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleListDocuments } from "../src/documents-route.js";

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
  stage: string | null = "validation"
) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)")
    .bind(id, JSON.stringify(facts))
    .run();

  if (stage) {
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
       VALUES (?, 'ap', 'invoice', ?, ?)`
    )
      .bind(`pi-${id}`, id, stage)
      .run();
  }
}

async function list(params = "") {
  return (await handleListDocuments(env.DB, new URLSearchParams(params))).body as {
    documents: {
      id: string;
      number: string | null;
      supplier: string | null;
      amount: number | null;
      currency: string | null;
      status: string;
      stageName: string | null;
      orgUnitId: string | null;
      orgUnitName: string | null;
      hands: number;
    }[];
    searched: number;
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

describe("searching", () => {
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

  it("ignores case", async () => {
    await seedDocument("inv-1", { "BT-27": "Nordwind Logistik", "BT-1": "A" });
    expect((await list("q=NORDWIND")).documents).toHaveLength(1);
  });

  it("says how many it looked through", async () => {
    // **So the screen does not imply it searched everything**: the
    // facts live in a JSON blob, so this searches what was loaded.
    await seedDocument("inv-1", { "BT-27": "Nordwind", "BT-1": "A" });
    await seedDocument("inv-2", { "BT-27": "Munch", "BT-1": "B" });

    const body = await list("q=nordwind");
    expect(body.documents).toHaveLength(1);
    expect(body.searched).toBe(2);
  });

  it("returns nothing rather than everything when nothing matches", async () => {
    await seedDocument("inv-1", { "BT-27": "Nordwind", "BT-1": "A" });
    expect((await list("q=zzzz")).documents).toHaveLength(0);
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
    async function seedDuplicate(id: string, confidence: number) {
      await seedDocument(id, { "BT-1": id });
      await env.DB.prepare(
        `UPDATE invoice_headers
         SET facts_json = json_set(facts_json, '$."invoice.duplicate_confidence"', ?)
         WHERE id = ?`
      )
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

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

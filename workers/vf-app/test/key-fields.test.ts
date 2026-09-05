import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";

async function seedInvoice(id: string, facts: Record<string, unknown> = {}) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)")
    .bind(id, JSON.stringify(facts))
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan Y.')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sarah', 'sarah@acme.com', 'Sarah K.')").run();
});

describe("keying facts a document would not give up", () => {
  it("records the value, and merges rather than replacing what intake learned", async () => {
    // The Morrison case: captured with provenance and no invoice facts.
    await seedInvoice("inv-1", {
      "intake.structure": "",
      "intake.attempted": "pdf_header,embedded_invoice_xml",
    });

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 3137.47, "BT-1": "SKELS26003894" } },
      "u-dan"
    );
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{
      facts_json: string;
    }>();
    const facts = JSON.parse(row!.facts_json);
    expect(facts["BT-112"]).toBe(3137.47);
    // What intake learned survives. Trading one kind of provenance for
    // another would be a poor exchange.
    expect(facts["intake.attempted"]).toBe("pdf_header,embedded_invoice_xml");
  });

  it("allows partial keying", async () => {
    // Someone who can read the total but not the VAT breakdown should
    // be able to save what they have; validation then reports honestly
    // on what is missing.
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100 } }, "u-dan");
    expect(result.status).toBe(200);
  });

  it("refuses a field outside the closed vocabulary", async () => {
    // A value nobody can address is a value nobody can use — the exact
    // divergence that produced cost_centre and extraction.confidence.
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-999": "invented" } },
      "u-dan"
    );
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("BT-999");
  });

  it("refuses keying nothing at all", async () => {
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: {} }, "u-dan");
    expect(result.status).toBe(400);
  });

  it("refuses an empty value rather than recording a deletion as a creation", async () => {
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-1": "   " } }, "u-dan");
    expect(result.status).toBe(422);
    expect(String((result.body as { detail: string }).detail)).toContain("leave a field you cannot read unkeyed");
  });

  it("404s an invoice that does not exist", async () => {
    expect((await handleKeyInvoiceFields(env.DB, "nope", { facts: { "BT-1": "x" } }, "u-dan")).status).toBe(404);
  });
});

describe("who keyed a value", () => {
  it("records the caller against every field", async () => {
    await seedInvoice("inv-1");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100, "BT-1": "A" } }, "u-dan");

    const rows = await env.DB.prepare(
      "SELECT field, keyed_by FROM keyed_fields WHERE invoice_id = 'inv-1' ORDER BY field"
    ).all<{ field: string; keyed_by: string }>();
    expect(rows.results.map((r: { field: string }) => r.field)).toEqual(["BT-1", "BT-112"]);
    expect(rows.results.every((r: { keyed_by: string }) => r.keyed_by === "u-dan")).toBe(true);
  });

  it("ignores a spoofed identity in the request body, recording the real caller", async () => {
    // The discipline decision 0007 applies to rule approval, applied
    // here. Who keyed a value is the whole reason a keyed value is
    // worth anything.
    await seedInvoice("inv-1");
    await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 100 }, keyedBy: "u-sarah", userId: "u-sarah" } as never,
      "u-dan"
    );

    const row = await env.DB.prepare("SELECT keyed_by FROM keyed_fields WHERE invoice_id = 'inv-1'").first<{
      keyed_by: string;
    }>();
    expect(row?.keyed_by).toBe("u-dan");
  });
});

describe("keying a field extraction already produced", () => {
  it("records the previous value, and says the field was corrected", async () => {
    // Keying a field extraction never produced is the ordinary case.
    // CORRECTING one it produced wrongly is the consequential one, and
    // collapsing them would hide the second.
    await seedInvoice("inv-1", { "BT-112": 2272.47 });
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 3137.47 } }, "u-dan");

    const keyed = (result.body as { keyed: { previous: unknown; corrected: boolean }[] }).keyed[0];
    expect(keyed.previous).toBe(2272.47);
    expect(keyed.corrected).toBe(true);

    const row = await env.DB.prepare("SELECT previous_value FROM keyed_fields WHERE field = 'BT-112'").first<{
      previous_value: string;
    }>();
    expect(JSON.parse(row!.previous_value)).toBe(2272.47);
  });

  it("records no previous value for a field that had none", async () => {
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100 } }, "u-dan");
    expect((result.body as { keyed: { corrected: boolean }[] }).keyed[0].corrected).toBe(false);

    const row = await env.DB.prepare("SELECT previous_value FROM keyed_fields WHERE field = 'BT-112'").first<{
      previous_value: string | null;
    }>();
    expect(row?.previous_value).toBeNull();
  });
});

describe("provenance.keyed, as a fact a rule can test", () => {
  it("lists the keyed fields", async () => {
    await seedInvoice("inv-1");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100, "BT-1": "A" } }, "u-dan");

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{
      facts_json: string;
    }>();
    expect(JSON.parse(row!.facts_json)["provenance.keyed"]).toBe("BT-1,BT-112");
  });

  it("accumulates across sessions rather than erasing the earlier one", async () => {
    // A second person keying a different field must not erase the
    // record that the first keyed theirs.
    await seedInvoice("inv-1");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-1": "A" } }, "u-dan");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100 } }, "u-sarah");

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{
      facts_json: string;
    }>();
    expect(JSON.parse(row!.facts_json)["provenance.keyed"]).toBe("BT-1,BT-112");
  });

  it("does not duplicate a field keyed twice", async () => {
    await seedInvoice("inv-1");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100 } }, "u-dan");
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 200 } }, "u-sarah");

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{
      facts_json: string;
    }>();
    expect(JSON.parse(row!.facts_json)["provenance.keyed"]).toBe("BT-112");

    // Both keying events are still recorded, even though the fact lists
    // the field once.
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM keyed_fields WHERE invoice_id = 'inv-1'"
    ).first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});

describe("validation is reported after keying (decision 0072)", () => {
  it("says the document now passes once the totals agree", async () => {
    // The operator's actual question. Nothing else answers it: rules do
    // not re-evaluate after keying.
    await seedInvoice("inv-1", { "intake.structure": "" });
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-106": 1500, "BT-110": 285, "BT-112": 1785, "BT-115": 1785 } },
      "u-dan"
    );

    const v = (result.body as { validation: { passed: boolean; checked: string[] } }).validation;
    expect(v.passed).toBe(true);
    expect(v.checked).toContain("vat_arithmetic");
  });

  it("names the failure when the keyed totals do not agree", async () => {
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-106": 1500, "BT-110": 100, "BT-112": 1785 } },
      "u-dan"
    );
    const v = (result.body as { validation: { passed: boolean; failures: string[] } }).validation;
    expect(v.passed).toBe(false);
    expect(v.failures).toContain("vat_arithmetic");
  });

  it("marks the verdict advisory, because it is not recorded anywhere", async () => {
    // The authoritative verdict is written at the next stage visit,
    // under the channel's own tolerance.
    await seedInvoice("inv-1");
    const result = await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 100 } }, "u-dan");
    expect((result.body as { validation: { advisory: boolean } }).validation.advisory).toBe(true);
  });
});

describe("keying lines (decision 0109)", () => {
  /**
   * The route has always accepted `body.lines` and passed them to the
   * ordinary writer, so keyed lines were storable. **What was missing
   * is any record that a person typed them** — which left a typed line
   * amount indistinguishable from an extracted one.
   */
  async function withLines() {
    await seedInvoice("inv-lines", { "BT-112": 100 });
    for (const [n, description, amount] of [
      [1, "Support", 60],
      [2, "Training", 40],
    ] as [number, string, number][]) {
      await env.DB.prepare(
        "INSERT INTO invoice_lines (id, invoice_id, line_number, description, amount, facts_json) VALUES (?, 'inv-lines', ?, ?, ?, '{}')"
      )
        .bind(`l-${n}`, n, description, amount)
        .run();
    }
  }

  it("records who typed a line amount", async () => {
    await withLines();
    await handleKeyInvoiceFields(
      env.DB,
      "inv-lines",
      {
        facts: {},
        lines: [
          { lineNumber: 1, description: "Support", amount: 65 },
          { lineNumber: 2, description: "Training", amount: 40 },
        ],
      } as never,
      "u-dan"
    );

    const row = await env.DB.prepare(
      "SELECT field, line_number, keyed_by FROM keyed_fields WHERE line_number IS NOT NULL"
    ).first<{ field: string; line_number: number; keyed_by: string }>();

    expect(row?.field).toBe("line.1.amount");
    expect(row?.line_number).toBe(1);
    expect(row?.keyed_by).toBe("u-dan");
  });

  it("records only what changed", async () => {
    // Somebody opening a line table and saving without editing should
    // not appear to have typed every figure on the invoice.
    await withLines();
    await handleKeyInvoiceFields(
      env.DB,
      "inv-lines",
      {
        facts: {},
        lines: [
          { lineNumber: 1, description: "Support", amount: 60 },
          { lineNumber: 2, description: "Training", amount: 40 },
        ],
      } as never,
      "u-dan"
    );

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM keyed_fields WHERE line_number IS NOT NULL"
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("puts lines in the same provenance list as header fields", async () => {
    // So a rule testing provenance.keyed with `contains` sees both.
    await withLines();
    await handleKeyInvoiceFields(
      env.DB,
      "inv-lines",
      {
        facts: { "BT-1": "INV-9" },
        lines: [
          { lineNumber: 1, description: "Support", amount: 65 },
          { lineNumber: 2, description: "Training", amount: 40 },
        ],
      } as never,
      "u-dan"
    );


    const row = await env.DB.prepare(
      "SELECT facts_json FROM invoice_headers WHERE id = 'inv-lines'"
    ).first<{ facts_json: string }>();
    const keyed = String(JSON.parse(row!.facts_json)["provenance.keyed"]);

    expect(keyed).toContain("BT-1");
    expect(keyed).toContain("line.1.amount");
  });

  it("records a line typed where none existed", async () => {
    // The case a document nobody could read actually presents: no lines
    // at all, and a person types them.
    await seedInvoice("inv-empty", {});
    await handleKeyInvoiceFields(
      env.DB,
      "inv-empty",
      { facts: {}, lines: [{ lineNumber: 1, description: "Consultancy", amount: 500 }] } as never,
      "u-dan"
    );

    const rows = await env.DB.prepare(
      "SELECT field FROM keyed_fields WHERE invoice_id = 'inv-empty' AND line_number = 1 ORDER BY field"
    ).all<{ field: string }>();
    expect(rows.results.map((r: { field: string }) => r.field)).toEqual(["line.1.amount", "line.1.description"]);
  });

  it("leaves header keying unchanged", async () => {
    await withLines();
    await handleKeyInvoiceFields(env.DB, "inv-lines", { facts: { "BT-1": "INV-9" } } as never, "u-dan");

    const row = await env.DB.prepare(
      "SELECT line_number FROM keyed_fields WHERE field = 'BT-1'"
    ).first<{ line_number: number | null }>();
    expect(row?.line_number).toBeNull();
  });
});

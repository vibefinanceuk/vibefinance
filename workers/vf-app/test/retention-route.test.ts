import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleGetRetention,
  handleSetRetention,
  handleListBeyondRetention,
  loadRetentionSettings,
} from "../src/retention-route.js";

/** An invoice with a chosen issue date, and optionally a stored original. */
async function seedInvoice(id: string, issueDate: string | null, withDocument = true) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, issue_date, facts_json) VALUES (?, ?, '{}')")
    .bind(id, issueDate)
    .run();
  if (withDocument) {
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, document_type, content_type, r2_key) VALUES (?, ?, 'original', 'application/pdf', ?)"
    )
      .bind(`doc-${id}`, id, `Acme/2019/${id}.pdf`)
      .run();
  }
}

/** Backdates the capture timestamp, for the no-issue-date case. */
async function backdateCapture(id: string, isoDate: string) {
  await env.DB.prepare("UPDATE invoice_headers SET created_at = ? WHERE id = ?").bind(isoDate, id).run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the retention setting", () => {
  it("starts at seven years — the common EU and UK VAT requirement", async () => {
    expect((await loadRetentionSettings(env.DB)).retentionYears).toBe(7);
  });

  it("says plainly that nothing is enforced", async () => {
    // An operator reading a retention period could reasonably expect it
    // to be enforced. It is not, and the payload says so rather than
    // leaving that to be assumed.
    const result = await handleGetRetention(env.DB);
    expect(String((result.body as { enforcement: string }).enforcement)).toContain("nothing is deleted");
  });

  it("can be changed", async () => {
    expect((await handleSetRetention(env.DB, { retentionYears: 10 })).status).toBe(200);
    expect((await loadRetentionSettings(env.DB)).retentionYears).toBe(10);
  });

  it("refuses a period outside the bounds, with a reason", async () => {
    for (const years of [0, 51, -3]) {
      const result = await handleSetRetention(env.DB, { retentionYears: years });
      expect(result.status).toBe(422);
    }
  });

  it("refuses a non-integer", async () => {
    for (const bad of [7.5, "seven", null, undefined]) {
      expect((await handleSetRetention(env.DB, { retentionYears: bad })).status).toBe(400);
    }
  });
});

describe("what has passed the benchmark", () => {
  it("finds an invoice older than the period", async () => {
    await seedInvoice("old", "2015-01-01");
    const result = await handleListBeyondRetention(env.DB);
    const body = result.body as { count: number; invoices: { id: string }[] };
    expect(body.count).toBe(1);
    expect(body.invoices[0].id).toBe("old");
  });

  it("leaves a recent invoice alone", async () => {
    await seedInvoice("recent", "2026-01-01");
    expect(((await handleListBeyondRetention(env.DB)).body as { count: number }).count).toBe(0);
  });

  it("responds to the configured period, not a constant", async () => {
    // The setting has to actually reach the query — the divergence
    // decisions 0056 and 0057 were both about.
    await seedInvoice("mid", "2021-06-01");
    expect(((await handleListBeyondRetention(env.DB)).body as { count: number }).count).toBe(0);

    await handleSetRetention(env.DB, { retentionYears: 2 });
    expect(((await handleListBeyondRetention(env.DB)).body as { count: number }).count).toBe(1);
  });

  it("uses the issue date where there is one, and says so", async () => {
    await seedInvoice("dated", "2015-01-01");
    const body = (await handleListBeyondRetention(env.DB)).body as {
      invoices: { anchor: string; anchorSource: string }[];
    };
    expect(body.invoices[0].anchorSource).toBe("issue_date");
    expect(body.invoices[0].anchor).toBe("2015-01-01");
  });

  it("falls back to the capture date for a document nobody could read", async () => {
    // An undetectable document has no issue date at all (decision
    // 0063). Excluding it would leave exactly the documents nobody
    // could read sitting outside the retention report forever.
    await seedInvoice("unreadable", null);
    await backdateCapture("unreadable", "2014-03-02T00:00:00.000Z");

    const body = (await handleListBeyondRetention(env.DB)).body as {
      count: number;
      invoices: { anchorSource: string }[];
    };
    expect(body.count).toBe(1);
    expect(body.invoices[0].anchorSource).toBe("captured_at");
  });

  it("reports an invoice with no retained original, rather than hiding it", async () => {
    // Captured before decision 0068, or retention failed. There is
    // nothing in R2 to purge for these, and that is itself a finding.
    await seedInvoice("no-doc", "2015-01-01", false);
    const body = (await handleListBeyondRetention(env.DB)).body as {
      count: number;
      invoices: { r2Key: string | null }[];
    };
    expect(body.count).toBe(1);
    expect(body.invoices[0].r2Key).toBeNull();
  });

  it("deletes nothing", async () => {
    // The whole point. A wrong number that produces a report is an
    // afternoon's confusion; a wrong number wired to a delete is a
    // compliance incident.
    await seedInvoice("old", "2015-01-01");
    await handleListBeyondRetention(env.DB);

    const still = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>();
    const docs = await env.DB.prepare("SELECT count(*) AS n FROM invoice_documents").first<{ n: number }>();
    expect(still?.n).toBe(1);
    expect(docs?.n).toBe(1);
  });
});

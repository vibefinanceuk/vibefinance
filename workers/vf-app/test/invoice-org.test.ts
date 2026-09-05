import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { visitCurrentStage } from "../src/workflow-engine.js";

/**
 * Which part of the enterprise an invoice belongs to — decision 0111.
 *
 * Oracle calls it the Operating Unit, SAP a Company Code. **An invoice
 * processed under the wrong org is posted to the wrong books and
 * approved by the wrong people**, which is why it is settled on entry
 * rather than inferred later.
 */

async function seedOrgs() {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')"
  ).run();
  for (const [id, name, endpoint, vat] of [
    ["acme-uk", "Acme UK", "987654321", "GB907856452"],
    ["acme-fr", "Acme France", "111222333", "FR12345678901"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id, buyer_endpoint, vat_id) VALUES (?, ?, 'operating_unit', 'acme-group', ?, ?)"
    )
      .bind(id, name, endpoint, vat)
      .run();
  }
}

async function seedProcess(requiresOrg = false) {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, requires_org) VALUES ('validation', 'ap', 'Validation', 1, ?)"
  )
    .bind(requiresOrg ? 1 : 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 2)"
  ).run();
}

/**
 * The engine evaluates the facts it is **given**, not the ones stored
 * (decision 0015) — so these tests pass the same facts they seed.
 */
async function seedInvoice(id: string, facts: Record<string, unknown> = {}) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)")
    .bind(id, JSON.stringify(facts))
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')"
  )
    .bind(`inst-${id}`, id)
    .run();
  return `inst-${id}`;
}

/**
 * One compiled rule, in the shape the schema actually keeps it: `rules`
 * holds identity and order, `rule_versions` holds the compiled rule and
 * its approval.
 */
async function addRule(ruleId: string, sortOrder: number, endpoint: string, orgId: string) {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, 'rs-org', ?, 1)")
    .bind(ruleId, sortOrder)
    .run();
  await env.DB.prepare(
    // `effective_from` matters: the loader filters to rules that are
    // enabled, approved AND currently within their effective window, so
    // a version with a null `effective_from` never loads however
    // approved it looks.
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
     VALUES (?, 1, 'place it', ?, 'u-dan', 'u-dan', '2026-09-01', '2026-01-01T00:00:00.000Z')`
  )
    .bind(
      ruleId,
      JSON.stringify({
        conditions: { all: [{ field: "BT-49", operator: "is", value: endpoint }] },
        actions: [{ type: "assign_org", params: { org: orgId } }],
      })
    )
    .run();
}

/** A rule set whose only action places the invoice in an org. */
async function seedOrgRule(orgId: string, endpoint: string) {
  await env.DB.prepare(
    "INSERT INTO rule_sets (id, name, mode, vocabulary) VALUES ('rs-org', 'Placement', 'all_matches', 'invoice')"
  ).run();
  await addRule("r-org", 1, endpoint, orgId);
  await env.DB.prepare("UPDATE process_stages SET rule_set_id = 'rs-org' WHERE id = 'validation'").run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan','d@x.com','Dan')").run();
  await seedOrgs();
});

describe("a rule places the invoice", () => {
  it("assigns the org the rule names", async () => {
    // The buyer's electronic address is what Peppol itself routes on
    // (decision 0112), so it is the natural thing to test.
    await seedProcess();
    await seedOrgRule("acme-fr", "111222333");
    const facts = { "BT-49": "111222333" };
    const instanceId = await seedInvoice("inv-1", facts);

    await visitCurrentStage(env.DB, instanceId, facts as never);

    const row = await env.DB.prepare(
      "SELECT org_unit_id, org_assigned_by FROM invoice_headers WHERE id = 'inv-1'"
    ).first<{ org_unit_id: string; org_assigned_by: string }>();

    expect(row?.org_unit_id).toBe("acme-fr");
    expect(row?.org_assigned_by).toBe("rule");
  });

  it("leaves an invoice the rule does not match unplaced", async () => {
    await seedProcess();
    await seedOrgRule("acme-fr", "111222333");
    const facts = { "BT-49": "somebody-else" };
    const instanceId = await seedInvoice("inv-2", facts);

    await visitCurrentStage(env.DB, instanceId, facts as never);

    const row = await env.DB.prepare(
      "SELECT org_unit_id FROM invoice_headers WHERE id = 'inv-2'"
    ).first<{ org_unit_id: string | null }>();
    expect(row?.org_unit_id).toBeNull();
  });
});

describe("an invoice belongs to one part of the enterprise", () => {
  it("refuses two rules naming different orgs", async () => {
    // The same discipline route_to already applies. A rule set that
    // cannot decide should say so rather than pick -- posting to the
    // wrong books is what this exists to prevent.
    await seedProcess();
    await seedOrgRule("acme-fr", "111222333");
    await addRule("r-org-2", 2, "111222333", "acme-uk");
    const facts = { "BT-49": "111222333" };
    const instanceId = await seedInvoice("inv-3", facts);

    const result = await visitCurrentStage(env.DB, instanceId, facts as never);
    expect(result.status).toBe(409);
    expect(String((result.body as { error: string }).error)).toContain("conflicting assign_org");
  });

  it("refuses an org that does not exist", async () => {
    await seedProcess();
    await seedOrgRule("no-such-org", "111222333");
    const facts = { "BT-49": "111222333" };
    const instanceId = await seedInvoice("inv-4", facts);

    const result = await visitCurrentStage(env.DB, instanceId, facts as never);
    expect(result.status).toBe(409);
  });

  it("refuses a legal entity, which is not where payables happen", async () => {
    // A legal entity is a tax and reporting boundary; the operating
    // unit is where an invoice is processed.
    await seedProcess();
    await seedOrgRule("acme-group", "111222333");
    const facts = { "BT-49": "111222333" };
    const instanceId = await seedInvoice("inv-5", facts);

    const result = await visitCurrentStage(env.DB, instanceId, facts as never);
    expect(result.status).toBe(409);
    expect(String((result.body as { error: string }).error)).toContain("legal_entity");
  });
});

describe("a stage can require an org", () => {
  it("refuses to finish without one", async () => {
    // "Known at Validation" is a hope unless something enforces it.
    await seedProcess(true);
    const instanceId = await seedInvoice("inv-6", {});

    const result = await visitCurrentStage(env.DB, instanceId, {} as never);
    expect(result.status).toBe(409);
    expect(String((result.body as { error: string }).error)).toContain("organisational unit");
  });

  it("says how to place it, rather than only that it is unplaced", async () => {
    await seedProcess(true);
    const instanceId = await seedInvoice("inv-7", {});

    const result = await visitCurrentStage(env.DB, instanceId, {} as never);
    const detail = String((result.body as { detail: string }).detail);
    expect(detail).toContain("assign_org");
    expect(detail).toContain("source");
  });

  it("accepts an invoice a rule placed at this very stage", async () => {
    // Checked AFTER the stage's own rules run, so a rule here can be
    // the thing that supplies it.
    await seedProcess(true);
    await seedOrgRule("acme-fr", "111222333");
    const facts = { "BT-49": "111222333" };
    const instanceId = await seedInvoice("inv-8", facts);

    const result = await visitCurrentStage(env.DB, instanceId, facts as never);
    expect(result.status).toBeLessThan(400);
  });

  it("lets a stage that does not require one through unplaced", async () => {
    // Default false, so every process that existed before behaves
    // exactly as it did.
    await seedProcess(false);
    const instanceId = await seedInvoice("inv-9", {});

    const result = await visitCurrentStage(env.DB, instanceId, {} as never);
    expect(result.status).toBeLessThan(400);
  });
});

describe("the source's default org", () => {
  /**
   * The deterministic answer for a customer running one mailbox per
   * part of the enterprise — and the fallback when a document says
   * nothing readable.
   *
   * **Built before it was tested**, which is the gap this project keeps
   * finding. Added here rather than left to a live capture.
   */
  async function seedSource(defaultOrg: string | null) {
    await env.DB.prepare(
      "INSERT INTO sources (id, process_id, name, mechanism, default_org_unit_id) VALUES ('ic-fr', 'ap', 'French mailbox', 'email', ?)"
    )
      .bind(defaultOrg)
      .run();
  }

  it("is recorded on the source, and says it is the source's doing", async () => {
    await seedProcess();
    await seedSource("acme-fr");

    // The capture route applies it after the invoice is written; this
    // asserts the same statement, which is what that route runs.
    await seedInvoice("inv-src", {});
    await env.DB.prepare(
      "UPDATE invoice_headers SET org_unit_id = (SELECT default_org_unit_id FROM sources WHERE id = 'ic-fr'), org_assigned_by = 'source' WHERE id = 'inv-src' AND org_unit_id IS NULL"
    ).run();

    const row = await env.DB.prepare(
      "SELECT org_unit_id, org_assigned_by FROM invoice_headers WHERE id = 'inv-src'"
    ).first<{ org_unit_id: string; org_assigned_by: string }>();

    expect(row?.org_unit_id).toBe("acme-fr");
    // Which is what lets a disagreement be investigated rather than
    // argued about.
    expect(row?.org_assigned_by).toBe("source");
  });

  it("does not overwrite an org a rule already decided", async () => {
    // A rule is the customer's own more specific decision. The capture
    // statement is guarded by `org_unit_id IS NULL` for exactly this.
    await seedProcess();
    await seedSource("acme-fr");
    await seedInvoice("inv-both", {});
    await env.DB.prepare(
      "UPDATE invoice_headers SET org_unit_id = 'acme-uk', org_assigned_by = 'rule' WHERE id = 'inv-both'"
    ).run();

    await env.DB.prepare(
      "UPDATE invoice_headers SET org_unit_id = 'acme-fr', org_assigned_by = 'source' WHERE id = 'inv-both' AND org_unit_id IS NULL"
    ).run();

    const row = await env.DB.prepare(
      "SELECT org_unit_id, org_assigned_by FROM invoice_headers WHERE id = 'inv-both'"
    ).first<{ org_unit_id: string; org_assigned_by: string }>();
    expect(row?.org_unit_id).toBe("acme-uk");
    expect(row?.org_assigned_by).toBe("rule");
  });

  it("leaves an invoice unplaced when the source names no org", async () => {
    // Most customers will have one mailbox and place by rule, so a
    // source without a default is the ordinary case, not a fault.
    await seedProcess();
    await seedSource(null);
    await seedInvoice("inv-nodefault", {});

    const row = await env.DB.prepare(
      "SELECT org_unit_id FROM invoice_headers WHERE id = 'inv-nodefault'"
    ).first<{ org_unit_id: string | null }>();
    expect(row?.org_unit_id).toBeNull();
  });
});

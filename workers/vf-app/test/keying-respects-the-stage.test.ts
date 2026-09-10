import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";

/**
 * A stage's restrictions are enforced, not merely displayed —
 * decision 0144.
 *
 * **Field visibility was a screen behaviour.** Decision 0114 made a
 * stage able to restrict a field and the keying route never consulted
 * it, so a `curl` could always write a read-only field.
 *
 * Reported from the screen once the viewer served every stage: *"I can
 * open an approval item and add a line, and save the line."*
 */

async function seedAt(stageId: string, readOnly: boolean) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, read_only) VALUES (?, 'ap', ?, 1, ?)"
  )
    .bind(stageId, stageId, readOnly ? 1 : 0)
    .run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
     VALUES ('pi-1', 'ap', 'invoice', 'inv-1', ?)`
  )
    .bind(stageId)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
  ).run();

  /**
   * Membership of the process's current version — decision 0160.
   *
   * `process-route.ts` does this when a stage is created through it.
   * These tests insert directly, so they do it themselves: **a stage in
   * no version is a stage the workflow engine steps straight past.**
   */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence
     FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();

}

beforeEach(async () => {
  await applyTestSchema();
});

describe("keying at a read-only stage", () => {
  it("refuses a header field", async () => {
    await seedAt("approval", true);
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 999 } } as never,
      "u-dan"
    );

    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("not_editable_here");
  });

  it("names the fields it refused", async () => {
    // **"Some fields were refused" sends a person hunting.**
    await seedAt("approval", true);
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 999, "BT-106": 100 } } as never,
      "u-dan"
    );

    expect((result.body as { fields: string[] }).fields).toEqual(
      expect.arrayContaining(["BT-112", "BT-106"])
    );
  });

  it("refuses a line, which is structure rather than a field", async () => {
    // **The exact report.** Adding a line changes the shape of the
    // document, and a stage permitting nothing cannot permit that.
    await seedAt("approval", true);
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: {}, lines: [{ lineNumber: 1, facts: { "BT-131": 50 } }] } as never,
      "u-dan"
    );

    expect(result.status).toBe(403);
  });

  it("refuses rather than silently dropping", async () => {
    // **Silently ignoring would tell somebody their edit was saved when
    // it was not** — the failure decision 0119 spent a day on from the
    // other direction.
    await seedAt("approval", true);
    await handleKeyInvoiceFields(env.DB, "inv-1", { facts: { "BT-112": 999 } } as never, "u-dan");

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'")
      .first<{ facts_json: string }>();
    expect(row?.facts_json).not.toContain("999");
  });
});

describe("keying at an ordinary stage", () => {
  it("still works", async () => {
    // The restriction is the stage's, not the route's.
    await seedAt("validation", false);
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 999 } } as never,
      "u-dan"
    );

    expect(result.status).toBe(200);
  });

  it("refuses a field that stage hides, even there", async () => {
    // A per-field restriction (decision 0114) is enforced by the same
    // path.
    await seedAt("validation", false);
    await env.DB.prepare(
      "INSERT INTO stage_field_visibility (stage_id, field, visibility) VALUES ('validation', 'BT-112', 'read')"
    ).run();

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 999 } } as never,
      "u-dan"
    );
    expect(result.status).toBe(403);
  });
});

describe("an invoice in no process at all", () => {
  it("is read-only, because editing belongs to a task", async () => {
    /**
     * **Decision 0144 left this open and said so**: *"an invoice that
     * has left its process is editable by anybody with `AP.Validate`."*
     * Nothing could reach one, so it stayed theoretical — until the
     * document manager (decision 0164) made every invoice openable.
     *
     * The operator settled the rule: validation determines the fields,
     * matching and coding assign the lines, and there need not be any
     * modification after that.
     */
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-loose', '{}')").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
    ).run();

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-loose",
      { facts: { "BT-112": 999 } } as never,
      "u-dan"
    );

    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("not_editable_here");
  });
});

describe("a field the screen fills in (decision 0173)", () => {
  /**
   * **Every line edit at Validation was refused.**
   *
   * The viewer sets `BT-126` itself, to the line's own position, so a
   * document carrying no line numbers still has them. `BT-126` is
   * `read` by default, and decision 0164's check refused the whole save
   * with *"this stage does not permit editing those fields"*.
   *
   * Before 0164 the check ran only where a stage restricted something,
   * so a screen-supplied value never met it. **Widening the check
   * widened what it refused.**
   */
  it("accepts a line whose number the screen supplied", async () => {
    await seedAt("validation", false);
    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      {
        facts: {},
        lines: [{ lineNumber: 1, facts: { "BT-126": "1", "BT-131": 100 } }],
      } as never,
      "u-dan"
    );

    expect(result.status).toBe(200);
  });

  it("still refuses a read-only field somebody actually edited", async () => {
    // **Exempted by name rather than by relaxing the rule.**
    await seedAt("validation", false);
    await env.DB.prepare(
      "INSERT INTO stage_field_visibility (stage_id, field, visibility) VALUES ('validation', 'BT-131', 'read')"
    ).run();

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      {
        facts: {},
        lines: [{ lineNumber: 1, facts: { "BT-126": "1", "BT-131": 100 } }],
      } as never,
      "u-dan"
    );

    expect(result.status).toBe(403);
    expect((result.body as { fields: string[] }).fields).toEqual(["BT-131"]);
  });
});

describe("a unit's own restriction is enforced (decision 0197)", () => {
  /**
   * **The route, not the screen.**
   *
   * Decision 0144 found field visibility enforced only by the screen
   * since September — a `curl` could always write a read-only field. An
   * override the screen honours and the route ignores would be that
   * fault repeated, one layer along.
   */
  it("refuses a field France restricted and the group did not", async () => {
    await seedAt("validation", false);
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-fr', 'AP France', 'operating_unit', 'acme-fr')"
    ).run();
    await env.DB.prepare(
      "UPDATE invoice_headers SET org_unit_id = 'ap-fr', org_assigned_by = 'source' WHERE id = 'inv-1'"
    ).run();
    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('validation', 'acme-fr', 'BT-112', 'read')`
    ).run();

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 100 } } as never,
      "u-dan"
    );

    expect(result.status).toBe(403);
    expect((result.body as { fields: string[] }).fields).toEqual(["BT-112"]);
  });

  it("allows it for a document in another unit", async () => {
    // **The negative proof, at the enforcing layer.** France's rule
    // must not silently become everybody's.
    await seedAt("validation", false);
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('validation', 'acme-fr', 'BT-112', 'read')`
    ).run();

    const result = await handleKeyInvoiceFields(
      env.DB,
      "inv-1",
      { facts: { "BT-112": 100 } } as never,
      "u-dan"
    );

    expect(result.status).toBe(200);
  });
});

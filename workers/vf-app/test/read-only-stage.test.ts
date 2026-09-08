import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { resolveFieldVisibility } from "../src/field-visibility-route.js";

/**
 * A stage that is read-only, rather than one where every field happens
 * to be listed — decision 0143.
 *
 * **Found on the screen.** An approval stage was configured with three
 * header fields set to `read`, and line fields stayed editable — so a
 * Save button appeared on an approval screen and the amounts on a line
 * could be changed.
 *
 * The list was incomplete, and a list is the wrong shape: *"approvers
 * should approve data, not edit data"* (decision 0114) is a statement
 * about the stage.
 */

async function seedStage(readOnly: boolean) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    `INSERT INTO process_stages (id, process_id, name, sequence, read_only)
     VALUES ('approval', 'ap', 'Approval', 2, ?)`
  )
    .bind(readOnly ? 1 : 0)
    .run();

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

describe("a read-only stage", () => {
  it("makes every editable field read", async () => {
    await seedStage(true);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    expect(fields.filter((f) => f.visibility === "edit")).toEqual([]);
  });

  it("covers line fields, which a list of header fields did not", async () => {
    // **The bug this came from.** Three header fields were listed and
    // the lines were not, so a line's amount stayed editable.
    await seedStage(true);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    const lines = fields.filter((f) => f.line);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((f) => f.visibility !== "edit")).toBe(true);
  });

  it("covers a field nobody has thought of yet", async () => {
    // **A list cannot know about a field that did not exist when it was
    // written.** This asserts the property rather than a field name, so
    // it holds for whatever the vocabulary grows next.
    await seedStage(true);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    expect(fields.length).toBeGreaterThan(20);
    expect(fields.some((f) => f.visibility === "edit")).toBe(false);
  });

  it("says the stage decided it", async () => {
    // A person asking why a field is read-only gets an answer.
    await seedStage(true);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    const restricted = fields.find((f) => f.decidedBy === "stage");
    expect(restricted).toBeDefined();
  });

  it("leaves a hidden field hidden rather than revealing it", async () => {
    // **Restrictive-only, still** (decision 0114): a stage may tighten
    // and never loosen. Turning `edit` into `read` must not turn
    // `hidden` into `read`.
    await seedStage(true);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    expect(fields.some((f) => f.visibility === "hidden")).toBe(true);
  });
});

describe("a stage that is not read-only", () => {
  it("changes nothing", async () => {
    // The default is 0, so no existing stage behaves differently until
    // somebody says so.
    await seedStage(false);
    const fields = await resolveFieldVisibility(env.DB, "approval");

    expect(fields.some((f) => f.visibility === "edit")).toBe(true);
  });

  it("still honours a per-field restriction", async () => {
    // Decision 0114's mechanism is untouched; this sits beside it.
    await seedStage(false);
    await env.DB.prepare(
      "INSERT INTO stage_field_visibility (stage_id, field, visibility) VALUES ('approval', 'BT-112', 'read')"
    ).run();

    const fields = await resolveFieldVisibility(env.DB, "approval");
    expect(fields.find((f) => f.field === "BT-112")?.visibility).toBe("read");
  });
});

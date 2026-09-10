import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { visitCurrentStage, handleCreateProcessInstance } from "../src/workflow-engine.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import {
  unitLineage,
  resolveRuleSetForStage,
  explainRuleSetForStage,
  resolveFieldVisibilityForStage,
} from "../src/unit-config.js";

/**
 * Which configuration applies to which unit — decision 0196.
 *
 * Decision 0192 chose to scope configuration rather than split a
 * customer across databases, and named the risk: **forgetting a unit
 * does not fail** — it returns the group's answer, plausible and
 * quietly wrong.
 *
 * So there is one walk, and these tests are the defence.
 */

async function seedOrg() {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'acme-group')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-fr', 'AP France', 'operating_unit', 'acme-fr')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('acme-de', 'Acme Deutschland', 'legal_entity', 'acme-group')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-de', 'AP Deutschland', 'operating_unit', 'acme-de')"
  ).run();
}

async function seedStage() {
  // **Through the routes, not raw inserts.** A process carries version
  // membership (decision 0150) and a stage inserted directly is one the
  // engine cannot see — decision 0160 swept seventeen tests for this.
  await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
  for (const id of ["rs-group", "rs-fr"]) {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES (?, ?, 'all_matches')")
      .bind(id, id)
      .run();
  }
  await handleCreateStage(env.DB, "ap", {
    id: "approval",
    name: "Approval",
    sequence: 1,
    ruleSetId: "rs-group",
  });
}

async function override(unitId: string, ruleSetId: string) {
  await env.DB.prepare(
    "INSERT INTO stage_rule_set_overrides (stage_id, unit_id, rule_set_id) VALUES ('approval', ?, ?)"
  )
    .bind(unitId, ruleSetId)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedOrg();
  await seedStage();
});

describe("the walk", () => {
  it("goes from a department to its company to the group", async () => {
    // **Decision 0036's invariant keeps this short**: an operating
    // unit's parent is a legal entity, so the first step is always out
    // of the department and into the company.
    expect(await unitLineage(env.DB, "ap-fr")).toEqual(["ap-fr", "acme-fr", "acme-group"]);
  });

  it("is empty for no unit at all", async () => {
    expect(await unitLineage(env.DB, null)).toEqual([]);
  });

  it("stops on a cycle it did not create", async () => {
    // **A guarantee the code makes is not one the data keeps** —
    // decision 0152's lesson, and a tree is a tree because a migration
    // says so.
    await env.DB.prepare(
      "UPDATE org_units SET parent_unit_id = 'ap-fr' WHERE id = 'acme-group'"
    ).run();

    const lineage = await unitLineage(env.DB, "ap-fr");
    expect(lineage).toHaveLength(3);
  });
});

describe("which rules run here", () => {
  it("uses the group's where nothing is overridden", async () => {
    // **Nothing migrated.** Every stage behaves exactly as it did
    // before this existed.
    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-fr")).toBe("rs-group");
  });

  it("uses the group's for a document with no unit", async () => {
    // Which is most of them, and what every caller got before.
    expect(await resolveRuleSetForStage(env.DB, "approval", null)).toBe("rs-group");
  });

  it("uses a country's where one is set", async () => {
    // **An override on Acme France applies to every operating unit
    // beneath it**, so a country-wide rule is expressed once rather
    // than per department.
    await override("acme-fr", "rs-fr");
    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-fr")).toBe("rs-fr");
  });

  it("lets the most specific win", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES ('rs-ap-fr', 'x', 'all_matches')").run();
    await override("acme-fr", "rs-fr");
    await override("ap-fr", "rs-ap-fr");

    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-fr")).toBe("rs-ap-fr");
  });
});

describe("the negative proof", () => {
  /**
   * **A French invoice must never see a German rule set.**
   *
   * Decision 0022 insisted on exactly this for vocabularies — *"the
   * critical negative proof"* — and decision 0192 asked for it here,
   * because the failure mode is silent: the wrong rules run and produce
   * a plausible outcome.
   */
  it("does not give France Germany's rules", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES ('rs-de', 'x', 'all_matches')").run();
    await override("acme-de", "rs-de");

    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-fr")).not.toBe("rs-de");
    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-fr")).toBe("rs-group");
  });

  it("does not give Germany France's rules", async () => {
    await override("acme-fr", "rs-fr");
    expect(await resolveRuleSetForStage(env.DB, "approval", "ap-de")).toBe("rs-group");
  });

  it("does not leak a sibling's override to the group", async () => {
    // A document with no unit is the group's, and a country's override
    // must not become everybody's.
    await override("acme-fr", "rs-fr");
    expect(await resolveRuleSetForStage(env.DB, "approval", null)).toBe("rs-group");
  });
});

describe("where it came from", () => {
  /**
   * **A configuration inherited from two levels up is one nobody can
   * see** — decision 0185's argument, and the same here.
   */
  it("names the unit an override came from", async () => {
    await override("acme-fr", "rs-fr");
    const result = await explainRuleSetForStage(env.DB, "approval", "ap-fr");

    expect(result.fromUnitId).toBe("acme-fr");
    expect(result.inherited).toBe(true);
  });

  it("says it is not inherited where the unit set it itself", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES ('rs-ap-fr', 'x', 'all_matches')").run();
    await override("ap-fr", "rs-ap-fr");

    const result = await explainRuleSetForStage(env.DB, "approval", "ap-fr");
    expect(result.inherited).toBe(false);
  });

  it("says the group's rules are inherited", async () => {
    // Because they are, and a person looking at AP France should see
    // that nothing here is theirs.
    const result = await explainRuleSetForStage(env.DB, "approval", "ap-fr");
    expect(result.ruleSetId).toBe("rs-group");
    expect(result.fromUnitId).toBeNull();
    expect(result.inherited).toBe(true);
  });
});

describe("the engine uses the resolver (decision 0196)", () => {
  /**
   * **The resolver being right proves nothing about the engine calling
   * it.**
   *
   * Written after noticing that removing the call left every test
   * passing — which is exactly decision 0192's risk in miniature:
   * ignoring the unit does not fail, it quietly runs the group's rules.
   */
  /**
   * A rule that fires on any invoice and tags it, so which rule set ran
   * is visible in the outcome rather than inferred.
   */
  async function seedFiringRule(ruleSetId: string, tag: string) {
    await env.DB.prepare(
      "INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 1, 1)"
    )
      .bind(`r-${ruleSetId}`, ruleSetId)
      .run();

    // A rule that fires on anything, so which rule set ran is visible
    // in the outcome rather than inferred.
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by,
                                  approved_by, approved_at, effective_from)
       VALUES (?, 1, 'anything', ?, 'test', 'alice', datetime('now'), datetime('now'))`
    )
      .bind(
        `r-${ruleSetId}`,
        JSON.stringify({
          conditions: { all: [] },
          actions: [{ action: "tag", params: { tag } }],
        })
      )
      .run();
  }

  async function runAgainst(unitId: string | null) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
    if (unitId) {
      await env.DB.prepare(
        "UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'source' WHERE id = 'inv-1'"
      )
        .bind(unitId)
        .run();
    }

    const created = await handleCreateProcessInstance(env.DB, "ap", {
      subjectType: "invoice",
      subjectId: "inv-1",
    });
    const instanceId = (created.body as { id: string }).id;

    return visitCurrentStage(env.DB, instanceId, {});
  }

  /**
   * **Which rule ran, read from the record rather than the response.**
   * The visit reports that something matched; `stage_visit_steps` says
   * which rule it was (decision 0019).
   */
  async function ruleThatRan() {
    const row = await env.DB.prepare(
      "SELECT rule_id FROM stage_visit_steps WHERE matched = 1 ORDER BY rowid DESC LIMIT 1"
    ).first<{ rule_id: string }>();
    return row?.rule_id ?? null;
  }

  it("runs the unit's rules, not the group's", async () => {
    await seedFiringRule("rs-group", "GROUP");
    await seedFiringRule("rs-fr", "FRANCE");
    await override("acme-fr", "rs-fr");

    await runAgainst("ap-fr");
    expect(await ruleThatRan()).toBe("r-rs-fr");
  });

  it("runs the group's where a unit has no override", async () => {
    // **The negative proof, through the engine**: Germany must not
    // inherit France's rules from a shared parent.
    await seedFiringRule("rs-group", "GROUP");
    await seedFiringRule("rs-fr", "FRANCE");
    await override("acme-fr", "rs-fr");

    await runAgainst("ap-de");
    expect(await ruleThatRan()).toBe("r-rs-group");
  });
});

describe("which fields a unit may key (decision 0197)", () => {
  /**
   * **Per field, not per stage.** If a unit's overrides replaced the
   * stage's whole set, restricting one field in France would silently
   * drop every restriction the group had made — a loosening dressed as
   * a tightening, which is what decision 0143 watched for.
   */
  async function stageSays(field: string, visibility: string) {
    await env.DB.prepare(
      "INSERT INTO stage_field_visibility (stage_id, field, visibility) VALUES ('approval', ?, ?)"
    )
      .bind(field, visibility)
      .run();
  }

  async function unitSays(unitId: string, field: string, visibility: string) {
    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('approval', ?, ?, ?)`
    )
      .bind(unitId, field, visibility)
      .run();
  }

  it("uses the stage's answer where nothing is overridden", async () => {
    await stageSays("BT-112", "read");
    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.get("BT-112")).toBe("read");
  });

  it("lets a unit restrict a field the group left alone", async () => {
    await unitSays("acme-fr", "BT-110", "hidden");
    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.get("BT-110")).toBe("hidden");
  });

  it("keeps the group's other restrictions", async () => {
    /**
     * **The whole point.** Restricting one field in France must not
     * drop what the group said about every other field.
     */
    await stageSays("BT-110", "read");
    await stageSays("BT-115", "hidden");
    await unitSays("acme-fr", "BT-112", "read");

    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.get("BT-110")).toBe("read");
    expect(resolved.get("BT-115")).toBe("hidden");
    expect(resolved.get("BT-112")).toBe("read");
  });

  it("lets a unit restore a field the group restricted", async () => {
    // **`edit` exists only as an override**, so a customer whose group
    // hides a field can say *"except in France."*
    await stageSays("BT-112", "hidden");
    await unitSays("acme-fr", "BT-112", "edit");

    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.has("BT-112")).toBe(false);
  });

  it("lets the nearer unit win", async () => {
    await unitSays("acme-fr", "BT-112", "hidden");
    await unitSays("ap-fr", "BT-112", "read");

    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.get("BT-112")).toBe("read");
  });

  it("does not give France Germany's restrictions", async () => {
    // The negative proof, again — decision 0022's discipline.
    await unitSays("acme-de", "BT-112", "hidden");

    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", "ap-fr");
    expect(resolved.has("BT-112")).toBe(false);
  });

  it("gives a document with no unit the group's answer", async () => {
    await stageSays("BT-112", "read");
    await unitSays("acme-fr", "BT-112", "hidden");

    const resolved = await resolveFieldVisibilityForStage(env.DB, "approval", null);
    expect(resolved.get("BT-112")).toBe("read");
  });
});

describe("the screen sees what the route enforces (decision 0198)", () => {
  /**
   * **Decision 0197 left the screen behind the route.** The route
   * enforced a unit's overrides and `/field-visibility` reported the
   * group's answer, so a French keyer saw an editable field and got a
   * 403 on save.
   *
   * Decision 0144 **inverted** — the route stricter than the screen.
   * Safe, and a trap: a person types into a box the system will refuse.
   */
  it("reports a unit's restriction to the screen", async () => {
    const { handleFieldVisibility } = await import("../src/field-visibility-route.js");

    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('approval', 'acme-fr', 'BT-112', 'read')`
    ).run();

    const result = await handleFieldVisibility(env.DB, "approval", "ap-fr");
    const fields = (result.body as { fields: { field: string; visibility: string }[] }).fields;

    expect(fields.find((f) => f.field === "BT-112")?.visibility).toBe("read");
  });

  it("reports the group's answer where no unit is asked for", async () => {
    // Which is what every caller got before, and what a customer with
    // no units configured still gets.
    const { handleFieldVisibility } = await import("../src/field-visibility-route.js");

    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('approval', 'acme-fr', 'BT-112', 'read')`
    ).run();

    const result = await handleFieldVisibility(env.DB, "approval", null);
    const fields = (result.body as { fields: { field: string; visibility: string }[] }).fields;

    expect(fields.find((f) => f.field === "BT-112")?.visibility).toBe("edit");
  });

  it("agrees with what keying will allow", async () => {
    /**
     * **The point of the whole record.** What the screen offers and
     * what the route accepts must be one answer, and this asserts they
     * are rather than trusting that they are.
     */
    const { handleFieldVisibility, resolveFieldVisibility } = await import(
      "../src/field-visibility-route.js"
    );

    await env.DB.prepare(
      `INSERT INTO stage_field_visibility_overrides (stage_id, unit_id, field, visibility)
       VALUES ('approval', 'acme-fr', 'BT-112', 'hidden')`
    ).run();

    const shown = (
      (await handleFieldVisibility(env.DB, "approval", "ap-fr")).body as {
        fields: { field: string; visibility: string }[];
      }
    ).fields;
    const enforced = await resolveFieldVisibility(env.DB, "approval", "ap-fr");

    const editableOnScreen = shown.filter((f) => f.visibility === "edit").map((f) => f.field);
    const editableInRoute = enforced.filter((f) => f.visibility === "edit").map((f) => f.field);

    expect(editableOnScreen.sort()).toEqual(editableInRoute.sort());
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hasPermission, unitsWherePermitted } from "../src/enforce.js";
import { handleListDocuments } from "../src/documents-route.js";
import { handleAssignRole } from "../src/org-route.js";
import { handleListMyTasks } from "../src/task-list-route.js";

/**
 * A role is held somewhere — decision 0199.
 *
 * The operator's requirement, in their own words:
 *
 *   Assigning AP Manager role for one org will not give a user
 *   visibility outside of that org.
 *
 * **Decision 0192's third step**, and the one it called irreversible:
 * the point where a unit stops being a filing label and becomes a
 * boundary.
 */

async function seedOrg() {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')"
  ).run();
  for (const [id, name] of [
    ["acme-fr", "Acme France"],
    ["acme-de", "Acme Deutschland"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES (?, ?, 'legal_entity', 'acme-group')"
    )
      .bind(id, name)
      .run();
  }
  for (const [id, name, parent] of [
    ["ap-fr", "AP France", "acme-fr"],
    ["ap-de", "AP Deutschland", "acme-de"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES (?, ?, 'operating_unit', ?)"
    )
      .bind(id, name, parent)
      .run();
  }
}

async function seedPerson(id: string) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, id)
    .run();
}

async function seedRole() {
  await env.DB.prepare(
    `INSERT INTO org_roles (id, name, permissions_json)
     VALUES ('ap-manager', 'AP Manager', '["AP.Review","AP.Approve"]')`
  ).run();
}

async function grant(userId: string, unitId: string | null) {
  await env.DB.prepare(
    "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, 'ap-manager', ?)"
  )
    .bind(userId, unitId)
    .run();
}

async function seedInvoice(id: string, unitId: string | null) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')")
    .bind(id)
    .run();
  if (unitId) {
    await env.DB.prepare(
      "UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'source' WHERE id = ?"
    )
      .bind(unitId, id)
      .run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await seedOrg();
  await seedRole();
  await seedPerson("alice");
  await seedPerson("mo");
});

describe("nothing changes for a customer not using units", () => {
  /**
   * **Every assignment predating decision 0199 is group-wide**, and the
   * migration made that explicit rather than leaving it implied.
   */
  it("grants everywhere where a role is held with no unit", async () => {
    await grant("alice", null);

    expect(await hasPermission(env.DB, "alice", "AP.Review", "ap-fr")).toBe(true);
    expect(await hasPermission(env.DB, "alice", "AP.Review", "ap-de")).toBe(true);
    expect(await hasPermission(env.DB, "alice", "AP.Review")).toBe(true);
  });

  it("reports no restriction at all", async () => {
    // `null` means everywhere, which a caller filtering a list treats
    // as *"no filter"* — so a customer sees exactly what they saw.
    await grant("alice", null);
    expect(await unitsWherePermitted(env.DB, "alice", "AP.Review")).toBeNull();
  });
});

describe("a role held in one country", () => {
  it("grants there", async () => {
    await grant("alice", "acme-fr");
    expect(await hasPermission(env.DB, "alice", "AP.Review", "ap-fr")).toBe(true);
  });

  it("does not grant in another", async () => {
    // **The requirement, stated as a test.**
    await grant("alice", "acme-fr");
    expect(await hasPermission(env.DB, "alice", "AP.Review", "ap-de")).toBe(false);
  });

  it("covers every operating unit beneath it", async () => {
    // Held at Acme France, so AP France is included without being named
    // — the same reasoning as decisions 0196 and 0197.
    await grant("alice", "acme-fr");
    const units = await unitsWherePermitted(env.DB, "alice", "AP.Review");

    expect(units).toContain("acme-fr");
    expect(units).toContain("ap-fr");
    expect(units).not.toContain("ap-de");
  });

  it("lets one person hold it in two", async () => {
    // **One role definition, assigned per org** — which is why the
    // scope is on the assignment rather than on the role.
    await grant("mo", "acme-fr");
    await grant("mo", "acme-de");

    expect(await hasPermission(env.DB, "mo", "AP.Review", "ap-fr")).toBe(true);
    expect(await hasPermission(env.DB, "mo", "AP.Review", "ap-de")).toBe(true);
  });

  it("answers 'at all' where no unit is named", async () => {
    /**
     * **The dangerous default, stated openly.** A route that names no
     * unit asks *"could this person do this at all"*, which is right
     * for a route not about one document and wrong for one that is.
     */
    await grant("alice", "acme-fr");
    expect(await hasPermission(env.DB, "alice", "AP.Review")).toBe(true);
  });

  it("grants nothing where the role is not held", async () => {
    expect(await hasPermission(env.DB, "mo", "AP.Review", "ap-fr")).toBe(false);
    expect(await unitsWherePermitted(env.DB, "mo", "AP.Review")).toEqual([]);
  });
});

describe("visibility follows the assignment", () => {
  async function documentsFor(userId: string) {
    const visible = await unitsWherePermitted(env.DB, userId, "AP.Review");
    const result = await handleListDocuments(env.DB, new URLSearchParams(), visible);
    return (result.body as { documents: { id: string }[] }).documents.map((d) => d.id);
  }

  it("shows only the country a person holds", async () => {
    // **The operator's requirement, end to end.**
    await grant("alice", "acme-fr");
    await seedInvoice("inv-fr", "ap-fr");
    await seedInvoice("inv-de", "ap-de");

    expect(await documentsFor("alice")).toEqual(["inv-fr"]);
  });

  it("shows both where a person holds both", async () => {
    await grant("mo", "acme-fr");
    await grant("mo", "acme-de");
    await seedInvoice("inv-fr", "ap-fr");
    await seedInvoice("inv-de", "ap-de");

    expect((await documentsFor("mo")).sort()).toEqual(["inv-de", "inv-fr"]);
  });

  it("shows everything where the role is held everywhere", async () => {
    await grant("alice", null);
    await seedInvoice("inv-fr", "ap-fr");
    await seedInvoice("inv-de", "ap-de");

    expect((await documentsFor("alice")).sort()).toEqual(["inv-de", "inv-fr"]);
  });

  it("hides an unassigned document from a restricted person", async () => {
    /**
     * **A document with no unit is nobody's**, and it might be
     * Germany's and not yet assigned. Showing it to France would be
     * guessing.
     */
    await grant("alice", "acme-fr");
    await seedInvoice("inv-fr", "ap-fr");
    await seedInvoice("inv-nowhere", null);

    expect(await documentsFor("alice")).toEqual(["inv-fr"]);
  });

  it("still shows an unassigned document to somebody unrestricted", async () => {
    // Which is every customer not using units, and most documents.
    await grant("alice", null);
    await seedInvoice("inv-nowhere", null);

    expect(await documentsFor("alice")).toEqual(["inv-nowhere"]);
  });

  it("shows nothing where the permission is held nowhere", async () => {
    // **An empty array is a real answer**, and a different one from
    // null.
    await seedInvoice("inv-fr", "ap-fr");
    expect(await documentsFor("mo")).toEqual([]);
  });
});

describe("delegated administration (decision 0201)", () => {
  /**
   * The operator's requirement:
   *
   *   An Administrator, and AP Manager (France) would have user–role
   *   allocation permissions for the France Org.
   *
   * **The dangerous half is the other direction.** Granting a role
   * *everywhere*, or in Germany, would hand somebody more than the
   * granter holds — privilege escalation by a route being helpful.
   */
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO org_roles (id, name, permissions_json)
       VALUES ('ap-clerk', 'AP Clerk', '["AP.Validate"]')`
    ).run();
  });

  it("lets a France administrator grant in France", async () => {
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", "acme-fr", [
      "acme-fr",
      "ap-fr",
    ]);
    expect(result.status).toBe(201);
  });

  it("refuses them granting in Germany", async () => {
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", "acme-de", [
      "acme-fr",
      "ap-fr",
    ]);

    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("outside_administered_units");
  });

  it("refuses them granting everywhere", async () => {
    /**
     * **The subtle escalation.** A France administrator granting a
     * role with no unit would hand somebody the whole group — more
     * than the granter has themselves.
     */
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", null, ["acme-fr"]);

    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("cannot_grant_everywhere");
  });

  it("lets an unrestricted administrator grant everywhere", async () => {
    // `null` means everywhere, which is every customer not using units.
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", null, null);
    expect(result.status).toBe(201);
  });

  it("refuses a scoped grant to somebody who already holds it everywhere", async () => {
    // **Holding it everywhere already covers France**, and the scoped
    // row would read as a restriction it is not — which migration 0047
    // refuses as a standing invariant.
    await handleAssignRole(env.DB, "mo", "ap-clerk", null, null);
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", "acme-fr", null);

    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("already_held_everywhere");
  });

  it("refuses a unit that does not exist", async () => {
    const result = await handleAssignRole(env.DB, "mo", "ap-clerk", "acme-es", null);
    expect(result.status).toBe(404);
  });
});

describe("a regional role covers every stage (decision 0201)", () => {
  /**
   * The operator's model, stated in full:
   *
   *   Someone assigned AP.Validation does not get access to French
   *   documents when they have been given access to the German
   *   AP.Validation role. An AP Manager could be a regional, org-based
   *   role — it should give access to all stages in a process for that
   *   org.
   *
   * **This needs no new mechanism.** A role is a list of permissions
   * (decision 0010) and an assignment carries a unit (decision 0199).
   * A regional manager is the two together, and these tests prove it
   * rather than a record asserting it.
   */
  beforeEach(async () => {
    // One stage, one permission — the narrow role.
    await env.DB.prepare(
      `INSERT INTO org_roles (id, name, permissions_json)
       VALUES ('ap-validator', 'AP Validator', '["AP.Validate"]')`
    ).run();

    // Every stage in the process — the regional one.
    await env.DB.prepare(
      `INSERT INTO org_roles (id, name, permissions_json)
       VALUES ('ap-regional', 'AP Manager (regional)',
               '["AP.Validate","AP.Match","AP.Code","AP.Review","AP.Approve"]')`
    ).run();
  });

  async function give(userId: string, roleId: string, unitId: string | null) {
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)"
    )
      .bind(userId, roleId, unitId)
      .run();
  }

  it("gives a German validator no access to French documents", async () => {
    // **The operator's sentence, as a test.**
    await give("alice", "ap-validator", "acme-de");

    expect(await hasPermission(env.DB, "alice", "AP.Validate", "ap-de")).toBe(true);
    expect(await hasPermission(env.DB, "alice", "AP.Validate", "ap-fr")).toBe(false);
  });

  it("gives a validator no access to other stages", async () => {
    // One stage means one stage: they cannot approve what they keyed.
    await give("alice", "ap-validator", "acme-de");

    expect(await hasPermission(env.DB, "alice", "AP.Approve", "ap-de")).toBe(false);
    expect(await hasPermission(env.DB, "alice", "AP.Code", "ap-de")).toBe(false);
  });

  it("gives a regional manager every stage in their org", async () => {
    await give("mo", "ap-regional", "acme-fr");

    for (const permission of ["AP.Validate", "AP.Match", "AP.Code", "AP.Review", "AP.Approve"]) {
      expect(await hasPermission(env.DB, "mo", permission as never, "ap-fr")).toBe(true);
    }
  });

  it("gives a regional manager nothing in another org", async () => {
    // **Regional means regional.** The bundle is wide and the place is
    // narrow, and those are separate facts.
    await give("mo", "ap-regional", "acme-fr");

    for (const permission of ["AP.Validate", "AP.Approve"]) {
      expect(await hasPermission(env.DB, "mo", permission as never, "ap-de")).toBe(false);
    }
  });

  it("lets one person manage France and validate in Germany", async () => {
    /**
     * **Two roles, two places**, which is why decision 0199 put the
     * scope on the assignment: the same *AP Manager* definition serves
     * every org, and a person's reach is the set of pairings they hold.
     */
    await give("mo", "ap-regional", "acme-fr");
    await give("mo", "ap-validator", "acme-de");

    expect(await hasPermission(env.DB, "mo", "AP.Approve", "ap-fr")).toBe(true);
    expect(await hasPermission(env.DB, "mo", "AP.Approve", "ap-de")).toBe(false);
    expect(await hasPermission(env.DB, "mo", "AP.Validate", "ap-de")).toBe(true);
  });

  it("shows a regional manager only their own org's documents", async () => {
    await give("mo", "ap-regional", "acme-fr");
    await seedInvoice("inv-fr", "ap-fr");
    await seedInvoice("inv-de", "ap-de");

    const visible = await unitsWherePermitted(env.DB, "mo", "AP.Review");
    const result = await handleListDocuments(env.DB, new URLSearchParams(), visible);
    const ids = (result.body as { documents: { id: string }[] }).documents.map((d) => d.id);

    expect(ids).toEqual(["inv-fr"]);
  });
});

describe("work somebody may not do is work they are not shown (decision 0202)", () => {
  /**
   * Decision 0199's largest recorded gap:
   *
   *   A person is correctly denied acting and still shown the work.
   *
   * **The question is where, not whether.** A permission somebody does
   * not hold has never hidden a task — `required_permission` decided
   * which *actions* were offered and ownership decided what was listed.
   * That is unchanged; what changed is that holding it **only in
   * Germany** no longer shows French work.
   */
  async function seedTaskFor(invoiceId: string, unitId: string, taskId: string) {
    await seedInvoice(invoiceId, unitId);
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)"
    ).run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
       VALUES (?, 'ap', 'invoice', ?, 'validation')`
    )
      .bind(`pi-${invoiceId}`, invoiceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome)
       VALUES (?, ?, 'validation', 'matched')`
    )
      .bind(`v-${invoiceId}`, `pi-${invoiceId}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_team_id, required_permission)
       VALUES (?, 'validation', ?, 'ap-team', 'AP.Validate')`
    )
      .bind(taskId, `v-${invoiceId}`)
      .run();
  }

  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap-team', 'AP team')").run();
    await env.DB.prepare(
      "INSERT INTO org_team_members (team_id, user_id) VALUES ('ap-team', 'alice')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO org_roles (id, name, permissions_json)
       VALUES ('validator', 'AP Validator', '["AP.Validate"]')`
    ).run();
  });

  async function tasksFor(userId: string) {
    const result = await handleListMyTasks(env.DB, userId);
    return (result.body as { tasks: { id: string }[] }).tasks.map((t) => t.id);
  }

  it("hides French work from a German validator", async () => {
    // **The operator's own sentence, as a test.**
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'validator', 'acme-de')"
    ).run();

    await seedTaskFor("inv-fr", "ap-fr", "t-fr");
    await seedTaskFor("inv-de", "ap-de", "t-de");

    expect(await tasksFor("alice")).toEqual(["t-de"]);
  });

  it("shows both to somebody holding it in both", async () => {
    for (const unit of ["acme-fr", "acme-de"]) {
      await env.DB.prepare(
        "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'validator', ?)"
      )
        .bind(unit)
        .run();
    }

    await seedTaskFor("inv-fr", "ap-fr", "t-fr");
    await seedTaskFor("inv-de", "ap-de", "t-de");

    expect((await tasksFor("alice")).sort()).toEqual(["t-de", "t-fr"]);
  });

  it("shows everything to somebody holding it everywhere", async () => {
    // Which is every customer not using units, and every assignment
    // predating decision 0199.
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'validator', NULL)"
    ).run();

    await seedTaskFor("inv-fr", "ap-fr", "t-fr");
    await seedTaskFor("inv-de", "ap-de", "t-de");

    expect((await tasksFor("alice")).sort()).toEqual(["t-de", "t-fr"]);
  });

  it("covers every operating unit beneath the one held", async () => {
    // Held at Acme France, and the task's invoice is in AP France.
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'validator', 'acme-fr')"
    ).run();

    await seedTaskFor("inv-fr", "ap-fr", "t-fr");
    expect(await tasksFor("alice")).toEqual(["t-fr"]);
  });
});

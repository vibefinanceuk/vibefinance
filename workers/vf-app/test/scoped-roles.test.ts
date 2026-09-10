import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hasPermission, unitsWherePermitted } from "../src/enforce.js";
import { handleListDocuments } from "../src/documents-route.js";

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

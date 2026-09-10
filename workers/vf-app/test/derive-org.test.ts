import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { deriveOrgUnit } from "../src/derive-org.js";
import { handleSetSourceOrg } from "../src/source-route.js";

/**
 * Which org an arriving invoice belongs to — decision 0204.
 *
 * The operator wants a source to choose: a fixed org, or `<Automatic>`
 * — one mailbox for everybody, and the invoice says whose it is.
 *
 * **Decision 0036 added the identifiers and nothing ever read them.**
 */

async function entity(id: string, identifiers: Record<string, string> = {}) {
  await env.DB.prepare(
    `INSERT INTO org_units (id, name, kind, buyer_endpoint, vat_id, buyer_reference)
     VALUES (?, ?, 'legal_entity', ?, ?, ?)`
  )
    .bind(
      id,
      id,
      identifiers.endpoint ?? null,
      identifiers.vat ?? null,
      identifiers.reference ?? null
    )
    .run();
}

async function operatingUnit(id: string, parent: string) {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES (?, ?, 'operating_unit', ?)"
  )
    .bind(id, id, parent)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("reading the recipient off the invoice", () => {
  it("matches the buyer's electronic address", async () => {
    // **What Peppol itself routes on** — decision 0036's own note, and
    // the reason an invoice reached this enterprise at all.
    await entity("acme-uk", { endpoint: "0088:5790000435975" });
    await operatingUnit("ap-uk", "acme-uk");

    const result = await deriveOrgUnit(env.DB, { "BT-49": "0088:5790000435975" });

    expect(result.unitId).toBe("ap-uk");
    expect(result.matchedOn).toBe("BT-49");
  });

  it("matches the buyer's VAT id", async () => {
    /**
     * **The one real documents carry.** A photographed invoice has a
     * VAT number on it and almost never an electronic address — so the
     * strongest identifier is the one least often present.
     */
    await entity("acme-de", { vat: "DE273445064" });
    await operatingUnit("ap-de", "acme-de");

    const result = await deriveOrgUnit(env.DB, { "BT-48": "DE273445064" });

    expect(result.unitId).toBe("ap-de");
    expect(result.matchedOn).toBe("BT-48");
  });

  it("ignores spacing and case", async () => {
    // `GB 907 856 199` on a document and `GB907856199` in configuration
    // are the same number, and neither person should have to know what
    // the other typed.
    await entity("acme-uk", { vat: "GB907856199" });
    await operatingUnit("ap-uk", "acme-uk");

    const result = await deriveOrgUnit(env.DB, { "BT-48": "gb 907 856 199" });
    expect(result.unitId).toBe("ap-uk");
  });

  it("prefers the electronic address where both are present", async () => {
    // Two entities, and the document names one by each identifier.
    await entity("by-endpoint", { endpoint: "0088:X" });
    await operatingUnit("ap-endpoint", "by-endpoint");
    await entity("by-vat", { vat: "DE1" });
    await operatingUnit("ap-vat", "by-vat");

    const result = await deriveOrgUnit(env.DB, { "BT-49": "0088:X", "BT-48": "DE1" });
    expect(result.unitId).toBe("ap-endpoint");
  });

  it("falls through to the next identifier where the first does not match", async () => {
    await entity("acme-de", { vat: "DE1" });
    await operatingUnit("ap-de", "acme-de");

    const result = await deriveOrgUnit(env.DB, { "BT-49": "0088:nobody", "BT-48": "DE1" });
    expect(result.unitId).toBe("ap-de");
  });
});

describe("when it cannot say", () => {
  /**
   * **Each is a fact about the document rather than a failure**, and
   * they need different fixes — which is why they are named apart.
   */
  it("says so where the document names nobody", async () => {
    const result = await deriveOrgUnit(env.DB, { "BT-1": "INV-1" });

    expect(result.unitId).toBeNull();
    expect(result.reason).toBe("no_identifier");
  });

  it("says so where nothing matches", async () => {
    await entity("acme-uk", { vat: "GB1" });
    const result = await deriveOrgUnit(env.DB, { "BT-48": "FR9" });

    expect(result.reason).toBe("no_match");
    expect(result.entityId).toBeNull();
  });

  it("says which entity, where the department is ambiguous", async () => {
    /**
     * **The identifiers name a legal entity and an invoice may only be
     * assigned to an operating unit** — decision 0036's invariant read
     * the other way. Two departments beneath it, and the document
     * belongs to the entity and to no particular one.
     */
    await entity("acme-uk", { vat: "GB1" });
    await operatingUnit("ap-uk", "acme-uk");
    await operatingUnit("ar-uk", "acme-uk");

    const result = await deriveOrgUnit(env.DB, { "BT-48": "GB1" });

    expect(result.unitId).toBeNull();
    expect(result.entityId).toBe("acme-uk");
    expect(result.reason).toBe("ambiguous_unit");
  });

  it("names the other case apart, because it needs a different fix", async () => {
    // An entity with no operating unit needs one created; one with
    // several needs somebody to say which.
    await entity("acme-uk", { vat: "GB1" });

    const result = await deriveOrgUnit(env.DB, { "BT-48": "GB1" });
    expect(result.reason).toBe("no_operating_unit");
  });

  it("does not match an operating unit directly", async () => {
    // **Identifiers belong to a legal entity.** A department carrying
    // a VAT number would be a department filing accounts.
    await entity("acme-uk", {});
    await env.DB.prepare(
      "UPDATE org_units SET vat_id = 'GB1' WHERE id = 'acme-uk'"
    ).run();
    await operatingUnit("ap-uk", "acme-uk");
    await env.DB.prepare("UPDATE org_units SET vat_id = 'GB2' WHERE id = 'ap-uk'").run();

    const result = await deriveOrgUnit(env.DB, { "BT-48": "GB2" });
    expect(result.reason).toBe("no_match");
  });

  it("ignores an empty identifier rather than matching on nothing", async () => {
    // A blank VAT id on a document and a blank one in configuration
    // must not find each other.
    await entity("acme-uk", { vat: "" });
    await operatingUnit("ap-uk", "acme-uk");

    const result = await deriveOrgUnit(env.DB, { "BT-48": "   " });
    expect(result.reason).toBe("no_identifier");
  });
});

describe("what a source chooses (decision 0204)", () => {
  /**
   * **`<Automatic>` sits among the orgs**, not beside them: *"one email
   * per org"* and *"one email for everybody"* are the same setting
   * rather than two mechanisms.
   */
  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO sources (id, process_id, name, mechanism) VALUES ('s1', 'ap', 'Mailbox', 'email')"
    ).run();
  });

  it("sets an operating unit as the default", async () => {
    await entity("acme-uk");
    await operatingUnit("ap-uk", "acme-uk");

    const result = await handleSetSourceOrg(env.DB, "s1", { orgUnitId: "ap-uk" });
    expect(result.status).toBe(200);
  });

  it("takes null as automatic rather than as nowhere", async () => {
    /**
     * **Strictly better than the old reading.** A source with no
     * default used to leave every document unplaced; now the document
     * gets a chance to say whose it is.
     */
    const result = await handleSetSourceOrg(env.DB, "s1", { orgUnitId: null });

    expect(result.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT default_org_unit_id FROM sources WHERE id = 's1'"
    ).first<{ default_org_unit_id: string | null }>();
    expect(row?.default_org_unit_id).toBeNull();
  });

  it("refuses a legal entity", async () => {
    // **A document belongs to an operating unit** — decision 0036's
    // invariant, so a source defaulting to an entity would place every
    // document somewhere the database refuses.
    await entity("acme-uk");

    const result = await handleSetSourceOrg(env.DB, "s1", { orgUnitId: "acme-uk" });
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("not_an_operating_unit");
  });

  it("refuses a unit that does not exist", async () => {
    const result = await handleSetSourceOrg(env.DB, "s1", { orgUnitId: "nowhere" });
    expect(result.status).toBe(404);
  });
});

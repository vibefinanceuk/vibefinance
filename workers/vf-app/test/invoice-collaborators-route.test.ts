import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleAddCollaborator,
  handleListCollaborators,
  isInvoiceCollaborator,
} from "../src/invoice-collaborators-route.js";

/**
 * "Add person to conversation" — decision 0468's own picture, built in
 * decision 0470.
 */

async function seedUser(id: string, name: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, name)
    .run();
}

async function seedInvoice(id: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(id).run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleAddCollaborator", () => {
  it("400s for a missing userId", async () => {
    await seedInvoice("inv-1");
    const result = await handleAddCollaborator(env.DB, "inv-1", undefined, "ap-1");
    expect(result.status).toBe(400);
  });

  it("404s for a document that does not exist", async () => {
    await seedUser("biz-1", "Priya");
    const result = await handleAddCollaborator(env.DB, "nope", "biz-1", "ap-1");
    expect(result.status).toBe(404);
  });

  it("404s for a user that does not exist", async () => {
    await seedInvoice("inv-1");
    const result = await handleAddCollaborator(env.DB, "inv-1", "nope", "ap-1");
    expect(result.status).toBe(404);
  });

  it("adds a real collaborator, recording who added them", async () => {
    await seedInvoice("inv-1");
    await seedUser("ap-1", "Alex");
    await seedUser("biz-1", "Priya");

    const result = await handleAddCollaborator(env.DB, "inv-1", "biz-1", "ap-1");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ invoiceId: "inv-1", userId: "biz-1", addedBy: "ap-1" });

    const row = await env.DB.prepare("SELECT added_by FROM invoice_collaborators WHERE invoice_id = ? AND user_id = ?")
      .bind("inv-1", "biz-1")
      .first<{ added_by: string }>();
    expect(row?.added_by).toBe("ap-1");
  });

  /**
   * **Adding the same person twice is a no-op, not a 409** — migration
   * 0078's own design comment, matching `handleSetSupervisorOverride`
   * (`approval-config-route.ts`, decision 0075)'s own upsert for the
   * same composite-key "grant" shape, not `handleAddTeamMember`
   * (`team-route.ts`)'s own 409-on-duplicate for a different table.
   */
  it("is a silent no-op adding the same person twice, not a 409", async () => {
    await seedInvoice("inv-1");
    await seedUser("ap-1", "Alex");
    await seedUser("ap-2", "Jordan");
    await seedUser("biz-1", "Priya");

    await handleAddCollaborator(env.DB, "inv-1", "biz-1", "ap-1");
    const second = await handleAddCollaborator(env.DB, "inv-1", "biz-1", "ap-2");
    expect(second.status).toBe(200);

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM invoice_collaborators WHERE invoice_id = ? AND user_id = ?"
    )
      .bind("inv-1", "biz-1")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    // The original `added_by` is kept — the second call never happened,
    // not "happened and was overwritten."
    const row = await env.DB.prepare("SELECT added_by FROM invoice_collaborators WHERE invoice_id = ? AND user_id = ?")
      .bind("inv-1", "biz-1")
      .first<{ added_by: string }>();
    expect(row?.added_by).toBe("ap-1");
  });

  it("the same person collaborates on two different invoices independently", async () => {
    await seedInvoice("inv-1");
    await seedInvoice("inv-2");
    await seedUser("ap-1", "Alex");
    await seedUser("biz-1", "Priya");

    await handleAddCollaborator(env.DB, "inv-1", "biz-1", "ap-1");
    await handleAddCollaborator(env.DB, "inv-2", "biz-1", "ap-1");

    expect(await isInvoiceCollaborator(env.DB, "inv-1", "biz-1")).toBe(true);
    expect(await isInvoiceCollaborator(env.DB, "inv-2", "biz-1")).toBe(true);
    expect(await isInvoiceCollaborator(env.DB, "inv-1", "biz-2")).toBe(false);
  });
});

describe("handleListCollaborators", () => {
  it("404s for a document that does not exist", async () => {
    const result = await handleListCollaborators(env.DB, "nope");
    expect(result.status).toBe(404);
  });

  it("is empty for an invoice nobody has been added to", async () => {
    await seedInvoice("inv-1");
    const result = await handleListCollaborators(env.DB, "inv-1");
    expect(result.status).toBe(200);
    expect((result.body as { collaborators: unknown[] }).collaborators).toEqual([]);
  });

  it("lists collaborators, earliest-added first, with who added them", async () => {
    await seedInvoice("inv-1");
    await seedUser("ap-1", "Alex");
    await seedUser("biz-1", "Priya");
    await seedUser("biz-2", "Sam");

    await env.DB.prepare(
      "INSERT INTO invoice_collaborators (invoice_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)"
    )
      .bind("inv-1", "biz-2", "ap-1", "2026-09-01 10:00:00")
      .run();
    await env.DB.prepare(
      "INSERT INTO invoice_collaborators (invoice_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)"
    )
      .bind("inv-1", "biz-1", "ap-1", "2026-09-01 09:00:00")
      .run();

    const result = await handleListCollaborators(env.DB, "inv-1");
    expect(result.status).toBe(200);
    const collaborators = (result.body as { collaborators: { userId: string; userName: string; addedByName: string }[] })
      .collaborators;
    expect(collaborators.map((c) => c.userId)).toEqual(["biz-1", "biz-2"]);
    expect(collaborators[0].userName).toBe("Priya");
    expect(collaborators[0].addedByName).toBe("Alex");
  });
});

describe("isInvoiceCollaborator", () => {
  it("is false for an invoice/user pair with no row", async () => {
    expect(await isInvoiceCollaborator(env.DB, "inv-1", "biz-1")).toBe(false);
  });

  it("is true once added", async () => {
    await seedInvoice("inv-1");
    await seedUser("ap-1", "Alex");
    await seedUser("biz-1", "Priya");
    await handleAddCollaborator(env.DB, "inv-1", "biz-1", "ap-1");
    expect(await isInvoiceCollaborator(env.DB, "inv-1", "biz-1")).toBe(true);
  });
});

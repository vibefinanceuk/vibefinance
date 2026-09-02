import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import {
  handleSubmitSignupRequest,
  handleListSignupRequests,
  handleApproveSignupRequest,
  handleRejectSignupRequest,
  handleRecordProvisioning,
} from "../src/signup-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

const VALID_REQUEST = {
  companyName: "Northwind Trading",
  contactName: "Dana Reyes",
  contactEmail: "dana@northwind.example",
  notes: "About 400 supplier invoices a month, mostly Peppol.",
};

async function submitPending() {
  const result = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
  return (result.body as { id: string }).id;
}

describe("handleSubmitSignupRequest — the public form", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, { companyName: "Northwind" });
    expect(result.status).toBe(400);
  });

  it("400s on a whitespace-only field rather than storing it", async () => {
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, { ...VALID_REQUEST, contactName: "   " });
    expect(result.status).toBe(400);
  });

  it("400s on an obviously malformed email", async () => {
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, { ...VALID_REQUEST, contactEmail: "not-an-email" });
    expect(result.status).toBe(400);
  });

  it("records a real pending request in D1", async () => {
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    expect(result.status).toBe(201);
    const id = (result.body as { id: string }).id;

    // Measure the rendered result, not the instruction issued (§7).
    const row = await env.CONTROL_DB.prepare(
      "SELECT company_name, contact_name, contact_email, notes, status, decided_at, decided_by, customer_id FROM signup_requests WHERE id = ?"
    )
      .bind(id)
      .first();
    expect(row).toEqual({
      company_name: "Northwind Trading",
      contact_name: "Dana Reyes",
      contact_email: "dana@northwind.example",
      notes: "About 400 supplier invoices a month, mostly Peppol.",
      status: "pending",
      decided_at: null,
      decided_by: null,
      customer_id: null,
    });
  });

  it("accepts a request with no notes — a real form field a requester may leave blank", async () => {
    const withoutNotes = {
      companyName: VALID_REQUEST.companyName,
      contactName: VALID_REQUEST.contactName,
      contactEmail: VALID_REQUEST.contactEmail,
    };
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, withoutNotes);
    expect(result.status).toBe(201);
    const row = await env.CONTROL_DB.prepare("SELECT notes FROM signup_requests WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first();
    expect(row).toEqual({ notes: null });
  });

  it("never implies a decision in its response — only a neutral acknowledgement", async () => {
    const result = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    const body = result.body as { status: string; message: string };
    expect(body.status).toBe("pending");
    expect(body.message).toContain("will be in contact");
    // No promise of an outcome or a timeline. "provisioning team" is
    // deliberately fine — it names who will get in touch, which is
    // exactly what the website says; what must never appear is
    // language suggesting the request has been or will be granted.
    expect(body.message).not.toMatch(/approved|accepted|granted|instant|immediate|within \d/i);
  });

  it("allows the same company and email to submit more than once", async () => {
    const first = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    const second = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body as { id: string }).id).not.toBe((second.body as { id: string }).id);
  });
});

describe("handleListSignupRequests — the operator's review queue", () => {
  it("returns an empty list when nothing has been submitted", async () => {
    const result = await handleListSignupRequests(env.CONTROL_DB, null);
    expect(result.body).toEqual({ requests: [] });
  });

  it("400s an invalid status filter", async () => {
    const result = await handleListSignupRequests(env.CONTROL_DB, "maybe");
    expect(result.status).toBe(400);
  });

  it("filters by status — 'what's waiting for me'", async () => {
    const pendingId = await submitPending();
    const toReject = await submitPending();
    await handleRejectSignupRequest(env.CONTROL_DB, toReject, { decidedBy: "dan" });

    const pending = await handleListSignupRequests(env.CONTROL_DB, "pending");
    const pendingBody = pending.body as { requests: { id: string }[] };
    expect(pendingBody.requests.map((r) => r.id)).toEqual([pendingId]);

    const rejected = await handleListSignupRequests(env.CONTROL_DB, "rejected");
    const rejectedBody = rejected.body as { requests: { id: string }[] };
    expect(rejectedBody.requests.map((r) => r.id)).toEqual([toReject]);
  });

  it("returns every field the operator needs to review a request, including the requester's own notes", async () => {
    await submitPending();
    const result = await handleListSignupRequests(env.CONTROL_DB, null);
    const body = result.body as { requests: Record<string, unknown>[] };
    expect(body.requests[0]).toMatchObject({
      companyName: "Northwind Trading",
      contactName: "Dana Reyes",
      contactEmail: "dana@northwind.example",
      notes: "About 400 supplier invoices a month, mostly Peppol.",
      status: "pending",
    });
  });
});

describe("handleRejectSignupRequest — silent by design", () => {
  it("404s a request that doesn't exist", async () => {
    const result = await handleRejectSignupRequest(env.CONTROL_DB, "no-such-id", { decidedBy: "dan" });
    expect(result.status).toBe(404);
  });

  it("400s without decidedBy", async () => {
    const id = await submitPending();
    const result = await handleRejectSignupRequest(env.CONTROL_DB, id, {});
    expect(result.status).toBe(400);
  });

  it("records the rejection with who decided and when", async () => {
    const id = await submitPending();
    const result = await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    expect(result.status).toBe(200);

    const row = await env.CONTROL_DB.prepare("SELECT status, decided_by, decided_at FROM signup_requests WHERE id = ?")
      .bind(id)
      .first<{ status: string; decided_by: string; decided_at: string }>();
    expect(row?.status).toBe("rejected");
    expect(row?.decided_by).toBe("dan");
    expect(row?.decided_at).toBeTruthy();
  });

  it("a rejected requester can submit a genuinely new request — rejection never blocks a future signup", async () => {
    const first = await submitPending();
    await handleRejectSignupRequest(env.CONTROL_DB, first, { decidedBy: "dan" });

    const second = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    expect(second.status).toBe(201);

    const pending = await handleListSignupRequests(env.CONTROL_DB, "pending");
    expect((pending.body as { requests: unknown[] }).requests).toHaveLength(1);
  });

  it("409s rejecting an already-decided request rather than silently re-deciding it", async () => {
    const id = await submitPending();
    await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    const second = await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "someone-else" });
    expect(second.status).toBe(409);

    // The original decision stands, unchanged.
    const row = await env.CONTROL_DB.prepare("SELECT decided_by FROM signup_requests WHERE id = ?").bind(id).first();
    expect(row).toEqual({ decided_by: "dan" });
  });
});

describe("handleApproveSignupRequest — approval is not provisioning", () => {
  it("404s a request that doesn't exist", async () => {
    const result = await handleApproveSignupRequest(env.CONTROL_DB, "no-such-id", { decidedBy: "dan" });
    expect(result.status).toBe(404);
  });

  it("400s without decidedBy", async () => {
    const id = await submitPending();
    const result = await handleApproveSignupRequest(env.CONTROL_DB, id, {});
    expect(result.status).toBe(400);
  });

  it("marks the request approved but provisions nothing — the real decoupling", async () => {
    const id = await submitPending();
    const result = await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    expect(result.status).toBe(200);
    expect((result.body as { provisioned: boolean }).provisioned).toBe(false);

    const row = await env.CONTROL_DB.prepare(
      "SELECT status, decided_by, customer_id, environment_id FROM signup_requests WHERE id = ?"
    )
      .bind(id)
      .first();
    expect(row).toEqual({ status: "approved", decided_by: "dan", customer_id: null, environment_id: null });

    // Nothing was created anywhere else, either.
    const customers = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM customers").first<{ n: number }>();
    expect(customers?.n).toBe(0);
  });

  it("409s approving an already-decided request", async () => {
    const id = await submitPending();
    await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    const result = await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    expect(result.status).toBe(409);
  });
});

describe("handleRecordProvisioning — closing the loop", () => {
  async function seedInfrastructure() {
    await handleCreateCustomer(env.CONTROL_DB, { id: "northwind", name: "Northwind Trading" });
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "northwind",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://northwind-sandbox.workers.dev",
    });
  }

  it("links an approved request to the real customer and environment it produced", async () => {
    const id = await submitPending();
    await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    await seedInfrastructure();

    const result = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
    expect(result.status).toBe(200);
    expect((result.body as { provisioned: boolean }).provisioned).toBe(true);

    const row = await env.CONTROL_DB.prepare(
      "SELECT customer_id, environment_id FROM signup_requests WHERE id = ?"
    )
      .bind(id)
      .first();
    expect(row).toEqual({ customer_id: "northwind", environment_id: "northwind-sandbox" });
  });

  it("409s recording provisioning against a request that was never approved", async () => {
    const id = await submitPending();
    await seedInfrastructure();
    const result = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
    expect(result.status).toBe(409);
  });

  it("409s recording provisioning against a rejected request", async () => {
    const id = await submitPending();
    await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    await seedInfrastructure();
    const result = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
    expect(result.status).toBe(409);
  });

  it("409s a second provisioning record rather than silently overwriting the first", async () => {
    const id = await submitPending();
    await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    await seedInfrastructure();
    await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
    const second = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
    expect(second.status).toBe(409);
  });

  it("404s an environment that doesn't exist", async () => {
    const id = await submitPending();
    await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    await seedInfrastructure();
    const result = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-nonexistent",
    });
    expect(result.status).toBe(404);
  });

  it("400s an environment that belongs to a different customer — a real error the FKs alone cannot catch", async () => {
    const id = await submitPending();
    await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    await seedInfrastructure();
    await handleCreateCustomer(env.CONTROL_DB, { id: "contoso", name: "Contoso" });

    // Both ids are real and exist — only their relationship is wrong.
    const result = await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "contoso",
      environmentId: "northwind-sandbox",
    });
    expect(result.status).toBe(400);
  });
});

describe("the whole flow, end to end", () => {
  it("request -> review -> approve -> provision -> linked", async () => {
    // 1. A stranger submits the website form.
    const submitted = await handleSubmitSignupRequest(env.CONTROL_DB, VALID_REQUEST);
    const id = (submitted.body as { id: string }).id;

    // 2. It appears in the operator's queue.
    const queue = await handleListSignupRequests(env.CONTROL_DB, "pending");
    expect((queue.body as { requests: { id: string }[] }).requests.map((r) => r.id)).toContain(id);

    // 3. After a real conversation (which happens entirely outside
    //    this system), the operator approves.
    await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });

    // 4. Provisioning runs separately and creates the real
    //    infrastructure.
    await handleCreateCustomer(env.CONTROL_DB, { id: "northwind", name: "Northwind Trading" });
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "northwind",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://northwind-sandbox.workers.dev",
    });

    // 5. Its result is recorded back against the request.
    await handleRecordProvisioning(env.CONTROL_DB, id, {
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });

    const final = await handleListSignupRequests(env.CONTROL_DB, "approved");
    expect((final.body as { requests: Record<string, unknown>[] }).requests[0]).toMatchObject({
      id,
      status: "approved",
      decidedBy: "dan",
      customerId: "northwind",
      environmentId: "northwind-sandbox",
    });
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleResendWebhook } from "../src/resend-webhook-route.js";

const SECRET_B64 = "dGhpcyBpcyBhIHRlc3Qgc2VjcmV0"; // "this is a test secret"
const SECRET = `whsec_${SECRET_B64}`;

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(SECRET_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  let binary = "";
  for (const b of new Uint8Array(mac)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function seedEmailRow(status = "sent") {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('p-1', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('s-1', 'p-1', 'Approval', 1)").run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('inst-1', 'p-1', 'invoice', 'inv-1', 's-1', 'returned_manually')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, required_permission, status) VALUES ('task-1', 's-1', 'AP.Approve', 'returned')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO supplier_return_emails
       (id, process_instance_id, task_id, to_address, subject, body, provider_message_id, status, created_by)
     VALUES ('row-1', 'inst-1', 'task-1', 'supplier@example.com', 'subj', 'body', 'msg-abc', ?, 'u-dan')`
  )
    .bind(status)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("Resend's own webhook — decision 0498", () => {
  it("refuses when no webhook secret is configured", async () => {
    const result = await handleResendWebhook(env.DB, null, { id: "a", timestamp: "1", signature: "v1,x" }, "{}");
    expect(result.status).toBe(500);
  });

  it("400s when the svix headers are missing", async () => {
    const result = await handleResendWebhook(env.DB, SECRET, { id: null, timestamp: null, signature: null }, "{}");
    expect(result.status).toBe(400);
  });

  it("401s on a signature that does not verify", async () => {
    const result = await handleResendWebhook(
      env.DB,
      SECRET,
      { id: "a", timestamp: "1700000000", signature: "v1,not-valid" },
      JSON.stringify({ type: "email.delivered", data: { email_id: "msg-abc" } })
    );
    expect(result.status).toBe(401);
  });

  it("updates the matching row's status on a verified, recognised event", async () => {
    await seedEmailRow("sent");
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-abc" } });
    const signature = await sign("evt-1", "1700000001", body);

    const result = await handleResendWebhook(
      env.DB,
      SECRET,
      { id: "evt-1", timestamp: "1700000001", signature: `v1,${signature}` },
      body
    );
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT status, last_event_at FROM supplier_return_emails WHERE id = 'row-1'").first<{
      status: string;
      last_event_at: string | null;
    }>();
    expect(row?.status).toBe("delivered");
    expect(row?.last_event_at).not.toBeNull();
  });

  it("never walks a status backwards — a stale retry cannot undo a bounce", async () => {
    await seedEmailRow("bounced");
    const body = JSON.stringify({ type: "email.sent", data: { email_id: "msg-abc" } });
    const signature = await sign("evt-2", "1700000002", body);

    await handleResendWebhook(env.DB, SECRET, { id: "evt-2", timestamp: "1700000002", signature: `v1,${signature}` }, body);

    const row = await env.DB.prepare("SELECT status FROM supplier_return_emails WHERE id = 'row-1'").first<{
      status: string;
    }>();
    expect(row?.status).toBe("bounced");
  });

  it("acknowledges, but ignores, an event type this table has no column for", async () => {
    await seedEmailRow("sent");
    const body = JSON.stringify({ type: "email.clicked", data: { email_id: "msg-abc" } });
    const signature = await sign("evt-3", "1700000003", body);

    const result = await handleResendWebhook(
      env.DB,
      SECRET,
      { id: "evt-3", timestamp: "1700000003", signature: `v1,${signature}` },
      body
    );
    expect(result.status).toBe(200);
    expect((result.body as { ignored?: boolean }).ignored).toBe(true);
  });

  it("acknowledges, but ignores, a message id this deployment never recorded", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-unknown" } });
    const signature = await sign("evt-4", "1700000004", body);

    const result = await handleResendWebhook(
      env.DB,
      SECRET,
      { id: "evt-4", timestamp: "1700000004", signature: `v1,${signature}` },
      body
    );
    expect(result.status).toBe(200);
    expect((result.body as { ignored?: boolean }).ignored).toBe(true);
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleDismissMessage, handleReprocessMessage } from "../src/route-reprocess.js";
import { handleGetRouteMessage, handleListRouteMessages } from "../src/route-monitor-route.js";
import {
  checkSilentRoutes,
  handleDeleteAlert,
  handleListAlerts,
  handleSaveAlert,
  handleTestAlert,
  notifyMessageFinished,
  type AlertTransport,
} from "../src/route-alerts.js";

/**
 * **Fix and tell — decision 0559**, slice 5 of the Routes design:
 * reprocess a failed message from its kept original (never making an
 * invoice twice), dismiss one with a reason, and alerts by email and
 * webhook on a failure, a daily threshold, or a Source gone quiet.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function rawEmail(attachments: { filename: string; contentType: string; bytes: Uint8Array }[], subject = "Invoice") {
  const boundary = "----vf-fix";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n`,
    ...attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${btoa(String.fromCharCode(...a.bytes))}\r\n`
    ),
    `--${boundary}--`,
  ];
  return `From: accounts@munch.de\r\nTo: ${ADDRESS}\r\nSubject: ${subject}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`;
}

function message(attachments: { filename: string; contentType: string; bytes: Uint8Array }[], to = ADDRESS, messageId?: string): EmailMessage {
  // Decision 0687: a Message-ID makes each a different email, as three real failures are.
  const raw = (messageId ? `Message-ID: <${messageId}>\r\n` : "") + rawEmail(attachments);
  return { from: "accounts@munch.de", to, raw: new Response(raw).body as ReadableStream, rawSize: raw.length, setReject() {}, async forward() {} };
}

const reads = {
  extract: vi.fn(async () =>
    JSON.stringify({ invoiceNumber: "INV-7", issueDate: "2026-09-01", currency: "EUR", supplierName: "Munch GmbH", totalWithVat: 100, _confidence: 0.9 })
  ),
} as never;
const blind = { extract: vi.fn(async () => JSON.stringify({ _confidence: 0.9 })) } as never;

async function seedSource(status = "active") {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-email', 'ap', 'Email')").run();
  await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism, email_address, status) VALUES ('s-ap', 'ap', 'AP mailbox', 'email', ?, ?)")
    .bind(ADDRESS, status)
    .run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('s-ap', 'email-in', 'ap', 's-ap')").run();
}

async function lastMessageId(): Promise<string> {
  return (await env.DB.prepare("SELECT id FROM route_messages ORDER BY received_at DESC LIMIT 1").first<{ id: string }>())!.id;
}
const invoices = async () => (await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>())!.n;
const deps = (model = reads) => ({ model, bucket: env.DOCUMENTS, customerId: CUSTOMER });

type Sent = { kind: "email"; to: string[]; subject: string; text: string } | { kind: "webhook"; url: string; secret: string; body: string };
function fakeTransport(sent: Sent[], email = true): AlertTransport {
  return {
    sendEmail: email
      ? async (to, subject, text) => {
          sent.push({ kind: "email", to, subject, text });
          return { ok: true };
        }
      : null,
    postWebhook: async (url, secret, body) => {
      sent.push({ kind: "webhook", url, secret, body });
      return { ok: true };
    },
  };
}

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('it', 'it@acme.com', 'Ivy')").run();
});

describe("reprocessing", () => {
  it("runs a failed message again from its kept attachment, and delivers it once fixed", async () => {
    await seedSource();
    await handleInboundEmail(message([{ filename: "scan.png", contentType: "image/png", bytes: PNG }]), env.DB, blind, env.DOCUMENTS, CUSTOMER);
    const id = await lastMessageId();
    expect(await invoices()).toBe(0);

    const result = await handleReprocessMessage(env.DB, id, "it", deps());
    expect(result.body).toMatchObject({ status: "delivered", ran: 1, failed: 0 });
    expect(await invoices()).toBe(1);

    const detail = (await handleGetRouteMessage(env.DB, id)).body as {
      message: { status: string; attempts: number; failedPart: string | null };
      events: { event: string; actorName: string | null }[];
      canReprocess: boolean;
    };
    expect(detail.message).toMatchObject({ status: "delivered", attempts: 2, failedPart: null });
    expect(detail.events.map((e) => e.event)).toEqual(["received", "original_stored", "capture_failed", "failed", "reprocessed", "captured", "delivered"]);
    expect(detail.events.find((e) => e.event === "reprocessed")?.actorName).toBe("Ivy");
    // The invoice points at the kept attachment, not a copy.
    const doc = await env.DB.prepare("SELECT route_message_id, part_seq FROM invoice_documents WHERE document_type = 'original'").first();
    expect(doc).toEqual({ route_message_id: id, part_seq: 1 });
    expect(detail.canReprocess).toBe(false);
  });

  it("never makes an invoice twice: of a partly delivered message, only what failed runs again", async () => {
    await seedSource();
    await handleInboundEmail(
      message([
        { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
        { filename: "scan.png", contentType: "image/png", bytes: PNG },
      ]),
      env.DB,
      blind,
      env.DOCUMENTS,
      CUSTOMER
    );
    const id = await lastMessageId();
    expect(await invoices()).toBe(1);
    expect((await handleReprocessMessage(env.DB, id, "it", deps())).body).toMatchObject({ status: "delivered", ran: 1 });
    expect(await invoices()).toBe(2);
  });

  it("reads attachments from the kept email when none was ever cut from it", async () => {
    await seedSource();
    // A message kept as its email only, as one that failed before its
    // attachments were read would be.
    const raw = new TextEncoder().encode(rawEmail([{ filename: "late.pdf", contentType: "application/pdf", bytes: PDF }]));
    const key = `${CUSTOMER}/routes/s-ap/2026/09/MSG-OLD1-0000-0000/0-message.eml`;
    await env.DOCUMENTS.put(key, raw);
    await env.DB.prepare(
      "INSERT INTO route_messages (id, instance_id, direction, status, failed_part, error_code, received_at) VALUES ('MSG-OLD1-0000-0000', 's-ap', 'in', 'failed', 'format', 'no_attachment', '2026-09-29T10:00:00.000Z')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO route_message_parts (message_id, seq, role, filename, content_type, bytes, sha256, r2_key, stored_at) VALUES ('MSG-OLD1-0000-0000', 0, 'original', 'message.eml', 'message/rfc822', ?, 'x', ?, '2026-09-29T10:00:00.000Z')"
    )
      .bind(raw.length, key)
      .run();

    expect((await handleReprocessMessage(env.DB, "MSG-OLD1-0000-0000", "it", deps())).body).toMatchObject({ status: "delivered" });
    const parts = await env.DB.prepare("SELECT seq, role, filename, outcome FROM route_message_parts WHERE message_id = 'MSG-OLD1-0000-0000' ORDER BY seq").all();
    expect(parts.results).toEqual([
      { seq: 0, role: "original", filename: "message.eml", outcome: null },
      { seq: 1, role: "attachment", filename: "late.pdf", outcome: "captured" },
    ]);
  });

  it("still failing, stays failed with the new reason", async () => {
    await seedSource();
    await handleInboundEmail(message([{ filename: "scan.png", contentType: "image/png", bytes: PNG }]), env.DB, blind, env.DOCUMENTS, CUSTOMER);
    const id = await lastMessageId();
    expect((await handleReprocessMessage(env.DB, id, "it", deps(blind))).body).toMatchObject({ status: "failed", failed: 1 });
    const detail = (await handleGetRouteMessage(env.DB, id)).body as { message: { status: string; errorCode: string; attempts: number } };
    expect(detail.message).toMatchObject({ status: "failed", errorCode: "unreadable", attempts: 2 });
  });

  it("refuses what cannot be run again, saying why", async () => {
    await seedSource();
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active')").run();
    await env.DB.prepare(
      `INSERT INTO route_messages (id, instance_id, destination_id, direction, status, failed_part, received_at) VALUES
        ('MSG-OUT', NULL, 'erp-ap', 'out', 'delivered', NULL, ?),
        ('MSG-UNCLAIMED', NULL, NULL, 'in', 'failed', 'gateway', ?),
        ('MSG-DONE', 's-ap', NULL, 'in', 'delivered', NULL, ?)`
    )
      .bind(now, now, now)
      .run();
    const reason = async (id: string) => ((await handleReprocessMessage(env.DB, id, "it", deps())).body as { reason?: string }).reason;
    expect(await reason("MSG-OUT")).toBe("outbound");
    expect(await reason("MSG-UNCLAIMED")).toBe("no_original");
    expect(await reason("MSG-DONE")).toBe("not_failed");
    expect((await handleReprocessMessage(env.DB, "MSG-NOPE", "it", deps())).status).toBe(404);

    await handleInboundEmail(message([{ filename: "scan.png", contentType: "image/png", bytes: PNG }]), env.DB, blind, env.DOCUMENTS, CUSTOMER);
    const failed = await lastMessageId();
    await env.DB.prepare("UPDATE sources SET status = 'retired' WHERE id = 's-ap'").run();
    expect(await reason(failed)).toBe("source_retired");
  });

  it("offers the other open failures on the same route with the same problem", async () => {
    await seedSource();
    for (let i = 0; i < 3; i++) {
      await handleInboundEmail(message([{ filename: `scan${i}.png`, contentType: "image/png", bytes: PNG }]), env.DB, blind, env.DOCUMENTS, CUSTOMER);
    }
    const ids = (await env.DB.prepare("SELECT id FROM route_messages ORDER BY received_at").all<{ id: string }>()).results.map((r) => r.id);
    const detail = (await handleGetRouteMessage(env.DB, ids[2])).body as { similar: string[]; canReprocess: boolean; canDismiss: boolean };
    expect(detail.similar.sort()).toEqual([ids[0], ids[1]].sort());
    expect(detail).toMatchObject({ canReprocess: true, canDismiss: true });
  });
});

describe("dismissing", () => {
  it("closes a failure with its reason, and stops it counting as waiting to be fixed", async () => {
    await seedSource();
    await handleInboundEmail(message([]), env.DB, reads, env.DOCUMENTS, CUSTOMER);
    const id = await lastMessageId();
    expect(((await handleListRouteMessages(env.DB, new URLSearchParams())).body as { summary: { failedOpen: number } }).summary.failedOpen).toBe(1);

    expect((await handleDismissMessage(env.DB, id, "it", {})).body).toMatchObject({ reason: "reason_required" });
    expect((await handleDismissMessage(env.DB, id, "it", { reason: "A portal notification, not an invoice" })).status).toBe(200);

    const detail = (await handleGetRouteMessage(env.DB, id)).body as {
      message: { status: string; errorCode: string };
      events: { event: string; detail: string | null; actorName: string | null }[];
      canDismiss: boolean;
    };
    // The failure stays on the record; it is simply closed.
    expect(detail.message).toMatchObject({ status: "dismissed", errorCode: "no_attachment" });
    expect(detail.events.at(-1)).toMatchObject({ event: "dismissed", detail: "A portal notification, not an invoice", actorName: "Ivy" });
    expect(detail.canDismiss).toBe(false);
    expect(((await handleListRouteMessages(env.DB, new URLSearchParams())).body as { summary: { failedOpen: number } }).summary.failedOpen).toBe(0);
    expect((await handleDismissMessage(env.DB, id, "it", { reason: "again" })).body).toMatchObject({ reason: "not_failed" });
  });
});

describe("alerts: saving", () => {
  it("refuses an alert about nothing, to no one, or with a bad address", async () => {
    const reason = async (body: Record<string, unknown>) => ((await handleSaveAlert(env.DB, "it", body)).body as { reason?: string }).reason;
    expect(await reason({ emails: ["it@acme.com"] })).toBe("nothing_to_alert");
    expect(await reason({ onFailure: true })).toBe("no_recipient");
    expect(await reason({ onFailure: true, emails: ["not an address"] })).toBe("invalid_email");
    expect(await reason({ onFailure: true, webhookUrl: "http://plain.example" })).toBe("invalid_webhook");
    expect(await reason({ failuresPerDay: 0, emails: ["it@acme.com"] })).toBe("invalid_threshold");
    await seedSource();
    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active')").run();
    expect(await reason({ routeId: "erp-ap", silentHours: 6, emails: ["it@acme.com"] })).toBe("silence_needs_source");
  });

  it("saves one, gives a webhook its own secret, lists, changes and deletes it", async () => {
    await seedSource();
    const made = await handleSaveAlert(env.DB, "it", { routeId: "s-ap", onFailure: true, emails: "it@acme.com, ops@acme.com", webhookUrl: "https://hooks.acme.com/vf" });
    expect(made.status).toBe(201);
    const alert = made.body as { id: string; routeName: string; emails: string[]; webhookSecret: string };
    expect(alert).toMatchObject({ routeName: "AP mailbox", emails: ["it@acme.com", "ops@acme.com"] });
    expect(alert.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);

    const changed = (await handleSaveAlert(env.DB, "it", { routeId: null, failuresPerDay: 5, webhookUrl: "https://hooks.acme.com/vf" }, alert.id)).body as {
      routeId: string | null;
      onFailure: boolean;
      failuresPerDay: number;
      webhookSecret: string;
      emails: string[];
    };
    expect(changed).toMatchObject({ routeId: null, onFailure: false, failuresPerDay: 5, emails: [] });
    // The secret survives a change, so the receiving end keeps working.
    expect(changed.webhookSecret).toBe(alert.webhookSecret);
    expect(((await handleListAlerts(env.DB)).body as { alerts: unknown[] }).alerts).toHaveLength(1);
    expect((await handleDeleteAlert(env.DB, alert.id)).status).toBe(200);
    expect(((await handleListAlerts(env.DB)).body as { alerts: unknown[] }).alerts).toHaveLength(0);
  });
});

describe("alerts: telling", () => {
  it("tells by email and signed webhook when a message fails, once, and only those who asked", async () => {
    await seedSource();
    await handleSaveAlert(env.DB, "it", { routeId: "s-ap", onFailure: true, emails: ["it@acme.com"], webhookUrl: "https://hooks.acme.com/vf" });
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES ('s-other', 'ap', 'Other', 'email')").run();
    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('s-other', 'email-in', 'ap', 's-other')").run();
    await handleSaveAlert(env.DB, "it", { routeId: "s-other", onFailure: true, emails: ["other@acme.com"] });

    const sent: Sent[] = [];
    const transport = fakeTransport(sent);
    await handleInboundEmail(
      message([{ filename: "scan.png", contentType: "image/png", bytes: PNG }]),
      env.DB,
      blind,
      env.DOCUMENTS,
      CUSTOMER,
      (id) => notifyMessageFinished(env.DB, transport, id)
    );
    const id = await lastMessageId();
    expect(sent.map((s) => s.kind)).toEqual(["email", "webhook"]);
    const email = sent[0] as Extract<Sent, { kind: "email" }>;
    expect(email.to).toEqual(["it@acme.com"]);
    expect(email.subject).toBe("VibeFinance: a message on AP mailbox failed at translation");
    expect(email.text).toContain(`Reference: ${id}`);
    const hook = sent[1] as Extract<Sent, { kind: "webhook" }>;
    expect(JSON.parse(hook.body)).toMatchObject({ type: "failure", message: { id, route: "AP mailbox", status: "failed", errorCode: "unreadable" } });
    expect(hook.secret).toMatch(/^whsec_/);

    // Told once: the same message finishing again says nothing more.
    await notifyMessageFinished(env.DB, transport, id);
    expect(sent).toHaveLength(2);
  });

  it("says nothing about a delivered message", async () => {
    await seedSource();
    await handleSaveAlert(env.DB, "it", { onFailure: true, emails: ["it@acme.com"] });
    const sent: Sent[] = [];
    await handleInboundEmail(message([{ filename: "i.pdf", contentType: "application/pdf", bytes: PDF }]), env.DB, reads, env.DOCUMENTS, CUSTOMER, (id) =>
      notifyMessageFinished(env.DB, fakeTransport(sent), id)
    );
    expect(sent).toEqual([]);
  });

  it("alerts once when a day's failures reach the number set", async () => {
    await seedSource();
    await handleSaveAlert(env.DB, "it", { routeId: "s-ap", failuresPerDay: 2, emails: ["it@acme.com"] });
    const sent: Sent[] = [];
    for (let i = 0; i < 3; i++) {
      await handleInboundEmail(message([], ADDRESS, `m${i}@munch.de`), env.DB, reads, env.DOCUMENTS, CUSTOMER, (id) => notifyMessageFinished(env.DB, fakeTransport(sent), id));
    }
    expect(sent).toHaveLength(1);
    expect((sent[0] as Extract<Sent, { kind: "email" }>).subject).toBe("VibeFinance: 2 failed messages today on AP mailbox");
  });

  it("alerts once when a Source that has received goes quiet, until it receives again", async () => {
    await seedSource();
    await handleSaveAlert(env.DB, "it", { routeId: "s-ap", silentHours: 6, emails: ["it@acme.com"] });
    const sent: Sent[] = [];
    const transport = fakeTransport(sent);
    const now = new Date("2026-09-30T12:00:00Z");

    // Never received: not quiet, just not started.
    expect(await checkSilentRoutes(env.DB, transport, now)).toBe(0);

    await env.DB.prepare("INSERT INTO route_messages (id, instance_id, direction, status, received_at) VALUES ('MSG-A', 's-ap', 'in', 'delivered', '2026-09-30T02:00:00.000Z')").run();
    expect(await checkSilentRoutes(env.DB, transport, now)).toBe(1);
    expect((sent[0] as Extract<Sent, { kind: "email" }>).subject).toBe("VibeFinance: nothing received on AP mailbox for 10 hours");
    expect(await checkSilentRoutes(env.DB, transport, now)).toBe(0);

    // A new message ends that silence; the next one is alerted afresh.
    await env.DB.prepare("INSERT INTO route_messages (id, instance_id, direction, status, received_at) VALUES ('MSG-B', 's-ap', 'in', 'delivered', '2026-09-30T04:00:00.000Z')").run();
    expect(await checkSilentRoutes(env.DB, transport, now)).toBe(1);
  });

  it("sends a test on demand, and says when email is not configured here", async () => {
    await seedSource();
    const alert = (await handleSaveAlert(env.DB, "it", { onFailure: true, emails: ["it@acme.com"], webhookUrl: "https://hooks.acme.com/vf" })).body as { id: string };
    const sent: Sent[] = [];
    expect((await handleTestAlert(env.DB, fakeTransport(sent, false), alert.id)).body).toMatchObject({ outcome: "email: not configured · webhook: sent" });
    expect((await handleTestAlert(env.DB, fakeTransport(sent), alert.id)).body).toMatchObject({ outcome: "email: sent · webhook: sent" });
    const list = (await handleListAlerts(env.DB)).body as { alerts: { lastSent: { kind: string; outcome: string } }[] };
    expect(list.alerts[0].lastSent).toMatchObject({ kind: "test", outcome: "email: sent · webhook: sent" });
  });
});

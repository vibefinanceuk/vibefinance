import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleGetRouteMessage, handleListRouteMessages, routeMessagePart } from "../src/route-monitor-route.js";

/**
 * **The Route monitor — decision 0556**, slice 2: every message a Source
 * received (0555), for a customer's own IT team. Read from D1; a part's
 * bytes from R2 only when that one file is asked for.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function messageWith(to: string, attachments: { filename: string; contentType: string; bytes: Uint8Array }[], subject: string): EmailMessage {
  const boundary = "----vf-monitor";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n`,
    ...attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${btoa(String.fromCharCode(...a.bytes))}\r\n`
    ),
    `--${boundary}--`,
  ];
  const raw = `From: accounts@munch.de\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`;
  return {
    from: "accounts@munch.de",
    to,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    setReject() {},
    async forward() {},
  };
}

const model = {
  extract: vi.fn(async () =>
    JSON.stringify({ invoiceNumber: "INV-7", issueDate: "2026-09-01", currency: "EUR", supplierName: "Munch GmbH", totalWithVat: 100, _confidence: 0.9 })
  ),
} as never;
const blind = { extract: vi.fn(async () => JSON.stringify({ _confidence: 0.9 })) } as never;

async function seedSource() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-email', 'ap', 'Email')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism, email_address) VALUES ('s-ap', 'ap', 'AP mailbox', 'email', ?)"
  )
    .bind(ADDRESS)
    .run();
}

/** A message row as the monitor reads it, for the counts. */
async function row(id: string, status: string, receivedAt: string, failedPart: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO route_messages (id, instance_id, direction, status, failed_part, received_at)
     VALUES (?, 's-ap', 'in', ?, ?, ?)`
  )
    .bind(id, status, failedPart, receivedAt)
    .run();
}

type ListBody = {
  period: string;
  summary: { receivedToday: number; deliveredToday: number; failedOpen: number; waitingOverHour: number };
  sources: { id: string; name: string }[];
  messages: {
    id: string;
    sourceName: string | null;
    status: string;
    failedPart: string | null;
    errorCode: string | null;
    counterparty: string;
    subject: string;
    attachments: number;
    captured: number;
    invoices: number;
    firstInvoice: string | null;
  }[];
};

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: "acme/" });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
});

describe("the list", () => {
  it("shows what arrived, most recent first, with what became of it", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "INV-7.pdf", contentType: "application/pdf", bytes: PDF }], "Invoice 7"),
      env.DB,
      model,
      env.DOCUMENTS,
      "acme"
    );
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "scan.png", contentType: "image/png", bytes: PNG }], "Rechnung 88240"),
      env.DB,
      blind,
      env.DOCUMENTS,
      "acme"
    );

    const body = (await handleListRouteMessages(env.DB, new URLSearchParams())).body as ListBody;
    expect(body.period).toBe("today");
    expect(body.messages.map((m) => [m.subject, m.status, m.failedPart, m.attachments, m.captured])).toEqual([
      ["Rechnung 88240", "failed", "translation", 1, 0],
      ["Invoice 7", "delivered", null, 1, 1],
    ]);
    expect(body.messages[0]).toMatchObject({ sourceName: "AP mailbox", counterparty: "accounts@munch.de", errorCode: "unreadable", invoices: 0 });
    expect(body.messages[1].invoices).toBe(1);
    expect(body.sources).toEqual([{ id: "s-ap", name: "AP mailbox", status: "active" }]);
  });

  it("filters to failures, to one source, or to mail nothing claimed", async () => {
    await seedSource();
    const now = new Date().toISOString();
    await row("MSG-A", "delivered", now);
    await row("MSG-B", "failed", now, "format");
    await row("MSG-C", "partial", now);
    await env.DB.prepare(
      "INSERT INTO route_messages (id, instance_id, direction, status, failed_part, received_at) VALUES ('MSG-D', NULL, 'in', 'failed', 'gateway', ?)"
    )
      .bind(now)
      .run();

    const ids = async (q: string) =>
      ((await handleListRouteMessages(env.DB, new URLSearchParams(q))).body as ListBody).messages.map((m) => m.id).sort();
    expect(await ids("status=failed")).toEqual(["MSG-B", "MSG-C", "MSG-D"]);
    expect(await ids("source=s-ap")).toEqual(["MSG-A", "MSG-B", "MSG-C"]);
    expect(await ids("source=none")).toEqual(["MSG-D"]);
  });

  it("covers today, 7 or 30 days", async () => {
    await seedSource();
    const now = new Date("2026-09-30T12:00:00Z");
    await row("MSG-TODAY", "delivered", "2026-09-30T08:00:00.000Z");
    await row("MSG-WEEK", "delivered", "2026-09-25T08:00:00.000Z");
    await row("MSG-MONTH", "delivered", "2026-09-05T08:00:00.000Z");

    const ids = async (q: string) =>
      ((await handleListRouteMessages(env.DB, new URLSearchParams(q), now)).body as ListBody).messages.map((m) => m.id);
    expect(await ids("")).toEqual(["MSG-TODAY"]);
    expect(await ids("period=7d")).toEqual(["MSG-TODAY", "MSG-WEEK"]);
    expect(await ids("period=30d")).toEqual(["MSG-TODAY", "MSG-WEEK", "MSG-MONTH"]);
    // An unknown period is today, not everything.
    expect(await ids("period=forever")).toEqual(["MSG-TODAY"]);
  });

  it("counts today's traffic, open failures from any day, and anything stuck", async () => {
    await seedSource();
    const now = new Date("2026-09-30T12:00:00Z");
    await row("MSG-1", "delivered", "2026-09-30T09:00:00.000Z");
    await row("MSG-2", "partial", "2026-09-30T09:30:00.000Z");
    await row("MSG-3", "failed", "2026-09-30T10:00:00.000Z", "translation");
    // Yesterday's failure is still waiting to be fixed.
    await row("MSG-4", "failed", "2026-09-29T16:00:00.000Z", "format");
    // Received two hours ago and never finished.
    await row("MSG-5", "received", "2026-09-30T10:00:00.000Z");
    // Received ten minutes ago: still in progress, not stuck.
    await row("MSG-6", "received", "2026-09-30T11:50:00.000Z");

    const { summary } = (await handleListRouteMessages(env.DB, new URLSearchParams("status=failed"), now)).body as ListBody;
    expect(summary).toEqual({ receivedToday: 5, deliveredToday: 2, failedOpen: 3, waitingOverHour: 1 });
  });
});

describe("one message", () => {
  it("has its parts, its history and the invoice it made, and no R2 key", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "INV-7.pdf", contentType: "application/pdf", bytes: PDF }], "Invoice 7"),
      env.DB,
      model,
      env.DOCUMENTS,
      "acme"
    );
    const [listed] = ((await handleListRouteMessages(env.DB, new URLSearchParams())).body as ListBody).messages;

    const result = await handleGetRouteMessage(env.DB, listed.id);
    expect(result.status).toBe(200);
    const body = result.body as {
      message: { id: string; status: string; sourceName: string; subject: string };
      parts: Record<string, unknown>[];
      events: { event: string }[];
      invoices: { invoiceId: string; partSeq: number }[];
    };
    expect(body.message).toMatchObject({ id: listed.id, status: "delivered", sourceName: "AP mailbox", subject: "Invoice 7" });
    expect(body.parts.map((p) => [p.seq, p.role, p.filename, p.outcome])).toEqual([
      [0, "original", "message.eml", null],
      [1, "attachment", "INV-7.pdf", "captured"],
    ]);
    expect(body.parts.every((p) => !("r2Key" in p) && !("r2_key" in p))).toBe(true);
    expect(body.events.map((e) => e.event)).toEqual(["received", "original_stored", "captured", "delivered"]);
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].partSeq).toBe(1);
  });

  it("404s a message that does not exist", async () => {
    expect((await handleGetRouteMessage(env.DB, "MSG-NOPE")).status).toBe(404);
  });
});

describe("a stored part", () => {
  it("is downloaded as it arrived, never shown inline", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: 'Rechnung "88240".pdf', contentType: "application/pdf", bytes: PDF }], "Rechnung"),
      env.DB,
      model,
      env.DOCUMENTS,
      "acme"
    );
    const [listed] = ((await handleListRouteMessages(env.DB, new URLSearchParams())).body as ListBody).messages;

    const file = await routeMessagePart(env.DB, env.DOCUMENTS, listed.id, 1);
    expect(file).toBeInstanceOf(Response);
    const response = file as Response;
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="[^"]+"$/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);

    const eml = (await routeMessagePart(env.DB, env.DOCUMENTS, listed.id, 0)) as Response;
    expect(eml.headers.get("Content-Type")).toBe("message/rfc822");
    expect(await eml.text()).toContain("Subject: Rechnung");
  });

  it("404s a part that was never stored", async () => {
    await seedSource();
    await row("MSG-X", "failed", new Date().toISOString(), "gateway");
    const result = await routeMessagePart(env.DB, env.DOCUMENTS, "MSG-X", 0);
    expect((result as { status: number }).status).toBe(404);
  });
});

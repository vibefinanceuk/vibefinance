import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { retrieveInvoiceDocument } from "../src/document-storage.js";
import { routePartKey, safeFilename, newMessageId } from "../src/route-messages.js";

/**
 * **Routes, slice 1: store first — decision 0555.**
 *
 * Every email a Source receives is recorded as a route message, and its
 * original (the email itself, and each attachment) is stored in R2
 * before anything reads it. D1 holds what happened; R2 holds the bytes,
 * once each: the invoice points at the attachment's own object.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function messageWith(
  to: string,
  attachments: { filename: string; contentType: string; bytes: Uint8Array }[] = [],
  subject = "Invoice 88240"
): EmailMessage & { rejectedWith: string | null; rawText: string } {
  const boundary = "----vf-route-boundary";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nPlease find our invoice attached.\r\n`,
    ...attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${base64(a.bytes)}\r\n`
    ),
    `--${boundary}--`,
  ];
  const raw =
    `From: accounts@munch.de\r\nTo: ${to}\r\nSubject: ${subject}\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`;
  const message = {
    from: "accounts@munch.de",
    to,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    rawText: raw,
    rejectedWith: null as string | null,
    setReject(reason: string) {
      message.rejectedWith = reason;
    },
    async forward() {},
  };
  return message;
}

const model = {
  extract: vi.fn(async () =>
    JSON.stringify({
      invoiceNumber: "INV-1",
      issueDate: "2026-09-01",
      currency: "EUR",
      supplierName: "A Supplier",
      totalWithVat: 100,
      _confidence: 0.9,
    })
  ),
} as never;

/** A model that cannot read anything, which makes an image fail capture. */
const blind = { extract: vi.fn(async () => JSON.stringify({ _confidence: 0.9 })) } as never;

async function seedSource(status = "active") {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)"
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-email', 'ap', 'Email')").run();
  await env.DB.prepare(
    `INSERT INTO sources (id, process_id, name, mechanism, email_address, status)
     VALUES ('s-ap', 'ap', 'AP Mailbox', 'email', ?, ?)`
  )
    .bind(ADDRESS, status)
    .run();
}

interface MessageRow {
  id: string;
  instance_id: string | null;
  direction: string;
  status: string;
  failed_part: string | null;
  error_code: string | null;
  error_text: string | null;
  counterparty: string | null;
  recipient: string | null;
  subject: string | null;
  bytes: number;
  completed_at: string | null;
}

async function lastMessage(): Promise<MessageRow> {
  const row = await env.DB.prepare("SELECT * FROM route_messages ORDER BY received_at DESC LIMIT 1").first<MessageRow>();
  expect(row).not.toBeNull();
  return row!;
}

async function partsOf(id: string) {
  const rows = await env.DB.prepare(
    "SELECT seq, role, filename, content_type, bytes, sha256, r2_key, outcome, reason FROM route_message_parts WHERE message_id = ? ORDER BY seq"
  )
    .bind(id)
    .all<{
      seq: number;
      role: string;
      filename: string;
      content_type: string;
      bytes: number;
      sha256: string;
      r2_key: string;
      outcome: string | null;
      reason: string | null;
    }>();
  return rows.results;
}

async function eventsOf(id: string) {
  const rows = await env.DB.prepare("SELECT event FROM route_message_events WHERE message_id = ? ORDER BY seq")
    .bind(id)
    .all<{ event: string }>();
  return rows.results.map((r) => r.event);
}

async function r2Bytes(key: string): Promise<Uint8Array | null> {
  const object = await env.DOCUMENTS.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

beforeEach(async () => {
  await applyTestSchema();
  // R2 is not reset by the schema; each test lists only its own keys.
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
});

describe("an invoice by email is stored before it is read", () => {
  it("records the message, delivered, with who sent it and its subject", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "Rechnung_88240.pdf", contentType: "application/pdf", bytes: PDF }]),
      env.DB,
      model,
      env.DOCUMENTS,
      CUSTOMER
    );

    const m = await lastMessage();
    expect(m.id).toMatch(/^MSG-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(m.instance_id).toBe("s-ap");
    expect(m.direction).toBe("in");
    expect(m.status).toBe("delivered");
    expect(m.failed_part).toBeNull();
    expect(m.counterparty).toBe("accounts@munch.de");
    expect(m.recipient).toBe(ADDRESS);
    expect(m.subject).toBe("Invoice 88240");
    expect(m.completed_at).not.toBeNull();
  });

  it("keeps the email itself in R2, byte for byte", async () => {
    await seedSource();
    const message = messageWith(ADDRESS, [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF }]);
    await handleInboundEmail(message, env.DB, model, env.DOCUMENTS, CUSTOMER);

    const m = await lastMessage();
    const [original] = await partsOf(m.id);
    expect(original.seq).toBe(0);
    expect(original.role).toBe("original");
    expect(original.content_type).toBe("message/rfc822");
    expect(original.r2_key).toMatch(new RegExp(`^acme/routes/s-ap/\\d{4}/\\d{2}/${m.id}/0-message\\.eml$`));
    expect(new TextDecoder().decode((await r2Bytes(original.r2_key))!)).toBe(message.rawText);
    expect(m.bytes).toBe(message.rawText.length);
    expect(original.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps each attachment as its own object, and says what became of it", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [
        { filename: "one.pdf", contentType: "application/pdf", bytes: PDF },
        { filename: "two.pdf", contentType: "application/pdf", bytes: PDF },
      ]),
      env.DB,
      model,
      env.DOCUMENTS,
      CUSTOMER
    );

    const m = await lastMessage();
    const parts = await partsOf(m.id);
    expect(parts.map((p) => [p.seq, p.role, p.filename, p.outcome])).toEqual([
      [0, "original", "message.eml", null],
      [1, "attachment", "one.pdf", "captured"],
      [2, "attachment", "two.pdf", "captured"],
    ]);
    expect(await r2Bytes(parts[1].r2_key)).toEqual(PDF);
    expect(parts[1].r2_key).toContain(`/routes/s-ap/`);
    expect(parts[1].r2_key.endsWith(`/${m.id}/1-one.pdf`)).toBe(true);
  });

  it("points the invoice at the attachment's own object: stored once, not twice", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF }]),
      env.DB,
      model,
      env.DOCUMENTS,
      CUSTOMER
    );

    const m = await lastMessage();
    const item = await env.DB.prepare("SELECT item_type, item_id, part_seq FROM route_message_items WHERE message_id = ?")
      .bind(m.id)
      .first<{ item_type: string; item_id: string; part_seq: number }>();
    expect(item?.item_type).toBe("invoice");
    expect(item?.part_seq).toBe(1);

    const doc = await env.DB.prepare(
      "SELECT r2_key, content_type, route_message_id, part_seq FROM invoice_documents WHERE invoice_id = ? AND document_type = 'original'"
    )
      .bind(item!.item_id)
      .first<{ r2_key: string; content_type: string; route_message_id: string; part_seq: number }>();
    const [, attachment] = await partsOf(m.id);
    expect(doc?.r2_key).toBe(attachment.r2_key);
    expect(doc?.route_message_id).toBe(m.id);
    expect(doc?.part_seq).toBe(1);
    // Detection's type, not the mail client's label (0069).
    expect(doc?.content_type).toBe("application/pdf");

    // The viewer still gets the document.
    const served = await retrieveInvoiceDocument(env.DOCUMENTS, env.DB, item!.item_id, "original");
    expect(new Uint8Array(served!.bytes)).toEqual(PDF);

    // And there is no second copy under the invoice's own key.
    const all = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
    expect(all.objects.map((o) => o.key).filter((k) => !k.includes("/routes/"))).toEqual([]);
  });

  it("writes its history in order", async () => {
    await seedSource();
    await handleInboundEmail(
      messageWith(ADDRESS, [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF }]),
      env.DB,
      model,
      env.DOCUMENTS,
      CUSTOMER
    );
    expect(await eventsOf((await lastMessage()).id)).toEqual(["received", "original_stored", "captured", "delivered"]);
  });
});

describe("a message that fails is kept, with where it failed", () => {
  it("nothing attached: failed at the format, the email kept, the supplier told", async () => {
    await seedSource();
    const message = messageWith(ADDRESS, []);
    await handleInboundEmail(message, env.DB, model, env.DOCUMENTS, CUSTOMER);

    expect(message.rejectedWith).toContain("attach the invoice");
    const m = await lastMessage();
    expect(m.status).toBe("failed");
    expect(m.failed_part).toBe("format");
    expect(m.error_code).toBe("no_attachment");
    const parts = await partsOf(m.id);
    expect(parts.map((p) => p.role)).toEqual(["original"]);
    // **The body is kept**: a supplier who pasted the invoice into it
    // has sent something a person can now read.
    expect(new TextDecoder().decode((await r2Bytes(parts[0].r2_key))!)).toContain("Please find our invoice attached.");
  });

  it("nothing could be read: failed at the translation, the attachment kept with its reason", async () => {
    await seedSource();
    const message = messageWith(ADDRESS, [{ filename: "scan.png", contentType: "image/png", bytes: PNG }]);
    await handleInboundEmail(message, env.DB, blind, env.DOCUMENTS, CUSTOMER);

    expect(message.rejectedWith).toBeTruthy();
    const m = await lastMessage();
    expect(m.status).toBe("failed");
    expect(m.failed_part).toBe("translation");
    expect(m.error_text).toContain("scan.png");
    const [, attachment] = await partsOf(m.id);
    expect(attachment.outcome).toBe("failed");
    expect(attachment.reason).toContain("no fields could be read");
    // **The reason it matters**: before this slice, nothing of this
    // message survived.
    expect(await r2Bytes(attachment.r2_key)).toEqual(PNG);
    expect(await eventsOf(m.id)).toEqual(["received", "original_stored", "capture_failed", "failed"]);
  });

  it("one good and one bad: partial, not delivered and not failed", async () => {
    await seedSource();
    const message = messageWith(ADDRESS, [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
      { filename: "scan.png", contentType: "image/png", bytes: PNG },
    ]);
    await handleInboundEmail(message, env.DB, blind, env.DOCUMENTS, CUSTOMER);

    expect(message.rejectedWith).toBeNull();
    const m = await lastMessage();
    expect(m.status).toBe("partial");
    expect(m.failed_part).toBeNull();
    expect((await partsOf(m.id)).map((p) => p.outcome)).toEqual([null, "captured", "failed"]);
  });

  it("a retired source: failed at the gateway, the email still kept", async () => {
    await seedSource("retired");
    const message = messageWith(ADDRESS, [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF }]);
    await handleInboundEmail(message, env.DB, model, env.DOCUMENTS, CUSTOMER);

    expect(message.rejectedWith).toContain("no longer in use");
    const m = await lastMessage();
    expect(m.status).toBe("failed");
    expect(m.failed_part).toBe("gateway");
    expect(m.error_code).toBe("source_retired");
    expect((await partsOf(m.id)).map((p) => p.role)).toEqual(["original"]);
  });

  it("an address nothing claims: recorded, but nothing stored", async () => {
    // **Such mail belongs to no process**, so no retention rule covers
    // it, and keeping it would make the bucket a sink for anything
    // mailed to any address.
    const message = messageWith("nobody.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);
    await handleInboundEmail(message, env.DB, model, env.DOCUMENTS, CUSTOMER);

    const m = await lastMessage();
    expect(m.instance_id).toBeNull();
    expect(m.status).toBe("failed");
    expect(m.failed_part).toBe("gateway");
    expect(m.error_code).toBe("no_such_address");
    expect(await partsOf(m.id)).toEqual([]);
    expect((await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` })).objects).toEqual([]);
  });
});

describe("without R2, nothing is lost that was kept before", () => {
  it("records the message and captures as before, saying the original was not stored", async () => {
    await seedSource();
    const message = messageWith(ADDRESS, [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF }]);
    await handleInboundEmail(message, env.DB, model);

    expect(message.rejectedWith).toBeNull();
    const m = await lastMessage();
    expect(m.status).toBe("delivered");
    expect(await partsOf(m.id)).toEqual([]);
    expect(await eventsOf(m.id)).toEqual(["received", "original_not_stored", "captured", "delivered"]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM route_message_items WHERE message_id = ?").bind(m.id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe("keys and references", () => {
  it("a file name is made safe for a key, and never empty", () => {
    expect(safeFilename("Rechnung 88240 (final).pdf")).toBe("Rechnung_88240_final_.pdf");
    expect(safeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFilename("")).toBe("file");
    expect(safeFilename("..")).toBe("file");
  });

  it("a key is under the customer, by source and month of arrival", () => {
    expect(routePartKey("acme", "s-ap", "MSG-1", "2026-09-29T10:40:12.000Z", 2, "a b.pdf")).toBe(
      "acme/routes/s-ap/2026/09/MSG-1/2-a_b.pdf"
    );
  });

  it("a reference is short enough to read out", () => {
    expect(newMessageId()).toMatch(/^MSG-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});

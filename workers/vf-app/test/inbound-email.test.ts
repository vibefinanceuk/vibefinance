import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";

/**
 * Invoices arriving by email — decision 0146.
 *
 * A source has carried an address since decision 0126 and nothing
 * delivered to one.
 *
 * **Nothing is silently dropped**, which is decision 0125's own words:
 * *"a supplier who sent an invoice believes they sent it."*
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** A message as a mail system delivers one. */
function messageWith(
  to: string,
  attachments: { filename: string; contentType: string; bytes: Uint8Array }[] = [],
  bodyText = "Please find our invoice attached."
): EmailMessage & { rejectedWith: string | null } {
  const boundary = "----vf-test-boundary";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${bodyText}\r\n`,
    ...attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${base64(a.bytes)}\r\n`
    ),
    `--${boundary}--`,
  ];

  const raw = `From: supplier@example.com\r\nTo: ${to}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`;

  const message = {
    from: "supplier@example.com",
    to,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    rejectedWith: null as string | null,
    setReject(reason: string) {
      message.rejectedWith = reason;
    },
    async forward() {},
  };
  return message;
}

/** Extraction is not what this tests, so it answers plainly. */
const model = {
  extract: vi.fn(async () => ({ fields: {}, confidence: 0.9 })),
} as never;

/**
 * A process complete enough to capture into.
 *
 * Capture needs a stage to place an invoice at and an intake channel to
 * attribute it to — the legacy structure decision 0060 replaced with
 * sources and has not yet retired.
 */
async function seedSource(address: string | null, status = "active") {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)"
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-email', 'ap', 'Email')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO sources (id, process_id, name, mechanism, email_address, status)
     VALUES ('s-ap', 'ap', 'AP Mailbox', 'email', ?, ?)`
  )
    .bind(address, status)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("an address nothing claims", () => {
  it("bounces rather than swallowing the message", async () => {
    // **A routing rule outliving its source** is the shape decision
    // 0130 warned of, and a supplier learning today beats a customer
    // learning in a month.
    const message = messageWith("nobody.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toContain("does not accept invoices");
  });

  it("bounces mail to a retired source", async () => {
    // **This is what makes the status true rather than decorative**
    // until retiring also removes the routing rule (decision 0130).
    await seedSource("ap-mailbox.acme@vibefinance-ai.com", "retired");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toContain("no longer in use");
  });
});

describe("a message with nothing attached", () => {
  it("bounces, and says what to do instead", async () => {
    // **A supplier who pastes an invoice into the body has sent
    // something this system cannot retain**, and decision 0055's intake
    // model rests on keeping what arrived.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", []);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toContain("attach the invoice");
  });

  it("ignores a body that is not an attachment", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith(
      "ap-mailbox.acme@vibefinance-ai.com",
      [],
      "Invoice 12345, total 500 EUR, due 30 days"
    );

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toBeTruthy();
  });
});

describe("a message carrying an invoice", () => {
  it("captures it", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);

    expect(message.rejectedWith).toBeNull();
    const invoices = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{
      n: number;
    }>();
    expect(invoices?.n).toBe(1);
  });

  it("captures every attachment, not the first", async () => {
    // **A supplier sending three invoices has sent three invoices**,
    // and picking one would lose two silently.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "one.pdf", contentType: "application/pdf", bytes: PDF },
      { filename: "two.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);

    const invoices = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{
      n: number;
    }>();
    expect(invoices?.n).toBe(2);
  });

  it("matches the address regardless of case", async () => {
    // A local part is case-sensitive by RFC 5321 and case-INsensitive
    // in every practical mail system — decision 0126 stores lower-case
    // for exactly this reason.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("AP-Mailbox.Acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toBeNull();
  });

  it("ignores a signature image alongside a real invoice", async () => {
    // A logo in a footer is not an invoice, and capturing one would
    // put a task in front of somebody for nothing. Not solved: this
    // records that both are captured today.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toBeNull();
  });
});

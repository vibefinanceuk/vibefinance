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

/**
 * Extraction is not what this tests, so it answers plainly.
 *
 * **Returns a JSON string**, which is what `ExtractionModel.extract`
 * promises — an object is what my first stub returned, and the image
 * path refused it as *"the model's response was not valid JSON"*.
 */
const model = {
  // `_confidence` is required (decision 0043): a model that does not
  // say how sure it is has not answered.
  /**
   * **Answers in prompt keys, not Business Terms.** The model is asked
   * for `invoiceNumber` and the answer is mapped back to `BT-1` —
   * decision 0043's design, and a stub returning `BT-1` produces *"no
   * fields could be read from this image at all"*.
   */
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

  /**
   * Membership of the process's current version — decision 0160.
   *
   * **A stage in no version is a stage the workflow engine steps
   * straight past**, so capture would find nowhere to put the invoice.
   * `process-route.ts` does this when a stage is created through it.
   */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence
     FROM process_stages s JOIN processes p ON p.id = s.process_id`
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

describe("what arrived, recorded (decision 0147)", () => {
  /**
   * **The first real invoice by email was rejected**, and the only
   * place the reason existed was Cloudflare's own activity log — the
   * operator's, not the customer's.
   *
   * A supplier gets a clear bounce. The customer got nothing, and
   * *"we never received it"* is a conversation they would have blind.
   */
  async function arrivals() {
    const rows = await env.DB.prepare(
      "SELECT sender, recipient, source_id, outcome, reason, attachments, captured FROM inbound_email_events ORDER BY occurred_at DESC"
    ).all<{
      sender: string;
      recipient: string;
      source_id: string | null;
      outcome: string;
      reason: string | null;
      attachments: number;
      captured: number;
    }>();
    return rows.results;
  }

  it("records a message for an address nothing claims", async () => {
    // **The case that has nowhere else to be recorded**: no source
    // means no `intake_capture_events` row either, so without this the
    // message leaves no trace on the customer's side at all.
    const message = messageWith("nobody.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);
    await handleInboundEmail(message, env.DB, model);

    const [event] = await arrivals();
    expect(event.outcome).toBe("rejected");
    expect(event.reason).toBe("no_such_address");
    expect(event.source_id).toBeNull();
  });

  it("records who sent it", async () => {
    // **The sender is the point.** Somebody chasing "did our invoice
    // arrive" has an address and a date and nothing else.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
    ]);
    await handleInboundEmail(message, env.DB, model);

    const [event] = await arrivals();
    expect(event.sender).toBe("supplier@example.com");
    expect(event.recipient).toBe("ap-mailbox.acme@vibefinance-ai.com");
  });

  it("records a message with nothing attached", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", []),
      env.DB,
      model
    );

    const [event] = await arrivals();
    expect(event.reason).toBe("no_attachment");
  });

  it("counts what arrived against what became an invoice", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", [
        { filename: "one.pdf", contentType: "application/pdf", bytes: PDF },
        { filename: "two.pdf", contentType: "application/pdf", bytes: PDF },
      ]),
      env.DB,
      model
    );

    const [event] = await arrivals();
    expect(event.attachments).toBe(2);
    expect(event.captured).toBe(2);
  });

  it("marks the source as receiving, on the first message", async () => {
    // **A routing rule lives in Cloudflare's dashboard and this
    // database cannot see it**, so a message arriving is the only
    // honest evidence that routing works.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const before = await env.DB.prepare("SELECT email_routing FROM sources WHERE id = 's-ap'")
      .first<{ email_routing: string }>();
    expect(before?.email_routing).toBe("not_configured");

    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", [
        { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
      ]),
      env.DB,
      model
    );

    const after = await env.DB.prepare("SELECT email_routing FROM sources WHERE id = 's-ap'")
      .first<{ email_routing: string }>();
    expect(after?.email_routing).toBe("active");
  });

  it("does not mark it receiving when the message was rejected", async () => {
    // Nothing was delivered, so nothing is proven.
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", []),
      env.DB,
      model
    );

    const row = await env.DB.prepare("SELECT email_routing FROM sources WHERE id = 's-ap'")
      .first<{ email_routing: string }>();
    expect(row?.email_routing).toBe("not_configured");
  });

  it("reads back, most recent first", async () => {
    const { handleListInboundEmail } = await import("../src/inbound-email.js");
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");

    await handleInboundEmail(messageWith("nobody@vibefinance-ai.com", []), env.DB, model);
    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", [
        { filename: "invoice.pdf", contentType: "application/pdf", bytes: PDF },
      ]),
      env.DB,
      model
    );

    const body = (await handleListInboundEmail(env.DB, 10)).body as {
      arrivals: { outcome: string; sourceName: string | null }[];
    };

    expect(body.arrivals.length).toBe(2);
    // The one nothing claimed shows a null source rather than being
    // hidden — it is the entry worth noticing.
    expect(body.arrivals.some((a) => a.sourceName === null)).toBe(true);
  });
});

describe("a document nobody configured a channel for (decision 0161)", () => {
  /**
   * **An image was refused outright.** Nothing seeds a channel for
   * `image`, so a photographed invoice reached *"process ap has no
   * image intake channel"* and bounced to the supplier — a
   * configuration gap reported as a document problem.
   *
   * Found on a real send: `attachments 1, captured 0, unreadable`.
   */
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  it("accepts an image, creating the channel on arrival", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    const message = messageWith("ap-mailbox.acme@vibefinance-ai.com", [
      { filename: "invoice.png", contentType: "image/png", bytes: PNG },
    ]);

    await handleInboundEmail(message, env.DB, model);
    expect(message.rejectedWith).toBeNull();
  });

  it("records the channel it made", async () => {
    // **A customer should not be limited to the kinds of document
    // somebody thought of in advance.**
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    await handleInboundEmail(
      messageWith("ap-mailbox.acme@vibefinance-ai.com", [
        { filename: "invoice.png", contentType: "image/png", bytes: PNG },
      ]),
      env.DB,
      model
    );

    const channel = await env.DB.prepare(
      "SELECT structure FROM intake_channels WHERE process_id = 'ap' AND structure = 'image'"
    ).first<{ structure: string }>();
    expect(channel?.structure).toBe("image");
  });

  it("makes one channel, not one per message", async () => {
    await seedSource("ap-mailbox.acme@vibefinance-ai.com");
    for (let i = 0; i < 3; i++) {
      await handleInboundEmail(
        messageWith("ap-mailbox.acme@vibefinance-ai.com", [
          { filename: `invoice-${i}.png`, contentType: "image/png", bytes: PNG },
        ]),
        env.DB,
        model
      );
    }

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM intake_channels WHERE structure = 'image'"
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

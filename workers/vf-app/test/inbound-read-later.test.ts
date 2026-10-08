import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { MAX_READS, readQueuedInbound } from "../src/inbound-read-later.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import { handleReprocessMessage } from "../src/route-reprocess.js";

/**
 * **Accept now, read later; the same email once — decision 0687.**
 * Reading five scanned PDFs inside the email handler took longer than
 * the sending server waited; it sent the same email again every five
 * minutes and each copy made the same invoices again.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

function rawEmail(files: string[], messageId: string | null = "<a1@munch.de>") {
  const boundary = "----vf-later";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n`,
    ...files.map(
      (f) =>
        `--${boundary}\r\nContent-Type: application/pdf; name="${f}"\r\nContent-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${f}"\r\n\r\n${btoa(String.fromCharCode(...PDF))}\r\n`
    ),
    `--${boundary}--`,
  ];
  return (
    (messageId ? `Message-ID: ${messageId}\r\n` : "") +
    `From: accounts@munch.de\r\nTo: ${ADDRESS}\r\nSubject: invoices\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`
  );
}

function message(files: string[], messageId?: string | null): EmailMessage & { rejected: string | null } {
  const raw = rawEmail(files, messageId === undefined ? "<a1@munch.de>" : messageId);
  const m = {
    from: "accounts@munch.de",
    to: ADDRESS,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    rejected: null as string | null,
    setReject(reason: string) {
      m.rejected = reason;
    },
    async forward() {},
  };
  return m;
}

let n = 0;
const reads = {
  extract: vi.fn(async () =>
    JSON.stringify({ invoiceNumber: `INV-${++n}`, issueDate: "2026-09-01", currency: "EUR", totalWithVat: 100, _confidence: 0.9 })
  ),
};

async function seedSource() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-email', 'ap', 'Email')").run();
  await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism, email_address, status) VALUES ('s-ap', 'ap', 'AP mailbox', 'email', ?, 'active')")
    .bind(ADDRESS)
    .run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('s-ap', 'email-in', 'ap', 's-ap')").run();
}

const invoices = async () => (await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>())!.n;
const messages = async () =>
  (await env.DB.prepare("SELECT id, status, read_queued_at, reading_until, read_count FROM route_messages ORDER BY received_at").all<{
    id: string;
    status: string;
    read_queued_at: string | null;
    reading_until: string | null;
    read_count: number;
  }>()).results;
const events = async (id: string) =>
  (await env.DB.prepare("SELECT event FROM route_message_events WHERE message_id = ? ORDER BY seq").bind(id).all<{ event: string }>()).results.map((e) => e.event);
const receive = (m: EmailMessage, finished?: (id: string) => Promise<void>) =>
  handleInboundEmail(m, env.DB, reads as never, env.DOCUMENTS, CUSTOMER, finished, { readLater: true });
const deps = { model: reads as never, bucket: env.DOCUMENTS, customerId: CUSTOMER };

beforeEach(async () => {
  await applyTestSchema();
  await seedSource();
  reads.extract.mockClear();
  n = 0;
});

describe("an emailed message is accepted at once and read afterwards (decision 0687)", () => {
  it("stores the email and its attachments, reads nothing, and leaves it in process", async () => {
    const m = message(["a.pdf", "b.pdf", "c.pdf"]);
    const finished = vi.fn(async () => {});
    await receive(m, finished);
    expect(m.rejected).toBeNull();
    expect(reads.extract).not.toHaveBeenCalled();
    expect(await invoices()).toBe(0);
    const [row] = await messages();
    expect(row.status).toBe("received");
    expect(row.read_queued_at).not.toBeNull();
    expect(await events(row.id)).toEqual(["received", "original_stored", "queued"]);
    const parts = await env.DB.prepare("SELECT seq, outcome FROM route_message_parts WHERE message_id = ? AND role = 'attachment'").bind(row.id).all();
    expect(parts.results).toEqual([
      { seq: 1, outcome: null },
      { seq: 2, outcome: null },
      { seq: 3, outcome: null },
    ]);
    // Not finished, so nobody is told anything yet.
    expect(finished).not.toHaveBeenCalled();
  });

  it("reads it on the next run, settles it, and tells whoever asked", async () => {
    await receive(message(["a.pdf", "b.pdf"]));
    const finished = vi.fn(async () => {});
    const run = await readQueuedInbound(env.DB, { ...deps, onFinished: finished });
    const [row] = await messages();
    expect(run).toEqual({ read: [row.id], settled: [row.id] });
    expect(await invoices()).toBe(2);
    expect(row.status).toBe("delivered");
    expect(row.reading_until).toBeNull();
    expect(finished).toHaveBeenCalledWith(row.id);
    const arrival = await env.DB.prepare("SELECT outcome, attachments, captured FROM inbound_email_events").first();
    expect(arrival).toEqual({ outcome: "captured", attachments: 2, captured: 2 });
    // Read once: a second run finds nothing to do.
    expect(await readQueuedInbound(env.DB, deps)).toEqual({ read: [], settled: [] });
    expect(await invoices()).toBe(2);
  });

  it("stops between attachments when its time is up, and the next run carries on without reading any twice", async () => {
    await receive(message(["a.pdf", "b.pdf", "c.pdf"]));
    let clock = 0;
    const now = () => clock;
    // Each attachment fetched takes a second of the run's time.
    const slowBucket = {
      get: async (key: string) => {
        clock += 1000;
        return env.DOCUMENTS.get(key);
      },
    } as unknown as R2Bucket;
    const first = await readQueuedInbound(env.DB, { ...deps, bucket: slowBucket }, { budgetMs: 1500, now });
    expect(first.settled).toEqual([]);
    expect(await invoices()).toBe(2);
    const [row] = await messages();
    expect(row.status).toBe("received");
    expect(row.reading_until).toBeNull();

    const second = await readQueuedInbound(env.DB, { ...deps, bucket: slowBucket }, { budgetMs: 1500, now });
    expect(second.settled).toEqual([row.id]);
    expect(await invoices()).toBe(3);
    expect((await messages())[0].status).toBe("delivered");
    expect(await events(row.id)).toContain("read_resumed");
  });

  it("leaves a message another run is reading alone, and refuses to reprocess it meanwhile", async () => {
    await receive(message(["a.pdf"]));
    const [row] = await messages();
    const later = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE route_messages SET reading_until = ? WHERE id = ?").bind(later, row.id).run();
    expect(await readQueuedInbound(env.DB, deps)).toEqual({ read: [], settled: [] });
    const refused = await handleReprocessMessage(env.DB, row.id, "u-1", deps);
    expect(refused.status).toBe(409);
    expect((refused.body as { reason: string }).reason).toBe("being_read");
    expect(await invoices()).toBe(0);
  });

  it(`fails what is still unread after ${MAX_READS} runs that never finished, and settles the message`, async () => {
    await receive(message(["a.pdf", "b.pdf"]));
    const [row] = await messages();
    // Three runs claimed it and died without a word (a Worker cut off mid-read).
    await env.DB.prepare("UPDATE route_messages SET read_count = ? WHERE id = ?").bind(MAX_READS, row.id).run();
    const finished = vi.fn(async () => {});
    await readQueuedInbound(env.DB, { ...deps, onFinished: finished });
    const after = (await messages())[0];
    expect(after.status).toBe("failed");
    expect(reads.extract).not.toHaveBeenCalled();
    const parts = await env.DB.prepare("SELECT outcome, reason FROM route_message_parts WHERE message_id = ? AND role = 'attachment'").bind(row.id).all();
    expect(parts.results).toEqual([
      { outcome: "failed", reason: `not read after ${MAX_READS} tries` },
      { outcome: "failed", reason: `not read after ${MAX_READS} tries` },
    ]);
    expect(await events(row.id)).toContain("read_given_up");
    expect(finished).toHaveBeenCalledWith(row.id);
  });

  it("never picks up a message received before this change", async () => {
    await env.DB.prepare("INSERT INTO route_messages (id, instance_id, direction, status, received_at) VALUES ('MSG-OLD', 's-ap', 'in', 'received', '2026-10-08T10:00:00Z')").run();
    expect(await readQueuedInbound(env.DB, deps)).toEqual({ read: [], settled: [] });
  });

  it("still refuses at once what it can tell without reading: no attachment", async () => {
    const m = message([]);
    await receive(m);
    expect(m.rejected).toContain("No invoice was attached");
    expect((await messages())[0].status).toBe("failed");
  });
});

describe("the same email delivered twice is read once (decision 0687)", () => {
  it("notes the second delivery on the first and makes nothing", async () => {
    await receive(message(["a.pdf", "b.pdf"], "<same@munch.de>"));
    await readQueuedInbound(env.DB, deps);
    expect(await invoices()).toBe(2);

    const again = message(["a.pdf", "b.pdf"], "<same@munch.de>");
    const finished = vi.fn(async () => {});
    await receive(again, finished);
    expect(again.rejected).toBeNull();
    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(await events(rows[0].id)).toContain("received_again");
    await readQueuedInbound(env.DB, deps);
    expect(await invoices()).toBe(2);
    expect(finished).not.toHaveBeenCalled();
    const monitor = await handleGetRouteMessage(env.DB, rows[0].id);
    expect((monitor.body as { events: { event: string }[] }).events.map((e) => e.event)).toContain("received_again");
  });

  it("knows a repeat with no Message-ID by its bytes", async () => {
    await receive(message(["a.pdf"], null));
    await receive(message(["a.pdf"], null));
    expect(await messages()).toHaveLength(1);
  });

  it("takes a different email with the same attachments as new, as a supplier re-sending on purpose is", async () => {
    await receive(message(["a.pdf"], "<one@munch.de>"));
    await receive(message(["a.pdf"], "<two@munch.de>"));
    expect(await messages()).toHaveLength(2);
  });
});

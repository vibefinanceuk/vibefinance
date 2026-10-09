import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { nextUtcMidnight, readQueuedInbound } from "../src/inbound-read-later.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleReprocessMessage } from "../src/route-reprocess.js";
import { ExtractionRefusal, allowanceMessage, isAllowanceError } from "../src/extraction.js";
import { createWorkersAiExtractionModel } from "../src/extraction-model.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS } from "../src/permissions.js";
import { SCANNED_FLATE_JPEG_PDF_B64 } from "./fixtures/pdf-read-fixtures.js";

/**
 * **The day's AI allowance used up — decision 0696.** Not a fact about the
 * document: an emailed one waits and is read after 00:00 UTC; nothing is
 * failed, bounced or kept for keying because of it.
 */
const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";
const SCAN = () => Uint8Array.from(atob(SCANNED_FLATE_JPEG_PDF_B64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
const READ = JSON.stringify({ invoiceNumber: "INV-1", totalWithVat: 100, _confidence: 0.9, lines: [{ description: "Toner", amount: 100 }] });
const ALLOWANCE = "AiError: 4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.";

const exhausted = () => ({
  extract: async () => {
    throw new ExtractionRefusal(allowanceMessage(ALLOWANCE), undefined, true, true);
  },
});
const reads = { extract: async () => READ };

function rawEmail(messageId: string) {
  const boundary = "----vf-allow";
  const pdf = SCAN();
  let bin = "";
  for (const b of pdf) bin += String.fromCharCode(b);
  return (
    `Message-ID: <${messageId}>\r\nFrom: accounts@munch.de\r\nTo: ${ADDRESS}\r\nSubject: invoice\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf; name="scan.pdf"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="scan.pdf"\r\n\r\n${btoa(bin)}\r\n--${boundary}--`
  );
}
function message(messageId: string): EmailMessage & { rejected: string | null } {
  const raw = rawEmail(messageId);
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

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
  await handleCreateStage(env.DB, "ap", { id: "received", name: "Received", sequence: 1 });
  await handleCreateIntakeChannel(env.DB, "ap", { id: "ch-image", name: "Image", structure: "image" });
  await handleCreateSource(env.DB, "ap", { id: "s-ap", name: "AP mailbox", mechanism: "email" });
  await env.DB.prepare("UPDATE sources SET email_address = ? WHERE id = 's-ap'").bind(ADDRESS).run();
});

const invoices = async () => (await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>())!.n;
const messages = async () =>
  (await env.DB.prepare("SELECT id, status, error_code, reading_until, read_count FROM route_messages ORDER BY received_at").all<{
    id: string;
    status: string;
    error_code: string | null;
    reading_until: string | null;
    read_count: number;
  }>()).results;

describe("recognising it (decision 0696)", () => {
  it("knows Workers AI's allowance refusal by its codes and its words, and nothing else", () => {
    expect(isAllowanceError(ALLOWANCE)).toBe(true);
    expect(isAllowanceError("AiError: 3036: You have used up your daily free allocation")).toBe(true);
    expect(isAllowanceError("AiError: 3046: Request timeout")).toBe(false);
    expect(isAllowanceError("AiError: 5007: model not found")).toBe(false);
  });

  it("is raised by the Workers AI adapter as an allowance refusal, with the model's own words kept", async () => {
    const model = createWorkersAiExtractionModel({ run: async () => { throw new Error(ALLOWANCE); } } as never);
    const err = await model.extract("p", [{ bytes: new Uint8Array([0xff, 0xd8]), contentType: "image/jpeg" }], {}).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionRefusal);
    expect(err.allowance).toBe(true);
    expect(err.unanswered).toBe(true);
    expect(err.message).toMatch(/^the AI allowance for today is used up, so this was not read; it will be read after the allowance resets at 00:00 UTC/);
    expect(err.message).toContain("4006");
  });
});

describe("an emailed document waits for the allowance (decision 0696)", () => {
  it("leaves the message waiting until just after midnight, counts no try, stops the run, and reads it after the reset", async () => {
    await handleInboundEmail(message("a1@munch.de"), env.DB, reads as never, env.DOCUMENTS, CUSTOMER, undefined, { readLater: true });
    await handleInboundEmail(message("a2@munch.de"), env.DB, reads as never, env.DOCUMENTS, CUSTOMER, undefined, { readLater: true });
    const [first, second] = await messages();

    // 9 October, 10:00 UTC: the allowance is used up.
    let clock = Date.parse("2026-10-09T10:00:00Z");
    const now = () => clock;
    const run = await readQueuedInbound(env.DB, { model: exhausted() as never, bucket: env.DOCUMENTS, customerId: CUSTOMER }, { now });
    expect(run).toEqual({ read: [first.id], settled: [] });
    expect(await invoices()).toBe(0);
    const after = await messages();
    expect(after[0]).toMatchObject({ status: "received", error_code: null, reading_until: "2026-10-10T00:05:00.000Z", read_count: 0 });
    // The second was not tried: no allowance for it either.
    expect(after[1]).toMatchObject({ status: "received", read_count: 0, reading_until: null });
    const part = await env.DB.prepare("SELECT outcome FROM route_message_parts WHERE message_id = ? AND role = 'attachment'").bind(first.id).first();
    expect(part).toEqual({ outcome: null });
    const events = (await env.DB.prepare("SELECT event, detail FROM route_message_events WHERE message_id = ? ORDER BY seq").bind(first.id).all<{ event: string; detail: string }>()).results;
    expect(events.at(-1)?.event).toBe("read_deferred");
    expect(events.at(-1)?.detail).toContain("AI allowance for today is used up");

    // Before the reset the waiting one is left alone; the second, never paused, is read when the model answers.
    clock = Date.parse("2026-10-09T23:59:00Z");
    const before = await readQueuedInbound(env.DB, { model: reads as never, bucket: env.DOCUMENTS, customerId: CUSTOMER }, { now });
    expect(before.settled).toEqual([second.id]);
    expect((await messages()).find((m) => m.id === first.id)?.status).toBe("received");

    // After the reset the waiting one is read too, its paused try not counted.
    clock = Date.parse("2026-10-10T00:06:00Z");
    const later = await readQueuedInbound(env.DB, { model: reads as never, bucket: env.DOCUMENTS, customerId: CUSTOMER }, { now });
    expect(later.settled).toEqual([first.id]);
    expect(await invoices()).toBe(2);
    expect((await messages()).map((m) => [m.status, m.read_count])).toEqual([
      ["delivered", 1],
      ["delivered", 1],
    ]);
  });

  it("works out the next 00:00 UTC across a month and a year", () => {
    expect(new Date(nextUtcMidnight(Date.parse("2026-10-31T22:00:00Z"))).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(nextUtcMidnight(Date.parse("2026-12-31T23:59:59Z"))).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("does not bounce an email read on arrival, and labels it so Reprocess after the reset reads it", async () => {
    const m = message("inline@munch.de");
    // No bucket: read on arrival, the old path.
    await handleInboundEmail(m, env.DB, exhausted() as never, undefined, CUSTOMER);
    expect(m.rejected).toBeNull();
    const [row] = await messages();
    expect(row).toMatchObject({ status: "failed", error_code: "ai_allowance" });
    expect(await invoices()).toBe(0);
  });

  it("Reprocess during the outage says ai_allowance, and leaves the attachment to be read later", async () => {
    await handleInboundEmail(message("rp@munch.de"), env.DB, reads as never, env.DOCUMENTS, CUSTOMER, undefined, { readLater: true });
    const [row] = await messages();
    const result = await handleReprocessMessage(env.DB, row.id, "u-1", { model: exhausted() as never, bucket: env.DOCUMENTS, customerId: CUSTOMER });
    expect(result.status).toBe(200);
    expect((await messages())[0]).toMatchObject({ status: "failed", error_code: "ai_allowance" });
    const part = await env.DB.prepare("SELECT outcome FROM route_message_parts WHERE message_id = ? AND role = 'attachment'").bind(row.id).first();
    expect(part).toEqual({ outcome: null });
    // After the reset, Reprocess reads it.
    const again = await handleReprocessMessage(env.DB, row.id, "u-1", { model: reads as never, bucket: env.DOCUMENTS, customerId: CUSTOMER });
    expect((again.body as { status: string }).status).toBe("delivered");
    expect(await invoices()).toBe(1);
  });
});

describe("a direct capture is told to come back (decision 0696)", () => {
  it("answers 503 ai_allowance and makes nothing, rather than an invoice to key", async () => {
    const result = await handleCaptureFromSource(env.DB, "s-ap", SCAN(), exhausted());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ allowance: true, reason: "ai_allowance" });
    expect(await invoices()).toBe(0);
  });

  it("stops at the lines call too, rather than keeping a header with its lines lost", async () => {
    let calls = 0;
    const model = {
      extract: async () => {
        calls++;
        if (calls === 1) return READ;
        throw new ExtractionRefusal(allowanceMessage(ALLOWANCE), undefined, true, true);
      },
    };
    const result = await handleCaptureFromSource(env.DB, "s-ap", SCAN(), model);
    expect(result.status).toBe(503);
    expect(await invoices()).toBe(0);
  });
});

async function seedActiveLicence(): Promise<void> {
  const claims = {
    customerId: "test-customer",
    plan: "standard",
    features: [],
    volumeEntitlement: 10000,
    status: "active",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)")
    .bind(JSON.stringify(claims), new Date().toISOString())
    .run();
}

describe("the Rules screen says so (decision 0696)", () => {
  it("answers 503 with the allowance wording, not a failure", async () => {
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES ('u-r', 'r@acme.com', 'R', ?)").bind(await hashApiKey(apiKey)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('role-all', 'All', ?)").bind(JSON.stringify(PERMISSIONS)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-r', 'role-all')").run();
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-v', 'Validation', 'first_match', 'active')").run();
    await seedActiveLicence();
    const res = await worker.fetch(
      new Request("https://example.com/rules/compile", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ruleSetId: "rs-v", sourceText: "If the supplier is not known, assign a task to the AP team" }),
      }),
      { ...env, AI: { run: async () => { throw new Error(ALLOWANCE); } } } as unknown as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
    );
    const body = (await res.json()) as { error: string; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(503);
    expect(body.reason).toBe("ai_allowance");
    expect(body.error).toMatch(/^The AI allowance for today is used up, so the rule could not be worked out\. It resets at 00:00 UTC/);
  });
});

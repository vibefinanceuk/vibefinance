import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmailViaResend, verifyResendWebhookSignature } from "../src/resend-client.js";

describe("sendEmailViaResend", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the message id on success", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "msg-123" }), { status: 200 })) as unknown as typeof fetch;

    const result = await sendEmailViaResend("key", { from: "a@x.com", to: "b@y.com", subject: "hi", text: "body" });
    expect(result).toEqual({ ok: true, messageId: "msg-123" });
  });

  it("passes cc only when given", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await sendEmailViaResend("key", { from: "a@x.com", to: "b@y.com", subject: "hi", text: "body" });
    expect(capturedBody).not.toHaveProperty("cc");

    await sendEmailViaResend("key", { from: "a@x.com", to: "b@y.com", cc: "c@z.com", subject: "hi", text: "body" });
    expect(capturedBody).toEqual(expect.objectContaining({ cc: ["c@z.com"] }));
  });

  it("reports Resend's own refusal message on a non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "invalid `from` field" }), { status: 422 })
    ) as unknown as typeof fetch;

    const result = await sendEmailViaResend("key", { from: "bad", to: "b@y.com", subject: "hi", text: "body" });
    expect(result).toEqual({ ok: false, error: "invalid `from` field" });
  });

  it("reports a plain failure when fetch itself throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await sendEmailViaResend("key", { from: "a@x.com", to: "b@y.com", subject: "hi", text: "body" });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("network down");
  });
});

describe("verifyResendWebhookSignature", () => {
  const secretB64 = "dGhpcyBpcyBhIHRlc3Qgc2VjcmV0"; // "this is a test secret", base64
  const secret = `whsec_${secretB64}`;

  async function sign(id: string, timestamp: string, body: string): Promise<string> {
    const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const bytes = new Uint8Array(mac);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  it("verifies a correctly signed payload", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const signature = await sign("msg_1", "1700000000", body);
    const ok = await verifyResendWebhookSignature(
      secret,
      { id: "msg_1", timestamp: "1700000000", signature: `v1,${signature}` },
      body
    );
    expect(ok).toBe(true);
  });

  it("accepts a match anywhere in a space-separated multi-version list", async () => {
    const body = JSON.stringify({ type: "email.sent" });
    const signature = await sign("msg_2", "1700000001", body);
    const ok = await verifyResendWebhookSignature(
      secret,
      { id: "msg_2", timestamp: "1700000001", signature: `v1,not-the-real-one v1,${signature}` },
      body
    );
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify({ type: "email.sent" });
    const signature = await sign("msg_3", "1700000002", body);
    const ok = await verifyResendWebhookSignature(
      secret,
      { id: "msg_3", timestamp: "1700000002", signature: `v1,${signature}` },
      JSON.stringify({ type: "email.bounced" })
    );
    expect(ok).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const body = JSON.stringify({ type: "email.sent" });
    const wrongRaw = Uint8Array.from(atob("d3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldA=="), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", wrongRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`msg_4.1700000003.${body}`));
    let binary = "";
    for (const b of new Uint8Array(mac)) binary += String.fromCharCode(b);
    const wrongSignature = btoa(binary);

    const ok = await verifyResendWebhookSignature(
      secret,
      { id: "msg_4", timestamp: "1700000003", signature: `v1,${wrongSignature}` },
      body
    );
    expect(ok).toBe(false);
  });
});

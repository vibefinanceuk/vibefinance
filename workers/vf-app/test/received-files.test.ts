import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { handleGetActivity } from "../src/activity-route.js";
import { mintPartToken, verifyPartToken } from "../src/document-token.js";
import { renderEmailForDisplay, viewFor } from "../src/received-files.js";

/**
 * **Everything received with an invoice — decision 0571.** The Timeline
 * names the message an invoice came in, and the Attachments tab offers
 * the email and every file it carried.
 */

const SECRET = "test-document-secret";
const MSG = "MSG-7A86-7670-F2A5";
const OTHER = "MSG-0000-1111-2222";

const EML = [
  "From: =?utf-8?Q?M=C3=BCnch_GmbH?= <ap@munch.example>",
  "To: invoices@acme.example",
  "Subject: Invoice 88250",
  "Date: Tue, 29 Sep 2026 09:14:00 +0000",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  'Content-Type: multipart/alternative; boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Please find our invoice attached. <script>alert(1)</script>",
  "Kind regards =E2=80=93 M=C3=BCnch",
  "--b2",
  "Content-Type: text/html",
  "",
  "<p>Please find our invoice attached.</p>",
  "--b2--",
  "--b1",
  'Content-Type: application/pdf; name="88250.pdf"',
  'Content-Disposition: attachment; filename="88250.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--b1--",
  "",
].join("\r\n");

let key: string;

async function seedPermitted(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Reader", await hashApiKey(apiKey))
    .run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Reader', ?)")
    .bind(roleId, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

async function part(messageId: string, seq: number, role: string, filename: string, type: string, body: string) {
  const r2Key = `test/${messageId}/${seq}/${filename}`;
  await env.DOCUMENTS.put(r2Key, body);
  await env.DB.prepare(
    `INSERT INTO route_message_parts (message_id, seq, role, filename, content_type, bytes, sha256, r2_key, stored_at)
     VALUES (?, ?, ?, ?, ?, ?, 'x', ?, '2026-09-29T09:14:00Z')`
  )
    .bind(messageId, seq, role, filename, type, body.length, r2Key)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  key = await seedPermitted(["AP.Validate"]);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism, email_address) VALUES ('s-ap', 'ap', 'AP mailbox', 'email', 'ap@acme.example')"
  ).run();
  for (const id of ["inv-r", "inv-other", "inv-plain"]) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, created_at) VALUES (?, '{}', '2026-09-29 09:15:00')")
      .bind(id)
      .run();
  }
  for (const [id, subject] of [
    [MSG, "Invoice 88250"],
    [OTHER, "Unrelated"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO route_messages (id, instance_id, direction, status, counterparty, subject, received_at)
       VALUES (?, 's-ap', 'in', 'delivered', 'ap@munch.example', ?, '2026-09-29T09:14:00Z')`
    )
      .bind(id, subject)
      .run();
  }
  await part(MSG, 0, "original", "message.eml", "message/rfc822", EML);
  await part(MSG, 1, "attachment", "88250.pdf", "application/pdf", "%PDF-1.4 this invoice");
  await part(MSG, 2, "attachment", "88251.pdf", "application/pdf", "%PDF-1.4 another invoice");
  await part(MSG, 3, "attachment", "logo.svg", "image/svg+xml", "<svg onload='alert(1)'/>");
  await part(OTHER, 0, "original", "message.eml", "message/rfc822", "Subject: nothing\r\n\r\nhi");
  await env.DB.prepare(
    "INSERT INTO route_message_items (message_id, item_type, item_id, part_seq) VALUES (?, 'invoice', 'inv-r', 1), (?, 'invoice', 'inv-other', 2)"
  )
    .bind(MSG, MSG)
    .run();
  await env.DB.prepare(
    `INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type, route_message_id, part_seq)
     VALUES ('d-1', 'inv-r', 'test/${MSG}/1/88250.pdf', 'original', 'application/pdf', ?, 1)`
  )
    .bind(MSG)
    .run();
  await env.DOCUMENTS.put("test/inv-r/embedded.xml", "<Invoice><ID>88250</ID></Invoice>");
  await env.DB.prepare(
    `INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type)
     VALUES ('d-2', 'inv-r', 'test/inv-r/embedded.xml', 'embedded_xml', 'application/xml'),
            ('d-3', 'inv-plain', 'test/inv-plain.png', 'original', 'image/png')`
  ).run();
});

const withSecret = (): Env => ({ ...env, DOCUMENT_URL_SECRET: SECRET }) as Env;
const call = (path: string, init: RequestInit = {}, apiKey = key) =>
  worker.fetch(
    new Request(`https://example.com${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}` } }),
    withSecret()
  );

describe("the Timeline names the message an invoice came in", () => {
  it("gives the message, its source, its sender and the file", async () => {
    const result = await handleGetActivity(env.DB, "inv-r");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "received")).toEqual({
      kind: "received",
      at: "2026-09-29T09:15:00.000Z",
      messageId: MSG,
      source: "AP mailbox",
      sender: "ap@munch.example",
      filename: "88250.pdf",
    });
  });

  it("says only that it was received when no message holds it", async () => {
    const result = await handleGetActivity(env.DB, "inv-plain");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items).toEqual([{ kind: "received", at: "2026-09-29T09:15:00.000Z" }]);
  });
});

describe("the Attachments list", () => {
  it("lists the email, every attachment, and the XML inside the PDF, marking this invoice's file", async () => {
    const res = await call("/invoices/inv-r/attachments");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { id: string }[]; files: Record<string, unknown>[] };
    expect(body.messages.map((m) => m.id)).toEqual([MSG]);
    expect(body.files.map((f) => [f.kind, f.filename ?? f.documentType, f.thisInvoice, f.view])).toEqual([
      ["part", "message.eml", false, "inline"],
      ["part", "88250.pdf", true, "inline"],
      ["part", "88251.pdf", false, "inline"],
      ["part", "logo.svg", false, "download"],
      ["document", "embedded_xml", false, "inline"],
    ]);
  });

  it("lists the original document for an invoice no message holds", async () => {
    const body = (await (await call("/invoices/inv-plain/attachments")).json()) as { messages: unknown[]; files: Record<string, unknown>[] };
    expect(body.messages).toEqual([]);
    expect(body.files).toEqual([
      { kind: "document", documentType: "original", filename: null, contentType: "image/png", bytes: null, thisInvoice: true, view: "inline" },
    ]);
  });

  it("is refused to someone who may not see the invoice", async () => {
    const other = await seedPermitted(["AP.Review"]);
    expect((await call("/invoices/inv-r/attachments", {}, other)).status).toBe(403);
    expect((await call(`/invoices/inv-r/attachments/${MSG}/1/url`, { method: "POST" }, other)).status).toBe(403);
  });
});

describe("a received file, by signed link", () => {
  async function linkFor(invoiceId: string, messageId: string, seq: number) {
    const res = await call(`/invoices/${invoiceId}/attachments/${messageId}/${seq}/url`, { method: "POST" });
    return { res, body: res.status === 200 ? ((await res.json()) as { url: string; view: string }) : null };
  }
  const fetchUrl = (url: string) => worker.fetch(new Request(url), withSecret());

  it("shows the email as a person reads it, escaped", async () => {
    const { body } = await linkFor("inv-r", MSG, 0);
    const res = await fetchUrl(body!.url);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("Münch GmbH &lt;ap@munch.example&gt;");
    expect(html).toContain("Invoice 88250");
    expect(html).toContain("Kind regards – Münch");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<li>88250.pdf</li>");
    expect(html).not.toContain("JVBERi0xLjQK");
  });

  it("shows a PDF in place, and downloads it under its own name when asked", async () => {
    const { body } = await linkFor("inv-r", MSG, 1);
    expect(body!.view).toBe("inline");
    const shown = await fetchUrl(body!.url);
    expect(shown.headers.get("Content-Type")).toBe("application/pdf");
    expect(shown.headers.get("Content-Disposition")).toMatch(/^inline/);
    expect(await shown.text()).toBe("%PDF-1.4 this invoice");
    const saved = await fetchUrl(`${body!.url}?download=1`);
    expect(saved.headers.get("Content-Disposition")).toBe('attachment; filename="88250.pdf"');
  });

  it("only ever downloads somebody else's active content", async () => {
    const { body } = await linkFor("inv-r", MSG, 3);
    expect(body!.view).toBe("download");
    const res = await fetchUrl(body!.url);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="logo.svg"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("refuses a message the invoice did not come in, and a link tampered with", async () => {
    expect((await linkFor("inv-r", OTHER, 0)).res.status).toBe(404);
    expect((await linkFor("inv-r", MSG, 9)).res.status).toBe(404);
    const { body } = await linkFor("inv-r", MSG, 1);
    const forged = body!.url.replace(`.${MSG}.1.`, `.${OTHER}.0.`);
    expect((await fetchUrl(forged)).status).toBe(403);
    // A genuine token for a message that is not this invoice's still finds nothing.
    const { token } = await mintPartToken(SECRET, "inv-r", OTHER, 0);
    expect((await fetchUrl(`https://example.com/received-files/${token}`)).status).toBe(404);
  });

  it("downloads the invoice's own document when asked", async () => {
    const res = await call("/invoices/inv-r/document-url?type=embedded_xml", { method: "POST" });
    const { url } = (await res.json()) as { url: string };
    const saved = await fetchUrl(`${url}?download=1`);
    expect(saved.headers.get("Content-Disposition")).toBe('attachment; filename="invoice-inv-r-embedded_xml.xml"');
    expect(await saved.text()).toBe("<Invoice><ID>88250</ID></Invoice>");
  });
});

describe("the part token and what is shown", () => {
  it("round-trips, expires, and is refused when changed", async () => {
    const { token } = await mintPartToken(SECRET, "inv-r", MSG, 2, 1000);
    expect(await verifyPartToken(SECRET, token, 1001)).toEqual({ valid: true, invoiceId: "inv-r", messageId: MSG, seq: 2 });
    expect(await verifyPartToken(SECRET, token, 1000 + 301)).toEqual({ valid: false, reason: "expired" });
    expect(await verifyPartToken(SECRET, token.replace(".2.", ".3."), 1001)).toEqual({ valid: false, reason: "bad signature" });
    expect(await verifyPartToken(SECRET, token.replace("part.", "page."), 1001)).toEqual({ valid: false, reason: "malformed" });
  });

  it("shows only what is safe to show", () => {
    expect(viewFor("application/pdf", "a.pdf")).toBe("inline");
    expect(viewFor("image/jpeg", "a.jpg")).toBe("inline");
    expect(viewFor("application/octet-stream", "a.xml")).toBe("inline");
    expect(viewFor("text/html", "a.html")).toBe("download");
    expect(viewFor("image/svg+xml", "a.svg")).toBe("download");
    expect(viewFor("image/tiff", "a.tif")).toBe("download");
    expect(viewFor("application/zip", "a.zip")).toBe("download");
  });

  it("reads an HTML-only email as text", () => {
    const html = renderEmailForDisplay(
      new TextEncoder().encode("Subject: Hi\r\nContent-Type: text/html\r\n\r\n<p>Line one<br>Line &amp; two</p><script>x()</script>")
    );
    expect(html).toContain("Line one\nLine &amp; two");
    expect(html).not.toContain("x()");
  });
});

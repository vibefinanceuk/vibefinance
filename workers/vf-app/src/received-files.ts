import { renderCsvTable } from "./csv-render.js";
import { renderXmlForDisplay } from "./document-storage.js";

/**
 * **Everything received with an invoice — decision 0571.**
 *
 * Asked for live, after slice 4: the viewer's XML tab becomes
 * **Attachments**, with *"access to anything we have received"*: the
 * email itself, the XML, image or PDF, and anything sent with them. And
 * the Timeline names the message the invoice came in, for example
 * `MSG-7A86-7670-F2A5`, *"unique to the transmission"*.
 *
 * **Nothing new is stored.** A route keeps every message and every part
 * of it (decision 0556, `route_message_parts`), and records which invoice
 * each part made (`route_message_items`, and `invoice_documents`'
 * `route_message_id` and `part_seq`). This reads them.
 */

export interface ReceivedMessage {
  id: string;
  source: string | null;
  sender: string | null;
  subject: string | null;
  receivedAt: string;
  /** The part this invoice was read from, when known. */
  partSeq: number | null;
  filename: string | null;
}

export interface ReceivedFile {
  kind: "part" | "document";
  /** A part's message and sequence; a document's type. */
  messageId?: string;
  seq?: number;
  role?: string;
  documentType?: "original" | "embedded_xml";
  filename: string | null;
  contentType: string;
  bytes: number | null;
  /** The file this invoice was read from. */
  thisInvoice: boolean;
  /** Shown in the tab, or only downloaded. */
  view: "inline" | "download";
}

/** The messages this invoice came in, oldest first. Usually one. */
export async function messagesForInvoice(db: D1Database, invoiceId: string): Promise<ReceivedMessage[]> {
  const rows = await db
    .prepare(
      `SELECT m.id, s.name AS source, m.counterparty AS sender, m.subject, m.received_at,
              COALESCE(i.part_seq, d.part_seq) AS part_seq
       FROM route_messages m
       LEFT JOIN sources s ON s.id = m.instance_id
       LEFT JOIN route_message_items i ON i.message_id = m.id AND i.item_type = 'invoice' AND i.item_id = ?1
       LEFT JOIN invoice_documents d ON d.route_message_id = m.id AND d.invoice_id = ?1 AND d.document_type = 'original'
       WHERE m.direction = 'in' AND (i.item_id IS NOT NULL OR d.id IS NOT NULL)
       ORDER BY m.received_at, m.id`
    )
    .bind(invoiceId)
    .all<{ id: string; source: string | null; sender: string | null; subject: string | null; received_at: string; part_seq: number | null }>();
  const out: ReceivedMessage[] = [];
  for (const r of rows.results) {
    if (out.some((m) => m.id === r.id)) continue;
    const part =
      r.part_seq === null
        ? null
        : await db
            .prepare("SELECT filename FROM route_message_parts WHERE message_id = ? AND seq = ?")
            .bind(r.id, r.part_seq)
            .first<{ filename: string }>();
    out.push({
      id: r.id,
      source: r.source,
      sender: r.sender,
      subject: r.subject,
      receivedAt: r.received_at,
      partSeq: r.part_seq,
      filename: part?.filename ?? null,
    });
  }
  return out;
}

const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;

/**
 * How a file is shown. Only what this app renders itself (XML, CSV, an
 * email, plain text), a PDF, or an ordinary image is shown in the tab.
 * Anything else, an HTML or SVG attachment above all, is somebody else's
 * active content and is only ever downloaded, as the Route monitor does
 * (decision 0556).
 */
export function viewFor(contentType: string, filename: string | null): "inline" | "download" {
  const type = contentType.toLowerCase();
  if (type.includes("svg") || type.includes("html")) return "download";
  if (type.includes("xml") || /\.xml$/i.test(filename ?? "")) return "inline";
  if (type.includes("csv") || /\.csv$/i.test(filename ?? "")) return "inline";
  if (type === "message/rfc822" || /\.eml$/i.test(filename ?? "")) return "inline";
  if (type === "text/plain" || type === "application/pdf" || IMAGE.test(type)) return "inline";
  return "download";
}

/**
 * Every file received with this invoice.
 *
 * - **Each message's own parts**: the email as it arrived (`original`),
 *   then every attachment, including ones that made other invoices or
 *   were skipped. A person asked for *anything we have received*.
 * - **The XML inside a PDF** (`embedded_xml`), which was received too,
 *   inside the file.
 * - **The original document**, only when no message holds it: an
 *   invoice uploaded or captured before routes kept messages.
 */
export async function receivedFiles(db: D1Database, invoiceId: string): Promise<ReceivedFile[]> {
  const messages = await messagesForInvoice(db, invoiceId);
  const files: ReceivedFile[] = [];
  for (const m of messages) {
    const parts = await db
      .prepare(
        `SELECT seq, role, filename, content_type, bytes FROM route_message_parts
         WHERE message_id = ? AND role IN ('original', 'attachment') ORDER BY seq`
      )
      .bind(m.id)
      .all<{ seq: number; role: string; filename: string; content_type: string; bytes: number }>();
    for (const p of parts.results) {
      files.push({
        kind: "part",
        messageId: m.id,
        seq: p.seq,
        role: p.role,
        filename: p.filename,
        contentType: p.content_type,
        bytes: p.bytes,
        thisInvoice: m.partSeq === p.seq,
        view: viewFor(p.content_type, p.filename),
      });
    }
  }
  const docs = await db
    .prepare(
      `SELECT document_type, content_type, route_message_id FROM invoice_documents
       WHERE invoice_id = ? AND document_type IN ('original', 'embedded_xml')
       ORDER BY CASE document_type WHEN 'original' THEN 0 ELSE 1 END`
    )
    .bind(invoiceId)
    .all<{ document_type: "original" | "embedded_xml"; content_type: string; route_message_id: string | null }>();
  for (const d of docs.results) {
    if (d.document_type === "original" && (d.route_message_id !== null || files.some((f) => f.thisInvoice))) continue;
    files.push({
      kind: "document",
      documentType: d.document_type,
      filename: null,
      contentType: d.content_type,
      bytes: null,
      thisInvoice: d.document_type === "original",
      view: viewFor(d.content_type, null),
    });
  }
  return files;
}

/** One received part, if its message belongs to this invoice. */
export async function partForInvoice(
  db: D1Database,
  invoiceId: string,
  messageId: string,
  seq: number
): Promise<{ r2Key: string; filename: string; contentType: string } | null> {
  const messages = await messagesForInvoice(db, invoiceId);
  if (!messages.some((m) => m.id === messageId)) return null;
  const row = await db
    .prepare(
      `SELECT r2_key, filename, content_type FROM route_message_parts
       WHERE message_id = ? AND seq = ? AND role IN ('original', 'attachment')`
    )
    .bind(messageId, seq)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  return row ? { r2Key: row.r2_key, filename: row.filename, contentType: row.content_type } : null;
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decodeBase64(text: string): Uint8Array {
  try {
    const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ""));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

function decodeQuotedPrintable(text: string): Uint8Array {
  const joined = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(...encoder.encode(joined[i]));
    }
  }
  return new Uint8Array(out);
}

function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** `=?utf-8?B?…?=` and `=?utf-8?Q?…?=` in a header, as a mail client writes a name with accents. */
function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) =>
      decodeBytes(
        enc.toUpperCase() === "B" ? decodeBase64(text) : decodeQuotedPrintable(text.replace(/_/g, " ")),
        charset
      )
    );
}

function splitHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const name = line.slice(0, i).trim().toLowerCase();
      if (!headers.has(name)) headers.set(name, line.slice(i + 1).trim());
    }
  }
  return headers;
}

function splitEntity(raw: string): { headers: Map<string, string>; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return { headers: splitHeaders(raw), body: "" };
  return { headers: splitHeaders(raw.slice(0, m.index)), body: raw.slice(m.index + m[0].length) };
}

/** The readable text of a MIME entity, and the names of the files in it. */
function walk(raw: string, found: { text: string | null; html: string | null; files: string[] }): void {
  const { headers, body } = splitEntity(raw);
  const type = headers.get("content-type") ?? "text/plain";
  const boundary = type.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    const pieces = body.split(`--${boundary}`).slice(1);
    for (const piece of pieces) {
      if (piece.startsWith("--")) break;
      walk(piece.replace(/^\r?\n/, ""), found);
    }
    return;
  }
  const disposition = headers.get("content-disposition") ?? "";
  const filename =
    (disposition.match(/filename\*?="?([^";\r\n]+)"?/i) ?? type.match(/name="?([^";\r\n]+)"?/i))?.[1] ?? null;
  if (filename || /^attachment/i.test(disposition)) {
    found.files.push(decodeHeaderWords(filename ?? "attachment"));
    return;
  }
  const encoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = type.match(/charset="?([^";\s]+)"?/i)?.[1];
  const bytes =
    encoding === "base64"
      ? decodeBase64(body)
      : encoding === "quoted-printable"
        ? decodeQuotedPrintable(body)
        : new TextEncoder().encode(body);
  const text = decodeBytes(bytes, charset);
  if (/^text\/plain/i.test(type) && found.text === null) found.text = text;
  else if (/^text\/html/i.test(type) && found.html === null) found.html = text;
}

/** An HTML body as plain text, for a message sent without one. Never rendered as HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * **An email as a person reads it** — its sender, recipients, date and
 * subject, its text, and the names of its attachments. Not the raw
 * message, which is mostly base64. Everything is escaped: an email's
 * HTML is somebody else's, so it is shown as text, never run.
 */
export function renderEmailForDisplay(bytes: Uint8Array): string {
  const raw = new TextDecoder("utf-8").decode(bytes);
  const { headers } = splitEntity(raw);
  const found = { text: null as string | null, html: null as string | null, files: [] as string[] };
  walk(raw, found);
  const body = found.text ?? (found.html !== null ? htmlToText(found.html) : "");
  const row = (label: string, name: string) => {
    const v = headers.get(name);
    return v ? `<tr><th>${label}</th><td>${escapeHtml(decodeHeaderWords(v))}</td></tr>` : "";
  };
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #1d2433; background: #fff; }
  table { border-collapse: collapse; margin-bottom: 12px; }
  th { text-align: left; color: #5b6475; font-weight: 500; padding: 2px 12px 2px 0; vertical-align: top; }
  td { padding: 2px 0; }
  pre { margin: 0; padding-top: 12px; border-top: 1px solid #d6dbe4; font-family: inherit; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  ul { margin: 12px 0 0; padding: 12px 0 0 18px; border-top: 1px solid #d6dbe4; color: #5b6475; }
</style>
</head>
<body>
<table>${row("From", "from")}${row("To", "to")}${row("Cc", "cc")}${row("Date", "date")}${row("Subject", "subject")}</table>
<pre>${escapeHtml(body.trim())}</pre>
${found.files.length > 0 ? `<ul>${found.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
</body>
</html>`;
}

/**
 * A received part as a response. Shown in the tab when `viewFor` says
 * so, otherwise, or when asked, downloaded under its own name. Only
 * this app's own renderings are HTML, and they allow no script.
 */
export function partResponse(
  bytes: Uint8Array,
  part: { filename: string; contentType: string },
  download: boolean
): Response {
  const safeName = part.filename.replace(/["\\\r\n]/g, "_");
  const common = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (download || viewFor(part.contentType, part.filename) === "download") {
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...common,
        "Content-Type": part.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  }
  const type = part.contentType.toLowerCase();
  const page = (html: string) =>
    new Response(html, {
      status: 200,
      headers: {
        ...common,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  if (type === "message/rfc822" || /\.eml$/i.test(part.filename)) return page(renderEmailForDisplay(bytes));
  if (type.includes("csv") || /\.csv$/i.test(part.filename)) {
    const table = renderCsvTable(bytes, part.filename);
    if (table.html) return page(table.html);
  }
  if (type.includes("xml") || type === "text/plain" || /\.(xml|csv)$/i.test(part.filename)) {
    return page(renderXmlForDisplay(bytes.slice().buffer as ArrayBuffer));
  }
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { ...common, "Content-Type": part.contentType, "Content-Disposition": `inline; filename="${safeName}"` },
  });
}

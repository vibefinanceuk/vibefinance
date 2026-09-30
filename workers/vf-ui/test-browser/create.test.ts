import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0222_create_upload_strings.sql?raw";

/**
 * **Create → Upload documents — decision 0573.** Where an upload goes,
 * the files sent one at a time into one upload, each shown as it lands,
 * a zip unpacked here, and what cannot be sent said in words.
 *
 * **The real English strings**, read from the migration that adds them.
 */

const strings: Record<string, string> = { "action.close": "Close" };
for (const m of stringsSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

const TARGETS = {
  targets: [
    { id: "upload-ap", name: "AP upload", processId: "ap", processName: "Standard AP Process", orgName: "Acme UK Ltd" },
    { id: "upload-ar", name: "AP upload", processId: "ap2", processName: "Germany AP", orgName: null },
  ],
  maxFiles: 50,
  maxBytes: 15 * 1024 * 1024,
};

type Call = { method: string; path: string; query: string; type?: string; body?: unknown };

function stub(calls: Call[], options: { targets?: unknown; files?: Record<string, unknown>; openStatus?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, path, query, type: headers["Content-Type"], body: init?.body });
      const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/uploads/targets") return reply(200, options.targets ?? TARGETS);
      if (path === "/api/uploads" && method === "POST") {
        return options.openStatus
          ? reply(options.openStatus, { error: "AP upload is retired and no longer receives invoices" })
          : reply(201, { messageId: "MSG-3C41-9A02-7E55", receivedAt: "2026-09-30T16:42:00Z" });
      }
      if (path === "/api/uploads/MSG-3C41-9A02-7E55/files") {
        const name = decodeURIComponent(query.replace(/^name=/, ""));
        return reply(200, options.files?.[name] ?? { captured: false, why: "no stub" });
      }
      if (path === "/api/uploads/MSG-3C41-9A02-7E55/finish") return reply(200, { captured: 1, failed: 1 });
      throw new Error(`no stub for ${method} ${path}`);
    })
  );
}

async function open() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open: openScreen } = await import("/create.js");
  await openScreen();
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const texts = (selector: string) => [...document.querySelectorAll(selector)].map((n) => n.textContent);

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A zip, as a person's own zip tool writes one: one stored entry, one deflated, a folder and a Mac's leftovers. */
async function zipOf(entries: Array<{ name: string; text: string; deflate?: boolean }>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.text);
    const data = e.deflate
      ? new Uint8Array(await new Response(new Response(raw).body!.pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())
      : raw;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, e.deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, e.deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("Create → Upload documents (decision 0573)", () => {
  it("offers where to send them, the first chosen, with process and company", async () => {
    stub([]);
    await open();
    expect(document.querySelector(".topbar h1, .topbar h2")?.textContent).toBe("Create");
    expect(texts("#create-target option")).toEqual(["AP upload · Standard AP Process · Acme UK Ltd", "AP upload · Germany AP"]);
    expect((document.getElementById("create-target") as HTMLSelectElement).value).toBe("upload-ap");
    expect(document.getElementById("create-drop")?.textContent).toContain("Drop PDFs, images, XML or CSV invoices here, or a zip of them");
    expect(document.getElementById("create-drop")?.textContent).toContain("Up to 50 files, 15 MB each.");
    expect(document.getElementById("create-upload")?.textContent).toContain("Files you upload are listed here");
  });

  it("says so when there is nowhere to upload to", async () => {
    stub([], { targets: { targets: [], maxFiles: 50, maxBytes: 1 } });
    await open();
    expect(document.getElementById("create-drop")).toBeNull();
    expect(document.body.textContent).toContain("No AP upload is set up for any process.");
  });

  it("sends each file on its own into one upload, and shows what each became", async () => {
    const calls: Call[] = [];
    stub(calls, {
      files: {
        "Rechnung_88240.xml": {
          captured: true,
          invoice: { id: "inv-1", number: "88240", seller: "Lager Nord GmbH", total: 738.99, currency: "EUR", stage: "Validation", taskId: "t-1", taskStageId: "validation" },
        },
        "notes.docx": { captured: false, why: "this is not a type an invoice arrives as: send a PDF, an image, XML or CSV" },
      },
    });
    await open();
    (document.getElementById("create-target") as HTMLSelectElement).value = "upload-ar";
    document.getElementById("create-target")!.dispatchEvent(new Event("change"));

    const { send } = await import("/create.js");
    await send([
      new File(["<Invoice/>"], "Rechnung_88240.xml", { type: "text/xml" }),
      new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    ]);
    await settle();

    const opened = calls.find((c) => c.path === "/api/uploads");
    expect(JSON.parse(String(opened?.body))).toEqual({ sourceId: "upload-ar", files: 2 });
    expect(calls.filter((c) => c.path.endsWith("/files")).map((c) => [c.query, c.type])).toEqual([
      ["name=Rechnung_88240.xml", "text/xml"],
      ["name=notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ]);
    expect(calls.at(-1)?.path).toBe("/api/uploads/MSG-3C41-9A02-7E55/finish");

    expect(document.getElementById("create-upload")?.textContent).toContain("MSG-3C41-9A02-7E55 · 2 files");
    expect(texts(".createsummary .createpill")).toEqual(["1 created", "1 not read"]);
    const rows = [...document.querySelectorAll(".createrow")];
    expect(rows[0].querySelector(".createpill")?.textContent).toBe("Created");
    expect(rows[0].textContent).toContain("88240 · Lager Nord GmbH ·");
    expect(rows[0].textContent).toContain("now at Validation");
    expect(rows[0].querySelector(".createact button")?.textContent).toBe("Open");
    expect(rows[1].querySelector(".createpill")?.textContent).toBe("Not read");
    expect(rows[1].textContent).toContain("This is not a type an invoice arrives as");
    expect(rows[1].querySelector(".createact button")).toBeNull();
  });

  it("unpacks a zip here, leaving out folders and a Mac's leftovers", async () => {
    const calls: Call[] = [];
    stub(calls, { files: { "a.xml": { captured: true, invoice: { id: "i", number: "A-1", stage: null } } } });
    await open();
    const zip = await zipOf([
      { name: "invoices/", text: "" },
      { name: "invoices/a.xml", text: "<Invoice>stored</Invoice>" },
      { name: "invoices/b.xml", text: "<Invoice>deflated deflated deflated</Invoice>", deflate: true },
      { name: "__MACOSX/invoices/._a.xml", text: "junk" },
    ]);
    const { send } = await import("/create.js");
    await send([new File([zip], "september.zip", { type: "application/zip" })]);
    await settle();

    const sent = calls.filter((c) => c.path.endsWith("/files"));
    expect(sent.map((c) => c.query)).toEqual(["name=a.xml", "name=b.xml"]);
    expect(await new Response(sent[1].body as BodyInit).text()).toBe("<Invoice>deflated deflated deflated</Invoice>");
    expect(texts(".createrow .createname")).toEqual(["a.xml", "b.xml"]);
    expect(document.querySelector(".createrow")?.textContent).toContain("A-1");
  });

  it("does not send a file over the limit, says why an upload could not start, and says a broken zip", async () => {
    const calls: Call[] = [];
    stub(calls, { targets: { ...TARGETS, maxBytes: 4 } });
    await open();
    const { send } = await import("/create.js");
    await send([new File(["too large"], "big.pdf", { type: "application/pdf" }), new File(["nope"], "broken.zip", { type: "application/zip" })]);
    await settle();
    expect(calls.some((c) => c.path.endsWith("/files"))).toBe(false);
    expect(document.querySelector(".createrow")?.textContent).toContain("The file is larger than 0 MB, so it was not sent.");
    expect(document.getElementById("create-upload")?.textContent).toContain("broken.zip could not be opened as a zip.");

    stub([], { openStatus: 409 });
    await open();
    await send([new File(["%PDF"], "a.pdf", { type: "application/pdf" })]);
    await settle();
    expect(document.getElementById("create-upload")?.textContent).toContain("AP upload is retired and no longer receives invoices");
  });
});

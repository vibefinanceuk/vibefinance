import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0222_create_upload_strings.sql?raw";
import keyedStringsSql from "../../vf-licence/migrations/0223_create_invoice_strings.sql?raw";
import batchStringsSql from "../../vf-licence/migrations/0224_batch_upload_strings.sql?raw";

/**
 * **Create → Upload documents — decision 0573.** Where an upload goes,
 * the files sent one at a time into one upload, each shown as it lands,
 * a zip unpacked here, and what cannot be sent said in words.
 *
 * **The real English strings**, read from the migration that adds them.
 */

const strings: Record<string, string> = { "action.close": "Close" };
for (const sql of [stringsSql, keyedStringsSql, batchStringsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

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

  it("opens a created invoice with its task's full row, so it can be claimed and keyed — decision 0574", async () => {
    const calls: Call[] = [];
    const TASK = {
      id: "t-1",
      stageId: "validation",
      stageName: "Validation",
      ownership: "available",
      actions: ["claim"],
      requiredPermission: "AP.Validate",
      subject: { id: "inv-1", type: "invoice" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const [path, query = ""] = String(url).split("?");
        const method = init?.method ?? "GET";
        calls.push({ method, path, query });
        const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
        if (path === "/api/ui-strings") return reply({ locale: "en", strings: { ...strings, "action.claim": "Claim" } });
        if (path === "/api/uploads/targets") return reply(TARGETS);
        if (path === "/api/uploads") return reply({ messageId: "MSG-3C41-9A02-7E55", receivedAt: "2026-09-30T16:42:00Z" });
        if (path.endsWith("/files")) {
          return reply({ captured: true, invoice: { id: "inv-1", number: null, stage: "Validation", taskId: "t-1", taskStageId: "validation" } });
        }
        if (path.endsWith("/finish")) return reply({ captured: 1, failed: 0 });
        if (path === "/api/tasks") return reply({ tasks: [TASK], total: 1 });
        if (path === "/api/invoices/inv-1") return reply({ facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } });
        if (path === "/api/invoices/inv-1/pages") return reply({ pages: [] });
        if (path === "/api/documents/inv-1/collaborators") return reply({ collaborators: [] });
        if (path === "/api/documents/inv-1/activity") return reply({ items: [] });
        if (path === "/api/invoices/inv-1/progress") return reply({ visits: [] });
        return reply({});
      })
    );
    await open();
    const { send } = await import("/create.js");
    await send([new File(["%PDF"], "scan.pdf", { type: "application/pdf" })]);
    await settle();

    (document.querySelector(".createact button") as HTMLButtonElement).click();
    for (let i = 0; i < 100 && ![...document.querySelectorAll("#viewer button")].some((b) => b.textContent?.includes("Claim")); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const asked = calls.find((c) => c.path === "/api/tasks");
    expect(asked?.query).toBe("task=t-1");
    expect(document.getElementById("viewer")?.hidden).toBe(false);
    expect([...document.querySelectorAll("#viewer button")].some((b) => b.textContent?.includes("Claim"))).toBe(true);
  });

  describe("Create an invoice — decision 0575", () => {
    function stubKeyed(calls: Call[]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const [path, query = ""] = String(url).split("?");
          const method = init?.method ?? "GET";
          calls.push({ method, path, query, body: init?.body });
          const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
          if (path === "/api/ui-strings") return reply({ locale: "en", strings: { ...strings, "action.claim": "Claim" } });
          if (path === "/api/uploads/targets") return reply(TARGETS);
          if (path === "/api/uploads") return reply({ messageId: "MSG-3C41-9A02-7E55", receivedAt: "2026-09-30T16:42:00Z" }, 201);
          const made = { captured: true, invoice: { id: "inv-9", number: null, stage: "Validation", taskId: "t-9", taskStageId: "validation" } };
          if (path.endsWith("/keyed") || path.endsWith("/files")) return reply(made);
          if (path.endsWith("/finish")) return reply({ captured: 1, failed: 0 });
          if (path === "/api/tasks") {
            return reply({ tasks: [{ id: "t-9", stageId: "validation", ownership: "available", actions: ["claim"], subject: { id: "inv-9", type: "invoice" } }] });
          }
          if (path === "/api/invoices/inv-9") return reply({ facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } });
          if (path === "/api/invoices/inv-9/pages") return reply({ pages: [] });
          if (path === "/api/documents/inv-9/collaborators") return reply({ collaborators: [] });
          if (path === "/api/documents/inv-9/activity") return reply({ items: [] });
          if (path === "/api/invoices/inv-9/progress") return reply({ visits: [] });
          return reply({});
        })
      );
    }
    const viewerShowsClaim = async () => {
      for (let i = 0; i < 100 && ![...document.querySelectorAll("#viewer button")].some((b) => b.textContent?.includes("Claim")); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return [...document.querySelectorAll("#viewer button")].some((b) => b.textContent?.includes("Claim"));
    };

    it("has its own tab beside Upload documents, with a file to start from and self-billing", async () => {
      stubKeyed([]);
      await open();
      expect(texts(".createtabs .doctab")).toEqual(["Upload documents", "Create an invoice", "Batch upload"]);
      (document.getElementById("create-tab-keyed") as HTMLButtonElement).click();
      expect(document.getElementById("create-tab-keyed")?.className).toContain("on");
      expect(document.getElementById("create-drop")).toBeNull();
      expect(document.getElementById("create-keyedname")?.textContent).toBe("No file");
      expect(document.body.textContent).toContain("Self-billed invoice");
      expect(document.body.textContent).toContain("It is marked with invoice type 389.");
      expect(document.getElementById("create-keyedgo")?.textContent).toBe("Create invoice");
    });

    it("makes a self-billed invoice with no file, and opens it to be claimed and keyed", async () => {
      const calls: Call[] = [];
      stubKeyed(calls);
      await open();
      (document.getElementById("create-tab-keyed") as HTMLButtonElement).click();
      (document.getElementById("create-selfbilled") as HTMLInputElement).click();
      (document.getElementById("create-keyedgo") as HTMLButtonElement).click();

      expect(await viewerShowsClaim()).toBe(true);
      const opened = calls.find((c) => c.path === "/api/uploads");
      expect(JSON.parse(String(opened?.body))).toMatchObject({ kind: "keyed", files: 0 });
      const keyed = calls.find((c) => c.path === "/api/uploads/MSG-3C41-9A02-7E55/keyed");
      expect(JSON.parse(String(keyed?.body))).toEqual({ selfBilled: true });
      expect(calls.some((c) => c.path.endsWith("/finish"))).toBe(true);
      expect(calls.find((c) => c.path === "/api/tasks")?.query).toBe("task=t-9");
    });

    it("reads a chosen file first, marked self-billed, instead of an empty invoice", async () => {
      const calls: Call[] = [];
      stubKeyed(calls);
      await open();
      (document.getElementById("create-tab-keyed") as HTMLButtonElement).click();
      const input = document.getElementById("create-keyedfile") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [new File(["<Invoice/>"], "Rechnung_88240.xml", { type: "text/xml" })] });
      input.dispatchEvent(new Event("change"));
      expect(document.getElementById("create-keyedname")?.textContent).toContain("Rechnung_88240.xml");
      (document.getElementById("create-selfbilled") as HTMLInputElement).click();
      (document.getElementById("create-keyedgo") as HTMLButtonElement).click();

      expect(await viewerShowsClaim()).toBe(true);
      expect(calls.find((c) => c.path.endsWith("/files"))?.query).toBe("name=Rechnung_88240.xml&selfBilled=1");
      expect(calls.some((c) => c.path.endsWith("/keyed"))).toBe(false);
      expect(JSON.parse(String(calls.find((c) => c.path === "/api/uploads")?.body))).toMatchObject({ kind: "keyed", files: 1 });
    });
  });

  describe("Batch upload — decision 0576", () => {
    const PREVIEW = {
      filename: "batch_september.csv",
      layout: "VibeFinance template",
      rows: 5,
      problems: [],
      counts: { ready: 2, duplicate: 1, problem: 1 },
      invoices: [
        { key: "STMT-09|de999", number: "STMT-09", supplier: "Hanse Logistik", date: "2026-09-30", currency: "EUR", total: 178.5, lines: 2, rows: [2, 3], status: "ready", problems: [], duplicateOf: null },
        { key: "88240|de812345678", number: "88240", supplier: "Lager Nord GmbH", date: "2026-09-30", currency: "EUR", total: 738.99, lines: 1, rows: [4], status: "ready", problems: [], duplicateOf: null },
        { key: "7781|de999", number: "7781", supplier: "Hanse Logistik", date: "2026-09-30", currency: "EUR", total: 96.4, lines: 1, rows: [5], status: "duplicate", problems: [], duplicateOf: { id: "inv-old", number: "7781", receivedAt: "2026-09-12 10:00:00" } },
        { key: "INV-5530|de999", number: "INV-5530", supplier: "Hanse Logistik", date: null, currency: null, total: null, lines: 0, rows: [6], status: "problem", problems: ["Row 6: no VAT rate"], duplicateOf: null },
      ],
      problemsCsv: "row,invoice_number,problem\r\n6,INV-5530,Row 6: no VAT rate\r\n",
    };

    function stubBatch(calls: Call[]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const [path, query = ""] = String(url).split("?");
          const method = init?.method ?? "GET";
          calls.push({ method, path, query, body: init?.body });
          const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
          if (path === "/api/ui-strings") return reply({ locale: "en", strings });
          if (path === "/api/uploads/targets") return reply(TARGETS);
          if (path === "/api/uploads/mappings") return reply({ mappings: [{ id: "map-ln", name: "Lager Nord CSV", version: 2 }] });
          if (path === "/api/uploads/preview") {
            if (query.startsWith("layout=xml")) {
              const name = decodeURIComponent(query.split("name=")[1]);
              return reply({ invoices: [{ key: `${name}|x`, number: name.replace(".xml", ""), supplier: "Lager Nord GmbH", date: "2026-09-29", currency: "EUR", total: 10, lines: 1, rows: [], status: "ready", problems: [], duplicateOf: null }] });
            }
            return reply(PREVIEW);
          }
          if (path === "/api/uploads") return reply({ messageId: "MSG-3C41-9A02-7E55", receivedAt: "2026-09-30T16:42:00Z" }, 201);
          if (path.endsWith("/batch")) {
            return reply({
              total: 2,
              from: 0,
              made: [
                { key: "STMT-09|de999", number: "STMT-09", invoiceId: "i1", invoice: { id: "i1", number: "STMT-09", seller: "Hanse Logistik", total: 178.5, currency: "EUR", stage: "Validation", taskId: "t1", taskStageId: "validation" } },
                { key: "88240|de812345678", number: "88240", invoiceId: "i2", invoice: { id: "i2", number: "88240", seller: "Lager Nord GmbH", total: 738.99, currency: "EUR", stage: "Validation", taskId: "t2", taskStageId: "validation" } },
              ],
              failed: [],
            });
          }
          if (path.endsWith("/files")) {
            const name = decodeURIComponent(query.replace(/^name=/, ""));
            return reply({ captured: true, invoice: { id: name, number: name.replace(".xml", ""), stage: "Validation" } });
          }
          if (path.endsWith("/finish")) return reply({ captured: 2, failed: 0 });
          throw new Error(`no stub for ${method} ${path}`);
        })
      );
    }

    async function openBatch(calls: Call[]) {
      stubBatch(calls);
      await open();
      (document.getElementById("create-tab-batch") as HTMLButtonElement).click();
      await settle();
    }

    it("offers the template, or a supplier's layout by its mapping", async () => {
      const calls: Call[] = [];
      await openBatch(calls);
      expect(texts(".createtabs .doctab")).toEqual(["Upload documents", "Create an invoice", "Batch upload"]);
      expect((document.getElementById("create-layout-template") as HTMLInputElement).checked).toBe(true);
      expect(document.getElementById("create-template")?.getAttribute("href")).toBe("/api/uploads/template.csv");
      expect(texts("#create-mapping option")).toEqual(["Lager Nord CSV · v2"]);
      expect(document.body.textContent).toContain("Rows with the same invoice number become one invoice");
      expect(document.body.textContent).toContain("What goes in the template");
    });

    it("previews a CSV before anything is made, and creates only what is ready unless duplicates are ticked in", async () => {
      const calls: Call[] = [];
      await openBatch(calls);
      const { readForPreview } = await import("/create.js");
      await readForPreview([new File(["x"], "batch_september.csv", { type: "text/csv" })]);
      await settle();

      expect(calls.find((c) => c.path === "/api/uploads/preview")?.query).toBe("layout=template&name=batch_september.csv");
      expect(calls.some((c) => c.path === "/api/uploads")).toBe(false);
      expect(document.getElementById("create-upload")?.textContent).toContain("batch_september.csv · 5 rows · 4 invoices · VibeFinance template");
      expect(texts(".createsummary .createpill")).toEqual(["2 ready", "1 possible duplicate", "1 with problems"]);
      const rows = [...document.querySelectorAll(".createtable tbody tr")];
      expect(rows.map((r) => r.querySelector(".createpill")?.textContent)).toEqual(["Ready", "Ready", "Possible duplicate", "Problem"]);
      expect(rows[0].textContent).toContain("2 rows in one invoice");
      expect(rows[2].textContent).toContain("7781 from this supplier was received on");
      expect(rows[3].textContent).toContain("Row 6: no VAT rate");
      expect(document.getElementById("create-problems")).not.toBeNull();
      expect(document.getElementById("create-batchgo")?.textContent).toBe("Create 2 invoices");
      (document.getElementById("create-duplicates") as HTMLInputElement).click();
      expect(document.getElementById("create-batchgo")?.textContent).toBe("Create 3 invoices");
      (document.getElementById("create-duplicates") as HTMLInputElement).click();

      const { createBatch } = await import("/create.js");
      await createBatch();
      await settle();
      expect(JSON.parse(String(calls.find((c) => c.path === "/api/uploads")?.body))).toMatchObject({ kind: "batch", files: 1 });
      expect(calls.filter((c) => c.path.endsWith("/batch")).map((c) => c.query)).toEqual([
        "layout=template&name=batch_september.csv&from=0&count=20&duplicates=0",
      ]);
      expect(calls.at(-1)?.path).toBe("/api/uploads/MSG-3C41-9A02-7E55/finish");
      expect(texts(".createrow .createname")).toEqual(["STMT-09", "88240"]);
      expect(texts(".createrow .createpill")).toEqual(["Created", "Created"]);
      expect(document.querySelector(".createrow")?.textContent).toContain("now at Validation");
      expect(document.querySelectorAll(".createrow .createact button")).toHaveLength(2);
    });

    it("reads by the chosen mapping, and XML invoices one at a time", async () => {
      const calls: Call[] = [];
      await openBatch(calls);
      (document.getElementById("create-layout-mapping") as HTMLInputElement).click();
      const { readForPreview, createBatch } = await import("/create.js");
      await readForPreview([new File(["x"], "ln.csv", { type: "text/csv" })]);
      expect(calls.find((c) => c.path === "/api/uploads/preview")?.query).toBe("layout=mapping&mapping=map-ln&name=ln.csv");

      await readForPreview([new File(["<a/>"], "88241.xml"), new File(["<a/>"], "88242.xml")]);
      await settle();
      expect(calls.filter((c) => c.query.startsWith("layout=xml")).map((c) => c.query)).toEqual(["layout=xml&name=88241.xml", "layout=xml&name=88242.xml"]);
      expect(document.getElementById("create-upload")?.textContent).toContain("2 XML invoices");
      await createBatch();
      await settle();
      expect(JSON.parse(String(calls.filter((c) => c.path === "/api/uploads").at(-1)?.body))).toMatchObject({ kind: "batch", files: 2 });
      expect(calls.filter((c) => c.path.endsWith("/files")).map((c) => c.query)).toEqual(["name=88241.xml", "name=88242.xml"]);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mappingStringsSql from "../../vf-licence/migrations/0212_supplier_mapping_strings.sql?raw";
import formatStringsSql from "../../vf-licence/migrations/0211_formats_and_en16931_strings.sql?raw";
import monitorStringsSql from "../../vf-licence/migrations/0207_route_monitor_strings.sql?raw";
import routesStringsSql from "../../vf-licence/migrations/0208_routes_and_process_routes_strings.sql?raw";
import missStringsSql from "../../vf-licence/migrations/0214_mapping_miss_strings.sql?raw";

/**
 * **The mapping editor — decision 0561**, with the real strings: draw a
 * line from an element to a Business Term, give it a function in plain
 * words and accept it after its worked examples, give a fixed value, try
 * the draft on its sample, publish it and reprocess what it may now read.
 * And the ways in: the Route monitor's "Map this format", and the Routes
 * screen's Supplier mappings.
 */

const strings: Record<string, string> = { "action.close": "Close", "action.save": "Save" };
for (const sql of [mappingStringsSql, formatStringsSql, monitorStringsSql, routesStringsSql, missStringsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

const TARGETS = [
  { id: "BT-1", kind: "text", line: false, required: true },
  { id: "BT-2", kind: "date", line: false, required: true },
  { id: "BT-3", kind: "text", line: false, required: true },
  { id: "BT-13", kind: "text", line: false, required: false },
  { id: "BT-129", kind: "number", line: true, required: true },
  { id: "BT-131", kind: "number", line: true, required: true },
];

const MAPPING = () => ({
  mapping: { id: "MAP-1", routeId: "email-in", name: "munch.de <Rechnung>", root: "Rechnung", senders: ["@munch.de"] },
  versions: [{ version: 1, status: "draft" }],
  editing: {
    version: 1,
    status: "draft",
    definition: {
      root: "Rechnung",
      linesPath: "Rechnung/Position",
      lines: [{ target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] }],
    },
    sample: { messageId: "MSG-1", partSeq: 1, filename: "Rechnung_88240.xml" },
  },
  described: {
    root: "Rechnung",
    repeating: ["Rechnung/Position"],
    groups: ["Rechnung/Kopf", "Rechnung/Position"],
    elements: [
      { path: "Rechnung/Kopf/Rechnungsnummer", sample: "88240", count: 1 },
      { path: "Rechnung/Kopf/Datum", sample: "29.09.2026", count: 1 },
      { path: "Rechnung/Position/Menge", sample: "12", count: 1 },
      { path: "Rechnung/Position/Netto", sample: "546,00", count: 1 },
    ],
  },
  targets: TARGETS,
  waiting: 1,
});

type Call = { method: string; path: string; body?: unknown };

function stub(calls: Call[], overrides: Record<string, (body: unknown) => { status?: number; body: unknown }> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const key = `${method} ${path}`;
      const respond = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json }) as Response;
      if (path === "/api/ui-strings") return respond(200, { locale: "en", strings });
      if (overrides[key]) {
        const r = overrides[key](body);
        return respond(r.status ?? 200, r.body);
      }
      if (key === "GET /api/supplier-mappings/MAP-1") return respond(200, MAPPING());
      if (key === "PUT /api/supplier-mappings/MAP-1/draft") return respond(200, { id: "MAP-1", version: 1, status: "draft" });
      throw new Error(`no stub for ${key}`);
    })
  );
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const src = (path: string) => document.querySelector(`[data-src="${path}"]`) as HTMLButtonElement;
const tgt = (id: string) => document.querySelector(`[data-tgt="${id}"]`) as HTMLButtonElement;

async function openEditor() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/mapping-editor.js");
  await open("MAP-1");
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the mapping editor — decision 0561", () => {
  it("lays out the supplier's elements beside the EN 16931 terms, the required ones without a source marked", async () => {
    stub([]);
    await openEditor();
    expect(text(".topbar h2")).toBe("Mapping: munch.de <Rechnung>");
    expect([...document.querySelectorAll("[data-src]")].map((b) => b.textContent)).toEqual([
      "Rechnungsnummer88240",
      "Datum29.09.2026",
      "Menge12",
      "Netto546,00",
    ]);
    expect([...document.querySelectorAll(".megrp")].map((g) => g.textContent)).toEqual(["Kopf", "Position · each line", "Invoice", "Invoice line"]);
    expect(tgt("BT-1").dataset.from).toBe("Rechnung/Kopf/Rechnungsnummer");
    expect(tgt("BT-2").classList.contains("miss")).toBe(true);
    expect(tgt("BT-2").textContent).toContain("Needs a source");
    expect(tgt("BT-13").classList.contains("miss")).toBe(false);
    expect(document.body.textContent).toContain("Mapped: 1, with a function: 0. Required terms still needing a source: 4.");
  });

  it("draws a line from an element to a term, a line's term relative to the lines, and saves the draft", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openEditor();
    src("Rechnung/Kopf/Datum").click();
    await settle();
    tgt("BT-2").click();
    await settle();
    src("Rechnung/Position/Netto").click();
    await settle();
    tgt("BT-131").click();
    await settle();
    const saves = calls.filter((c) => c.method === "PUT");
    expect(saves).toHaveLength(2);
    expect((saves[1].body as { definition: { lines: unknown[] } }).definition.lines).toEqual([
      { target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] },
      { target: "BT-2", source: "Rechnung/Kopf/Datum", fx: [], origin: "person" },
      { target: "BT-131", source: "Netto", fx: [], origin: "person" },
    ]);
    expect(tgt("BT-131").dataset.from).toBe("Rechnung/Position/Netto");
  });

  it("refuses a line's term from outside the lines, in words, and saves nothing", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openEditor();
    src("Rechnung/Kopf/Datum").click();
    await settle();
    tgt("BT-129").click();
    await settle();
    expect(text(".menote")).toBe("That term belongs to each line: choose an element inside the lines.");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("compiles a function from plain words, shows the worked examples, and saves it when accepted", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/supplier-mappings/MAP-1/compile": () => ({
        body: { kind: "compiled", steps: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }], examples: [{ input: "29.09.2026", output: "2026-09-29" }] },
      }),
    });
    await openEditor();
    src("Rechnung/Kopf/Datum").click();
    await settle();
    tgt("BT-2").click();
    await settle();
    const box = document.querySelector(".mesay") as HTMLTextAreaElement;
    box.value = "read it as day.month.year";
    box.dispatchEvent(new Event("input"));
    button("Understand").click();
    await settle();
    expect(calls.find((c) => c.path.endsWith("/compile"))?.body).toEqual({ target: "BT-2", source: "Rechnung/Kopf/Datum", say: "read it as day.month.year" });
    expect(text(".mesteps")).toBe("read date dd.MM.yyyy");
    expect([...document.querySelectorAll(".meex td")].map((td) => td.textContent)).toEqual(["29.09.2026", "→", "2026-09-29"]);

    button("Accept").click();
    await settle();
    const last = calls.filter((c) => c.method === "PUT").at(-1)!.body as { definition: { lines: Array<Record<string, unknown>> } };
    expect(last.definition.lines.find((l) => l.target === "BT-2")).toEqual({
      target: "BT-2",
      source: "Rechnung/Kopf/Datum",
      fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }],
      say: "read it as day.month.year",
      origin: "person",
    });
    expect(tgt("BT-2").dataset.fx).toBe("1");
  });

  it("shows a refusal in words, and changes nothing", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/supplier-mappings/MAP-1/compile": () => ({ body: { kind: "refused", reason: "No function translates text." } }),
    });
    await openEditor();
    tgt("BT-1").click();
    await settle();
    button("Understand").click();
    await settle();
    expect(text(".merefused")).toBe("No function translates text.");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("gives a term the document never carries a fixed value", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openEditor();
    tgt("BT-3").click();
    await settle();
    (document.querySelector(".meinput") as HTMLInputElement).value = "380";
    button("Use this value").click();
    await settle();
    const last = calls.filter((c) => c.method === "PUT").at(-1)!.body as { definition: { lines: Array<Record<string, unknown>> } };
    expect(last.definition.lines.at(-1)).toEqual({ target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }], origin: "person" });
    expect(tgt("BT-3").textContent).toContain("A fixed value");
  });

  it("tries the draft on its sample: what it could not read, and the EN 16931 checks", async () => {
    stub([], {
      "POST /api/supplier-mappings/MAP-1/try": () => ({
        body: {
          version: 1,
          filename: "Rechnung_88240.xml",
          facts: { "BT-1": "88240" },
          lines: [{ lineNumber: 1 }],
          problems: [{ target: "BT-131", source: "Netto", value: "546,00", line: 1, reason: '"546,00" is not a number' }],
          en16931: { checked: 29, failed: [{ rule: "BR-02" }] },
        },
      }),
    });
    await openEditor();
    button("Try on the sample").click();
    await settle();
    expect(document.body.textContent).toContain("What it makes of Rechnung_88240.xml");
    expect(document.body.textContent).toContain("Values read: 1. Lines: 1.");
    const items = [...document.querySelectorAll(".rmrules li")].map((li) => li.textContent);
    expect(items[0]).toBe('BT-131 Line net amount · line 1: "546,00" is not a number');
    expect(items[1]).toContain("BR-02");
  });

  it("publishes, and reprocesses the failed messages it may now read", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/supplier-mappings/MAP-1/publish": () => ({ body: { id: "MAP-1", version: 1, status: "live", waiting: ["MSG-1", "MSG-2"] } }),
      "POST /api/route-messages/reprocess": () => ({ body: { results: [{ id: "MSG-1", status: "delivered" }, { id: "MSG-2", status: "delivered" }] } }),
    });
    await openEditor();
    button("Publish").click();
    await settle();
    expect(document.body.textContent).toContain("Version 1 is live");
    expect(document.body.textContent).toContain("2 failed messages on this route may now be read.");
    button("Reprocess 2 messages").click();
    await settle();
    expect(calls.find((c) => c.path === "/api/route-messages/reprocess")?.body).toEqual({ ids: ["MSG-1", "MSG-2"] });
    expect(text(".menote")).toBe("2 run again: 2 delivered.");
  });

  it("says why it cannot publish while the draft cannot read its own sample", async () => {
    stub([], {
      "POST /api/supplier-mappings/MAP-1/publish": () => ({
        status: 422,
        body: { reason: "sample_problems", problems: [{ target: "BT-2", source: "Rechnung/Kopf/Datum", value: "29.09.2026", reason: '"29.09.2026" is not a date written yyyy-MM-dd' }] },
      }),
    });
    await openEditor();
    button("Publish").click();
    await settle();
    expect(text(".menote")).toBe("It cannot be published while it cannot read its own sample. The values are listed below.");
    expect(document.body.textContent).toContain('"29.09.2026" is not a date written yyyy-MM-dd');
  });

  it("draws a line and an Fx for each mapping", async () => {
    stub([]);
    await openEditor();
    const { drawLines } = await import("/mapping-editor.js");
    tgt("BT-1").dataset.fx = "1";
    drawLines(document.querySelector(".megrid") as HTMLElement);
    expect(document.querySelectorAll(".megrid svg.melines path")).toHaveLength(1);
    expect(document.querySelectorAll(".megrid .mefx")).toHaveLength(1);
  });
});

describe("the ways in", () => {
  it("offers to map a supplier's own XML from the Route monitor, and opens the editor on it", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "GET /api/route-messages": () => ({ body: { period: "today", summary: {}, sources: [], destinations: [], messages: [{ id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", subject: "Rechnung", receivedAt: new Date().toISOString(), invoices: 0 }] } }),
      "GET /api/route-messages/MSG-1": () => ({
        body: {
          canReprocess: true,
          similar: [],
          canDismiss: true,
          message: { id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", subject: "Rechnung", receivedAt: new Date().toISOString() },
          parts: [{ seq: 1, role: "attachment", filename: "Rechnung_88240.xml", bytes: 900, outcome: "failed", format: "supplier_xml", xmlRoot: "Rechnung", mapping: null, en16931Failed: null }],
          events: [],
          invoices: [],
        },
      }),
      "POST /api/supplier-mappings": () => ({ status: 201, body: { id: "MAP-1" } }),
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/route-monitor.js");
    await open();
    await settle();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
    expect(text(".rmfmtname")).toBe("Rechnung_88240.xml: A supplier's own XML <Rechnung>");
    expect(text(".rmfmt .rmpill")).toBe("No mapping yet");
    // Not "check it is legible": it needs a mapping.
    expect(text(".rmexplain .h")).toBe("A supplier's own XML, and no mapping reads it yet");
    button("Map this format").click();
    await settle();
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/supplier-mappings")?.body).toEqual({ messageId: "MSG-1", partSeq: 1 });
    expect(text(".topbar h2")).toBe("Mapping: munch.de <Rechnung>");
  });
});

/**
 * **Near misses and retiring — decision 0563**: the monitor says which
 * mapping came close and why, and a mapping made by mistake is retired
 * from its own card, after saying what that does.
 */
describe("near misses and retiring — decision 0563", () => {
  async function monitorWith(mapping: unknown) {
    stub([], {
      "GET /api/route-messages": () => ({ body: { period: "today", summary: {}, sources: [], destinations: [], messages: [{ id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", subject: "Rechnung", receivedAt: new Date().toISOString(), invoices: 0 }] } }),
      "GET /api/route-messages/MSG-1": () => ({
        body: {
          canReprocess: true,
          similar: [],
          canDismiss: true,
          message: { id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", counterparty: "vibefinanceuk@gmail.com", subject: "Rechnung", receivedAt: new Date().toISOString() },
          parts: [{ seq: 1, role: "attachment", filename: "Rechnung_88240.xml", bytes: 900, outcome: "failed", format: "supplier_xml", xmlRoot: "Rechnung", mapping, en16931Failed: null }],
          events: [],
          invoices: [],
        },
      }),
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/route-monitor.js");
    await open();
    await settle();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
  }

  it("says a live mapping is not for this sender, names it, and opens it", async () => {
    await monitorWith({ id: "MAP-1", version: null, name: "Lager Nord", miss: "not_for_sender" });
    expect(text(".rmfmt .rmpill")).toBe("Not for this sender");
    expect(text(".rmfmt .muted.sm")).toBe("Lager Nord reads this format on this route, but is not for vibefinanceuk@gmail.com.");
    expect(text(".rmexplain .h")).toBe("A mapping reads this format, but not from this sender");
    expect(text(".rmexplain")).toContain("Who it is for applies at once, without publishing again.");
    expect(button("Open the mapping")).toBeTruthy();
    expect(button("Map this format")).toBeUndefined();
  });

  it("says a mapping would read it but has not been published", async () => {
    await monitorWith({ id: "MAP-1", version: null, name: "gmail.com <Rechnung>", miss: "not_published" });
    expect(text(".rmfmt .rmpill")).toBe("Mapping not published");
    expect(text(".rmfmt .muted.sm")).toBe("gmail.com <Rechnung> would read it, but has never been published.");
    expect(text(".rmexplain .h")).toBe("A mapping would read it, but has not been published");
  });

  it("retires a draft after saying no invoice is affected, then shows Routes with a notice", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/supplier-mappings/MAP-1/retire": () => ({ body: { id: "MAP-1", status: "retired", wasLive: false } }),
      "GET /api/routes": () => ({ body: { routes: [] } }),
    });
    await openEditor();
    button("Retire this mapping").click();
    await settle();
    expect(text(".meretire p")).toBe("Retire munch.de <Rechnung>? It has never been published, so no invoice is affected. Its versions are kept as history.");
    button("Keep it").click();
    await settle();
    expect(document.querySelector(".meretire")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/retire"))).toBe(false);

    button("Retire this mapping").click();
    await settle();
    button("Retire it").click();
    await settle();
    expect(calls.find((c) => c.path === "/api/supplier-mappings/MAP-1/retire")?.method).toBe("POST");
    // Routes is imported on demand, which takes longer than a few ticks.
    await vi.waitFor(() => expect(text("#routes-note")).toBe("munch.de <Rechnung> is retired."));
  });

  it("warns that retiring a live mapping stops it reading invoices", async () => {
    stub([], {
      "GET /api/supplier-mappings/MAP-1": () => ({ body: { ...MAPPING(), versions: [{ version: 1, status: "live" }] } }),
    });
    await openEditor();
    button("Retire this mapping").click();
    await settle();
    expect(text(".meretire p")).toContain("It is live: invoices it reads today will fail until another mapping reads them.");
  });

  it("shows a retired mapping as retired, with nothing to publish, save or retire", async () => {
    stub([], {
      "GET /api/supplier-mappings/MAP-1": () => ({ body: { ...MAPPING(), mapping: { ...MAPPING().mapping, status: "retired" } } }),
    });
    await openEditor();
    expect(text(".menote")).toBe("This mapping is retired. It reads nothing, and can no longer be changed.");
    expect(button("Publish")).toBeUndefined();
    expect(button("Retire this mapping")).toBeUndefined();
    expect(button("Save")).toBeUndefined();
  });
});

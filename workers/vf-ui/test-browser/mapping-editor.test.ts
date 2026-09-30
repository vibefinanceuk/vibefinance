import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mappingStringsSql from "../../vf-licence/migrations/0212_supplier_mapping_strings.sql?raw";
import formatStringsSql from "../../vf-licence/migrations/0211_formats_and_en16931_strings.sql?raw";
import monitorStringsSql from "../../vf-licence/migrations/0207_route_monitor_strings.sql?raw";
import routesStringsSql from "../../vf-licence/migrations/0208_routes_and_process_routes_strings.sql?raw";
import missStringsSql from "../../vf-licence/migrations/0214_mapping_miss_strings.sql?raw";
import retirePopoutStringsSql from "../../vf-licence/migrations/0215_mapping_retire_popout_strings.sql?raw";
import csvStringsSql from "../../vf-licence/migrations/0216_supplier_csv_strings.sql?raw";
import rereadStringsSql from "../../vf-licence/migrations/0217_mapping_reread_strings.sql?raw";

/**
 * **The mapping editor — decision 0561**, with the real strings: draw a
 * line from an element to a Business Term, give it a function in plain
 * words and accept it after its worked examples, give a fixed value, try
 * the draft on its sample, publish it and reprocess what it may now read.
 * And the ways in: the Route monitor's "Map this format", and the Routes
 * screen's Supplier mappings.
 */

const strings: Record<string, string> = { "action.close": "Close", "action.save": "Save" };
for (const sql of [mappingStringsSql, formatStringsSql, monitorStringsSql, routesStringsSql, missStringsSql, retirePopoutStringsSql, csvStringsSql, rereadStringsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
  // Later migrations change some words in place.
  for (const m of sql.matchAll(/UPDATE ui_strings SET value = '((?:[^']|'')*)' WHERE key = '([^']+)' AND locale = 'en'/g)) strings[m[2]] = m[1].replace(/''/g, "'");
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

  it("keeps Save and Retire at the top right of the Mapping card", async () => {
    stub([]);
    await openEditor();
    const head = [...document.querySelectorAll(".cardhead")].find((h) => h.querySelector("h3")?.textContent === "Mapping") as HTMLElement;
    const labels = [...head.querySelectorAll(".statebuttons button")].map((b) => b.textContent);
    expect(labels).toEqual(["Save", "Retire this mapping"]);
  });

  it("confirms retiring a draft in a pop-out, Cancel closing it, then shows Routes with a notice", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/supplier-mappings/MAP-1/retire": () => ({ body: { id: "MAP-1", status: "retired", wasLive: false } }),
      "GET /api/routes": () => ({ body: { routes: [] } }),
    });
    await openEditor();
    button("Retire this mapping").click();
    await settle();
    const pop = document.querySelector(".backdrop .popout[role=dialog]") as HTMLElement;
    expect(pop.querySelector("h3")?.textContent).toBe("Retire mapping");
    expect(pop.querySelector("p")?.textContent).toBe(
      "Retire munch.de <Rechnung>? It has never been published, so no invoice is affected. Its versions are kept as history."
    );
    expect([...pop.querySelectorAll(".statebuttons button")].map((b) => b.textContent)).toEqual(["Retire mapping", "Cancel"]);
    button("Cancel").click();
    await settle();
    expect(document.querySelector(".backdrop")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/retire"))).toBe(false);

    button("Retire this mapping").click();
    await settle();
    (document.querySelector(".backdrop .statebuttons button") as HTMLButtonElement).click();
    await settle();
    expect(calls.find((c) => c.path === "/api/supplier-mappings/MAP-1/retire")?.method).toBe("POST");
    // Routes is imported on demand, which takes longer than a few ticks.
    await vi.waitFor(() => expect(text("#routes-note")).toBe("munch.de <Rechnung> is retired."));
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("says why inside the pop-out when retiring is refused, and closes on Escape", async () => {
    stub([], {
      "POST /api/supplier-mappings/MAP-1/retire": () => ({ status: 404, body: { error: "mapping MAP-1 does not exist" } }),
    });
    await openEditor();
    button("Retire this mapping").click();
    await settle();
    (document.querySelector(".backdrop .statebuttons button") as HTMLButtonElement).click();
    await settle();
    const refused = document.querySelector(".backdrop .merefused") as HTMLElement;
    expect(refused.hidden).toBe(false);
    expect(refused.textContent).toBe("mapping MAP-1 does not exist");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("warns that retiring a live mapping stops it reading invoices", async () => {
    stub([], {
      "GET /api/supplier-mappings/MAP-1": () => ({ body: { ...MAPPING(), versions: [{ version: 1, status: "live" }] } }),
    });
    await openEditor();
    button("Retire this mapping").click();
    await settle();
    expect(text(".backdrop .popout p")).toContain("It is live: invoices it reads today will fail until another mapping reads them.");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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

/**
 * **A supplier's CSV in the editor — decision 0565**: its columns by the
 * names in the file, the first row and every row as the two groups, how
 * the file is read on the Mapping card, and a whole-invoice amount drawn
 * from the rows, which adds them up.
 */
describe("a CSV mapping — decision 0565", () => {
  const CSV_MAPPING = () => ({
    mapping: { id: "MAP-1", routeId: "email-in", name: "lagernord.de CSV", root: "CSV", senders: ["@lagernord.de"], status: "active" },
    versions: [{ version: 1, status: "draft" }],
    editing: {
      version: 1,
      status: "draft",
      definition: { root: "CSV", linesPath: "CSV/Row", csv: { delimiter: ";", header: true, skip: 0 }, lines: [] },
      sample: { messageId: "MSG-1", partSeq: 1, filename: "Rechnung_88250.csv" },
    },
    described: {
      root: "CSV",
      repeating: ["CSV/Row"],
      groups: ["CSV/First", "CSV/Row"],
      elements: [
        { path: "CSV/First/Rechnungsnr", sample: "88250", count: 1 },
        { path: "CSV/First/USt-IdNr", sample: "DE298765432", count: 1 },
        { path: "CSV/Row/Menge", sample: "4", count: 2 },
        { path: "CSV/Row/Netto", sample: "480,00", count: 2 },
      ],
    },
    columns: [
      { name: "Rechnungsnr", element: "Rechnungsnr" },
      { name: "USt-IdNr", element: "USt-IdNr" },
      { name: "Menge (Stk)", element: "Menge" },
      { name: "Netto", element: "Netto" },
    ],
    targets: [...TARGETS, { id: "BT-106", kind: "number", line: false, required: true }],
    waiting: 0,
  });

  it("shows the columns by their names in the file, grouped as the first row and every row", async () => {
    stub([], { "GET /api/supplier-mappings/MAP-1": () => ({ body: CSV_MAPPING() }) });
    await openEditor();
    expect(text(".megrid .mecol h4 + .meh4s")).toBe("The supplier's CSV · column and sample value");
    expect([...document.querySelectorAll(".megrid .mecol:first-child .megrp")].map((g) => g.textContent)).toEqual([
      "First row · the whole invoice",
      "Every row · each line",
    ]);
    expect(src("CSV/Row/Menge").querySelector(".mep")?.textContent).toBe("Menge (Stk)");
    expect(document.body.textContent).toContain("CSV file → EN 16931 invoice");
  });

  it("changes how the file is read on the Mapping card, saving the draft and reading the sample again", async () => {
    const calls: Call[] = [];
    stub(calls, { "GET /api/supplier-mappings/MAP-1": () => ({ body: CSV_MAPPING() }) });
    await openEditor();
    expect(document.querySelector("select[aria-label='Lines repeat at']")).toBeNull();
    const sep = document.querySelector("select[aria-label='Separator']") as HTMLSelectElement;
    expect([...sep.options].map((o) => o.textContent)).toEqual(["Semicolon ;", "Comma ,", "Tab", "Vertical bar |"]);
    expect(sep.value).toBe(";");
    sep.value = ",";
    sep.dispatchEvent(new Event("change"));
    await settle();
    const put = calls.filter((c) => c.method === "PUT").at(-1);
    expect((put?.body as { definition: { csv: unknown } }).definition.csv).toEqual({ delimiter: ",", header: true, skip: 0 });
    expect(calls.filter((c) => c.method === "GET" && c.path === "/api/supplier-mappings/MAP-1")).toHaveLength(2);

    const header = document.querySelector("input[aria-label='Column names']") as HTMLInputElement;
    expect(header.checked).toBe(true);
    header.checked = false;
    header.dispatchEvent(new Event("change"));
    await settle();
    expect((calls.filter((c) => c.method === "PUT").at(-1)?.body as { definition: { csv: { header: boolean } } }).definition.csv.header).toBe(false);
  });

  it("takes a whole-invoice amount from a column on every row, saying it adds them up", async () => {
    const calls: Call[] = [];
    stub(calls, { "GET /api/supplier-mappings/MAP-1": () => ({ body: CSV_MAPPING() }) });
    await openEditor();
    src("CSV/Row/Netto").click();
    await settle();
    tgt("BT-106").click();
    await settle();
    const put = calls.filter((c) => c.method === "PUT").at(-1)?.body as { definition: { lines: unknown[] } };
    expect(put.definition.lines).toEqual([{ target: "BT-106", source: "CSV/Row/Netto", fx: [], origin: "person" }]);
    expect(text(".mesum")).toBe("An amount for the whole invoice, drawn from the lines: every line's value is read, then added up.");

    // A text term still cannot come from the rows.
    src("CSV/Row/Menge").click();
    await settle();
    tgt("BT-1").click();
    await settle();
    expect(text(".menote")).toBe("That term belongs to the whole invoice: choose an element outside the lines. An amount may also come from inside the lines, which adds them up.");
  });

  it("shows a failed CSV in the Route monitor as a supplier's CSV, offering to map it", async () => {
    stub([], {
      "GET /api/route-messages": () => ({ body: { period: "today", summary: {}, sources: [], destinations: [], messages: [{ id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", subject: "Rechnung", receivedAt: new Date().toISOString(), invoices: 0 }] } }),
      "GET /api/route-messages/MSG-1": () => ({
        body: {
          canReprocess: true,
          similar: [],
          canDismiss: true,
          message: { id: "MSG-1", sourceName: "AP mailbox", status: "failed", failedPart: "translation", subject: "Rechnung", receivedAt: new Date().toISOString() },
          parts: [{ seq: 1, role: "attachment", filename: "Rechnung_88250.csv", bytes: 400, outcome: "failed", format: "supplier_csv", xmlRoot: "CSV", mapping: null, en16931Failed: null }],
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
    expect(text(".rmfmtname")).toBe("Rechnung_88250.csv: A supplier's CSV");
    expect(text(".rmexplain .h")).toBe("A supplier's CSV, and no mapping reads it yet");
    expect(text(".rmfmt .muted.sm")).toBe("This supplier sends a CSV. Map it once, from this file, and every CSV like it is read as data.");
    expect(button("Map this format")).toBeTruthy();
  });
});

/**
 * **What was tried, and reading again — decision 0566**: a failed file's
 * card says which version tried and why, "1 rule broken" is singular, and
 * a file read with an older version offers to read it again with the live
 * one, or says why it will not.
 */
describe("tried, and read again — decision 0566", () => {
  async function monitorWithParts(parts: unknown[], calls: Call[] = [], extra: Record<string, (body: unknown) => { status?: number; body: unknown }> = {}) {
    let detailCalls = 0;
    stub(calls, {
      "GET /api/route-messages": () => ({ body: { period: "today", summary: {}, sources: [], destinations: [], messages: [{ id: "MSG-1", sourceName: "AP mailbox", status: "partial", subject: "Rechnung", receivedAt: new Date().toISOString(), invoices: 1 }] } }),
      "GET /api/route-messages/MSG-1": () => {
        detailCalls++;
        return {
          body: {
            canReprocess: true,
            similar: [],
            canDismiss: true,
            message: { id: "MSG-1", sourceName: "AP mailbox", status: "partial", subject: "Rechnung", receivedAt: new Date().toISOString() },
            parts: typeof parts[0] === "function" ? (parts[0] as (n: number) => unknown[])(detailCalls) : parts,
            events: [],
            invoices: [],
          },
        };
      },
      ...extra,
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/route-monitor.js");
    await open();
    await settle();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
  }
  const cards = () => [...document.querySelectorAll(".rmfmt")] as HTMLElement[];

  it("says what was tried and why on a failed file, and counts one broken rule in the singular", async () => {
    await monitorWithParts([
      { seq: 1, role: "attachment", filename: "Rechnungen_88252_88253.csv", outcome: "failed", reason: "the file holds 2 invoices (88252, 88253); one invoice per file is read", format: "supplier_csv", xmlRoot: "CSV", mapping: { id: "MAP-1", version: 2, name: "Lager Nord CSV", miss: null }, en16931Failed: null, reread: null },
      { seq: 2, role: "attachment", filename: "Rechnung_88251.csv", outcome: "captured", format: "supplier_csv", xmlRoot: "CSV", mapping: { id: "MAP-1", version: 2, name: "Lager Nord CSV", miss: null }, en16931Failed: [{ rule: "BR-CO-15", detail: "BT-112 605.00, expected 508.40" }], reread: null },
    ]);
    const [failed, captured] = cards();
    expect(failed.querySelector(".muted.sm")?.textContent).toBe(
      "Tried with Lager Nord CSV, version 2: the file holds 2 invoices (88252, 88253); one invoice per file is read"
    );
    expect(captured.querySelector(".rmpill")?.textContent).toBe("1 rule broken");
    expect(captured.querySelector(".muted.sm")?.textContent).toBe("Read with Lager Nord CSV, version 2.");
  });

  it("offers to read a file again with the live version, reads it, and shows the result", async () => {
    const calls: Call[] = [];
    const before = { seq: 2, role: "attachment", filename: "Rechnung_88251.csv", outcome: "captured", format: "supplier_csv", xmlRoot: "CSV", mapping: { id: "MAP-1", version: 1, name: "Lager Nord CSV", miss: null }, en16931Failed: [{ rule: "BR-CO-15" }], reread: { can: true, version: 2 } };
    const after = { ...before, mapping: { ...before.mapping, version: 2 }, en16931Failed: [], reread: null };
    // Before the re-read, the part as read with version 1; after it, with version 2.
    let done = false;
    await monitorWithParts([() => [done ? after : before]], calls, {
      "POST /api/route-messages/MSG-1/parts/2/reread": () => {
        done = true;
        return { body: { invoiceId: "inv-1", mappingId: "MAP-1", version: 2, en16931Failed: [] } };
      },
    });
    expect(text(".rmreread")).toBe(
      "Version 2 of the mapping is now live. This invoice was read with an earlier version, and nobody has worked on it yet, so it can be read again."
    );
    button("Read again with version 2").click();
    await settle();
    expect(calls.find((c) => c.path === "/api/route-messages/MSG-1/parts/2/reread")?.method).toBe("POST");
    expect(text("#routemonitor-note")).toBe("Read again with version 2: no EN 16931 rules broken. The same invoice starts again at its first stage.");
    expect(text(".rmfmt .rmpill")).toBe("Passed EN 16931");
    expect(button("Read again with version 2")).toBeUndefined();
  });

  it("says why a file is not read again", async () => {
    await monitorWithParts([
      { seq: 2, role: "attachment", filename: "Rechnung_88251.csv", outcome: "captured", format: "supplier_csv", xmlRoot: "CSV", mapping: { id: "MAP-1", version: 1, name: "Lager Nord CSV", miss: null }, en16931Failed: [], reread: { can: false, reason: "worked_on" } },
    ]);
    expect(text(".rmreread")).toBe("A newer version of the mapping is live, but somebody has worked on this invoice, so it is not read again.");
    expect(button("Read again with version 2")).toBeUndefined();
  });
});

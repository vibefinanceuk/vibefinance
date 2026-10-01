import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0208_routes_and_process_routes_strings.sql?raw";
import destinationStringsSql from "../../vf-licence/migrations/0209_erp_destination_strings.sql?raw";
import formatStringsSql from "../../vf-licence/migrations/0211_formats_and_en16931_strings.sql?raw";
import mappingStringsSql from "../../vf-licence/migrations/0212_supplier_mapping_strings.sql?raw";
import csvStringsSql from "../../vf-licence/migrations/0216_supplier_csv_strings.sql?raw";
import httpsStringsSql from "../../vf-licence/migrations/0226_https_in_strings.sql?raw";
import httpsStateStringsSql from "../../vf-licence/migrations/0228_https_source_state_strings.sql?raw";
import replaceKeyStringsSql from "../../vf-licence/migrations/0229_replace_key_strings.sql?raw";
import mailboxStringsSql from "../../vf-licence/migrations/0230_mailbox_name_strings.sql?raw";
import renameStringsSql from "../../vf-licence/migrations/0231_rename_source_strings.sql?raw";
import httpsOutStringsSql from "../../vf-licence/migrations/0232_https_out_strings.sql?raw";
import erpDeliveriesStringsSql from "../../vf-licence/migrations/0233_erp_deliveries_strings.sql?raw";
import destUnitsStringsSql from "../../vf-licence/migrations/0234_destination_units_strings.sql?raw";
import libraryStringsSql from "../../vf-licence/migrations/0235_route_library_strings.sql?raw";

/**
 * **Routes and Process routes — decision 0557.** The standard routes with
 * one laid out as its five parts, and one process as a flow: Source
 * instances into its entry stage, Destination instances out of its exit
 * stage, a source's own actions, and Add a source.
 *
 * The real English strings, read from the migration that adds them, plus
 * the Sources screen's own that Process routes reuses.
 */

const strings: Record<string, string> = {
  "action.close": "Close",
  "action.save": "Save",
  "action.rename": "Rename",
  "action.retire": "Retire",
  "action.create": "Create",
  "action.download": "Download",
  "sources.claim": "Create address",
  "sources.retired": "Retired",
  "sources.org": "Business unit",
  "sources.orgautomatic": "Automatic — read from the document",
  "sources.name": "Source",
  "sources.nameexample": "AP Mailbox",
  "sources.needname": "Give the source a name.",
  "sources.rename": "Rename",
  "routing.active": "Receiving",
  "routing.not_configured": "Not receiving yet",
  "mechanism.email": "Email",
  "mechanism.https": "HTTPS",
  "mechanism.sftp": "SFTP",
  "mechanism.file_import": "File import",
  "mechanism.edi": "EDI",
};
for (const sql of [stringsSql, destinationStringsSql, formatStringsSql, mappingStringsSql, csvStringsSql, httpsStringsSql, httpsStateStringsSql, replaceKeyStringsSql, mailboxStringsSql, renameStringsSql, httpsOutStringsSql, erpDeliveriesStringsSql, destUnitsStringsSql, libraryStringsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}
// 0209 updates the ERP note rather than inserting it.
strings["processroutes.erpnote"] = "Invoices reaching Payment Eligible are exported from the ERP export screen, each once, as a CSV file. Each export shows in the Route monitor as a message sent out on this Destination.";

const V = (gw: string, fin: string, tr: string, fout: string, gwo: string, status = "live") => ({
  version: 1,
  status,
  receivingGateway: gw,
  receivingFormat: fin,
  translation: tr,
  deliveryFormat: fout,
  deliveryGateway: gwo,
});

const ROUTES = {
  routes: [
    { id: "email-in", direction: "source", name: "Email in", origin: "standard", live: true, processes: 1, instances: 1, placedIn: ["Standard AP Process"], current: V("email", "detected", "standard_intake", "en16931", "process") },
    { id: "sftp-in", direction: "source", name: "SFTP in", origin: "standard", live: false, processes: 0, instances: 0, placedIn: [], current: V("sftp", "detected", "standard_intake", "en16931", "process", "draft") },
    { id: "erp-csv", direction: "destination", name: "ERP CSV file", origin: "standard", live: true, processes: 1, instances: 1, placedIn: ["Standard AP Process"], current: V("process", "en16931", "erp_csv_v1", "csv", "file_download") },
  ],
};

const FLOW = {
  processes: [
    { id: "ap", name: "Standard AP Process" },
    { id: "exp", name: "Expenses" },
  ],
  process: {
    id: "ap",
    name: "Standard AP Process",
    stages: [
      { id: "s1", name: "Intake", sequence: 1 },
      { id: "s2", name: "AP Review", sequence: 2 },
      { id: "s3", name: "Payment Eligible", sequence: 3 },
    ],
    entryStageId: "s1",
    exitStageId: "s3",
  },
  sources: [
    { id: "ap-mailbox", name: "AP mailbox", mechanism: "email", status: "active", emailAddress: "ap-mailbox.acme@vibefinance-ai.com", emailRouting: "active", defaultOrgUnitId: null, routeId: "email-in", routeName: "Email in", route: { live: true, ...V("email", "detected", "standard_intake", "en16931", "process") }, receivedThisWeek: 124, failedOpen: 2 },
    { id: "new-box", name: "New box", mechanism: "email", status: "active", emailAddress: null, emailRouting: "not_configured", defaultOrgUnitId: null, routeId: "email-in", routeName: "Email in", route: { live: true, ...V("email", "detected", "standard_intake", "en16931", "process") }, receivedThisWeek: 0, failedOpen: 0 },
    { id: "old-drop", name: "Old SFTP drop", mechanism: "sftp", status: "active", emailAddress: null, emailRouting: "not_configured", defaultOrgUnitId: null, routeId: "sftp-in", routeName: "SFTP in", route: { live: false, ...V("sftp", "detected", "standard_intake", "en16931", "process", "draft") }, receivedThisWeek: 0, failedOpen: 0 },
  ],
  destinations: [{ id: "erp-ap", name: "ERP", status: "active", routeId: "erp-csv", routeName: "ERP CSV file", route: { live: true, ...V("process", "en16931", "erp_csv_v1", "csv", "file_download") }, waiting: 38 }],
};

type Call = { method: string; path: string; query: string; body?: string };

function stub(calls: Call[], extra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      const method = init?.method ?? "GET";
      calls.push({ method, path, query, body: init?.body as string | undefined });
      if (path === "/api/ui-strings") return { ok: true, json: async () => ({ locale: "en", strings }) } as Response;
      if (path in extra) return { ok: true, status: 200, json: async () => extra[path] } as Response;
      if (path === "/api/routes") return { ok: true, json: async () => ROUTES } as Response;
      if (path === "/api/supplier-mappings") return { ok: true, json: async () => ({ mappings: [] }) } as Response;
      if (path === "/api/process-routes") return { ok: true, json: async () => FLOW } as Response;
      if (path === "/api/org/units") return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path === "/api/processes/ap/sources" && method === "POST") return { ok: true, status: 201, json: async () => ({}) } as Response;
      if (/^\/api\/sources\/[^/]+\/email$/.test(path) && method === "GET") {
        // Decision 0582: the preview, as vf-app reduces a mailbox name.
        const mailbox = (new URLSearchParams(query).get("mailbox") ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
        if (mailbox === "invoices") return { ok: true, json: async () => ({ ok: false, address: null, mailbox, reason: "address_taken", error: "taken" }) } as Response;
        return { ok: true, json: async () => ({ ok: true, address: `${mailbox}.acme@vibefinance-ai.com`, mailbox }) } as Response;
      }
      if (/^\/api\/sources\/[^/]+\/email$/.test(path)) return { ok: true, json: async () => ({}) } as Response;
      if (path === "/api/route-instances/erp-ap" && method === "PATCH") return { ok: true, json: async () => ({ id: "erp-ap", status: "paused" }) } as Response;
      throw new Error(`no stub for ${method} ${path}`);
    })
  );
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";

async function openScreen(module: string) {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import(module);
  await open();
}

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Routes — decision 0557", () => {
  it("lists Sources beside Destinations, standard and live or draft, with where each is placed", async () => {
    stub([]);
    await openScreen("/routes.js");
    const tables = [...document.querySelectorAll(".rttable")];
    expect(tables).toHaveLength(2);
    const rows = (table: Element) => [...table.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows(tables[0])).toEqual([
      ["Email inStandard", "Email address · PDF, image or XML→ EN 16931 invoice · A VibeFinance process", "Standard AP Process", "v1 Live"],
      ["SFTP inStandard", "SFTP · PDF, image or XML→ EN 16931 invoice · A VibeFinance process", "Not placed", "v1 Draft"],
    ]);
    expect(rows(tables[1])[0][1]).toBe("A VibeFinance process · EN 16931 invoice→ CSV file · File download");
  });

  it("lays out the first live source route as its five parts, and another when chosen", async () => {
    stub([]);
    await openScreen("/routes.js");
    expect(text(".rtdetail h3")).toBe("Email in");
    const parts = () => [...document.querySelectorAll(".rtpart")].map((p) => [p.querySelector(".k")?.textContent, p.querySelector(".v")?.textContent, p.classList.contains("core")]);
    expect(parts()).toEqual([
      ["1 · Receiving gateway", "Email address", false],
      ["2 · Receiving format", "PDF, image or XML", false],
      ["3 · Translation", "Standard intake mapping", false],
      ["4 · Delivery format", "EN 16931 invoice", true],
      ["5 · Delivery gateway", "A VibeFinance process", false],
    ]);
    expect(text(".rtdetail")).toContain("keeps its original");

    ([...document.querySelectorAll(".rttable tbody tr")].find((r) => r.textContent?.startsWith("ERP CSV file")) as HTMLElement).click();
    await settle();
    expect(text(".rtdetail h3")).toBe("ERP CSV file");
    expect(parts().map((p) => p[1])).toEqual(["A VibeFinance process", "EN 16931 invoice", "ERP CSV layout", "CSV file", "File download"]);
    expect(parts()[1][2]).toBe(true);
    expect(text(".rtdetail")).toContain("Reads from the process's last stage");
  });
});

describe("Receiving formats — decision 0560", () => {
  const withFormats = {
    routes: ROUTES.routes.map((r) =>
      r.id === "email-in"
        ? {
            ...r,
            formats30d: [
              { format: "xrechnung", inPdf: false, received: 41, failing: 2 },
              { format: "en16931", inPdf: true, received: 80, failing: 0 },
              { format: "factur_x_minimum", inPdf: true, received: 6, failing: 0 },
              { format: "peppol_bis_3", inPdf: false, received: 3, failing: 0 },
              { format: "picture", inPdf: false, received: 1204, failing: 0 },
              { format: "unread", inPdf: false, received: 5, failing: 0 },
            ],
          }
        : { ...r, formats30d: [] }
    ),
  };

  /** The screen remembers the route chosen last, so each test chooses its own. */
  async function choose(name: string) {
    ([...document.querySelectorAll(".rttable tbody tr")].find((r) => r.textContent?.startsWith(name)) as HTMLElement).click();
    await settle();
  }

  it("lists what a Source route reads, how, what it is checked against, and the last 30 days", async () => {
    stub([], { "/api/routes": withFormats });
    await openScreen("/routes.js");
    await choose("Email in");
    const rows = [...document.querySelectorAll(".rtformats tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((td) => td.textContent)
    );
    expect(rows.map((r) => r[0])).toEqual([
      "XRechnungUBL or CII",
      "Peppol BIS Billing 3.0UBL",
      "EN 16931UBL or CII, with no national rules",
      "ZUGFeRD / Factur-XA PDF with the XML inside",
      "Another UBL or CII invoiceDeclaring another specification",
      "A supplier's own XMLNeither UBL nor CII",
      // Decision 0565.
      "A supplier's CSVColumns, one row per line",
      "PDF or imageNo data inside",
    ]);
    // Anything read from inside a PDF counts as Factur-X / ZUGFeRD, whatever profile it declares.
    const counts = [...document.querySelectorAll(".rtformats tbody td.n")].map((td) =>
      [...td.children].map((c) => c.textContent)
    );
    expect(counts).toEqual([["41", "2 broke a rule"], ["3"], ["0"], ["86"], ["0"], ["0"], ["0"], ["1204"]]);
    expect(rows[0][2]).toBe("EN 16931, and the buyer reference XRechnung requires (BR-DE-15)");
    expect(text(".rtformats").includes("undefined")).toBe(false);
    expect(document.body.textContent).toContain("5 attachments in the last 30 days could not be read at all");
    expect(text(".rtnote")).toContain("A broken rule does not stop an invoice");
  });

  it("is shown for a Source route that detects formats, and not for a Destination", async () => {
    stub([], { "/api/routes": withFormats });
    await openScreen("/routes.js");
    await choose("Email in");
    expect(document.querySelector(".rtformats")).not.toBeNull();
    await choose("ERP CSV file");
    expect(document.querySelector(".rtformats")).toBeNull();
  });
});

describe("Supplier mappings — decision 0561", () => {
  it("lists a Source route's mappings with their versions and what they read, and opens one in the editor", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "/api/supplier-mappings": {
        mappings: [
          { id: "MAP-1", routeId: "email-in", name: "Munch GmbH XML", root: "Rechnung", senders: ["@munch.de"], liveVersion: 1, draftVersion: 2, read30d: 14, waiting: 2 },
        ],
      },
      "/api/supplier-mappings/MAP-1": {
        mapping: { id: "MAP-1", routeId: "email-in", name: "Munch GmbH XML", root: "Rechnung", senders: ["@munch.de"] },
        versions: [{ version: 2, status: "draft" }, { version: 1, status: "live" }],
        editing: { version: 2, status: "draft", definition: { root: "Rechnung", linesPath: null, lines: [] }, sample: null },
        described: null,
        targets: [],
        waiting: 2,
      },
    });
    await openScreen("/routes.js");
    ([...document.querySelectorAll(".rttable tbody tr")].find((r) => r.textContent?.startsWith("Email in")) as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.path === "/api/supplier-mappings" && c.query === "route=email-in")).toBe(true);
    const row = [...document.querySelectorAll(".rtmappings tbody td")].map((td) => td.textContent);
    expect(row.slice(0, 3)).toEqual(["Munch GmbH XML<Rechnung> · @munch.de", "v1 Livev2 Draft", "14 read2 failed, waiting"]);
    ([...document.querySelectorAll(".rtmappings button")][0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(text(".topbar h2")).toBe("Mapping: Munch GmbH XML"));
  });
});

describe("Process routes — decision 0557", () => {
  it("draws the process: sources into Intake, its stages, the ERP out of Payment Eligible", async () => {
    stub([]);
    await openScreen("/process-routes.js");
    expect(text(".prpanel h3")).toBe("Standard AP Process");
    expect([...document.querySelectorAll(".prstage")].map((s) => s.textContent)).toEqual([
      "IntakeSources deliver here",
      "AP Review",
      "Payment EligibleDestinations read from here",
    ]);
    expect([...document.querySelectorAll(".prstage.edge")]).toHaveLength(2);
    const heads = [...document.querySelectorAll(".prcolh")].map((h) => h.textContent);
    expect(heads).toEqual(["Sourcesdeliver to Intake", "Destinationsread from Payment Eligible"]);

    const cards = [...document.querySelectorAll(".prcard")];
    expect(cards.map((c) => c.querySelector(".v")?.textContent)).toEqual(["AP mailbox", "New box", "Old SFTP drop", "ERP"]);
    expect(cards[0].textContent).toContain("ap-mailbox.acme@vibefinance-ai.com");
    expect(cards[0].textContent).toContain("Receiving");
    expect(cards[0].textContent).toContain("2 failed");
    expect(cards[1].textContent).toContain("No address yet");
    // A route with no live version is shown, dimmed, as not yet available.
    expect(cards[2].classList.contains("dim")).toBe(true);
    expect(cards[2].textContent).toContain("Not yet available");
    expect(cards[3].textContent).toContain("38 waiting");
    // One connector per source, and one per destination.
    const brackets = [...document.querySelectorAll(".prbracket")];
    expect(brackets[0].querySelectorAll("path")).toHaveLength(4);
    expect(brackets[1].querySelectorAll("path")).toHaveLength(2);
  });

  it("opens a source with the Sources screen's own actions, and one with no address offers to create it", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openScreen("/process-routes.js");
    (document.querySelectorAll(".prcard")[0] as HTMLElement).click();
    await settle();
    expect(text(".prdetail h3")).toBe("Source: AP mailbox");
    const buttons = () => [...document.querySelectorAll(".prdetail .statebuttons button")].map((b) => b.textContent);
    expect(buttons()).toEqual(["Rename", "Retire", "Close"]);
    expect(text(".prdetail")).toContain("Delivers to stage");
    expect(text(".prdetail")).toContain("124 this week");
    expect(document.querySelector(".prdetail select.orgpicker")).not.toBeNull();

    (document.querySelectorAll(".prcard")[1] as HTMLElement).click();
    await settle();
    expect(buttons()).toEqual(["Create address", "Rename", "Retire", "Close"]);
    ([...document.querySelectorAll(".prdetail .statebuttons button")][0] as HTMLButtonElement).click();
    await settle();
    // Decision 0582: a pop-out with the mailbox name first, previewed; nothing issued yet.
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/sources/new-box/email")).toBe(false);
    ([...document.querySelectorAll(".praddpop button")][0] as HTMLButtonElement).click();
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/sources/new-box/email")).toBe(true);
    // And the flow is fetched again, not the Sources screen.
    expect(calls.filter((c) => c.path === "/api/process-routes").length).toBeGreaterThan(1);
    expect(calls.some((c) => c.path === "/api/sources")).toBe(false);
  });

  it("opens the ERP Destination, reading from Payment Eligible", async () => {
    stub([]);
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].at(-1) as HTMLElement).click();
    await settle();
    expect(text(".prdetail h3")).toBe("Destination: ERP");
    expect(text(".prdetail")).toContain("Payment Eligible · approved, coded and matched");
    expect(text(".prdetail")).toContain("File download");
    expect([...document.querySelectorAll(".prdetail .statebuttons button")].map((b) => b.textContent)).toEqual(["Pause", "Open ERP export", "Close"]);
    expect(text(".prdetail")).toContain("shows in the Route monitor");
  });

  it("pauses the ERP Destination, and a paused one offers Resume and says what waits — decision 0558", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].at(-1) as HTMLElement).click();
    await settle();
    ([...document.querySelectorAll(".prdetail .statebuttons button")].find((b) => b.textContent === "Pause") as HTMLElement).click();
    await settle();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toMatchObject({ path: "/api/route-instances/erp-ap" });
    expect(JSON.parse(patch!.body!)).toEqual({ status: "paused" });

    stub([], { "/api/process-routes": { ...FLOW, destinations: [{ ...FLOW.destinations[0], status: "paused" }] } });
    await openScreen("/process-routes.js");
    const erp = [...document.querySelectorAll(".prcard")].at(-1) as HTMLElement;
    expect(erp.classList.contains("dim")).toBe(true);
    expect(erp.textContent).toContain("Paused");
    erp.click();
    await settle();
    expect([...document.querySelectorAll(".prdetail .statebuttons button")].map((b) => b.textContent)).toEqual(["Resume", "Open ERP export", "Close"]);
    expect(text(".prdetail")).toContain("Paused: nothing is exported for this process.");
  });

  it("adds a source to this process from its name and how it arrives", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prpanel .cardhead button")].find((b) => b.textContent === "Add a source") as HTMLElement).click();
    await settle();
    const pop = document.querySelector(".popout.praddpop") as HTMLElement;
    expect(pop.textContent).toContain("A new way in to Standard AP Process, delivering to Intake.");
    const input = pop.querySelector("input") as HTMLInputElement;
    input.value = "Rechnungen für Köln";
    input.dispatchEvent(new Event("input"));
    expect(pop.querySelector(".slugpreview")?.textContent).toBe("rechnungen-fur-koln");
    ([...pop.querySelectorAll("button")].find((b) => b.textContent === "Create") as HTMLElement).click();
    await settle();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/processes/ap/sources");
    expect(JSON.parse(post!.body!)).toEqual({ id: "rechnungen-fur-koln", name: "Rechnungen für Köln", mechanism: "email" });
    expect(document.querySelector(".popout.praddpop")).toBeNull();
  });

  it("switches process, asking for that one", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".rmchip")].find((b) => b.textContent === "Expenses") as HTMLElement).click();
    await settle();
    expect(calls.at(-1)).toMatchObject({ path: "/api/process-routes", query: "process=exp" });
  });
});

describe("HTTPS in — decision 0578", () => {
  const PORTAL = { ...FLOW.sources[0], id: "portal", name: "Supplier portal API", mechanism: "https", emailAddress: null, emailRouting: "not_configured", routeId: "https-in", routeName: "HTTPS in", receivedThisWeek: 3, failedOpen: 0 };
  const KEYS = {
    address: "https://acme.vibefinance.example/v1/sources/portal/invoices",
    keys: [
      { id: "k1", name: "Lager Nord ERP", prefix: "vf_in_Ab3x", createdAt: "2026-09-29T10:00:00Z", createdBy: "Dan Young", lastUsedAt: "2026-10-01T08:12:00Z", revokedAt: null },
      { id: "k0", name: "Old portal", prefix: "vf_in_Zq9w", createdAt: "2026-09-01T10:00:00Z", createdBy: "Dan Young", lastUsedAt: null, revokedAt: "2026-09-20T10:00:00Z" },
    ],
  };

  function stubHttps(calls: Call[], keys = KEYS) {
    stub(calls, { "/api/process-routes": { ...FLOW, sources: [PORTAL, ...FLOW.sources] } });
    const inner = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        const method = init?.method ?? "GET";
        if (path === "/api/sources/portal/keys" && method === "GET") {
          calls.push({ method, path, query: "" });
          return { ok: true, status: 200, json: async () => keys } as Response;
        }
        if (path === "/api/sources/portal/keys" && method === "POST") {
          calls.push({ method, path, query: "", body: init?.body as string });
          return { ok: true, status: 201, json: async () => ({ id: "k2", name: "Coupa", prefix: "vf_in_Qr7t", key: "vf_in_Qr7tSECRETSECRETSECRETSECRET01" }) } as Response;
        }
        if (/^\/api\/sources\/portal\/keys\/[^/]+\/replace$/.test(path)) {
          calls.push({ method, path, query: "", body: init?.body as string });
          return { ok: true, status: 201, json: async () => ({ id: "k3", name: "Lager Nord ERP", prefix: "vf_in_Nw5e", key: "vf_in_Nw5eREPLACEDREPLACEDREPLACED01", replaced: "k1" }) } as Response;
        }
        if (/^\/api\/sources\/portal\/keys\/[^/]+\/revoke$/.test(path)) {
          calls.push({ method, path, query: "" });
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        }
        return inner(url, init);
      })
    );
  }

  async function openPortal() {
    await openScreen("/process-routes.js");
    (document.querySelectorAll(".prcard")[0] as HTMLElement).click();
    await settle();
  }

  it("shows an HTTPS source's address, its keys by their start, and how to send", async () => {
    stubHttps([]);
    await openPortal();
    expect(text(".prdetail h3")).toBe("Source: Supplier portal API");
    // The panel's own buttons are unchanged by the section.
    expect([...document.querySelectorAll(".prdetail .statebuttons button")].map((b) => b.textContent)).toEqual(["Rename", "Retire", "Close"]);
    expect(text("#httpsin h4")).toBe("HTTPS in");
    expect(text("#httpsin-address")).toBe("POST https://acme.vibefinance.example/v1/sources/portal/invoices");
    const rows = [...document.querySelectorAll(".httpskeys tbody tr")];
    expect(rows.map((r) => r.querySelector("td")?.textContent)).toEqual(["Lager Nord ERP", "Old portal"]);
    expect(rows[0].textContent).toContain("vf_in_Ab3x…");
    expect(rows[0].textContent).toContain("Dan Young");
    expect([...rows[0].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Replace", "Revoke"]);
    // A revoked key is shown, struck through, with no Revoke.
    expect(rows[1].classList.contains("httpsrevoked")).toBe(true);
    expect(rows[1].textContent).toContain("Revoked");
    expect(rows[1].querySelector("button")).toBeNull();
    expect(text(".httpspre")).toContain('curl -X POST "https://acme.vibefinance.example/v1/sources/portal/invoices"');
    // Decision 0581: no key's start, which looked like a key to paste.
    expect(text(".httpspre")).toContain("Bearer <your key>");
    expect(text("#httpsin")).toContain("Each key is shown once");
  });

  it("says on its card whether it receives: Receiving with a live key, else No keys yet — decision 0580", async () => {
    stub([], { "/api/process-routes": { ...FLOW, sources: [PORTAL, { ...PORTAL, id: "keyed", name: "Keyed API", liveKeys: 1 }] } });
    await openScreen("/process-routes.js");
    const cards = [...document.querySelectorAll(".prcard")];
    expect(cards[0].querySelector(".rmpill")?.textContent).toBe("No keys yet");
    expect(cards[0].querySelector(".rmpill")?.classList.contains("warn")).toBe(true);
    expect(cards[1].querySelector(".rmpill")?.textContent).toBe("Receiving");
    expect(cards[1].querySelector(".rmpill")?.classList.contains("ok")).toBe(true);
  });

  it("is not shown for an email source", async () => {
    stub([]);
    await openScreen("/process-routes.js");
    (document.querySelectorAll(".prcard")[0] as HTMLElement).click();
    await settle();
    expect(document.querySelector("#httpsin")).toBeNull();
  });

  it("makes a key with a name, shows it once, and lists it after", async () => {
    const calls: Call[] = [];
    stubHttps(calls, { ...KEYS, keys: [] });
    await openPortal();
    expect(text("#httpsin-nokeys")).toContain("No keys yet");
    ([...document.querySelectorAll("#httpsin button")].find((b) => b.textContent === "Make a key") as HTMLElement).click();
    await settle();
    const pop = document.querySelector(".httpspop") as HTMLElement;
    expect(pop.getAttribute("role")).toBe("dialog");
    (document.querySelector("#httpsin-keyname") as HTMLInputElement).value = "Coupa";
    ([...pop.querySelectorAll("button")].find((b) => b.textContent === "Make key") as HTMLElement).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ name: "Coupa" });
    expect(text("#httpsin-newkey")).toBe("vf_in_Qr7tSECRETSECRETSECRETSECRET01");
    expect(text(".httpspop")).toContain("It is not shown again");
    const before = calls.filter((c) => c.path === "/api/sources/portal/keys" && c.method === "GET").length;
    ([...pop.querySelectorAll("button")].find((b) => b.textContent === "Done") as HTMLElement).click();
    await settle();
    expect(document.querySelector(".httpspop")).toBeNull();
    expect(calls.filter((c) => c.path === "/api/sources/portal/keys" && c.method === "GET").length).toBe(before + 1);
  });

  it("replaces a key with one of the same name, shown once, the old one stopping in 24 hours unless ticked — decision 0581", async () => {
    for (const stopNow of [false, true]) {
      document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
      const calls: Call[] = [];
      stubHttps(calls);
      await openPortal();
      ([...document.querySelectorAll(".httpskeys tbody tr")][0].querySelector("button") as HTMLElement).click();
      await settle();
      expect(text(".httpspop h3")).toBe("Replace this key?");
      expect(text(".httpspop")).toContain("Lager Nord ERP gets a new key with the same name");
      expect(text(".httpspop")).toContain("mappings that name Lager Nord ERP keep reading");
      expect(text(".httpspop")).toContain("keeps working for 24 hours");
      (document.querySelector("#httpsin-stopnow") as HTMLInputElement).checked = stopNow;
      ([...document.querySelectorAll(".httpspop button")].find((b) => b.textContent === "Replace") as HTMLElement).click();
      await settle();
      const call = calls.find((c) => c.path.endsWith("/replace"))!;
      expect(call).toMatchObject({ method: "POST", path: "/api/sources/portal/keys/k1/replace" });
      expect(JSON.parse(call.body!)).toEqual({ stopNow });
      expect(text("#httpsin-newkey")).toBe("vf_in_Nw5eREPLACEDREPLACEDREPLACED01");
      expect(text(".httpspop")).toContain("It is not shown again");
    }
  });

  it("shows a replaced key with when it stops, and one past that as stopped — decision 0581", async () => {
    const soon = new Date(Date.now() + 20 * 3600_000).toISOString();
    stubHttps([], {
      ...KEYS,
      keys: [
        { ...KEYS.keys[0], id: "k3", prefix: "vf_in_Nw5e" },
        { ...KEYS.keys[0], replacedBy: "k3", expiresAt: soon },
        { ...KEYS.keys[0], id: "k2", prefix: "vf_in_Qq1a", replacedBy: "k1", expiresAt: "2026-09-25T10:00:00Z" },
      ],
    });
    await openPortal();
    const rows = [...document.querySelectorAll(".httpskeys tbody tr")];
    expect([...rows[0].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Replace", "Revoke"]);
    // Replaced, still working: says when it stops, and can be stopped now.
    expect(rows[1].classList.contains("httpsreplaced")).toBe(true);
    expect(rows[1].textContent).toContain("Replaced · stops");
    expect([...rows[1].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Revoke"]);
    // Past its 24 hours: stopped, struck through, nothing to do.
    expect(rows[2].classList.contains("httpsrevoked")).toBe(true);
    expect(rows[2].textContent).toContain("Stopped");
    expect(rows[2].querySelector("button")).toBeNull();
  });

  it("revokes a key only once confirmed", async () => {
    const calls: Call[] = [];
    stubHttps(calls);
    await openPortal();
    ([...document.querySelectorAll(".httpskeys tbody tr button")].find((b) => b.textContent === "Revoke") as HTMLElement).click();
    await settle();
    expect(text(".httpspop h3")).toBe("Revoke this key?");
    expect(text(".httpspop")).toContain("Lager Nord ERP can no longer send with it");
    expect(calls.some((c) => c.path.endsWith("/revoke"))).toBe(false);
    ([...document.querySelectorAll(".httpspop button")].find((b) => b.textContent === "Revoke") as HTMLElement).click();
    await settle();
    expect(calls.find((c) => c.path.endsWith("/revoke"))).toMatchObject({ method: "POST", path: "/api/sources/portal/keys/k1/revoke" });
    expect(document.querySelector(".httpspop")).toBeNull();
  });
});

describe("Create the address, with a mailbox name — decision 0582", () => {
  it("prefills the mailbox name from the source's name, previews the address as typed, and issues what was chosen", async () => {
    const calls: Call[] = [];
    stub(calls);
    await openScreen("/process-routes.js");
    (document.querySelectorAll(".prcard")[1] as HTMLElement).click();
    await settle();
    ([...document.querySelectorAll(".prdetail .statebuttons button")][0] as HTMLButtonElement).click();
    await settle();
    expect(text(".praddpop h3")).toBe("Create the address");
    expect(text(".praddpop")).toContain("Suppliers send invoices for New box to this address. It cannot be changed once created");
    const input = document.querySelector("#mailbox-name") as HTMLInputElement;
    expect(input.value).toBe("new-box");
    expect(text("#mailbox-address")).toBe("new-box.acme@vibefinance-ai.com");

    input.value = "Invoices";
    input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(calls.some((c) => c.method === "GET" && c.path === "/api/sources/new-box/email" && c.query === "mailbox=Invoices")).toBe(true);
    expect(text("#mailbox-address")).toBe("—");
    expect(text("#mailbox-problem")).toBe("Another of your sources already has that address. Choose a different mailbox name.");

    input.value = "UK.Invoices";
    input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(text("#mailbox-address")).toBe("uk.invoices.acme@vibefinance-ai.com");
    expect(text("#mailbox-problem")).toBe("");

    ([...document.querySelectorAll(".praddpop button")].find((b) => b.textContent === "Create address") as HTMLElement).click();
    await settle();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/sources/new-box/email")!;
    expect(JSON.parse(post.body!)).toEqual({ mailbox: "UK.Invoices" });
    expect(document.querySelector(".praddpop")).toBeNull();
  });
});

describe("renaming a source — decision 0583", () => {
  async function renameTo(name: string, reply: { status: number; body: unknown }) {
    const calls: Call[] = [];
    stub(calls, { "/api/sources/ap-mailbox": reply.body });
    const inner = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/sources/ap-mailbox" && init?.method === "PATCH") {
          calls.push({ method: "PATCH", path: "/api/sources/ap-mailbox", query: "", body: init.body as string });
          return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
        }
        return inner(url, init);
      })
    );
    await openScreen("/process-routes.js");
    (document.querySelectorAll(".prcard")[0] as HTMLElement).click();
    await settle();
    ([...document.querySelectorAll(".prdetail .statebuttons button")].find((b) => b.textContent === "Rename") as HTMLElement).click();
    await settle();
    expect(text(".renamepop")).toContain("The name is what people read. The address never changes");
    (document.querySelector(".renamepop input") as HTMLInputElement).value = name;
    (document.querySelector(".renamepop button") as HTMLElement).click();
    await settle();
    return calls;
  }

  it("names the rules that test for the source's name, when they stop the rename", async () => {
    const calls = await renameTo("UK supplier invoices", {
      status: 409,
      body: { reason: "rule_names_source", error: "x", rules: [{ id: "r-1", name: "Mailbox invoices to Dan" }, { id: "r-9", name: null }] },
    });
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body!)).toEqual({ name: "UK supplier invoices" });
    expect(text(".renamepop .warn")).toBe(
      "These rules test for this source's name as the channel: Mailbox invoices to Dan, r-9. Change them to the new name, or end them, then rename."
    );
  });

  it("says when another source has the name", async () => {
    await renameTo("New box", { status: 409, body: { reason: "name_taken", error: "x" } });
    expect(text(".renamepop .warn")).toBe("Another source in this process already has that name.");
  });
});

describe("HTTPS out — decision 0585", () => {
  const PUSH = { id: "dest-1", name: "ERP push", status: "paused", routeId: "https-out", routeName: "HTTPS out", route: { live: true, ...V("process", "en16931", "vf_invoice_json_v1", "en16931", "https") }, waiting: 0, started: false, failedOpen: 0 };
  const CONNECTOR = {
    instance: { id: "dest-1", name: "ERP push", status: "paused", processId: "ap", startedAt: null },
    settings: { url: "https://erp.acme.example/api/invoices", method: "POST", format: "vf_json", auth: { type: "bearer" }, referencePath: "$.id" },
    secrets: { token: "2026-10-01T09:00:00Z" },
    waitingNotTaken: 3,
    counts: { failed: 1, delivered: 1 },
    deliveries: [
      { invoiceId: "inv-9", invoiceNumber: "88240", supplier: "Lager Nord GmbH", status: "failed", attempts: 1, nextAttemptAt: null, lastStatus: 422, lastError: "Supplier has no site", reference: null, deliveredAt: null, messageId: "MSG-1" },
      { invoiceId: "inv-8", invoiceNumber: "88239", supplier: "Lager Nord GmbH", status: "delivered", attempts: 1, nextAttemptAt: null, lastStatus: 201, lastError: null, reference: "AP-51", deliveredAt: "2026-10-01T09:10:00Z", messageId: "MSG-2" },
    ],
    candidates: [{ id: "inv-9", number: "88240", supplier: "Lager Nord GmbH", currency: "EUR", total: 738.99 }],
  };

  function stubOut(calls: Call[], connector: unknown = CONNECTOR, destinations: unknown[] = [PUSH]) {
    stub(calls, { "/api/process-routes": { ...FLOW, destinations: [...FLOW.destinations, ...destinations] } });
    const inner = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        const method = init?.method ?? "GET";
        const reply = (status: number, body: unknown) => {
          calls.push({ method, path, query: "", body: init?.body as string | undefined });
          return { ok: status < 300, status, json: async () => body } as Response;
        };
        if (path === "/api/processes/ap/destinations") return reply(201, { id: "dest-2", name: "New push", routeId: "https-out", status: "paused" });
        if (path === "/api/route-instances/dest-1/connector") return method === "GET" ? reply(200, connector) : reply(200, { settings: {}, secrets: {} });
        if (path === "/api/route-instances/dest-1/connector/preview")
          return reply(200, { method: "POST", url: "https://erp.acme.example/api/invoices", headers: { "Content-Type": "application/json", Authorization: "Bearer •••" }, body: '{\n  "invoiceNumber": "88240"\n}', checks: ["no_supplier_erp_id"] });
        if (path === "/api/route-instances/dest-1/connector/send") return reply(200, { status: "delivered", httpStatus: 201, reference: "AP-77", error: null, messageId: "MSG-3" });
        if (path === "/api/route-instances/dest-1/connector/start") return reply(200, { status: "active" });
        return inner(url, init);
      })
    );
  }

  async function openPush() {
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].find((c) => c.textContent?.includes("ERP push")) as HTMLElement).click();
    await settle();
  }
  const button = (root: string, label: string) => [...document.querySelectorAll(`${root} button`)].find((b) => b.textContent === label) as HTMLElement;

  it("shows on its card whether it is sending, what failed and what waits", async () => {
    stubOut([], CONNECTOR, [PUSH, { ...PUSH, id: "dest-x", name: "Live push", status: "active", started: true, failedOpen: 2, waiting: 1 }]);
    await openScreen("/process-routes.js");
    const cards = [...document.querySelectorAll(".prcard")];
    const pills = (name: string) => [...cards.find((c) => c.textContent?.includes(name))!.querySelectorAll(".rmpill")].map((p) => p.textContent);
    expect(pills("ERP push")).toEqual(["Not sending yet"]);
    expect(pills("Live push")).toEqual(["Sending", "2 failed", "1 waiting"]);
  });

  it("adds a destination, named, as HTTPS out", async () => {
    const calls: Call[] = [];
    stubOut(calls);
    await openScreen("/process-routes.js");
    button(".prpanel .statebuttons", "Add a destination").click();
    await settle();
    expect(text(".praddpop h3")).toBe("Add a destination");
    (document.querySelector("#dest-name") as HTMLInputElement).value = "New push";
    (document.querySelector(".praddpop .statebuttons button") as HTMLElement).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path === "/api/processes/ap/destinations")!.body!)).toEqual({ name: "New push", connectorId: "https-out" });
  });

  it("shows its settings, signs in by bearer with the token set, and saves what is typed", async () => {
    const calls: Call[] = [];
    stubOut(calls);
    await openPush();
    expect(text(".prdetail h3")).toBe("Destination: ERP push");
    // Not started: no Pause, no ERP export; a Start instead.
    expect([...document.querySelectorAll(".prdetail > .cardhead .statebuttons button")].map((b) => b.textContent)).toEqual(["Close"]);
    expect(text("#do-notstarted")).toContain("Not sending yet");
    expect((document.querySelector("#do-url") as HTMLInputElement).value).toBe("https://erp.acme.example/api/invoices");
    expect((document.querySelector("#do-auth") as HTMLSelectElement).value).toBe("bearer");
    expect((document.querySelector("#do-secret") as HTMLInputElement).placeholder).toContain("Type to replace it");
    // Choosing OAuth asks for its own fields.
    const auth = document.querySelector("#do-auth") as HTMLSelectElement;
    auth.value = "oauth2_client_credentials";
    auth.dispatchEvent(new Event("change"));
    expect(document.querySelector("#do-tokenurl")).not.toBeNull();
    expect(text("#do-settings")).toContain("Client secret");
    (document.querySelector("#do-tokenurl") as HTMLInputElement).value = "https://id.example/token";
    (document.querySelector("#do-clientid") as HTMLInputElement).value = "vf";
    (document.querySelector("#do-secret") as HTMLInputElement).value = "cs-1";
    button("#do-settings", "Save").click();
    await settle();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toMatchObject({
      settings: { url: "https://erp.acme.example/api/invoices", method: "POST", format: "vf_json", referencePath: "$.id", auth: { type: "oauth2_client_credentials", tokenUrl: "https://id.example/token", clientId: "vf" } },
      secret: "cs-1",
    });
  });

  it("shows exactly what would be sent first, then sends it and says what came back", async () => {
    const calls: Call[] = [];
    stubOut(calls);
    await openPush();
    button("#do-try", "Show what would be sent").click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path.endsWith("/preview"))!.body!)).toEqual({ invoiceId: "inv-9" });
    expect(text("#do-preview")).toContain("POST https://erp.acme.example/api/invoices");
    expect(text("#do-preview")).toContain("Authorization: Bearer •••");
    expect(text("#do-try")).toContain("The supplier has no ERP id");
    expect(calls.some((c) => c.path.endsWith("/send"))).toBe(false);
    button("#do-try", "Send").click();
    await settle();
    expect(text("#do-outcome")).toBe("Delivered: HTTP 201. Its reference: AP-77.");
  });

  it("lists deliveries with Send again for a failed one, and starts only as chosen", async () => {
    const calls: Call[] = [];
    stubOut(calls);
    await openPush();
    const rows = [...document.querySelectorAll("#do-deliveries tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[0].slice(0, 4)).toEqual(["88240", "Lager Nord GmbH", "Failed", "HTTP 422 · Supplier has no site"]);
    expect(rows[1][2]).toBe("Delivered");
    expect(rows[1][3]).toContain("AP-51");
    button("#do-deliveries", "Send again").click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path.endsWith("/send"))!.body!)).toEqual({ invoiceId: "inv-9" });

    button("#do-notstarted", "Start sending").click();
    await settle();
    expect(text(".dostartpop")).toContain("Only invoices from now on (3 already waiting are set aside)");
    (document.querySelector("#do-start-all") as HTMLInputElement).checked = true;
    button(".dostartpop", "Start sending").click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path.endsWith("/start"))!.body!)).toEqual({ includeWaiting: true });
  });
});

describe("the ERP CSV file's deliveries — decision 0586", () => {
  it("lists each invoice an export took, with the export, and no Send again", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "/api/route-instances/erp-ap/deliveries": {
        id: "erp-ap",
        routeId: "erp-csv",
        counts: { delivered: 2 },
        deliveries: [
          { invoiceId: "inv-a", invoiceNumber: "88240", supplier: "Lager Nord GmbH", status: "delivered", attempts: 1, reference: "3f9c2a7e-1111-2222-3333-444455556666", deliveredAt: "2026-10-01T09:10:00Z", messageId: "MSG-1" },
          { invoiceId: "inv-b", invoiceNumber: "88241", supplier: "Lager Nord GmbH", status: "delivered", attempts: 1, reference: "3f9c2a7e-1111-2222-3333-444455556666", deliveredAt: "2026-10-01T09:10:00Z", messageId: "MSG-1" },
        ],
      },
    });
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].at(-1) as HTMLElement).click();
    await settle();
    expect(text(".prdetail h3")).toBe("Destination: ERP");
    const rows = [...document.querySelectorAll("#erpout tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ["88240", "Lager Nord GmbH", "Delivered"],
      ["88241", "Lager Nord GmbH", "Delivered"],
    ]);
    expect(rows[0][3]).toContain("export 3f9c2a7e");
    expect(document.querySelectorAll("#erpout tbody button")).toHaveLength(0);
    expect(text("#erpout")).toContain("Undoing an export on the ERP export screen puts its invoices back to ready.");
  });
});

describe("a Destination's business units — decision 0587", () => {
  const UNITS = [
    { id: "de", name: "Acme Germany", kind: "legal_entity", parentUnitId: null },
    { id: "de-ham", name: "Acme Hamburg", kind: "operating_unit", parentUnitId: "de" },
    { id: "uk", name: "Acme UK", kind: "legal_entity", parentUnitId: null },
  ];
  function stubUnits(calls: Call[], erp: Record<string, unknown>, replies: Array<{ status: number; body: unknown }>) {
    stub(calls, { "/api/org/units": { units: UNITS }, "/api/process-routes": { ...FLOW, destinations: [{ ...FLOW.destinations[0], ...erp }] } });
    const inner = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (path === "/api/route-instances/erp-ap/units") {
          calls.push({ method: init?.method ?? "GET", path, query: "", body: init?.body as string });
          const r = replies.shift() ?? { status: 200, body: {} };
          return { ok: r.status < 300, status: r.status, json: async () => r.body } as Response;
        }
        return inner(url, init);
      })
    );
  }
  async function openErp() {
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].at(-1) as HTMLElement).click();
    await settle();
  }

  it("shows the units on the card and panel, and chooses units with those beneath indented", async () => {
    const calls: Call[] = [];
    stubUnits(calls, { unitIds: ["de"] }, [{ status: 200, body: { unitIds: ["de", "uk"] } }]);
    await openErp();
    expect([...document.querySelectorAll(".prcard")].at(-1)!.textContent).toContain("Acme Germany");
    expect(text("#du-summary")).toBe("Acme Germany");
    ([...document.querySelectorAll(".duline button")][0] as HTMLElement).click();
    await settle();
    expect(text(".dounitspop h3")).toBe("Which business units it sends for");
    const rows = [...document.querySelectorAll(".dounits label")] as HTMLElement[];
    expect(rows.map((r) => [r.textContent, r.style.paddingLeft])).toEqual([
      ["Acme Germany", "0px"],
      ["Acme Hamburg", "18px"],
      ["Acme UK", "0px"],
    ]);
    expect((document.querySelector("#du-all") as HTMLInputElement).checked).toBe(false);
    const uk = rows[2].querySelector("input") as HTMLInputElement;
    uk.checked = true;
    uk.dispatchEvent(new Event("change"));
    ([...document.querySelectorAll(".dounitspop .statebuttons button")][0] as HTMLElement).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path === "/api/route-instances/erp-ap/units")!.body!)).toEqual({ unitIds: ["de", "uk"] });
  });

  it("asks what to do with invoices already waiting in units added, then saves with the answer", async () => {
    const calls: Call[] = [];
    stubUnits(calls, {}, [{ status: 409, body: { reason: "decide_waiting", waiting: 4 } }, { status: 200, body: {} }]);
    await openErp();
    expect(text("#du-summary")).toBe("All business units");
    ([...document.querySelectorAll(".duline button")][0] as HTMLElement).click();
    await settle();
    const box = document.querySelectorAll(".dounits input")[2] as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect((document.querySelector("#du-all") as HTMLInputElement).checked).toBe(false);
    const save = () => ([...document.querySelectorAll(".dounitspop .statebuttons button")][0] as HTMLElement).click();
    save();
    await settle();
    expect(text("#du-decide")).toContain("4 invoices are already waiting in the units added");
    (document.querySelector("#du-sendtoo") as HTMLInputElement).checked = true;
    document.querySelector("#du-sendtoo")!.dispatchEvent(new Event("change"));
    save();
    await settle();
    const puts = calls.filter((c) => c.path === "/api/route-instances/erp-ap/units").map((c) => JSON.parse(c.body!));
    expect(puts).toEqual([{ unitIds: ["uk"] }, { unitIds: ["uk"], includeWaiting: true }]);
    expect(document.querySelector(".dounitspop")).toBeNull();
  });
});

describe("the Route library — decision 0589", () => {
  const C = (id: string, direction: string, status: string, categories: string[], extra: Record<string, unknown> = {}) => ({
    id, version: 1, direction, publisher: "standard", status, categories, transport: "https", formats: ["vf_json"], multiple: true, mechanism: null, vendorDocs: null, inUse: [], ...extra,
  });
  const LIB = {
    connectors: [
      C("https-out", "destination", "available", ["generic"], { inUse: [{ instanceId: "dest-1", processId: "ap", processName: "Standard AP Process", name: "ERP push", version: 1, upgradeAvailable: true }] }),
      C("automation-webhook", "destination", "available", ["automation"]),
      C("oracle-fusion-payables", "destination", "planned", ["erp"], { formats: ["oracle_invoice_json"] }),
      C("email-in", "source", "available", ["generic"], { transport: "email", formats: ["detected"], mechanism: "email" }),
    ],
    processes: [{ id: "ap", name: "Standard AP Process" }, { id: "exp", name: "Expenses" }],
  };

  it("lists connectors as cards, filtered, with what is in use, planned, and to upgrade", async () => {
    stub([], { "/api/connector-library": LIB });
    await openScreen("/route-library.js");
    expect(text(".topbar h2")).toBe("Route library");
    const names = () => [...document.querySelectorAll(".libcard h3")].map((h) => h.textContent);
    expect(names()).toEqual(["HTTPS out", "Automation webhook", "Oracle Fusion Payables", "Email in"]);
    const card = (id: string) => document.querySelector(`.libcard[data-connector="${id}"]`) as HTMLElement;
    expect(card("https-out").textContent).toContain("In use: 1");
    expect(card("https-out").textContent).toContain("Standard AP Process · ERP push");
    expect(card("https-out").textContent).toContain("Version 1 available");
    expect(card("oracle-fusion-payables").textContent).toContain("Planned");
    expect(card("oracle-fusion-payables").textContent).toContain("Oracle invoices");
    expect(card("oracle-fusion-payables").querySelector("button")).toBeNull();
    // Decision 0590: Add to my routes top right, in the card's head.
    expect(card("automation-webhook").querySelector(".libhead .libadd button")?.textContent).toBe("Add to my routes");
    expect(card("automation-webhook").querySelector(".libfoot button")).toBeNull();
    expect(card("automation-webhook").textContent).toContain("Zapier, Make or Power Automate");
    ([...document.querySelectorAll("#lib-filters button")].find((b) => b.textContent === "Sources") as HTMLElement).click();
    expect(names()).toEqual(["Email in"]);
    ([...document.querySelectorAll("#lib-filters button")].find((b) => b.textContent === "Automation") as HTMLElement).click();
    expect(names()).toEqual(["Automation webhook"]);
  });

  it("adds a destination connector to a process, then opens it there", async () => {
    const calls: Call[] = [];
    stub(calls, { "/api/connector-library": LIB });
    const inner = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/processes/exp/destinations") {
          calls.push({ method: "POST", path: String(url), query: "", body: init?.body as string });
          return { ok: true, status: 201, json: async () => ({ id: "dest-9", routeId: "https-out", connectorId: "automation-webhook" }) } as Response;
        }
        return inner(url, init);
      })
    );
    await openScreen("/route-library.js");
    (document.querySelector('.libcard[data-connector="automation-webhook"] .libadd button') as HTMLElement).click();
    await settle();
    expect(text(".libaddpop h3")).toBe("Add Automation webhook");
    expect((document.querySelector("#lib-name") as HTMLInputElement).value).toBe("Automation webhook");
    (document.querySelector("#lib-process") as HTMLSelectElement).value = "exp";
    (document.querySelector(".libaddpop .statebuttons button") as HTMLElement).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.path === "/api/processes/exp/destinations")!.body!)).toEqual({ name: "Automation webhook", connectorId: "automation-webhook" });
    expect(calls.some((c) => c.path === "/api/process-routes" && c.query === "process=exp")).toBe(true);
  });

  it("adds a source connector as a source of its mechanism", async () => {
    const calls: Call[] = [];
    stub(calls, { "/api/connector-library": LIB });
    await openScreen("/route-library.js");
    (document.querySelector('.libcard[data-connector="email-in"] .libadd button') as HTMLElement).click();
    await settle();
    (document.querySelector("#lib-name") as HTMLInputElement).value = "UK invoices";
    (document.querySelector(".libaddpop .statebuttons button") as HTMLElement).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.method === "POST" && c.path === "/api/processes/ap/sources")!.body!)).toEqual({ id: "uk-invoices", name: "UK invoices", mechanism: "email" });
  });

  it("shows a Destination's connector and version, offers Upgrade, and keeps fixed settings unchangeable", async () => {
    const calls: Call[] = [];
    const PUSH = { id: "dest-1", name: "Zapier", status: "paused", routeId: "https-out", routeName: "HTTPS out", route: { live: true, ...V("process", "en16931", "vf_invoice_json_v1", "en16931", "https") }, waiting: 0, started: false, failedOpen: 0 };
    stub(calls, {
      "/api/process-routes": { ...FLOW, destinations: [...FLOW.destinations, PUSH] },
      "/api/route-instances/dest-1/connector": {
        instance: { id: "dest-1", name: "Zapier", status: "paused", processId: "ap", startedAt: null },
        settings: { url: "https://hooks.zapier.com/x", method: "POST", format: "vf_json", auth: { type: "none" }, referencePath: null },
        connector: { id: "automation-webhook", version: 1, latestVersion: 2, upgradeAvailable: true, fixed: ["method", "format"], authTypes: ["none", "api_key_header"] },
        secrets: {}, waitingNotTaken: 0, counts: {}, deliveries: [], candidates: [],
      },
      "/api/route-instances/dest-1/connector/upgrade": { from: 1, to: 2, authChanged: false },
    });
    await openScreen("/process-routes.js");
    ([...document.querySelectorAll(".prcard")].find((c) => c.textContent?.includes("Zapier")) as HTMLElement).click();
    await settle();
    expect(text("#do-connector")).toContain("Connector: Automation webhook · version 1");
    expect(text("#do-connector")).toContain("Version 2 available");
    expect((document.querySelector("#do-method") as HTMLSelectElement).disabled).toBe(true);
    expect((document.querySelector("#do-format") as HTMLSelectElement).disabled).toBe(true);
    expect([...(document.querySelector("#do-auth") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["none", "api_key_header"]);
    ([...document.querySelectorAll("#do-connector button")].find((b) => b.textContent === "Upgrade") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/route-instances/dest-1/connector/upgrade")).toBe(true);
  });
});

describe("the Route library button — decision 0590", () => {
  it("is in the Routes screen's top-right buttons, after a divider, and opens the library", async () => {
    const calls: Call[] = [];
    stub(calls, { "/api/connector-library": { connectors: [], processes: [] } });
    await openScreen("/routes.js");
    const right = document.querySelector(".topbar .right") as HTMLElement;
    const first = right.firstElementChild as HTMLElement;
    expect(first.textContent).toBe("Route library");
    expect(first.nextElementSibling?.classList.contains("topbardivider")).toBe(true);
    first.click();
    await settle();
    expect(text(".topbar h2")).toBe("Route library");
  });
});

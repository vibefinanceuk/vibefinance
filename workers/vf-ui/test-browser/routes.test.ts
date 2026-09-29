import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0208_routes_and_process_routes_strings.sql?raw";
import destinationStringsSql from "../../vf-licence/migrations/0209_erp_destination_strings.sql?raw";

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
for (const sql of [stringsSql, destinationStringsSql]) {
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
      if (path === "/api/process-routes") return { ok: true, json: async () => FLOW } as Response;
      if (path === "/api/org/units") return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path === "/api/processes/ap/sources" && method === "POST") return { ok: true, status: 201, json: async () => ({}) } as Response;
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

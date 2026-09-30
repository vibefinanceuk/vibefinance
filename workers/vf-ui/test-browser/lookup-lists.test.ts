import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0208_routes_and_process_routes_strings.sql?raw";
import destinationStringsSql from "../../vf-licence/migrations/0209_erp_destination_strings.sql?raw";
import formatStringsSql from "../../vf-licence/migrations/0211_formats_and_en16931_strings.sql?raw";
import mappingStringsSql from "../../vf-licence/migrations/0212_supplier_mapping_strings.sql?raw";
import csvStringsSql from "../../vf-licence/migrations/0216_supplier_csv_strings.sql?raw";
import lookupStringsSql from "../../vf-licence/migrations/0218_lookup_list_strings.sql?raw";

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
  "action.save": "Save",
  "action.close": "Close",
};
for (const sql of [stringsSql, destinationStringsSql, formatStringsSql, mappingStringsSql, csvStringsSql, lookupStringsSql]) {
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

type Call = { method: string; path: string; query: string; body?: string };


/**
 * **Look-up lists — decision 0568**, with the real strings: the panel on
 * the Routes screen, a new list, and a list's pop-out (rows, paste, save,
 * a refusal shown inside it, and retiring after saying who uses it).
 */

const LISTS = { lists: [{ id: "LL-1", name: "Units", description: null, entries: 2, updatedAt: "2026-09-30T10:00:00Z", usedBy: ["Lager Nord CSV"] }] };
const UNITS = { list: { id: "LL-1", name: "Units", status: "active" }, entries: [{ from: "Karton", to: "CT" }, { from: "Rolle", to: "RO" }], usedBy: ["Lager Nord CSV"] };

function stub(calls: Call[], answers: Record<string, (body: unknown) => { status?: number; body: unknown }> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      const method = init?.method ?? "GET";
      calls.push({ method, path, query, body: init?.body as string | undefined });
      const respond = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json }) as Response;
      if (path === "/api/ui-strings") return respond(200, { locale: "en", strings });
      const key = `${method} ${path}`;
      if (answers[key]) {
        const r = answers[key](init?.body ? JSON.parse(String(init.body)) : undefined);
        return respond(r.status ?? 200, r.body);
      }
      if (path === "/api/routes") return respond(200, ROUTES);
      if (path === "/api/supplier-mappings") return respond(200, { mappings: [] });
      if (key === "GET /api/lookup-lists") return respond(200, LISTS);
      if (key === "GET /api/lookup-lists/LL-1") return respond(200, UNITS);
      throw new Error(`no stub for ${key}`);
    })
  );
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (s: string) => document.querySelector(s)?.textContent ?? "";
const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const lastBody = (calls: Call[], key: string) => {
  const c = calls.filter((x) => `${x.method} ${x.path}` === key).at(-1);
  return c?.body ? JSON.parse(c.body) : undefined;
};

async function openRoutes() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/routes.js");
  await open();
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.unstubAllGlobals();
});
afterEach(() => {
  document.querySelectorAll(".backdrop").forEach((b) => b.remove());
  vi.unstubAllGlobals();
});

describe("look-up lists — decision 0568", () => {
  it("lists them on the Routes screen, with entries and the mappings that use them", async () => {
    stub([]);
    await openRoutes();
    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "Look-up lists") as HTMLElement;
    expect(panel).toBeTruthy();
    const cells = [...panel.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cells.slice(0, 3)).toEqual(["Units", "2", "Lager Nord CSV"]);
  });

  it("makes a new list and opens it", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "POST /api/lookup-lists": () => ({ status: 201, body: { id: "LL-1", name: "Units" } }),
    });
    await openRoutes();
    const name = document.querySelector("input[aria-label='New list name']") as HTMLInputElement;
    name.value = "Units";
    button("New list").click();
    await settle();
    expect(lastBody(calls, "POST /api/lookup-lists")).toEqual({ name: "Units" });
    expect(text(".llpop h3")).toBe("Look-up list: Units");
  });

  it("edits rows, adds pasted ones, saves the whole list, and shows a refusal inside the pop-out", async () => {
    const calls: Call[] = [];
    let refuse = true;
    stub(calls, {
      "PUT /api/lookup-lists/LL-1": (body) =>
        refuse
          ? { status: 422, body: { error: "ROLLE is in the list twice (rows 2 and 3)", reason: "duplicate" } }
          : { body: { id: "LL-1", name: "Units", entries: (body as { entries: unknown[] }).entries.length } },
    });
    await openRoutes();
    button("Open").click();
    await settle();
    const pop = document.querySelector(".llpop") as HTMLElement;
    const from1 = pop.querySelector("input[aria-label='From (as the supplier writes it) 1']") as HTMLInputElement;
    expect(from1.value).toBe("Karton");
    (pop.querySelector("textarea") as HTMLTextAreaElement).value = "Beutel\tBG\nPalette; PF\n\nKiste, CR";
    button("Add the pasted rows", pop).click();
    await settle();
    button("Save", pop).click();
    await settle();
    expect(lastBody(calls, "PUT /api/lookup-lists/LL-1")).toEqual({
      name: "Units",
      entries: [
        { from: "Karton", to: "CT" },
        { from: "Rolle", to: "RO" },
        { from: "Beutel", to: "BG" },
        { from: "Palette", to: "PF" },
        { from: "Kiste", to: "CR" },
      ],
    });
    expect(text(".llpop .merefused")).toBe("ROLLE is in the list twice (rows 2 and 3)");

    refuse = false;
    button("Remove", document.querySelector(".llpop") as HTMLElement).click();
    await settle();
    button("Save", document.querySelector(".llpop") as HTMLElement).click();
    await settle();
    expect(lastBody(calls, "PUT /api/lookup-lists/LL-1").entries[0]).toEqual({ from: "Rolle", to: "RO" });
    expect(text(".llpop .menote")).toBe("Saved, with 4 entries.");
  });

  it("retires a list after naming the mappings that still use it", async () => {
    const calls: Call[] = [];
    stub(calls, { "POST /api/lookup-lists/LL-1/retire": () => ({ body: { id: "LL-1", status: "retired" } }) });
    await openRoutes();
    button("Open").click();
    await settle();
    button("Retire this list", document.querySelector(".llpop") as HTMLElement).click();
    await settle();
    expect(text(".llretire p")).toBe(
      "Retire this list? Lager Nord CSV still use it, and will not read a value through it until they use another list. Its entries are kept."
    );
    button("Retire list", document.querySelector(".llpop") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/lookup-lists/LL-1/retire")).toBe(true);
    expect(document.querySelector(".llpop")).toBeNull();
  });

  it("reads pasted rows split by a tab, semicolon or comma", async () => {
    const { parsePasted } = await import("/lookup-lists.js");
    expect(parsePasted("Rolle\tRO\nKarton;CT\nStk, H87\n\nlonely")).toEqual([
      { from: "Rolle", to: "RO" },
      { from: "Karton", to: "CT" },
      { from: "Stk", to: "H87" },
      { from: "lonely", to: "" },
    ]);
  });
});

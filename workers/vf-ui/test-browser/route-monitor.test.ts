import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0207_route_monitor_strings.sql?raw";

/**
 * The Route monitor — decision 0556. Four counts, the messages with
 * filters, and one message opened: which of the route's parts it got
 * through, what went wrong in words, the technical detail, the invoices
 * it made, its original files, and its history.
 *
 * **The real English strings**, read from the migration that adds them,
 * so a test that passes is a screen that reads as it will live.
 */

const strings: Record<string, string> = { "action.close": "Close" };
for (const m of stringsSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const TODAY = new Date().toISOString();

const LIST = {
  period: "today",
  summary: { receivedToday: 146, deliveredToday: 141, failedOpen: 3, waitingOverHour: 0 },
  sources: [{ id: "s-ap", name: "AP mailbox", status: "active" }],
  messages: [
    {
      id: "MSG-7F3A-2291-0C4E",
      sourceId: "s-ap",
      sourceName: "AP mailbox",
      direction: "in",
      status: "failed",
      failedPart: "translation",
      errorCode: "unreadable",
      counterparty: "buchhaltung@munch.de",
      subject: "Rechnung 88240",
      receivedAt: TODAY,
      attachments: 1,
      captured: 0,
      invoices: 0,
      firstInvoice: null,
    },
    {
      id: "MSG-0001-0002-0003",
      sourceId: "s-ap",
      sourceName: "AP mailbox",
      direction: "in",
      status: "delivered",
      failedPart: null,
      errorCode: null,
      counterparty: "invoices@kingsway.co.uk",
      subject: "INV-3110",
      receivedAt: TODAY,
      attachments: 1,
      captured: 1,
      invoices: 1,
      firstInvoice: "INV-3110",
    },
  ],
};

const DETAIL = {
  message: {
    id: "MSG-7F3A-2291-0C4E",
    sourceName: "AP mailbox",
    status: "failed",
    failedPart: "translation",
    errorCode: "unreadable",
    errorText: "scan.png: no fields could be read from this image at all",
    subject: "Rechnung 88240",
    receivedAt: TODAY,
  },
  parts: [
    { seq: 0, role: "original", filename: "message.eml", contentType: "message/rfc822", bytes: 5120, outcome: null, reason: null },
    { seq: 1, role: "attachment", filename: "scan.png", contentType: "image/png", bytes: 204800, outcome: "failed", reason: "no fields could be read from this image at all" },
  ],
  events: [
    { seq: 1, at: TODAY, event: "received", partSeq: null, detail: null },
    { seq: 2, at: TODAY, event: "original_stored", partSeq: 0, detail: null },
    { seq: 3, at: TODAY, event: "capture_failed", partSeq: 1, detail: "no fields" },
    { seq: 4, at: TODAY, event: "failed", partSeq: null, detail: "unreadable" },
  ],
  invoices: [],
};

type Call = { method: string; path: string; query: string };

function stub(calls: Call[], list: unknown = LIST) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      const method = init?.method ?? "GET";
      calls.push({ method, path, query });
      if (path === "/api/ui-strings") return { ok: true, json: async () => ({ locale: "en", strings }) } as Response;
      if (path === "/api/route-messages") return { ok: true, json: async () => list } as Response;
      if (path === "/api/route-messages/MSG-7F3A-2291-0C4E") return { ok: true, json: async () => DETAIL } as Response;
      if (/^\/api\/route-messages\/[^/]+\/parts\/\d+$/.test(path)) {
        return { ok: true, blob: async () => new Blob(["x"]) } as unknown as Response;
      }
      throw new Error(`no stub for ${method} ${path}`);
    })
  );
}

async function open() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open: openScreen } = await import("/route-monitor.js");
  await openScreen();
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Route monitor — decision 0556", () => {
  it("shows the four counts, a failure marked, and what each message made", async () => {
    stub([]);
    await open();
    const tiles = [...document.querySelectorAll(".rmtile")].map((t) => [t.querySelector(".k")?.textContent, t.querySelector(".v")?.textContent]);
    expect(tiles).toEqual([
      ["Received today", "146"],
      ["Delivered today", "141"],
      ["Failed, not yet fixed", "3"],
      ["Waiting over an hour", "0"],
    ]);
    expect(document.querySelectorAll(".rmtile.bad")).toHaveLength(1);
    expect(document.querySelectorAll(".rmtile.warn")).toHaveLength(0);

    const rows = [...document.querySelectorAll(".rmtable tbody tr")];
    expect(rows[0].classList.contains("bad")).toBe(true);
    expect(rows[0].textContent).toContain("from buchhaltung@munch.de");
    expect(rows[0].textContent).toContain("no invoice made");
    expect(rows[0].textContent).toContain("Failed");
    expect(rows[0].textContent).toContain("at translation");
    expect(rows[1].textContent).toContain("→ invoice INV-3110");
    expect(rows[1].textContent).toContain("Delivered");
    expect(text(".rmdetail")).toContain("Choose a message");
  });

  it("filters by route, by failures and by period, asking the server each time", async () => {
    const calls: Call[] = [];
    stub(calls);
    await open();
    const chipNamed = (name: string) => [...document.querySelectorAll(".rmchip")].find((c) => c.textContent === name) as HTMLButtonElement;
    expect(chipNamed("All routes").classList.contains("on")).toBe(true);

    chipNamed("AP mailbox").click();
    await settle();
    expect(calls.at(-1)?.query).toBe("source=s-ap&period=today");
    chipNamed("Failed only").click();
    await settle();
    expect(calls.at(-1)?.query).toBe("source=s-ap&status=failed&period=today");
    chipNamed("7 days").click();
    await settle();
    expect(calls.at(-1)?.query).toBe("source=s-ap&status=failed&period=7d");
    expect(chipNamed("7 days").classList.contains("on")).toBe(true);
    chipNamed("Unknown address").click();
    await settle();
    expect(calls.at(-1)?.query).toBe("source=none&status=failed&period=7d");
  });

  it("opens a failed message: where it got to, what went wrong, and what to do", async () => {
    stub([]);
    await open();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();

    expect(document.querySelector(".rmtable tbody tr")?.classList.contains("sel")).toBe(true);
    expect(text(".rmdetail h3")).toBe("Rechnung 88240");
    expect(text(".rmdetail")).toContain("MSG-7F3A-2291-0C4E");
    const chain = [...document.querySelectorAll(".rmpart")].map((p) => [p.querySelector(".k")?.textContent, p.className.split(" ")[1]]);
    expect(chain).toEqual([
      ["Gateway", "ok"],
      ["Format", "ok"],
      ["Translation", "bad"],
      ["EN 16931", "idle"],
      ["Process", "idle"],
    ]);
    expect(text(".rmexplain .h")).toBe("No attachment could be read as an invoice");
    expect(text(".rmexplain")).toContain("To fix:");
    expect(text(".rmtech")).toContain("unreadable");
    expect(text(".rmtech")).toContain("part 1    scan.png: no fields could be read");
    const origs = [...document.querySelectorAll(".rmorig")].map((o) => o.textContent);
    expect(origs).toEqual(["The email5 KB", "scan.png200 KB"]);
    expect(document.querySelectorAll(".rmorig.bad")).toHaveLength(1);
    const history = [...document.querySelectorAll(".rmhistory li")].map((li) =>
      (li.textContent ?? "").slice((li.querySelector(".rmtime")?.textContent ?? "").length).trim()
    );
    expect(history).toEqual(["Received", "Email kept", "Could not be read · file 1", "Failed"]);
  });

  it("downloads an original under its own name, the email as the message's reference", async () => {
    const calls: Call[] = [];
    stub(calls);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute("download") ?? "");
    });
    await open();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
    const [email, scan] = [...document.querySelectorAll(".rmorig")] as HTMLButtonElement[];
    email.click();
    await settle();
    scan.click();
    await settle();
    expect(calls.map((c) => c.path).filter((p) => p.includes("/parts/"))).toEqual([
      "/api/route-messages/MSG-7F3A-2291-0C4E/parts/0",
      "/api/route-messages/MSG-7F3A-2291-0C4E/parts/1",
    ]);
    expect(clicked).toEqual(["MSG-7F3A-2291-0C4E.eml", "scan.png"]);
  });

  it("closes the message", async () => {
    stub([]);
    await open();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
    ([...document.querySelectorAll(".rmdetail button")].find((b) => b.textContent === "Close") as HTMLButtonElement).click();
    await settle();
    expect(text(".rmdetail")).toContain("Choose a message");
  });

  it("says so when there is nothing in the period", async () => {
    stub([], { ...LIST, summary: { receivedToday: 0, deliveredToday: 0, failedOpen: 0, waitingOverHour: 0 }, messages: [] });
    await open();
    expect(text(".rmmessages")).toContain("No messages in this period.");
    expect(document.querySelectorAll(".rmtile.bad")).toHaveLength(0);
  });
});

describe("which of the route's parts a message got through", () => {
  it("follows the status and the part that failed", async () => {
    const { partStates } = await import("/route-monitor.js");
    expect(partStates({ status: "delivered" })).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(partStates({ status: "partial" })).toEqual(["ok", "ok", "warn", "ok", "ok"]);
    expect(partStates({ status: "failed", failedPart: "gateway" })).toEqual(["bad", "idle", "idle", "idle", "idle"]);
    expect(partStates({ status: "failed", failedPart: "format" })).toEqual(["ok", "bad", "idle", "idle", "idle"]);
    expect(partStates({ status: "received" })).toEqual(["ok", "idle", "idle", "idle", "idle"]);
  });
});

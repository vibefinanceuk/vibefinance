import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0207_route_monitor_strings.sql?raw";
import destinationStringsSql from "../../vf-licence/migrations/0209_erp_destination_strings.sql?raw";
import fixStringsSql from "../../vf-licence/migrations/0210_route_fix_and_tell_strings.sql?raw";
import formatStringsSql from "../../vf-licence/migrations/0211_formats_and_en16931_strings.sql?raw";
import splitStringsSql from "../../vf-licence/migrations/0225_csv_several_invoices_strings.sql?raw";

/**
 * The Route monitor — decision 0556. Four counts, the messages with
 * filters, and one message opened: which of the route's parts it got
 * through, what went wrong in words, the technical detail, the invoices
 * it made, its original files, and its history.
 *
 * **The real English strings**, read from the migration that adds them,
 * so a test that passes is a screen that reads as it will live.
 */

const strings: Record<string, string> = { "action.close": "Close", "action.save": "Save" };
for (const sql of [stringsSql, destinationStringsSql, fixStringsSql, formatStringsSql, splitStringsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

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

describe("an export, as a message sent out — decision 0558", () => {
  const OUT = {
    id: "MSG-AA11-BB22-CC33",
    sourceId: "erp-ap",
    sourceName: "ERP",
    direction: "out",
    status: "dismissed",
    failedPart: "delivery",
    errorCode: "undone",
    counterparty: null,
    recipient: "ERP",
    subject: "Export of 12 invoices",
    receivedAt: TODAY,
    attachments: 0,
    captured: 0,
    invoices: 12,
    firstInvoice: "INV-1",
  };
  const OUT_DETAIL = {
    message: { ...OUT, errorText: "The ERP rejected the file: GL code 1610 is closed" },
    parts: [{ seq: 1, role: "sent", filename: "vibefinance-erp-export-202609291031-aa11bb22.csv", contentType: "text/csv; charset=utf-8", bytes: 4096, outcome: null, reason: null }],
    events: [
      { seq: 1, at: TODAY, event: "exported", partSeq: null, detail: null, actorName: "Olga" },
      { seq: 2, at: TODAY, event: "delivered", partSeq: null, detail: null, actorName: null },
      { seq: 3, at: TODAY, event: "undone", partSeq: null, detail: "GL code", actorName: "Olga" },
    ],
    invoices: [{ invoiceId: "inv-1", number: "INV-1", supplierName: "Kingsway" }],
  };

  function stubOut(calls: Call[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const [path, query = ""] = String(url).split("?");
        calls.push({ method: init?.method ?? "GET", path, query });
        if (path === "/api/ui-strings") return { ok: true, json: async () => ({ locale: "en", strings }) } as Response;
        if (path === "/api/route-messages")
          return { ok: true, json: async () => ({ ...LIST, destinations: [{ id: "erp-ap", name: "ERP", status: "active" }], messages: [OUT, LIST.messages[1]] }) } as Response;
        if (path === `/api/route-messages/${OUT.id}`) return { ok: true, json: async () => OUT_DETAIL } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );
  }

  it("lists it as sent out, undone, with the Destination to filter by", async () => {
    const calls: Call[] = [];
    stubOut(calls);
    await open();
    const row = document.querySelector(".rmtable tbody tr") as HTMLElement;
    expect(row.textContent).toContain("sent out");
    expect(row.textContent).toContain("→ 12 invoices sent");
    expect(row.querySelector(".rmpill")?.textContent).toBe("Undone");
    expect(row.classList.contains("bad")).toBe(false);
    ([...document.querySelectorAll(".rmchip")].find((c) => c.textContent === "ERP") as HTMLButtonElement).click();
    await settle();
    // The filter is the module's own state, kept from the tests before: only the route matters here.
    expect(calls.at(-1)?.query).toContain("source=erp-ap");
  });

  it("opens it the other way round: process to gateway, undone in amber, the file sent and who did what", async () => {
    stubOut([]);
    await open();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
    const chain = [...document.querySelectorAll(".rmpart")].map((p) => [p.querySelector(".k")?.textContent, p.className.split(" ")[1]]);
    expect(chain).toEqual([
      ["Process", "ok"],
      ["EN 16931", "ok"],
      ["Translation", "ok"],
      ["Format", "ok"],
      ["Gateway", "bad"],
    ]);
    expect(document.querySelector(".rmexplain.done .h")?.textContent).toBe("This export was undone");
    expect(text(".rmtech")).toContain("reason    The ERP rejected the file: GL code 1610 is closed");
    expect(text(".rmdetail")).toContain("What was sent");
    expect([...document.querySelectorAll(".rmorig")].map((o) => o.textContent)).toEqual(["vibefinance-erp-export-202609291031-aa11bb22.csv4 KB"]);
    const history = [...document.querySelectorAll(".rmhistory li")].map((li) =>
      (li.textContent ?? "").slice((li.querySelector(".rmtime")?.textContent ?? "").length).trim()
    );
    // The reason given follows the undo, on its own line (0559).
    expect(history).toEqual(["Exported · by Olga", "Delivered", "Undone · by OlgaGL code"]);
  });
});

describe("fix and tell — decision 0559", () => {
  type Req = { method: string; path: string; body?: string };
  function stubFix(calls: Req[], detail: Record<string, unknown>, alerts: unknown[] = [], refuse: Record<string, unknown> | null = null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        const method = init?.method ?? "GET";
        calls.push({ method, path, body: init?.body as string | undefined });
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
        if (path === "/api/ui-strings") return ok({ locale: "en", strings });
        if (path === "/api/route-messages" && method === "GET") return ok(LIST);
        if (path === "/api/route-messages/MSG-7F3A-2291-0C4E" && method === "GET") return ok(detail);
        if (path.endsWith("/reprocess") && path !== "/api/route-messages/reprocess") return ok({ id: "MSG-7F3A-2291-0C4E", status: "delivered", ran: 1, failed: 0 });
        if (path === "/api/route-messages/reprocess") return ok({ results: [{ id: "a", status: "delivered" }, { id: "b", status: "failed" }, { id: "c", status: "delivered" }] });
        if (path.endsWith("/dismiss")) return ok({ status: "dismissed" });
        if (path === "/api/route-alerts" && method === "GET") return ok({ alerts });
        if (path === "/api/route-alerts" && method === "POST") return refuse ? ({ ok: false, status: 400, json: async () => refuse }) as Response : ok({ id: "al-2" });
        if (path.endsWith("/test")) return ok({ id: "al-1", outcome: "email: sent · webhook: sent" });
        if (path.startsWith("/api/route-alerts/") && method === "DELETE") return ok({ deleted: true });
        throw new Error(`no stub for ${method} ${path}`);
      })
    );
  }
  const openFirst = async () => {
    await open();
    (document.querySelector(".rmtable tbody tr") as HTMLElement).click();
    await settle();
  };
  const buttons = () => [...document.querySelectorAll(".rmdetail .statebuttons button")].map((b) => b.textContent);
  const click = (label: string, scope: ParentNode = document) =>
    ([...scope.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement).click();

  it("offers Reprocess, Reprocess all like it and Dismiss on a failure that can be run again", async () => {
    const calls: Req[] = [];
    stubFix(calls, { ...DETAIL, canReprocess: true, cannotReprocess: null, similar: ["MSG-2", "MSG-3"], canDismiss: true });
    await openFirst();
    expect(buttons()).toEqual(["Reprocess", "Reprocess 3 like it", "Dismiss", "Close"]);

    click("Reprocess", document.querySelector(".rmdetail")!);
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/route-messages/MSG-7F3A-2291-0C4E/reprocess")).toBe(true);
    expect(text("#routemonitor-note")).toBe("1 run again: 1 delivered.");

    click("Reprocess 3 like it", document.querySelector(".rmdetail")!);
    await settle();
    const bulk = calls.find((c) => c.path === "/api/route-messages/reprocess");
    expect(JSON.parse(bulk!.body!)).toEqual({ ids: ["MSG-7F3A-2291-0C4E", "MSG-2", "MSG-3"] });
    expect(text("#routemonitor-note")).toBe("3 run again: 2 delivered.");
  });

  it("says why one cannot be run again", async () => {
    stubFix([], { ...DETAIL, canReprocess: false, cannotReprocess: "source_retired", similar: [], canDismiss: true });
    await openFirst();
    expect(buttons()).toEqual(["Dismiss", "Close"]);
    expect(text(".rmdetail")).toContain("Its route is retired, so it cannot be run again.");
  });

  it("dismisses with a reason, asked for in its own pop-out", async () => {
    const calls: Req[] = [];
    stubFix(calls, { ...DETAIL, canReprocess: false, cannotReprocess: null, similar: [], canDismiss: true });
    await openFirst();
    click("Dismiss", document.querySelector(".rmdetail")!);
    await settle();
    const pop = document.querySelector(".popout.rmpop") as HTMLElement;
    expect(pop.querySelector("h3")?.textContent).toBe("Dismiss this message");
    click("Dismiss", pop);
    await settle();
    expect(pop.textContent).toContain("Give a reason.");
    expect(calls.some((c) => c.path.endsWith("/dismiss"))).toBe(false);
    (pop.querySelector("textarea") as HTMLTextAreaElement).value = "A portal notification";
    click("Dismiss", pop);
    await settle();
    expect(JSON.parse(calls.find((c) => c.path.endsWith("/dismiss"))!.body!)).toEqual({ reason: "A portal notification" });
    expect(document.querySelector(".popout.rmpop")).toBeNull();
  });

  it("shows the reason a message was dismissed in its history", async () => {
    stubFix([], {
      ...DETAIL,
      message: { ...DETAIL.message, status: "dismissed" },
      events: [...DETAIL.events, { seq: 5, at: TODAY, event: "dismissed", partSeq: null, detail: "A portal notification", actorName: "Ivy" }],
      canReprocess: false,
      canDismiss: false,
      similar: [],
    });
    await openFirst();
    const last = [...document.querySelectorAll(".rmhistory li")].at(-1)!;
    expect(last.textContent).toContain("Dismissed · by Ivy");
    expect(last.querySelector(".rmreason")?.textContent).toBe("A portal notification");
  });

  it("manages alerts: lists what each last sent, tests one, adds one and says why one is refused", async () => {
    const calls: Req[] = [];
    const existing = {
      id: "al-1",
      routeId: "s-ap",
      routeName: "AP mailbox",
      onFailure: true,
      failuresPerDay: 5,
      silentHours: null,
      emails: ["it@acme.com"],
      webhookUrl: "https://hooks.acme.com/vf",
      webhookSecret: "whsec_abc",
      lastSent: { kind: "failure", at: "2026-09-30T10:41:00.000Z", outcome: "email: sent · webhook: sent" },
    };
    stubFix(calls, DETAIL, [existing]);
    await open();
    click("Alerts", document.querySelector(".rmmessages")!);
    await settle();
    const pop = document.querySelector(".popout.rmalertspop") as HTMLElement;
    const card = pop.querySelector(".rmalert") as HTMLElement;
    expect(card.textContent).toContain("AP mailbox");
    expect(card.textContent).toContain("Each message that fails · When a day's failures reach 5");
    expect(card.textContent).toContain("it@acme.com, https://hooks.acme.com/vf");
    expect(card.textContent).toContain("whsec_abc");
    expect(card.textContent).toContain("Last sent 2026-09-30 10:41: email: sent · webhook: sent");

    click("Test", card);
    await settle();
    expect(calls.some((c) => c.path === "/api/route-alerts/al-1/test")).toBe(true);
    expect(pop.textContent).toContain("Test sent: email: sent · webhook: sent");

    const form = pop.querySelector(".rmalertform") as HTMLElement;
    (form.querySelector('input[type="text"]') as HTMLInputElement).value = "ops@acme.com";
    click("Add alert", form);
    await settle();
    const posted = JSON.parse(calls.find((c) => c.method === "POST" && c.path === "/api/route-alerts")!.body!);
    expect(posted).toEqual({ routeId: null, onFailure: true, failuresPerDay: null, silentHours: null, emails: "ops@acme.com", webhookUrl: null });

    stubFix(calls, DETAIL, [existing], { error: "Only a Source can go quiet.", reason: "silence_needs_source" });
    click("Add alert", pop.querySelector(".rmalertform") as HTMLElement);
    await settle();
    expect(pop.textContent).toContain("Only a Source can go quiet: choose a Source, or leave that unticked.");
  });
});

describe("e-invoice checks — decision 0560", () => {
  async function checksFor(parts: unknown[]) {
    stub([]);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { formatChecks } = await import("/route-monitor.js");
    const host = document.createElement("div");
    host.append(...formatChecks(parts));
    document.body.append(host);
    return host;
  }

  it("names each rule an attachment broke, in words, with what the check found", async () => {
    const host = await checksFor([
      { seq: 0, role: "original", filename: "message.eml", format: null, syntax: null, en16931Failed: null },
      {
        seq: 1,
        role: "attachment",
        filename: "Rechnung_88241.xml",
        format: "xrechnung",
        syntax: "cii",
        en16931Failed: [{ rule: "BR-CO-16", detail: "BT-115 700.00, expected 649.74" }, { rule: "BR-DE-15" }],
      },
    ]);
    expect(host.querySelector("h4")?.textContent).toBe("E-invoice checks");
    expect(host.querySelectorAll(".rmfmt")).toHaveLength(1);
    expect(host.querySelector(".rmfmtname")?.textContent).toBe("Rechnung_88241.xml: XRechnung (CII)");
    expect(host.querySelector(".rmpill")?.textContent).toBe("2 rules broken");
    expect([...host.querySelectorAll(".rmrules li")].map((li) => li.textContent)).toEqual([
      "BR-CO-16 The amount due (BT-115) does not follow from the total, the amount paid and rounding. · BT-115 700.00, expected 649.74",
      "BR-DE-15 An XRechnung must give the buyer reference (BT-10), such as a Leitweg-ID.",
    ]);
    expect(host.textContent).toContain("The invoice was still delivered to the process.");
  });

  it("says when one passed, and when one was not checked", async () => {
    const host = await checksFor([
      { seq: 1, role: "attachment", filename: "a.pdf", format: "en16931", syntax: "cii", en16931Failed: [] },
      { seq: 2, role: "attachment", filename: "b.pdf", format: "factur_x_minimum", syntax: "cii", en16931Failed: null },
    ]);
    const checks = [...host.querySelectorAll(".rmfmt")];
    expect(checks.map((c) => c.querySelector(".rmpill")?.textContent)).toEqual(["Passed EN 16931", "Not checked"]);
    expect(checks[1].querySelector(".rmfmtname")?.textContent).toBe("b.pdf: Factur-X / ZUGFeRD MINIMUM (CII)");
    expect(checks[1].textContent).toContain("is not a full invoice");
  });

  it("shows nothing for a message with no e-invoice in it", async () => {
    const host = await checksFor(DETAIL.parts);
    expect(host.children).toHaveLength(0);
  });
});

/**
 * Last in the file: it leaves a message chosen, which the module keeps.
 */
describe("the Route monitor opened on one message — decision 0573", () => {
  it("opens one message's detail at once when asked — decision 0573", async () => {
    const calls: Call[] = [];
    stub(calls);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open: openScreen } = await import("/route-monitor.js");
    await openScreen({ message: "MSG-7F3A-2291-0C4E" });
    expect(calls.some((c) => c.path === "/api/route-messages/MSG-7F3A-2291-0C4E")).toBe(true);
  });

  it("names a CSV split into invoices in the history — decision 0577", async () => {
    const calls: Call[] = [];
    const detail = {
      ...DETAIL,
      events: [
        { seq: 1, at: TODAY, event: "received", partSeq: null, detail: null },
        { seq: 2, at: TODAY, event: "csv_split", partSeq: 1, detail: "3 invoices (88250, 88252, 88253)" },
        { seq: 3, at: TODAY, event: "delivered", partSeq: null, detail: null },
      ],
    };
    stub(calls);
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) =>
      String(u).split("?")[0] === "/api/route-messages/MSG-7F3A-2291-0C4E" ? ({ ok: true, json: async () => detail } as Response) : real(u, i)
    ));
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open: openScreen } = await import("/route-monitor.js");
    await openScreen({ message: "MSG-7F3A-2291-0C4E" });
    await settle();
    const history = [...document.querySelectorAll(".rmhistory li")].map((li) =>
      (li.textContent ?? "").slice((li.querySelector(".rmtime")?.textContent ?? "").length).trim()
    );
    expect(history[1]).toContain("Split into invoices");
    expect(history[1]).toContain("3 invoices (88250, 88252, 88253)");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ERP export screen — decision 0552. What the next export would take,
 * one button to make it (and download its file), and the exports so far,
 * each downloadable again.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.erpexport": "ERP export",
    "action.download": "Download",
    "erpexport.heading": "ERP export",
    "erpexport.subtitle": "Payment-eligible invoices, each exported once.",
    "erpexport.ready": "Ready to export",
    "erpexport.readycount": "{n} payment-eligible invoices not yet exported",
    "erpexport.none": "Nothing is waiting: every payment-eligible invoice has been exported.",
    "erpexport.exportnow": "Export {n} invoices",
    "erpexport.more": "… and {n} more, all included in the export.",
    "erpexport.history": "Past exports",
    "erpexport.nohistory": "No exports yet.",
    "erpexport.col.invoice": "Invoice",
    "erpexport.col.supplier": "Supplier",
    "erpexport.col.issued": "Issued",
    "erpexport.col.total": "Total",
    "erpexport.col.when": "Exported",
    "erpexport.col.by": "By",
    "erpexport.col.invoices": "Invoices",
    "erpexport.col.rows": "Rows",
    "erpexport.done": "Exported {invoices} invoices as {rows} rows. The file is downloading.",
    "erpexport.nothing": "There is nothing to export.",
    "erpexport.failed": "The export could not be loaded or made. Try again.",
    "erpexport.downloadfailed": "The file could not be downloaded. Try again.",
    "action.return": "Return",
    "erpexport.undo": "Undo",
    "erpexport.undoprompt": "Undo this export? Its {n} invoices go back to Ready to export. Why?",
    "erpexport.undone": "Undone",
    "erpexport.undoneby": "by {who}, {when}",
    "erpexport.undonemsg": "Export undone: {n} invoices are back in Ready to export.",
    "erpexport.undofailed": "The export could not be undone. Try again.",
  },
};

const PENDING = {
  pending: {
    count: 2,
    invoices: [
      { id: "inv-a", number: "INV-A", supplierName: "Kingsway Interiors", issueDate: "2026-09-20", currency: "GBP", total: 14688 },
      { id: "inv-b", number: "INV-B", supplierName: null, issueDate: null, currency: "GBP", total: 120 },
    ],
  },
  exports: [{ id: "x-0", createdAt: "2026-09-28 10:15:02.123", createdByName: "Fran", invoiceCount: 5, rowCount: 9 }],
};

type Call = { method: string; path: string };

function stub(list: unknown, calls: Call[], posted: { status: number; body: unknown } = { status: 201, body: { id: "x-1", invoiceCount: 2, rowCount: 4 } }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (/^\/api\/erp-exports\/[^/]+\/undo$/.test(path)) return { ok: true, status: 200, json: async () => ({ id: "x-0", invoicesReleased: 5 }) } as Response;
      if (path === "/api/erp-exports" && method === "POST") return { ok: posted.status < 400, status: posted.status, json: async () => posted.body } as Response;
      if (path === "/api/erp-exports") return { ok: true, json: async () => list } as Response;
      if (/^\/api\/erp-exports\/[^/]+\/csv$/.test(path)) {
        return {
          ok: true,
          headers: new Headers({ "Content-Disposition": 'attachment; filename="vibefinance-erp-export-202609281015-x1.csv"' }),
          blob: async () => new Blob(["export_id\r\n"], { type: "text/csv" }),
        } as unknown as Response;
      }
      throw new Error(`no stub for ${method} ${path}`);
    })
  );
}

async function open() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open: openScreen } = await import("/erp-export.js");
  await openScreen();
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the ERP export screen — decision 0552", () => {
  it("shows what the next export takes, and the exports so far", async () => {
    stub(PENDING, []);
    await open();
    expect(document.querySelector(".erpready")?.textContent).toContain("2 payment-eligible invoices not yet exported");
    const rows = [...document.querySelectorAll(".erpready tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[0]).toEqual(["INV-A", "Kingsway Interiors", "2026-09-20", "14,688.00 GBP"]);
    expect(rows[1]).toEqual(["INV-B", "—", "—", "120.00 GBP"]);
    const history = [...document.querySelectorAll(".erphistory tbody tr td")].map((td) => td.textContent);
    expect(history.slice(0, 4)).toEqual(["2026-09-28 10:15", "Fran", "5", "9"]);
  });

  it("exports, downloads the file under the server's own name, and says what it did", async () => {
    const calls: Call[] = [];
    stub(PENDING, calls);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute("download") ?? "");
    });
    await open();
    const button = [...document.querySelectorAll(".erpready button")].find((b) => b.textContent === "Export 2 invoices") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    await settle();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /api/erp-exports");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("GET /api/erp-exports/x-1/csv");
    expect(clicked).toEqual(["vibefinance-erp-export-202609281015-x1.csv"]);
    expect(document.getElementById("erpexport-note")?.textContent).toBe("Exported 2 invoices as 4 rows. The file is downloading.");
  });

  it("downloads a past export again", async () => {
    const calls: Call[] = [];
    stub(PENDING, calls);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await open();
    (document.querySelector(".erphistory button") as HTMLButtonElement).click();
    await settle();
    expect(calls.map((c) => c.path)).toContain("/api/erp-exports/x-0/csv");
  });

  it("offers no export when nothing is waiting", async () => {
    stub({ pending: { count: 0, invoices: [] }, exports: [] }, []);
    await open();
    expect(document.querySelector(".erpready")?.textContent).toContain("Nothing is waiting");
    expect(document.querySelector(".erpready button")).toBeNull();
    expect(document.querySelector(".erphistory")?.textContent).toContain("No exports yet.");
  });
});

describe("undoing an export — decision 0553", () => {
  it("asks why, undoes it, and says the invoices are back", async () => {
    const calls: Call[] = [];
    stub(PENDING, calls);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("ERP rejected the file");
    await open();
    const undo = [...document.querySelectorAll(".erphistory button")].find((b) => b.textContent === "Undo") as HTMLButtonElement;
    undo.click();
    await settle();
    expect(prompt).toHaveBeenCalledWith("Undo this export? Its 5 invoices go back to Ready to export. Why?");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /api/erp-exports/x-0/undo");
    expect(document.getElementById("erpexport-note")?.textContent).toBe("Export undone: 5 invoices are back in Ready to export.");
  });

  it("does nothing when no reason is given", async () => {
    const calls: Call[] = [];
    stub(PENDING, calls);
    vi.spyOn(window, "prompt").mockReturnValue("  ");
    await open();
    ([...document.querySelectorAll(".erphistory button")].find((b) => b.textContent === "Undo") as HTMLButtonElement).click();
    await settle();
    expect(calls.some((c) => c.path.endsWith("/undo"))).toBe(false);
  });

  it("marks an undone export, who undid it and why, still downloadable and not undoable again", async () => {
    stub(
      {
        ...PENDING,
        exports: [{ ...PENDING.exports[0], undone: { at: "2026-09-29 11:00:05.000", byName: "Dan", reason: "ERP rejected the file" } }],
      },
      []
    );
    await open();
    const row = document.querySelector(".erphistory tbody tr") as HTMLElement;
    expect(row.classList.contains("erpundone")).toBe(true);
    expect(row.querySelector(".erpundonenote")?.textContent).toBe("Undone by Dan, 2026-09-29 11:00");
    expect(row.textContent).toContain("ERP rejected the file");
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Download"]);
  });
});

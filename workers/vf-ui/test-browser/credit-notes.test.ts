import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0334_credit_notes_strings.sql?raw";

/**
 * **Credit notes — decision 0731**: AP Setup › Credit Notes, Credits to
 * confirm on Tasks, and the viewer's panel. The real English strings,
 * read from their migration.
 */

const strings: Record<string, string> = {};
for (const m of stringsSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

const CONFIG = { config: { fullUnpaid: "confirm", partial: "pay", notFound: "review", confirmTeamId: null, networkAllowed: true }, teams: [{ id: "ap", name: "AP Review" }] };
const WAITING = {
  creditNoteId: "cn-1",
  creditNoteNumber: "CN-0012",
  total: 479.04,
  currency: "GBP",
  supplierName: "Thornbury Deli",
  note: "Duplicate of INV-16355",
  reference: "INV-16356",
  invoice: { id: "inv-1", number: "INV-16356", total: 479.04 },
  covers: "full",
  state: "to_confirm",
  afterPayment: false,
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function stub(routes: Record<string, (body: unknown) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      const route = routes[`${method} ${path}`];
      if (route) {
        const r = route(body);
        return reply(r.status, r.body);
      }
      return reply(404, {});
    })
  );
  return calls;
}

async function load() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  return import("/credit-notes.js");
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("AP Setup › Credit Notes", () => {
  it("shows the four questions and the team, and saves what was chosen", async () => {
    const calls = stub({
      "GET /api/credit-note-config": () => ({ status: 200, body: CONFIG }),
      "PUT /api/credit-note-config": (b) => ({ status: 200, body: { config: b } }),
    });
    const m = await load();
    await m.loadCreditNoteSetup();
    const rerender = vi.fn();
    const tab = m.creditNotesTab(rerender);
    document.body.append(tab);
    expect([...tab.querySelectorAll(".creditqtitle")].map((n) => n.textContent)).toEqual([
      "A credit note that credits an unpaid invoice in full",
      "A credit note for part of an invoice",
      "A credit note whose invoice is not found",
      "A credit note for an invoice already sent for payment",
      "Who confirms",
      "In the supplier network",
    ]);
    expect((tab.querySelector("#credit-fullUnpaid-confirm") as HTMLInputElement).checked).toBe(true);
    (tab.querySelector("#credit-fullUnpaid-take_out") as HTMLInputElement).click();
    const team = tab.querySelector(".creditteam select") as HTMLSelectElement;
    team.value = "ap";
    team.dispatchEvent(new Event("change"));
    (tab.querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(rerender).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ ...CONFIG.config, fullUnpaid: "take_out", confirmTeamId: "ap" });
  });
});

describe("Credits to confirm, on Tasks", () => {
  it("lists what waits, and Credit the invoice decides it", async () => {
    let waiting = [WAITING];
    const calls = stub({
      "GET /api/credit-notes/to-confirm": () => ({ status: 200, body: { credits: waiting, mayConfirm: true } }),
      "POST /api/credit-notes/cn-1/decide": () => {
        waiting = [];
        return { status: 200, body: {} };
      },
    });
    const m = await load();
    const holder = document.createElement("div");
    document.body.append(holder);
    expect(await m.fill(holder)).toBe(1);
    expect(holder.querySelector("h3")?.textContent).toBe("Credits to confirm");
    expect(holder.querySelector(".agentnotename")?.textContent).toBe("Credit note CN-0012 · Thornbury Deli");
    expect(holder.querySelector(".creditconfirm .muted")?.textContent).toMatch(/^Credits INV-16356 \(.+479\.04\) in full$/);
    const credit = [...holder.querySelectorAll("button")].find((b) => b.textContent === "Credit the invoice")!;
    credit.click();
    await vi.waitFor(() => expect(holder.hidden).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "credit" });
  });

  it("for one whose invoice was not found, asks which invoice, and says when there is none by that number", async () => {
    stub({
      "GET /api/credit-notes/to-confirm": () => ({ status: 200, body: { credits: [{ ...WAITING, invoice: null, covers: null }], mayConfirm: true } }),
      "POST /api/credit-notes/cn-1/decide": () => ({ status: 404, body: { reason: "not_found" } }),
    });
    const m = await load();
    const holder = document.createElement("div");
    await m.fill(holder);
    expect(holder.querySelector(".creditconfirm .muted")?.textContent).toBe("Credits INV-16356, which was not found from this supplier");
    (holder.querySelector(".creditnumber") as HTMLInputElement).value = "INV-9";
    [...holder.querySelectorAll("button")].find((b) => b.textContent === "It credits this invoice")!.click();
    await vi.waitFor(() => expect(holder.querySelector(".dobuttons .warn")?.textContent).toBe("No invoice with that number from this supplier."));
  });

  it("stays hidden when nothing waits", async () => {
    stub({ "GET /api/credit-notes/to-confirm": () => ({ status: 200, body: { credits: [], mayConfirm: false } }) });
    const m = await load();
    const holder = document.createElement("div");
    expect(await m.fill(holder)).toBe(0);
    expect(holder.hidden).toBe(true);
  });
});

describe("the viewer", () => {
  it("on an invoice, says what credited it, with the buttons only for someone who may confirm", async () => {
    stub({});
    const m = await load();
    const panel = m.creditPanel({ credit: null, creditedBy: [WAITING], mayConfirm: false }, async () => {});
    expect(panel?.textContent).toContain("Credited by");
    expect(panel?.textContent).toContain("waiting for AP to confirm");
    expect(panel?.querySelector("button")).toBeNull();
    expect(m.creditPanel({ credit: null, creditedBy: [WAITING], mayConfirm: true }, async () => {})?.querySelectorAll("button").length).toBe(2);
    expect(m.creditPanel({ credit: null, creditedBy: [], mayConfirm: false }, async () => {})).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0339_receipt_sharing_strings.sql?raw";
import updatesSql from "../../vf-licence/migrations/0340_supplier_network_card_strings.sql?raw";

/**
 * **Goods receipts shared with suppliers — decision 0738**: AP Setup ›
 * Supplier Network, and a supplier's own choice on its page. The real
 * English strings, read from their migration.
 */

const strings: Record<string, string> = {};
for (const m of stringsSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
// Decision 0739: the words changed since.
for (const m of updatesSql.matchAll(/SET value = '((?:[^']|'')*)' WHERE key = '([^']+)' AND locale = 'en'/g)) strings[m[2]] = m[1].replace(/''/g, "'");

type Route = (body: unknown) => { status: number; body: unknown };
function stub(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
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
  return import("/receipt-sharing.js");
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("AP Setup › Supplier Network", () => {
  it("off until turned on; saves the choice, and says how many suppliers have their own", async () => {
    const calls = stub({
      "GET /api/network-sharing-config": () => ({ status: 200, body: { config: { shareReceipts: false, registeredOnly: true }, suppliersWithOwn: 2 } }),
      "PUT /api/network-sharing-config": (b) => ({ status: 200, body: { config: b, suppliersWithOwn: 2 } }),
    });
    const m = await load();
    await m.loadNetworkSharingSetup();
    const rerender = vi.fn();
    const tab = m.supplierNetworkTab(rerender);
    document.body.append(tab);
    expect(tab.querySelector("h3")?.textContent).toBe("Supplier Network");
    expect((tab.querySelector("#network-receipts-none") as HTMLInputElement).checked).toBe(true);
    expect(tab.querySelector(".networkown")?.textContent).toBe("2 supplier(s) have their own setting, on their page's Supplier Network card.");
    (tab.querySelector("#network-receipts-share") as HTMLInputElement).click();
    (tab.querySelector("#network-registered") as HTMLInputElement).click();
    (tab.querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(rerender).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ shareReceipts: true, registeredOnly: false });
  });

  it("says so when the settings cannot be loaded", async () => {
    stub({});
    const m = await load();
    await m.loadNetworkSharingSetup();
    expect(m.supplierNetworkTab(() => {}).textContent).toBe("The supplier network settings could not be loaded.");
  });
});

describe("a supplier's own choice", () => {
  it("shows what AP Setup says, and saves a choice as soon as it is made", async () => {
    const calls = stub({
      "GET /api/suppliers/sup-1/receipt-sharing": () => ({ status: 200, body: { setting: "default", apSetup: false, canManage: true } }),
      "PUT /api/suppliers/sup-1/receipt-sharing": (b) => ({ status: 200, body: { setting: (b as { setting: string }).setting, apSetup: false, canManage: true } }),
    });
    const m = await load();
    const block = m.receiptSharingBlock("sup-1");
    document.body.append(block);
    await vi.waitFor(() => expect(block.hidden).toBe(false));
    expect(block.querySelector(".receiptsharinghead")?.textContent).toBe("Goods receipts in the network");
    expect([...block.querySelectorAll(".radiochoice b")].map((b) => b.textContent)).toEqual(["As AP Setup", "Share with this supplier", "Don't share with this supplier"]);
    expect(block.textContent).toContain("AP Setup does not share goods receipts.");
    expect(block.textContent).not.toContain("null");
    (block.querySelector("#receiptsharing-sup-1-share") as HTMLInputElement).click();
    await vi.waitFor(() => expect(block.querySelector(".portalnote")?.textContent).toBe("Saved."));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ setting: "share" });
    expect((block.querySelector("#receiptsharing-sup-1-share") as HTMLInputElement).checked).toBe(true);
  });

  it("is read only for someone who may not maintain suppliers", async () => {
    stub({ "GET /api/suppliers/sup-1/receipt-sharing": () => ({ status: 200, body: { setting: "none", apSetup: true, canManage: false } }) });
    const m = await load();
    const block = m.receiptSharingBlock("sup-1");
    await vi.waitFor(() => expect(block.hidden).toBe(false));
    expect([...block.querySelectorAll("input")].every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    expect((block.querySelector("#receiptsharing-sup-1-none") as HTMLInputElement).checked).toBe(true);
  });
});

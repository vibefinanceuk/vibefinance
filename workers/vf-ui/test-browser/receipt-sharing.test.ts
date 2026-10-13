import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0339_receipt_sharing_strings.sql?raw";
import updatesSql from "../../vf-licence/migrations/0340_supplier_network_card_strings.sql?raw";
import ordersSql from "../../vf-licence/migrations/0349_order_sharing_strings.sql?raw";
import documentsSql from "../../vf-licence/migrations/0362_network_invoice_document_strings.sql?raw";

/**
 * **Goods receipts shared with suppliers — decision 0738**: AP Setup ›
 * Supplier Network, and a supplier's own choice on its page. The real
 * English strings, read from their migration.
 */

const strings: Record<string, string> = {};
for (const sql of [stringsSql, ordersSql, documentsSql]) for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
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

describe("invoices and credit notes as documents — decision 0770", () => {
  it("AP Setup shows suppliers the documents they sent unless turned off, and saves it", async () => {
    const calls = stub({
      "GET /api/network-sharing-config": () => ({ status: 200, body: { config: { shareReceipts: false, registeredOnly: true, shareOrders: false, ordersFrom: null, shareDocuments: true }, suppliersWithOwn: 0, suppliersWithOwnOrders: 0 } }),
      "PUT /api/network-sharing-config": (b) => ({ status: 200, body: { config: b, suppliersWithOwn: 0, suppliersWithOwnOrders: 0 } }),
    });
    const m = await load();
    await m.loadNetworkSharingSetup();
    const rerender = vi.fn();
    const tab = m.supplierNetworkTab(rerender);
    document.body.append(tab);
    const box = tab.querySelector("#network-sharedocuments") as HTMLInputElement;
    expect(tab.querySelector("#network-documents .creditqtitle")?.textContent).toBe("Invoices and credit notes");
    expect(box.checked).toBe(true);
    expect(tab.querySelector("#network-documents")?.textContent).toContain("Never the email it came in");
    box.click();
    (tab.querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(rerender).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ shareDocuments: false });
  });
});

describe("purchase orders shared with suppliers — decision 0751", () => {
  it("AP Setup asks it beside receipts: share or not, and from when; and says how many suppliers have their own", async () => {
    const calls = stub({
      "GET /api/network-sharing-config": () => ({ status: 200, body: { config: { shareReceipts: true, registeredOnly: true, shareOrders: false, ordersFrom: null }, suppliersWithOwn: 0, suppliersWithOwnOrders: 1 } }),
      "PUT /api/network-sharing-config": (b) => ({ status: 200, body: { config: b, suppliersWithOwn: 0, suppliersWithOwnOrders: 1 } }),
    });
    const m = await load();
    await m.loadNetworkSharingSetup();
    const rerender = vi.fn();
    const tab = m.supplierNetworkTab(rerender);
    document.body.append(tab);
    const orders = tab.querySelector("#network-orders")!;
    expect(orders.querySelector(".creditqtitle")?.textContent).toBe("Purchase orders");
    expect((tab.querySelector("#network-orders-none") as HTMLInputElement).checked).toBe(true);
    expect(orders.querySelector(".networkown")?.textContent).toBe("1 supplier(s) have their own setting for orders, on their page's Supplier portal card.");
    (tab.querySelector("#network-orders-share") as HTMLInputElement).click();
    const from = tab.querySelector("#network-ordersfrom") as HTMLInputElement;
    from.value = "2026-10-01";
    from.dispatchEvent(new Event("change"));
    (tab.querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(rerender).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ shareReceipts: true, registeredOnly: true, shareOrders: true, ordersFrom: "2026-10-01" });
  });

  it("a supplier's own choice for orders, on its own address", async () => {
    const calls = stub({
      "GET /api/suppliers/sup-1/order-sharing": () => ({ status: 200, body: { setting: "default", apSetup: true, canManage: true } }),
      "PUT /api/suppliers/sup-1/order-sharing": (b) => ({ status: 200, body: { setting: (b as { setting: string }).setting, apSetup: true, canManage: true } }),
    });
    const m = await load();
    const block = m.orderSharingBlock("sup-1");
    document.body.append(block);
    await vi.waitFor(() => expect(block.hidden).toBe(false));
    expect(block.querySelector(".receiptsharinghead")?.textContent).toBe("Purchase orders in the network");
    expect(block.textContent).toContain("AP Setup shares purchase orders with every supplier.");
    (block.querySelector("#ordersharing-sup-1-none") as HTMLInputElement).click();
    await vi.waitFor(() => expect(block.querySelector(".portalnote")?.textContent).toBe("Saved."));
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({ path: "/api/suppliers/sup-1/order-sharing", body: { setting: "none" } });
  });
});

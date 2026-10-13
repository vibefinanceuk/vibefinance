import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Orders to suppliers — decision 0759**: the Destination's panel on
 * Process routes, *Send to supplier* on the order, and what the order's
 * Timeline says of a send. The real English strings, from every strings
 * migration.
 */

const migrations = import.meta.glob("../../vf-licence/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const strings: Record<string, string> = {};
for (const file of Object.keys(migrations).sort()) {
  for (const m of migrations[file].matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

const DETAIL = {
  order: { order_number: "PO-9", issue_date: "2026-10-01", currency: "GBP", seller_party_id: "GB111", org_unit_name: "Acme UK", status: "active", effective_status: "active" },
  lines: [{ line_number: 1, item_name: "Office chair", quantity: 10, unit_code: "EA", price_amount: 125, line_extension_amount: 1250 }],
};
const SENDING = {
  available: true,
  destination: { id: "dest-1", status: "active", started: true },
  to: ["orders@kingsway.example", "sales@kingsway.example"],
  from: "orders_email",
  supplier: { id: "kw", name: "Kingsway" },
  supplierSendsOwn: false,
  sends: [{ status: "sent", kind: "order", how: "on_release", to: ["orders@kingsway.example"], from: "orders_email", error: null, by: null, at: "2026-10-12T09:00:00Z" }],
};
const SETTINGS = {
  settings: { sendOnRelease: true, replyTo: null, ccBuyer: true, attachUbl: true },
  started: false,
  status: "paused",
  sends: [
    { orderNumber: "PO-9", status: "sent", kind: "change", how: "by_hand", to: ["orders@kingsway.example"], from: "orders_email", error: null, by: "Pat Lee", at: "2026-10-12T09:00:00Z" },
    { orderNumber: "PO-8", status: "no_address", kind: "order", how: "on_release", to: [], from: null, error: null, by: null, at: "2026-10-11T09:00:00Z" },
  ],
};

function stub(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      const own = routes[`${method} ${path}`];
      if (own) return reply(...own);
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/whoami") return reply(200, { id: "u-pat", name: "Pat Lee", permissions });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      if (path === "/api/purchase-orders/PO-9") return reply(200, DETAIL);
      if (path === "/api/purchase-orders/PO-9/send-to-supplier") return reply(200, SENDING);
      if (path === "/api/purchase-orders/PO-9/timeline") return reply(200, { items: [], collaborators: [], canManage: true });
      if (path === "/api/route-instances/dest-1/orders-out") return reply(200, SETTINGS);
      return reply(404, {});
    })
  );
  return calls;
}

async function start(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls = stub(permissions, routes);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const tasks = await import("/tasks.js");
  await tasks.start();
  return calls;
}

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the Destination's panel on Process routes", () => {
  it("says who orders go to, its settings, Start sending, and what it sent", async () => {
    const calls = await start(["Admin.Configure"], { "PUT /api/route-instances/dest-1/orders-out": [200, { settings: { ...SETTINGS.settings, replyTo: "purchasing@acme.example" } }] });
    const { ordersOutSection } = await import("/orders-out.js");
    const panel = ordersOutSection({ id: "dest-1" }, async () => {});
    document.body.append(panel);
    await vi.waitFor(() => expect(document.getElementById("oo-settings")).not.toBeNull());
    expect([...document.querySelectorAll("#oo-who li")].map((li) => li.textContent?.slice(0, 40))).toEqual([
      "The address the order itself gives for t",
      "Else the supplier's orders address, on i",
      "Else the supplier's general email.",
      "Else it is not sent. The order's Timelin",
    ]);
    expect(document.getElementById("oo-start")?.textContent).toBe("Start sending");
    expect(document.getElementById("oo-notstarted")).not.toBeNull();
    expect([...document.querySelectorAll("#oo-sends tbody tr")].map((r) => [...r.querySelectorAll("td")].slice(0, 4).map((c) => c.textContent))).toEqual([
      ["PO-9", "Change", "Sent", "orders@kingsway.example · The supplier's orders address"],
      ["PO-8", "Order", "No address", "There is no address to send it to: the order gives none, and the supplier has neither an orders address nor an email."],
    ]);
    (document.getElementById("oo-replyto") as HTMLInputElement).value = "purchasing@acme.example";
    (document.getElementById("oo-ccbuyer") as HTMLInputElement).checked = false;
    document.getElementById("oo-save")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")).toEqual({ method: "PUT", path: "/api/route-instances/dest-1/orders-out", body: { sendOnRelease: true, ccBuyer: false, attachPdf: true, attachUbl: true, replyTo: "purchasing@acme.example" } });
  });
});

describe("Send to supplier, on the order", () => {
  it("whoever works orders sees who it goes to and why, and sends it, to another address if given", async () => {
    const calls = await start(["AP.Purchasing"], { "POST /api/purchase-orders/PO-9/send-to-supplier": [201, { status: "sent" }] });
    const { openPurchaseOrder } = await import("/purchase-orders.js");
    await openPurchaseOrder({ order_number: "PO-9" });
    await vi.waitFor(() => expect(document.getElementById("po-send")).not.toBeNull());
    // The last send, above the order's details.
    expect(document.getElementById("po-sentline")?.textContent).toMatch(/^Order sent to the supplier on .+: orders@kingsway\.example\.$/);
    document.getElementById("po-send")!.click();
    expect(document.querySelector("#po-send-recipients strong")?.textContent).toBe("orders@kingsway.example, sales@kingsway.example");
    expect(document.querySelector("#po-send-recipients .muted")?.textContent).toBe("The supplier's orders address");
    (document.getElementById("po-send-to") as HTMLInputElement).value = "jo@kingsway.example";
    document.getElementById("po-send-go")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/api/purchase-orders/PO-9/send-to-supplier", body: { to: "jo@kingsway.example" } });
  });

  it("says when there is no address, and is not offered to whoever only reads orders", async () => {
    await start(["AP.Purchasing"], { "GET /api/purchase-orders/PO-9/send-to-supplier": [200, { ...SENDING, to: [], from: null, sends: [] }] });
    const { openPurchaseOrder } = await import("/purchase-orders.js");
    await openPurchaseOrder({ order_number: "PO-9" });
    await vi.waitFor(() => expect(document.getElementById("po-send")).not.toBeNull());
    document.getElementById("po-send")!.click();
    expect(document.getElementById("po-send-recipients")?.className).toBe("warn");
    document.querySelector(".backdrop")?.remove();

    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await start(["AP.Validate"]);
    const again = await import("/purchase-orders.js");
    await again.openPurchaseOrder({ order_number: "PO-9" });
    await vi.waitFor(() => expect(document.querySelector("#viewer .poview")).not.toBeNull());
    expect(document.getElementById("po-send")).toBeNull();
  });
});

describe("the order's Timeline", () => {
  it("says what was sent, to whom, by which address, and how", async () => {
    await start([]);
    const { describeOrderItem, orderSubs } = await import("/order-timeline.js");
    const item = { kind: "sent_to_supplier", at: "2026-10-12T09:00:00Z", by: "Pat Lee", detail: { kind: "change", how: "by_hand", to: ["orders@kingsway.example"], from: "orders_email", ubl: true, pdf: true } };
    expect(describeOrderItem(item)).toBe("The change sent to the supplier: orders@kingsway.example.");
    expect(orderSubs(item)).toEqual(["The supplier's orders address", "Sent by hand by Pat Lee.", "With the order as a PDF.", "With the order as a Peppol BIS order (UBL)."]);
    expect(describeOrderItem({ kind: "not_sent", at: "", by: null, detail: { reason: "no_address" } })).toBe("Not sent to the supplier: there is no address to send it to.");
    expect(describeOrderItem({ kind: "send_failed", at: "", by: null, detail: { to: ["x@y.example"], error: "refused" } })).toBe("Not sent to x@y.example: refused");
  });
});

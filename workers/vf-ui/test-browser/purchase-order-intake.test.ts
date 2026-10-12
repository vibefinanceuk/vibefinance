import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import checkingSql from "../../vf-licence/migrations/0348_order_checking_strings.sql?raw";

/**
 * **A purchase order held at Checking — decision 0750.** Its page: what
 * Checking found, the lines it found it on, Claim, the company and the
 * supplier, Release (anyway, once seen) and Reject with a reason. The real
 * English strings, read from their migration.
 */

const strings: Record<string, string> = { "viewer.back": "Back", "action.claim": "Claim", "action.release": "Release", "nav.tasks": "Tasks" };
for (const m of checkingSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

const HELD = {
  id: "in-1",
  orderNumber: "PO-4502",
  kind: "change",
  status: "pending",
  receivedAt: "2026-10-13T09:00:00Z",
  from: { source: "Procurement", sender: "Coupa", messageId: "MSG-1" },
  company: { id: "acme-uk", name: "Acme UK" },
  buyerPartyId: "GB907856452",
  supplier: null,
  sellerPartyId: "GB999",
  issueDate: "2026-10-12",
  currency: "GBP",
  totals: { lineExtensionAmount: 30, payableAmount: 36 },
  note: null,
  changeReference: null,
  sequenceNumber: null,
  lines: [
    { lineNumber: 1, quantity: 5, unitCode: "EA", priceAmount: 2, lineExtensionAmount: 10, itemName: "Bubble wrap" },
    { lineNumber: 3, quantity: 10, unitCode: "EA", priceAmount: 2, lineExtensionAmount: 20, itemName: "Tape" },
  ],
  problems: [
    { code: "supplier_unknown", detail: "GB999" },
    { code: "below_received", lines: [1] },
  ],
  blocked: false,
  process: { status: "in_progress", stage: "Checking", name: "Purchase Orders" },
  task: { id: "t-1", claimedBy: null, mine: false, canClaim: true, canRelease: false },
  inForce: { status: "active", currency: "GBP", payableAmount: 40, lines: [{ lineNumber: 1, quantity: 10, priceAmount: 2 }, { lineNumber: 2, quantity: 4, priceAmount: 2 }] },
  companies: [
    { id: "acme-ie", name: "Acme Ireland" },
    { id: "acme-uk", name: "Acme UK" },
  ],
  released: null,
  rejected: null,
};
const CLAIMED = { ...HELD, task: { id: "t-1", claimedBy: "Pat", mine: true, canClaim: false, canRelease: true } };

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function stub(permissions: string[], order: unknown, routes: Record<string, [number, unknown]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      const own = routes[`${method} ${path}`];
      if (own) return reply(...own);
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/whoami") return reply(200, { id: "u-pat", name: "Pat", permissions });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      if (path === "/api/purchase-orders/intake/in-1" && method === "GET") return reply(200, { order });
      return reply(404, {});
    })
  );
  return calls;
}

async function openPage(permissions: string[], order: unknown, routes: Record<string, [number, unknown]> = {}, onDone?: () => void) {
  const calls = stub(permissions, order, routes);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { openOrderIntake } = await import("/purchase-order-intake.js");
  await openOrderIntake("in-1", { onDone });
  return calls;
}

const text = (sel: string) => document.querySelector(sel)?.textContent ?? null;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("a purchase order held at Checking — decision 0750", () => {
  it("says where it waits and what Checking found, marks the lines, and shows what the order in force has", async () => {
    await openPage(["AP.Purchasing", "AP.TaskView"], HELD);
    expect(document.getElementById("viewer")?.hidden).toBe(false);
    expect(text("#poin .topbar h2")).toBe("PO-4502");
    expect(text("#poin-waiting")).toBe("Waiting at Checking in Purchase Orders: not in force until released.");
    expect([...document.querySelectorAll("#poin-found li")].map((li) => li.textContent)).toEqual([
      "The supplier GB999 is not on file.",
      "The change orders less than has already been received. Lines 1.",
    ]);
    expect([...document.querySelectorAll("#poin-lines tr.poinflagged")].map((tr) => (tr as HTMLElement).dataset.line)).toEqual(["1"]);
    expect(text('#poin-lines tr[data-line="1"] td:last-child')).toBe("was 10 at 2");
    expect(text('#poin-lines tr[data-line="3"] td:last-child')).toBe("new line");
    expect(text(".poinremoved")).toBe("Line 2 of the order in force is no longer in it.");
    expect(text("#poin-task")).toBe("Nobody has claimed it yet. Claim it to work it.");
    // Not claimed: Claim, and nothing to act with yet.
    expect(document.getElementById("poin-claim")).not.toBeNull();
    expect(document.getElementById("poin-release")).toBeNull();
    expect(document.getElementById("poin-company")).toBeNull();
  });

  it("Claim claims its task and opens it again", async () => {
    const calls = await openPage(["AP.Purchasing"], HELD, { "POST /api/tasks/t-1/claim": [200, {}] });
    (document.getElementById("poin-claim") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === "/api/purchase-orders/intake/in-1").length).toBe(2));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/tasks/t-1/claim")).toBe(true);
  });

  it("claimed: the company and the supplier may be set, each checking it again", async () => {
    const calls = await openPage(["AP.Purchasing"], CLAIMED, {
      "POST /api/purchase-orders/intake/in-1/fix": [200, { order: CLAIMED }],
      "GET /api/purchase-orders/intake/in-1/suppliers": [200, { suppliers: [{ id: "nw", name: "Northwind", vatId: "GB111", erpIdentifier: "N1", status: "active" }] }],
    });
    const company = document.getElementById("poin-company") as HTMLSelectElement;
    expect([...company.options].map((o) => o.textContent)).toEqual(["Choose the company", "Acme Ireland", "Acme UK"]);
    company.value = "acme-ie";
    company.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(calls.find((c) => c.path === "/api/purchase-orders/intake/in-1/fix")?.body).toEqual({ orgUnitId: "acme-ie" }));
    await settle();
    const box = document.getElementById("poin-supplier") as HTMLInputElement;
    box.value = "north";
    box.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelector("#poin-supplier-results button")).not.toBeNull(), { timeout: 2000 });
    expect(calls.some((c) => c.path === "/api/purchase-orders/intake/in-1/suppliers?q=north")).toBe(true);
    expect(text("#poin-supplier-results button")).toBe("Northwind · GB111");
    (document.querySelector("#poin-supplier-results button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((c) => c.path === "/api/purchase-orders/intake/in-1/fix").map((c) => c.body)).toContainEqual({ supplierId: "nw" }));
  });

  it("Release shows what is still found and releases it anyway only when asked", async () => {
    const done = vi.fn();
    const calls = await openPage(["AP.Purchasing"], CLAIMED, { "POST /api/purchase-orders/intake/in-1/release": [200, { order: { ...CLAIMED, status: "released" } }] }, done);
    (document.getElementById("poin-release") as HTMLButtonElement).click();
    await settle();
    expect(text("#poin-problem")).toContain("Checking still finds this. Release the order anyway?");
    expect(calls.some((c) => c.path.endsWith("/release"))).toBe(false);
    (document.getElementById("poin-releaseanyway") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls.find((c) => c.path.endsWith("/release"))?.body).toEqual({ anyway: true });
    expect(document.getElementById("viewer")?.hidden).toBe(true);
  });

  it("Reject asks why, and says the server's refusal in its own words", async () => {
    const calls = await openPage(["AP.Purchasing"], CLAIMED, { "POST /api/purchase-orders/intake/in-1/reject": [400, { error: "say why", reason: "reject_reason_missing" }] });
    (document.getElementById("poin-reject") as HTMLButtonElement).click();
    await settle();
    (document.getElementById("poin-rejectreason") as HTMLInputElement).value = "";
    (document.getElementById("poin-rejectconfirm") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(text("#poin-problem")).toBe("Say why it is rejected."));
    expect(calls.find((c) => c.path.endsWith("/reject"))?.body).toEqual({ reason: "" });
  });

  it("an order that cannot be released as it is offers no Release; a cancellation says what it cancels", async () => {
    await openPage(["AP.Purchasing"], {
      ...CLAIMED,
      kind: "cancellation",
      note: "Project stopped",
      lines: [],
      inForce: null,
      problems: [{ code: "nothing_to_cancel" }],
      blocked: true,
    });
    expect((document.getElementById("poin-release") as HTMLButtonElement).disabled).toBe(true);
    expect(text("#poin-found div")).toBe("Checking found something that must be fixed, or the order rejected:");
    expect(text("#poin-cancel")).toBe("This cancels the order in force. Reason given: Project stopped");
  });

  it("someone without AP.Purchasing may look, but not act", async () => {
    await openPage(["Admin.Configure"], CLAIMED);
    expect(document.getElementById("poin-release")).toBeNull();
    expect(document.getElementById("poin-claim")).toBeNull();
    expect(text("#poin-main")).toContain("Acme UK");
  });
});

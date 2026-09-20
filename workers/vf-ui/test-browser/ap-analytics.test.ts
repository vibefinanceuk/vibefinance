import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AP Analytics — decision 0417, the tabbed home the operator asked
 * for once Workload (0415) and Supplier Performance (0416) had each
 * shipped as their own standalone screen: "I was hoping to have an AP
 * Analytics link, with all dashboard available via tabs... similar
 * pill-box tabs seen in the Access screen." A mid-turn follow-up
 * added the permission gate this file spends most of its own weight
 * proving: "Access to tabs, and visibility of tabs controlled through
 * user permissions."
 *
 * **What this file does not re-prove.** The Operational Performance
 * and Supplier Performance tabs delegate to `workload.js` and
 * `supplier-performance.js`, each already covered by its own test
 * file for chart correctness, currency splitting and so on. This file
 * only proves the wiring — that the right module's `load()`/
 * `renderCard()` land behind the right tab — not that module's own
 * content in detail.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    // Nav — the same base set `tasks.test.ts` uses, since `start()`
    // itself always renders the nav around whatever screen follows.
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.purchaseorders": "Purchase Orders",
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.apanalytics": "AP Analytics",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "nav.roles": "Roles",
    "nav.access": "Access",
    "nav.processes": "Processes",
    "nav.group.accountspayable": "Accounts payable",
    "nav.group.suppliermanagement": "Supplier management",
    "nav.group.configuration": "Configuration",
    "nav.vibeap": "Vibe AP",
    "nav.collapse": "Collapse the menu",
    "nav.expand": "Expand the menu",
    // The task list — where `start()` lands nobody granted
    // `AP.Dashboard`, which none of these fixtures ever are.
    "tasks.stage": "Stage",
    "tasks.line": "line",
    "tasks.supplier": "Supplier",
    "tasks.amount": "Amount",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
    "tasks.signout": "Sign out",
    "tasks.allstages": "All stages",
    "tasks.everything": "Everything",
    "tasks.mine": "Mine",
    "tasks.available": "Available",
    "tasks.locked": "Locked",
    "tasks.empty": "Nothing here",
    "tasks.nodocument": "No document",
    "tasks.notkeyed": "Not keyed",
    "mood.label": "Mood",
    "mood.day": "Day",
    "mood.night": "Night",
    "org.all": "All organisations",
    "org.switchheading": "Switch organisation",
    "action.close": "Close",
    // AP Analytics' own screen.
    "apanalytics.heading": "AP Analytics",
    "apanalytics.sub": "Every AP analytics screen, in one place",
    "apanalytics.operational": "Operational Performance",
    "apanalytics.financial": "Financial Performance",
    "apanalytics.supplier": "Supplier Performance",
    "apanalytics.executiveiq": "Executive IQ",
    "apanalytics.fraud": "Fraud Prevention",
    "apanalytics.notbuilt": "Not built yet",
    "apanalytics.loaderror": "Could not load this tab right now",
    "apanalytics.none": "No AP Analytics tabs are available to you",
    // The Operational Performance tab's real content — decision 0415.
    "workload.throughput": "Throughput by user",
    "workload.throughputsub": "Completed in the last 7 days, stacked by stage",
    "workload.nothroughput": "Nothing completed in the last 7 days",
    // The Supplier Performance tab's real content — decision 0416.
    "supplierperformance.spend": "Spend by supplier",
    "supplierperformance.spendsub": "Ranked by total invoiced amount, by currency",
    "supplierperformance.nospend": "No priced invoices yet",
    "supplierperformance.invoicecount": "{n} invoices",
  },
};

/**
 * **Response-shaped stubs pass through, decision 0322/0333** — a
 * route can hand back `{ ok: false, status: 500 }` to prove the
 * loaderror path, not only a success body.
 */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      const value = routes[path];
      if (value && typeof value === "object" && ("status" in (value as object) || "ok" in (value as object))) {
        return value as Response;
      }
      return { ok: true, json: async () => value } as Response;
    })
  );
}

/**
 * **Always through `start()`, never `open()` alone** — the same gap
 * `access.test.ts` and `rules.test.ts` each found for themselves:
 * `me` is only ever populated by `start()`'s own `/api/whoami` call,
 * and every permission check this screen makes — its own tab gate,
 * `holdsEverywhere` for Executive IQ — reads `me` directly.
 *
 * `/api/workload/throughput` and `/api/suppliers/spend` are stubbed
 * empty by default on every call, whether or not the test's own
 * permission set makes either tab reachable — harmless when unused,
 * and one less thing each individual test has to remember.
 */
async function openApAnalytics(
  permissions: string[],
  extraWhoami: Record<string, unknown> = {},
  extraRoutes: Record<string, unknown> = {}
) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions, ...extraWhoami },
    "/api/tasks": { tasks: [], counts: {} },
    "/api/workload/throughput": { users: [], legend: [] },
    "/api/suppliers/spend": { currencies: [] },
    ...extraRoutes,
  });
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open } = await import("/ap-analytics.js");
  await open();
}

/**
 * **A tab switch, the same way a person clicking through the real UI
 * would — decision 0333's own `access.test.ts` pattern.** Unlike
 * `access.js`'s own tabs, whose data is all loaded upfront, a real
 * tab here fetches on the way in (`tabContent()` calls the module's
 * own `load()` every time it becomes active), so the click's own
 * handler is asynchronous — polled for rather than assumed settled
 * the instant `click()` returns, the same treatment
 * `tasks.test.ts`'s own nav-collapse test already gives an async
 * click handler.
 */
async function switchTab(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")].find(
    (b) => b.textContent === label
  );
  button?.click();
  for (let i = 0; i < 100; i++) {
    if (document.querySelector(".tab.active")?.textContent === label) break;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the screen's own topbar and current-screen marker", () => {
  it("titles it AP Analytics with the shared subtitle", async () => {
    await openApAnalytics(["AP.Analysis"]);

    expect(document.querySelector(".topbar h2")?.textContent).toBe("AP Analytics");
    expect(document.querySelector(".topbar .sub")?.textContent).toBe("Every AP analytics screen, in one place");
  });

  it("marks AP Analytics as the current screen in the nav", async () => {
    await openApAnalytics(["AP.Analysis"]);

    expect(document.querySelector(".nav a.on")?.textContent).toBe("AP Analytics");
  });
});

describe("tab visibility is permission-gated, not fixed — decision 0417's own mid-turn requirement", () => {
  it("shows Operational and Financial Performance behind AP.Analysis alone", async () => {
    await openApAnalytics(["AP.Analysis"]);

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Operational Performance", "Financial Performance"]);
  });

  it("keeps Executive IQ hidden behind AP.Analysis alone — it also requires holding everywhere", async () => {
    await openApAnalytics(["AP.Analysis"], { holdsEverywhere: false });

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).not.toContain("Executive IQ");
  });

  it("shows Executive IQ once AP.Analysis and holdsEverywhere are both true", async () => {
    await openApAnalytics(["AP.Analysis"], { holdsEverywhere: true });

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Operational Performance", "Financial Performance", "Executive IQ"]);
  });

  it("shows only Supplier Performance behind AP.Supplier alone", async () => {
    await openApAnalytics(["AP.Supplier"]);

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Supplier Performance"]);
  });

  it("shows only Fraud Prevention behind AP.FraudReview alone", async () => {
    await openApAnalytics(["AP.FraudReview"]);

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Fraud Prevention"]);
  });

  it("shows every tab once all three permissions and holdsEverywhere are held", async () => {
    await openApAnalytics(["AP.Analysis", "AP.Supplier", "AP.FraudReview"], { holdsEverywhere: true });

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual([
      "Operational Performance",
      "Financial Performance",
      "Supplier Performance",
      "Executive IQ",
      "Fraud Prevention",
    ]);
  });

  it("says no tabs are available rather than rendering an empty pane, for someone holding none of the three", async () => {
    await openApAnalytics([]);

    expect(document.querySelector(".tabbar")?.children.length).toBe(0);
    expect(document.body.textContent).toContain("No AP Analytics tabs are available to you");
  });
});

describe("the default tab, when only some permissions are held", () => {
  it("lands on the first tab TABS names among the ones actually available, not the first tab overall", async () => {
    // TABS' own order is operational, financial, supplier,
    // executiveiq, fraud — holding only the last two of those five
    // filters to [supplier, fraud], so Supplier Performance is the
    // one that opens, not Fraud Prevention.
    await openApAnalytics(["AP.FraudReview", "AP.Supplier"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Supplier Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend by supplier");
  });
});

describe("real tabs wire to the already-tested module behind them, placeholders say what they are", () => {
  it("Operational Performance renders workload.js's own card", async () => {
    await openApAnalytics(["AP.Analysis"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Operational Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");
    expect(document.body.textContent).toContain("Nothing completed in the last 7 days");
  });

  it("Supplier Performance renders supplier-performance.js's own card", async () => {
    await openApAnalytics(["AP.Supplier"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Supplier Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend by supplier");
    expect(document.body.textContent).toContain("No priced invoices yet");
  });

  it("Financial Performance, Executive IQ and Fraud Prevention each say not built yet, gated on their own real permission", async () => {
    await openApAnalytics(["AP.Analysis", "AP.FraudReview"], { holdsEverywhere: true });

    await switchTab("Financial Performance");
    expect(document.body.textContent).toContain("Not built yet");

    await switchTab("Executive IQ");
    expect(document.body.textContent).toContain("Not built yet");

    await switchTab("Fraud Prevention");
    expect(document.body.textContent).toContain("Not built yet");
  });

  it("shows a real error rather than crashing, when a real tab's own fetch fails", async () => {
    await openApAnalytics(["AP.Analysis"], {}, { "/api/workload/throughput": { ok: false, status: 500 } });

    expect(document.body.textContent).toContain("Could not load this tab right now");
  });
});

describe("switching tabs", () => {
  it("moves between real and placeholder content, and keeps exactly one tab marked active", async () => {
    await openApAnalytics(["AP.Analysis", "AP.Supplier", "AP.FraudReview"], { holdsEverywhere: true });

    expect(document.querySelector(".tab.active")?.textContent).toBe("Operational Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");

    await switchTab("Supplier Performance");
    expect(document.querySelectorAll(".tab.active")).toHaveLength(1);
    expect(document.querySelector(".tab.active")?.textContent).toBe("Supplier Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend by supplier");

    await switchTab("Fraud Prevention");
    expect(document.querySelectorAll(".tab.active")).toHaveLength(1);
    expect(document.querySelector(".tab.active")?.textContent).toBe("Fraud Prevention");
    expect(document.body.textContent).toContain("Not built yet");

    await switchTab("Operational Performance");
    expect(document.querySelector(".tab.active")?.textContent).toBe("Operational Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");
  });
});

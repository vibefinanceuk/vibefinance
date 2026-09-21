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
 * tab delegates to seven modules at once, `workload.js` (decision
 * 0415) and — decision 0428, six of Workload's own remaining seven key
 * metrics, built together at the operator's own choice — `workload-
 * open-tasks.js`, `workload-handling-time.js`, `workload-cycle-
 * time.js`, `workload-pending.js`, `workload-queue-depth.js`, and
 * `workload-balance.js`. The seventh, "Exceptions by user"
 * (`workload-exceptions.js`), was pulled live — decision 0428's own
 * second addendum — over a governance concern (naming individuals
 * under a broad `AP.Analysis` gate) and a raw-count calculation that
 * rewarded volume over accuracy; no route, no card, until both are
 * redesigned together. Financial Performance delegates to
 * two modules at once, `accruals.js` and `spend-under-management.js`
 * (decision 0419); Supplier Performance delegates to eight modules at
 * once, `supplier-status.js`, `supplier-performance.js`,
 * `supplier-cycle-time.js`, `supplier-exceptions.js`,
 * `supplier-po-variance.js` and `supplier-payment-terms.js` (decision
 * 0421), and — its own last two, decision 0427 —
 * `supplier-discount-eligibility.js` and `supplier-hold-history.js`;
 * Fraud Prevention delegates to five modules at once,
 * `fraud-duplicates.js` (decision 0420),
 * `fraud-unapproved-suppliers.js` (decision 0422),
 * `fraud-exception-trends.js` (decision 0423), and
 * `fraud-statistical-outliers.js` / `fraud-segregation-of-duties.js`
 * (decision 0424). Each is already covered by its own test file for
 * chart/table correctness, currency splitting and so on. This file
 * only proves the wiring — that the right module's
 * `load()`/`renderCard()` land behind the right tab — not that
 * module's own content in detail.
 *
 * **Talk to an AP Expert, the sixth tab — decision 0430.** Not a
 * `load()`/`renderCard()` pair like every tab above: `ap-assistant.js`'s
 * own `renderPanel()` builds a small, self-contained chat with no data
 * to fetch ahead of render, so this file's own coverage for it is the
 * gate (`AP.Assistant`) and the panel's own real interaction — typing a
 * question, sending it, and the real answer landing — rather than a
 * card-content comparison.
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
    "apanalytics.assistant": "Talk to an AP Expert",
    "apanalytics.notbuilt": "Not built yet",
    "apanalytics.loaderror": "Could not load this tab right now",
    "apanalytics.none": "No AP Analytics tabs are available to you",
    // The Operational Performance tab's real content — decision 0415.
    "workload.throughput": "Throughput by user",
    "workload.throughputsub": "Completed in the last 7 days, stacked by stage",
    "workload.nothroughput": "Nothing completed in the last 7 days",
    // The Operational Performance tab's remaining seven real cards —
    // decision 0428, all seven of Workload's own remaining key
    // metrics, built together.
    "workload.opentasks": "Open tasks by user",
    "workload.opentaskssub": "Who currently owns or has claimed what, and how much sits unclaimed",
    "workload.noopentasks": "No open tasks right now",
    "workload.opentasksavailable": "{n} unclaimed",
    "workload.handlingtime": "Average handling time",
    "workload.handlingtimesub": "Claim to complete, by stage and by user",
    "workload.nohandlingtime": "No completed, claimed tasks yet",
    "workload.stage": "Stage",
    "workload.user": "User",
    "workload.avghandlingtime": "Avg. handling time",
    "workload.taskcount": "Tasks",
    "workload.hourscount": "{n} hours",
    "workload.cycletime": "Claim-to-complete cycle time",
    "workload.cycletimesub": "How long a task sits once somebody has it",
    "workload.nocycletime": "No completed, claimed tasks yet",
    "workload.taskcountnote": "{n} tasks",
    "workload.pending": "Tasks pending action",
    "workload.pendingsub": "Open longer than 3, 7 or 14 days",
    "workload.nopending": "Nothing has been open that long",
    "workload.dayplusheader": "{n}+ days",
    "workload.unclaimed": "Unclaimed",
    "workload.queuedepth": "Team queue depth",
    "workload.queuedepthsub": "Available (unclaimed) vs. locked (claimed but not finished), by team",
    "workload.noqueuedepth": "No team-owned tasks open right now",
    "workload.available": "Available",
    "workload.locked": "Locked",
    "workload.balance": "Workload balance",
    "workload.balancesub": "Variance in open-task count across each team's own members",
    "workload.nobalance": "No teams to compare yet",
    "workload.balancestddev": "±{n} tasks",
    // workload.exceptions* deliberately not included — the card and its
    // route were pulled live, decision 0428's own second addendum.
    // The Financial Performance tab's real content — decision 0417's
    // own follow-on.
    "financialperformance.accruals": "Accruals report",
    "financialperformance.accrualssub": "Received, not yet payment-eligible, by stage",
    "financialperformance.noaccruals": "No open liabilities right now",
    "financialperformance.accrued": "{amount} accrued",
    "financialperformance.invoicecount": "{n} invoices",
    // Financial Performance's second real card — decision 0419.
    "financialperformance.spendundermanagement": "Spend under management",
    "financialperformance.spendundermanagementsub": "Share of spend backed by a purchase order",
    "financialperformance.nospend": "No spend recorded yet",
    "financialperformance.totalspend": "{amount} total spend",
    "financialperformance.withpospend": "{amount} with a PO",
    "financialperformance.invoiceswithpo": "{withpo} of {total} invoices with a PO",
    // The Supplier Performance tab's real content — decision 0416.
    "supplierperformance.spend": "Spend by supplier",
    "supplierperformance.spendsub": "Ranked by total invoiced amount, by currency",
    "supplierperformance.nospend": "No priced invoices yet",
    "supplierperformance.invoicecount": "{n} invoices",
    // Supplier Performance's five remaining real cards — decision 0421.
    "suppliers.statusheading": "Suppliers by status",
    "suppliers.nostatusdata": "No status data yet",
    "suppliers.status.active": "Active",
    "suppliers.status.onhold": "On hold",
    "suppliers.status.inactive": "Inactive",
    "suppliers.status.awaitingerp": "Awaiting the ERP",
    "supplierperformance.supplier": "Supplier",
    "supplierperformance.dayscount": "{n} days",
    "supplierperformance.cycletime": "Average cycle time",
    "supplierperformance.cycletimesub": "Receipt to payment-eligible, by supplier",
    "supplierperformance.nocycletime": "No completed invoices yet",
    "supplierperformance.exceptions": "Exception rate",
    "supplierperformance.exceptionssub": "Suppliers with the most validation exceptions, last 90 days",
    "supplierperformance.noexceptions": "No exceptions recorded",
    "supplierperformance.exceptioncount": "Exceptions",
    "supplierperformance.visitcount": "Checked",
    "supplierperformance.exceptionrate": "Rate",
    "supplierperformance.typemix": "Most common",
    "supplierperformance.povariance": "Invoice variance to order value",
    "supplierperformance.povariancesub": "Average variance from the matched purchase order, by supplier",
    "supplierperformance.nopovariance": "No PO-matched invoices yet",
    "supplierperformance.paymentterms": "Payment terms held vs. negotiated",
    "supplierperformance.paymenttermssub": "What was agreed, what was invoiced, and how often it was on time",
    "supplierperformance.nopaymentterms": "No comparable payment terms yet",
    "supplierperformance.negotiatedterms": "Negotiated",
    "supplierperformance.heldterms": "Invoiced",
    "supplierperformance.ontimerate": "On time",
    // Supplier Performance's last two remaining real cards — decision 0427.
    "supplierperformance.discounteligibility": "Early-payment discount eligibility",
    "supplierperformance.discounteligibilitysub": "Invoices currently inside their supplier's own discount window, by currency",
    "supplierperformance.nodiscounteligibility": "No invoices currently eligible for an early-payment discount",
    "supplierperformance.discounteligiblenote": "{n} invoices eligible at {pct}% within {days} days",
    "supplierperformance.holdhistory": "Hold history",
    "supplierperformance.holdhistorysub": "How often and for how long a supplier has been placed on hold, and why",
    "supplierperformance.noholdhistory": "No recorded hold periods yet",
    "supplierperformance.holdstarted": "Started",
    "supplierperformance.holdended": "Ended",
    "supplierperformance.holdongoing": "Ongoing",
    "supplierperformance.holdduration": "Days on hold",
    "supplierperformance.holdreason": "Reason",
    // The Fraud Prevention tab's real content — decision 0420.
    "fraudprevention.duplicates": "Potential duplicate invoices",
    "fraudprevention.duplicatessub": "Same supplier, amount and date — sorted by confidence",
    "fraudprevention.noduplicates": "No potential duplicates right now",
    "fraudprevention.invoicenumber": "Invoice",
    "fraudprevention.supplier": "Supplier",
    "fraudprevention.amount": "Amount",
    "fraudprevention.issuedate": "Issue date",
    "fraudprevention.confidence": "Confidence",
    // The Fraud Prevention tab's second real card — decision 0422.
    "fraudprevention.unapprovedsuppliers": "Unapproved-supplier invoices",
    "fraudprevention.unapprovedsupplierssub": "A supplier not on file, or one currently on hold",
    "fraudprevention.nounapprovedsuppliers": "No unapproved-supplier invoices right now",
    "fraudprevention.reason": "Reason",
    "fraudprevention.reasonnotonfile": "Not on file",
    "fraudprevention.reasononhold": "On hold",
    // The Fraud Prevention tab's third real card — decision 0423.
    "fraudprevention.exceptiontrends": "Exceptions by type, by user, by supplier",
    "fraudprevention.exceptiontrendssub": "Trended over the last 8 weeks",
    "fraudprevention.noexceptiontrends": "No exceptions in the last 8 weeks",
    "fraudprevention.exceptioncount": "Exceptions",
    "fraudprevention.trend": "Trend",
    "fraudprevention.bysupplier": "By supplier",
    "fraudprevention.byuser": "By user",
    "fraudprevention.bytype": "By type",
    "fraudprevention.user": "User",
    "fraudprevention.type": "Type",
    "fraudprevention.nosupplier": "No matched supplier",
    // The Fraud Prevention tab's fourth and fifth real cards — decision 0424.
    "fraudprevention.statisticaloutliers": "Statistical outliers",
    "fraudprevention.statisticaloutlierssub": "An amount well outside the supplier's own historical range",
    "fraudprevention.nostatisticaloutliers": "No statistical outliers right now",
    "fraudprevention.historicalmean": "Historical average",
    "fraudprevention.deviation": "Deviation",
    "fraudprevention.undefinedmagnitude": "Undefined magnitude",
    "fraudprevention.segregationofduties": "Segregation-of-duties flags",
    "fraudprevention.segregationofdutiessub": "The same person claiming and approving the same invoice",
    "fraudprevention.nosegregationofduties": "No segregation-of-duties flags right now",
    "fraudprevention.stagescompleted": "Stages completed",
    // Executive IQ's first real card — decision 0425.
    "executiveiq.consolidatedspend": "Consolidated spend across org units / legal entities",
    "executiveiq.consolidatedspendsub": "Every entity, by currency",
    "executiveiq.noconsolidatedspend": "No priced, placed invoices yet",
    "executiveiq.legalentity": "Legal entity",
    "executiveiq.operatingunit": "Operating unit",
    // Talk to an AP Expert — decision 0430, Screen 6, the sixth tab.
    "apassistant.heading": "Talk to an AP Expert",
    "apassistant.sub": "Ask a plain question about supplier spend, overdue balances, accruals, or exceptions",
    "apassistant.empty": "Ask a question to get started",
    "apassistant.thinking": "Thinking…",
    "apassistant.placeholder": "Ask a question…",
    "apassistant.send": "Ask",
    "apassistant.error": "Something went wrong answering that — please try again.",
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
 * `/api/workload/throughput`, `/api/workload/open-tasks`,
 * `/api/workload/handling-time`, `/api/workload/cycle-time`,
 * `/api/workload/pending`, `/api/workload/queue-depth`,
 * `/api/workload/balance` (not `/api/workload/exceptions` — that
 * route was pulled live, decision 0428's own second addendum),
 * `/api/accruals`,
 * `/api/spend/under-management`, `/api/suppliers/spend`,
 * `/api/suppliers/discount-eligibility`, `/api/suppliers/hold-history`,
 * `/api/fraud/duplicates`, `/api/fraud/unapproved-suppliers`,
 * `/api/fraud/exception-trends`, `/api/fraud/statistical-outliers`,
 * `/api/fraud/segregation-of-duties` and
 * `/api/executive/consolidated-spend` are stubbed empty by default on
 * every call, whether or not the test's own permission set makes any
 * given tab reachable — harmless when unused, and one less thing each
 * individual test has to remember.
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
    "/api/workload/open-tasks": { users: [], available: 0 },
    "/api/workload/handling-time": { rows: [] },
    "/api/workload/cycle-time": { users: [] },
    "/api/workload/pending": { thresholdsDays: [3, 7, 14], users: [], unclaimed: [0, 0, 0] },
    "/api/workload/queue-depth": { teams: [] },
    "/api/workload/balance": { teams: [] },
    "/api/accruals": { currencies: [] },
    "/api/spend/under-management": { currencies: [] },
    "/api/suppliers/spend": { currencies: [] },
    "/api/suppliers/status-counts": { counts: null },
    "/api/suppliers/cycle-time": { suppliers: [] },
    "/api/suppliers/exceptions": { suppliers: [], typeMix: [] },
    "/api/suppliers/po-variance": { suppliers: [] },
    "/api/suppliers/payment-terms": { suppliers: [] },
    "/api/suppliers/discount-eligibility": { currencies: [] },
    "/api/suppliers/hold-history": { periods: [] },
    "/api/fraud/duplicates": { invoices: [] },
    "/api/fraud/unapproved-suppliers": { invoices: [] },
    "/api/fraud/exception-trends": { weekStartDates: [], bySupplier: [], byUser: [], byType: [] },
    "/api/fraud/statistical-outliers": { invoices: [] },
    "/api/fraud/segregation-of-duties": { invoices: [] },
    "/api/executive/consolidated-spend": { currencies: [] },
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

  it("shows only Talk to an AP Expert behind AP.Assistant alone — decision 0430", async () => {
    await openApAnalytics(["AP.Assistant"]);

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Talk to an AP Expert"]);
  });

  it("shows every tab once all four permissions and holdsEverywhere are held", async () => {
    await openApAnalytics(["AP.Analysis", "AP.Supplier", "AP.FraudReview", "AP.Assistant"], { holdsEverywhere: true });

    const tabs = [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent);
    expect(tabs).toEqual([
      "Operational Performance",
      "Financial Performance",
      "Supplier Performance",
      "Executive IQ",
      "Fraud Prevention",
      "Talk to an AP Expert",
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
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Suppliers by status");
  });
});

describe("real tabs wire to the already-tested module behind them, placeholders say what they are", () => {
  it("Operational Performance renders seven of its own cards, decision 0428 — six of Workload's own remaining seven key metrics, now real; the eighth, Exceptions by user, was pulled live", async () => {
    await openApAnalytics(["AP.Analysis"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Operational Performance");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Throughput by user",
      "Open tasks by user",
      "Average handling time",
      "Claim-to-complete cycle time",
      "Tasks pending action",
      "Team queue depth",
      "Workload balance",
    ]);
    expect(headings).not.toContain("Exceptions by user");
    expect(document.body.textContent).toContain("Nothing completed in the last 7 days");
  });

  it("Operational Performance's seven cards fail independently — one's own load failure never hides the others' real content", async () => {
    await openApAnalytics(["AP.Analysis"], {}, { "/api/workload/handling-time": { ok: false, status: 500 } });

    expect(document.body.textContent).toContain("Could not load this tab right now");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toContain("Throughput by user");
    expect(headings).toContain("Open tasks by user");
    expect(headings).toContain("Claim-to-complete cycle time");
    expect(headings).toContain("Tasks pending action");
    expect(headings).toContain("Team queue depth");
    expect(headings).toContain("Workload balance");
    expect(headings).not.toContain("Average handling time");
  });

  it("Financial Performance renders accruals.js's own card", async () => {
    await openApAnalytics(["AP.Analysis"]);

    await switchTab("Financial Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Accruals report");
    expect(document.body.textContent).toContain("No open liabilities right now");
  });

  it("Financial Performance also renders spend-under-management.js's own card, decision 0419 — two real cards, not one", async () => {
    await openApAnalytics(["AP.Analysis"]);

    await switchTab("Financial Performance");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Accruals report", "Spend under management"]);
    expect(document.body.textContent).toContain("No spend recorded yet");
  });

  it("Supplier Performance renders all eight of its own cards, decision 0427 — all eight of the design's own key metrics for this screen, now real", async () => {
    await openApAnalytics(["AP.Supplier"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Supplier Performance");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Suppliers by status",
      "Spend by supplier",
      "Average cycle time",
      "Exception rate",
      "Invoice variance to order value",
      "Payment terms held vs. negotiated",
      "Early-payment discount eligibility",
      "Hold history",
    ]);
    expect(document.body.textContent).toContain("No priced invoices yet");
  });

  it("Supplier Performance's eight cards fail independently — one's own load failure never hides the others' real content", async () => {
    await openApAnalytics(["AP.Supplier"], {}, { "/api/suppliers/spend": { ok: false, status: 500 } });

    expect(document.body.textContent).toContain("Could not load this tab right now");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toContain("Average cycle time");
    expect(headings).not.toContain("Spend by supplier");
  });

  it("Executive IQ renders its own real card, decision 0425 — no longer a placeholder", async () => {
    await openApAnalytics(["AP.Analysis", "AP.FraudReview"], { holdsEverywhere: true });

    await switchTab("Executive IQ");
    expect(document.body.textContent).not.toContain("Not built yet");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe(
      "Consolidated spend across org units / legal entities"
    );
    expect(document.body.textContent).toContain("No priced, placed invoices yet");
  });

  it("shows a real error for Executive IQ too, when its own fetch fails", async () => {
    await openApAnalytics(
      ["AP.Analysis", "AP.FraudReview"],
      { holdsEverywhere: true },
      { "/api/executive/consolidated-spend": { ok: false, status: 500 } }
    );

    await switchTab("Executive IQ");
    expect(document.body.textContent).toContain("Could not load this tab right now");
  });

  it("Fraud Prevention renders all five of its own cards, decision 0424 — five real cards, not one", async () => {
    await openApAnalytics(["AP.FraudReview"]);

    expect(document.querySelector(".tab.active")?.textContent).toBe("Fraud Prevention");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Potential duplicate invoices",
      "Unapproved-supplier invoices",
      "Exceptions by type, by user, by supplier",
      "Statistical outliers",
      "Segregation-of-duties flags",
    ]);
    expect(document.body.textContent).toContain("No potential duplicates right now");
    expect(document.body.textContent).toContain("No unapproved-supplier invoices right now");
    expect(document.body.textContent).toContain("No exceptions in the last 8 weeks");
    expect(document.body.textContent).toContain("No statistical outliers right now");
    expect(document.body.textContent).toContain("No segregation-of-duties flags right now");
  });

  it("Fraud Prevention's five cards fail independently — one's own load failure never hides the others' real content", async () => {
    await openApAnalytics(["AP.FraudReview"], {}, { "/api/fraud/duplicates": { ok: false, status: 500 } });

    expect(document.body.textContent).toContain("Could not load this tab right now");
    const headings = [...document.querySelectorAll(".cardhead h3")].map((h) => h.textContent);
    expect(headings).toContain("Unapproved-supplier invoices");
    expect(headings).toContain("Exceptions by type, by user, by supplier");
    expect(headings).toContain("Statistical outliers");
    expect(headings).toContain("Segregation-of-duties flags");
    expect(headings).not.toContain("Potential duplicate invoices");
  });

  it("shows a real error rather than crashing, when a real tab's own fetch fails", async () => {
    await openApAnalytics(["AP.Analysis"], {}, { "/api/workload/throughput": { ok: false, status: 500 } });

    expect(document.body.textContent).toContain("Could not load this tab right now");
  });

  it("shows a real error for Financial Performance too, when its own fetch fails", async () => {
    await openApAnalytics(["AP.Analysis"], {}, { "/api/accruals": { ok: false, status: 500 } });

    await switchTab("Financial Performance");
    expect(document.body.textContent).toContain("Could not load this tab right now");
  });

  it("Financial Performance's two cards fail independently — one's own load failure never hides the other's real content", async () => {
    await openApAnalytics(["AP.Analysis"], {}, { "/api/accruals": { ok: false, status: 500 } });

    await switchTab("Financial Performance");
    expect(document.body.textContent).toContain("Could not load this tab right now");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend under management");
    expect(document.body.textContent).toContain("No spend recorded yet");
  });

  it("shows a real error for Fraud Prevention too, when its own fetch fails", async () => {
    await openApAnalytics(["AP.FraudReview"], {}, { "/api/fraud/duplicates": { ok: false, status: 500 } });

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
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Suppliers by status");

    await switchTab("Fraud Prevention");
    expect(document.querySelectorAll(".tab.active")).toHaveLength(1);
    expect(document.querySelector(".tab.active")?.textContent).toBe("Fraud Prevention");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Potential duplicate invoices");

    await switchTab("Operational Performance");
    expect(document.querySelector(".tab.active")?.textContent).toBe("Operational Performance");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");
  });
});

describe("Talk to an AP Expert — decision 0430, a real chat, not a card comparison", () => {
  it("renders the empty state, a text input and a send button — nothing to fetch ahead of render", async () => {
    await openApAnalytics(["AP.Assistant"]);

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Talk to an AP Expert");
    expect(document.body.textContent).toContain("Ask a question to get started");
    expect(document.querySelector(".chatinput")).not.toBeNull();
    expect(document.querySelector(".chatinputrow button")?.textContent).toBe("Ask");
  });

  it("sends a typed question and shows the real answer that comes back", async () => {
    await openApAnalytics(["AP.Assistant"], {}, {
      "/api/ap-assistant/ask": { question: "how much have we spent with Acme?", tool: "supplier_spend", answer: "You've spent £1,200 with Acme this year." },
    });

    const input = document.querySelector<HTMLInputElement>(".chatinput")!;
    input.value = "how much have we spent with Acme?";
    input.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>(".chatinputrow button")!.click();

    for (let i = 0; i < 100; i++) {
      if (document.body.textContent?.includes("You've spent")) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(document.body.textContent).toContain("how much have we spent with Acme?");
    expect(document.body.textContent).toContain("You've spent £1,200 with Acme this year.");
    // The empty-state message is gone once a real exchange exists.
    expect(document.body.textContent).not.toContain("Ask a question to get started");
  });

  it("shows a plain error message rather than a blank bubble when the request fails", async () => {
    await openApAnalytics(["AP.Assistant"], {}, {
      "/api/ap-assistant/ask": { ok: false, status: 500 },
    });

    const input = document.querySelector<HTMLInputElement>(".chatinput")!;
    input.value = "what do we owe?";
    input.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>(".chatinputrow button")!.click();

    for (let i = 0; i < 100; i++) {
      if (document.body.textContent?.includes("Something went wrong")) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(document.body.textContent).toContain("Something went wrong answering that");
  });

  it("clears the input and re-enables it once an answer lands, ready for the next question", async () => {
    await openApAnalytics(["AP.Assistant"], {}, {
      "/api/ap-assistant/ask": { question: "q", tool: "accrual_summary", answer: "You have £0 in accruals." },
    });

    const input = document.querySelector<HTMLInputElement>(".chatinput")!;
    input.value = "what do we owe?";
    input.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>(".chatinputrow button")!.click();

    for (let i = 0; i < 100; i++) {
      if (document.body.textContent?.includes("£0 in accruals")) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(input.value).toBe("");
    expect(input.disabled).toBe(false);
  });
});

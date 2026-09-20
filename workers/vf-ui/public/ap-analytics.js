import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission, holdsEverywhere } from "/tasks.js";
import { load as loadOperational, renderCard as operationalCard } from "/workload.js";
import { load as loadSupplierSpend, renderCard as supplierSpendCard } from "/supplier-performance.js";
import { load as loadAccruals, renderCard as accrualsCard } from "/accruals.js";
import { load as loadSpendUnderManagement, renderCard as spendUnderManagementCard } from "/spend-under-management.js";
import { load as loadDuplicates, renderCard as duplicatesCard } from "/fraud-duplicates.js";

/**
 * AP Analytics — decision 0417, the single tabbed home for every
 * screen the Management Dashboard design sketched.
 *
 * **Consolidates standalone screens, at the operator's own request.**
 * Workload (decision 0415), Supplier Performance (decision 0416), and
 * now Accruals (decision 0417's own follow-on) each shipped as, or
 * would otherwise have shipped as, their own top-level nav item;
 * asked directly whether Workload and Supplier Performance should
 * stay there or fold into one tabbed screen, the operator chose to
 * fold them in — their own `open()` entry points are gone, replaced
 * by an exported `load()` + `renderCard()` pair each this screen
 * calls directly, the same shape Accruals was built with from the
 * start rather than ever having a standalone screen of its own. The
 * pill tabs are `access.js`'s own `.tabbar`/`.tab` component, reused
 * rather than rebuilt — the same shape the operator pointed at by
 * name.
 *
 * **Five tabs, four real.** The operator's own names, mapped onto the
 * design's five original screens:
 *
 * | Tab | Design's own screen | Permission |
 * |---|---|---|
 * | Operational Performance | User & Team Workload | `AP.Analysis` |
 * | Financial Performance | Liabilities & Accruals | `AP.Analysis` |
 * | Supplier Performance | Supplier Performance | `AP.Supplier` |
 * | Executive IQ | Multi-Enterprise CFO View | `AP.Analysis` + `holdsEverywhere` |
 * | Fraud Prevention | Fraud & Risk Detection | `AP.FraudReview` |
 *
 * Operational, Financial, Supplier Performance, and now Fraud
 * Prevention (decision 0420's own potential-duplicate-invoices table)
 * are real, reusing the routes and screens decisions 0415–0420 already
 * built and tested. Only Executive IQ still renders a plain "not built
 * yet" placeholder — still gated on its own real permission, so who
 * can even see the tab exists is correct today, ahead of what is
 * behind it.
 *
 * **Financial Performance shows two real cards, not one** — decision
 * 0419's own follow-on to 0417's accruals report: spend under
 * management (with PO) vs. total spend, the design's own fifth
 * Liabilities & Accruals bullet. `tabContent()`'s own `financial`
 * branch loads both and returns an array of cards rather than a
 * single element; `renderActive()` spreads whichever shape it gets,
 * so every other single-card tab is unaffected.
 *
 * **The permission each tab actually checks matches its own route's
 * own gate, not the design document's own original proposal.**
 * The design's Role-Based Access Model table lists two permissions
 * for Workload (`AP.TaskManage` + `AP.Analysis`) and two for Supplier
 * Performance (`AP.Supplier` + `AP.Analysis`) — but decisions 0415 and
 * 0416 each deliberately shipped with a single permission instead,
 * and gating a tab more strictly than the data behind it would mean
 * a person could reach data through the API that the tab itself hid
 * from them, or the reverse. A tab's own gate is always exactly what
 * `hasPermission` already checks server-side for that tab's data —
 * never a second, independent guess at it.
 */

const TABS = [
  { key: "operational", labelKey: "apanalytics.operational", permission: "AP.Analysis" },
  { key: "financial", labelKey: "apanalytics.financial", permission: "AP.Analysis" },
  { key: "supplier", labelKey: "apanalytics.supplier", permission: "AP.Supplier" },
  { key: "executiveiq", labelKey: "apanalytics.executiveiq", permission: "AP.Analysis", global: true },
  { key: "fraud", labelKey: "apanalytics.fraud", permission: "AP.FraudReview" },
];

function availableTabs() {
  return TABS.filter((tab) => hasMyPermission(tab.permission) && (!tab.global || holdsEverywhere()));
}

let activeTab = null;

function tabBar(available) {
  return el(
    "div",
    { class: "tabbar" },
    available.map((tab) =>
      el("button", {
        class: `tab${activeTab === tab.key ? " active" : ""}`,
        text: t(tab.labelKey),
        onclick: async () => {
          activeTab = tab.key;
          await renderActive();
        },
      })
    )
  );
}

/** A placeholder card for a tab whose own screen does not exist yet — still real content, never a blank pane. */
function placeholderCard(tab) {
  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t(tab.labelKey) })]),
    el("div", { class: "muted", text: t("apanalytics.notbuilt") }),
  ]);
}

function loadErrorCard() {
  return el("div", { class: "panel card-graphic" }, [el("div", { class: "muted", text: t("apanalytics.loaderror") })]);
}

async function tabContent(key) {
  const tab = TABS.find((candidate) => candidate.key === key);
  if (key === "operational") return (await loadOperational()) ? operationalCard() : loadErrorCard();
  if (key === "financial") {
    // Two independent cards, two independent failures — one screen's
    // own fetch failing never hides the other's real data.
    const [accrualsOk, spendOk] = await Promise.all([loadAccruals(), loadSpendUnderManagement()]);
    return [accrualsOk ? accrualsCard() : loadErrorCard(), spendOk ? spendUnderManagementCard() : loadErrorCard()];
  }
  if (key === "supplier") return (await loadSupplierSpend()) ? supplierSpendCard() : loadErrorCard();
  if (key === "fraud") return (await loadDuplicates()) ? duplicatesCard() : loadErrorCard();
  return placeholderCard(tab);
}

async function renderActive() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const available = availableTabs();
  if (!activeTab || !available.some((tab) => tab.key === activeTab)) {
    activeTab = available[0]?.key ?? null;
  }

  const body = activeTab
    ? await tabContent(activeTab)
    : el("div", { class: "panel card-graphic" }, [el("div", { class: "muted", text: t("apanalytics.none") })]);
  const bodyCards = Array.isArray(body) ? body : [body];

  shell.replaceChildren(
    frame(
      el("div", { class: "dashboardpage" }, [
        topbar(t("apanalytics.heading"), t("apanalytics.sub")),
        tabBar(available),
        el("div", { class: "dashflow" }, bodyCards),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("apanalytics");
  await renderActive();
}

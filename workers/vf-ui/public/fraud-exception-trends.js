import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { sparkline } from "/charts.js";

/**
 * Exceptions by type, by user, by supplier — trended — decision 0423,
 * Fraud Prevention's third real card (`ap-analytics.js`), built the
 * same way `fraud-duplicates.js` and `fraud-unapproved-suppliers.js`
 * already were: `load()` and `renderCard()`, no `open()` of its own.
 *
 * **`charts.js`'s own `sparkline()`, its first real caller** — built
 * by decisions 0242/0265 and left deliberately unused since, waiting
 * for "whichever card next has a real trend and no room to show it
 * plainly" (that comment, verbatim, still sits in `dashboard.js`).
 * This is that card: three ranked tables, each row carrying its own
 * eight-week trend rather than one static number.
 *
 * **Three short tables, not three charts.** Each of the route's own
 * three breakdowns (`workers/vf-app/src/fraud-exception-trends-
 * route.ts`) is already ranked, top-N, and pre-bucketed by week — this
 * module only names the columns and draws the line.
 */

let data = { weekStartDates: [], bySupplier: [], byUser: [], byType: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/fraud/exception-trends${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function trendCell(weeklyCounts) {
  return el("td", { class: "trend" }, [sparkline(weeklyCounts, { height: 28 })]);
}

function supplierRow(entry) {
  return el("tr", {}, [
    el("td", { text: entry.supplierName ?? t("fraudprevention.nosupplier") }),
    el("td", { class: "num", text: String(entry.total) }),
    trendCell(entry.weeklyCounts),
  ]);
}

function userRow(entry) {
  return el("tr", {}, [
    el("td", { text: entry.userName ?? entry.userId }),
    el("td", { class: "num", text: String(entry.total) }),
    trendCell(entry.weeklyCounts),
  ]);
}

function typeRow(entry) {
  return el("tr", {}, [
    el("td", { text: entry.type }),
    el("td", { class: "num", text: String(entry.total) }),
    trendCell(entry.weeklyCounts),
  ]);
}

function breakdownTable(headingKey, nameKey, rows, rowFn) {
  if (rows.length === 0) return null;
  return el("div", {}, [
    el("h4", { text: t(headingKey) }),
    el("div", { class: "tablewrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: t(nameKey) }),
            el("th", { class: "num", text: t("fraudprevention.exceptioncount") }),
            el("th", { text: t("fraudprevention.trend") }),
          ]),
        ]),
        el("tbody", {}, rows.map(rowFn)),
      ]),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  const empty = data.bySupplier.length === 0 && data.byUser.length === 0 && data.byType.length === 0;

  return empty
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("fraudprevention.exceptiontrends") })]),
        el("div", { class: "muted", text: t("fraudprevention.noexceptiontrends") }),
      ])
    : el(
        "div",
        { class: "panel card-graphic" },
        [
          el("div", { class: "cardhead" }, [el("h3", { text: t("fraudprevention.exceptiontrends") })]),
          el("div", { class: "sub", text: t("fraudprevention.exceptiontrendssub") }),
          breakdownTable("fraudprevention.bysupplier", "fraudprevention.supplier", data.bySupplier, supplierRow),
          breakdownTable("fraudprevention.byuser", "fraudprevention.user", data.byUser, userRow),
          breakdownTable("fraudprevention.bytype", "fraudprevention.type", data.byType, typeRow),
        ].filter(Boolean)
      );
}

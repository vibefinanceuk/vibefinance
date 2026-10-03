import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { sparkline } from "/charts.js";
import { listCard, makeClickable } from "/fraud-list.js";

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

let data = { weekStartDates: [], weeklyTotals: [], total: 0, bySupplier: [], byUser: [], byType: [] };

/** Which breakdown is showing — decision 0618. */
let view = "supplier";

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

/**
 * **One breakdown at a time, chosen by tabs** — decision 0618. The card
 * stacked three tables, by supplier, user and type, up to 22 rows with
 * a line each, in a tile about 290px wide. Now it is full width, one
 * breakdown showing, and a row opens Documents at the invoices behind
 * it: those that failed validation in these eight weeks, from that
 * supplier, worked on by that person, or failing that check.
 */
const VIEWS = [
  { key: "supplier", labelKey: "fraudprevention.bysupplier", nameKey: "fraudprevention.supplier", rows: () => data.bySupplier },
  { key: "user", labelKey: "fraudprevention.byuser", nameKey: "fraudprevention.user", rows: () => data.byUser },
  { key: "type", labelKey: "fraudprevention.bytype", nameKey: "fraudprevention.type", rows: () => data.byType },
];

function nameOf(entry) {
  if (view === "supplier") return entry.supplierName ?? t("fraudprevention.nosupplier");
  if (view === "user") return entry.userName ?? entry.userId;
  return entry.type;
}

async function openEntry(entry) {
  const { openDocumentsWithExceptions } = await import("/documents.js");
  const since = data.weekStartDates[0];
  const filter =
    view === "supplier" ? { since, supplierId: entry.supplierId ?? "" } : view === "user" ? { since, userId: entry.userId } : { since, type: entry.type };
  openDocumentsWithExceptions(filter, t("documents.showing.exceptionsfor").replace("{name}", nameOf(entry)));
}

function entryRow(entry) {
  return makeClickable(
    el("tr", {}, [
      el("td", { text: nameOf(entry) }),
      el("td", { class: "num", text: String(entry.total) }),
      el("td", { class: "trend" }, [sparkline(entry.weeklyCounts, { height: 28 })]),
    ]),
    () => openEntry(entry)
  );
}

/** The tile's count: every failed validation in the eight weeks, and its line — decision 0618. */
export function summary() {
  const weekly = data.weeklyTotals?.length ? data.weeklyTotals : null;
  const count = data.total ?? (weekly ? weekly.reduce((a, b) => a + b, 0) : 0);
  return { key: "trends", label: t("fraudprevention.exceptiontrends"), count, weekly };
}

export function renderCard() {
  const empty = data.bySupplier.length === 0 && data.byUser.length === 0 && data.byType.length === 0;
  const head = el("div", { class: "cardhead" }, [el("h3", { text: t("fraudprevention.exceptiontrends") })]);
  if (empty) return listCard("trends", [head, el("div", { class: "muted", text: t("fraudprevention.noexceptiontrends") })]);

  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const body = el("div", { class: "fraudtrendbody" });
  const tabs = el(
    "div",
    { class: "fraudtabs", role: "tablist" },
    VIEWS.map((v) =>
      el("button", {
        class: `chip${v.key === current.key ? " on" : ""}`,
        role: "tab",
        "aria-selected": String(v.key === current.key),
        text: t(v.labelKey),
        onclick: (e) => {
          view = v.key;
          const card = e.target.closest(".fraudlist");
          card?.replaceWith(renderCard());
        },
      })
    )
  );
  const rows = current.rows();
  body.append(
    rows.length === 0
      ? el("div", { class: "muted", text: t("fraudprevention.noexceptiontrends") })
      : el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t(current.nameKey) }),
                el("th", { class: "num", text: t("fraudprevention.exceptioncount") }),
                el("th", { text: t("fraudprevention.trend") }),
              ]),
            ]),
            el("tbody", {}, rows.map(entryRow)),
          ]),
        ])
  );
  return listCard("trends", [head, el("div", { class: "sub", text: t("fraudprevention.exceptiontrendssub") }), tabs, body]);
}

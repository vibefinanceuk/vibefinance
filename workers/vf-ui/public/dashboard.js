import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
/**
 * **`sparkline` and `donut` are built and not used here** — decision
 * 0242.
 *
 * A sparkline needs history and decision 0240 returns none: a trend
 * drawn from one point is a decoration that implies a claim. A donut
 * needs a proportion, and the one worth showing — straight-through rate
 * — is a flow metric that `stage_visits` cannot yet answer.
 *
 * Both are in `charts.js`, tested, and waiting for the data.
 */
import { barChart, barList } from "/charts.js";

/**
 * What a person should do next — decision 0242, on decision 0240's
 * queries.
 *
 * **One request, nine cards.** The route computes the scope once and
 * returns everything, so this screen is a render rather than a
 * conversation.
 */

let cards = [];

async function load() {
  try {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return false;
    cards = (await response.json()).cards ?? [];
    return true;
  } catch {
    return false;
  }
}

/** A card with a heading, and whatever it holds. */
function panel(title, sub, ...children) {
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: title })]),
    sub ? el("div", { class: "sub", text: sub }) : null,
    ...children,
  ].filter(Boolean));
}

/**
 * **A big number and a quiet label**, which is what a KPI is for.
 *
 * The sparkline is optional and absent here: decision 0240 returns no
 * history, and **a trend drawn from one point is a decoration that
 * implies a claim.**
 */
function figure(value, label, { warn = false } = {}) {
  return el("div", {}, [
    el("div", { class: warn ? "bignum warn" : "bignum", text: String(value) }),
    el("div", { class: "muted", text: label }),
  ]);
}

/** How long a task has been waiting, as a person would say it. */
function heldFor(createdAt) {
  const days = Math.floor((Date.now() - new Date(`${createdAt}Z`.replace(" ", "T"))) / 86400000);
  if (Number.isNaN(days)) return "—";
  return days === 0 ? t("dash.today") : `${days}d`;
}

/**
 * **Days until payment is due, and overdue said as overdue.**
 *
 * Decision 0239: how long I have held it is my responsiveness; `BT-9`
 * is the supplier's expectation, and they disagree routinely.
 */
function dueIn(dueDate) {
  if (!dueDate) return { text: "—", tone: "muted" };
  /**
   * **Whole days between two dates, not hours divided.**
   *
   * `BT-9` is a date with no time; `Date.now()` has one. Dividing the
   * difference makes *"due today"* read as *"1d overdue"* from lunchtime
   * onwards — which is a wrong number on a screen somebody uses to
   * decide what to pay.
   */
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today) / 86400000);
  if (Number.isNaN(days)) return { text: "—", tone: "muted" };
  if (days < 0) return { text: t("dash.overdue").replace("{n}", String(-days)), tone: "warn" };
  return { text: t("dash.duein").replace("{n}", String(days)), tone: days <= 7 ? "" : "muted" };
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

/**
 * The card types, each rendering its own data — decision 0242.
 *
 * **A type the screen does not know is skipped**, not thrown on: the
 * route's set can grow ahead of this one, and decision 0240 already
 * decided that one card failing is not the dashboard failing.
 */
const RENDERERS = {
  waiting_for_me: (data) =>
    panel(
      t("dash.waiting"),
      t("dash.waitingsub"),
      figure(data.count, t("dash.acrossstages").replace("{n}", String(data.stages)))
    ),

  on_my_clock: (data, card) => {
    const rows = (data.items ?? []).map((item) => {
      const due = dueIn(item.due_date);
      return el("tr", {}, [
        el("td", {}, [
          el("div", { text: item.supplier_name ?? "—" }),
          el("div", {
            class: "muted tiny",
            text: [item.invoice_number, item.stage_name].filter(Boolean).join(" · "),
          }),
        ]),
        el("td", { class: "num", text: heldFor(item.created_at) }),
        el("td", { class: `num ${due.tone}`, text: due.text }),
        el("td", { class: "num", text: money(item.total_with_vat, item.currency) }),
      ]);
    });

    /**
     * **Both clocks, side by side.** Sorting chooses which leads; it
     * does not hide the other, because an item held two days and due
     * tomorrow is urgent and would vanish from a list sorted by age.
     */
    const sorts = ["held", "due", "value"].map((key) =>
      el("button", {
        class: (card.settings.sort ?? "held") === key ? "chip on" : "chip",
        text: t(`dash.sort.${key}`),
        onclick: () => sortBy(card, key),
      })
    );

    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("dash.myclock") }),
        el("div", { class: "chips" }, sorts),
      ]),
      el("div", { class: "sub", text: t("dash.myclocksub") }),
      rows.length === 0
        ? el("div", { class: "muted", text: t("dash.nothingmine") })
        : el("table", { class: "clocktable" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("dash.supplier") }),
                el("th", { class: "num", text: t("dash.held") }),
                el("th", { class: "num", text: t("dash.due") }),
                el("th", { class: "num", text: t("dash.value") }),
              ]),
            ]),
            el("tbody", {}, rows),
          ]),
    ]);
  },

  where_things_are: (data) => {
    const stages = data.stages ?? [];
    return panel(
      t("dash.wherethings"),
      t("dash.bystage"),
      stages.length === 0
        ? el("div", { class: "muted", text: t("dash.nothinginflight") })
        : barChart(stages.map((s) => ({ label: s.stage_name, value: s.n })))
    );
  },

  items_at_stage: (data) =>
    panel(
      data.stageName ?? t("dash.astage"),
      null,
      data.missing
        ? // **A stage that no longer exists says so** rather than
          // showing a zero, which would look like good news.
          el("div", { class: "warn", text: t("dash.stagegone") })
        : figure(data.count, t("dash.waitinghere"))
    ),

  ageing: (data) => {
    const buckets = data.buckets ?? [];
    return panel(
      t("dash.ageing"),
      t("dash.ageingsub"),
      barChart(
        buckets.map((b, i) => ({
          label: b.label,
          value: b.n,
          // The last two buckets are the ones worth looking at.
          warn: i >= 3 && b.n > 0,
        }))
      )
    );
  },

  done: (data) =>
    panel(
      t("dash.done"),
      null,
      el("div", { class: "figures" }, [
        figure(data.today, t("dash.todaylabel")),
        figure(data.week, t("dash.weeklabel")),
        figure(data.mine, t("dash.minelabel")),
      ])
    ),

  received: (data) => {
    const days = data.days ?? [];
    return panel(
      t("dash.received"),
      t("dash.receivedsub"),
      days.length === 0
        ? el("div", { class: "muted", text: t("dash.nonereceived") })
        : barChart(
            days.map((d) => ({
              label: new Date(d.day).toLocaleDateString(undefined, { weekday: "short" }),
              value: d.n,
            }))
          )
    );
  },

  exceptions_by_supplier: (data) => {
    const suppliers = data.suppliers ?? [];
    return panel(
      t("dash.exceptions"),
      t("dash.exceptionssub"),
      suppliers.length === 0
        ? el("div", { class: "muted", text: t("dash.noexceptions") })
        : barList(suppliers.map((s) => ({ label: s.supplier, value: s.n, warn: true })))
    );
  },

  needs_somebody: (data) => {
    const rows = [
      { label: t("dash.unplaced"), value: data.unplaced },
      { label: t("dash.awaitingerp"), value: data.awaitingErp },
      { label: t("dash.duplicates"), value: data.duplicates },
    ].filter((r) => r.value > 0);

    return panel(
      t("dash.needssomebody"),
      t("dash.needssomebodysub"),
      rows.length === 0
        ? // **Nothing to do is an answer**, and a good one.
          el("div", { class: "muted", text: t("dash.allclear") })
        : barList(rows.map((r) => ({ ...r, warn: true })))
    );
  },
};

async function sortBy(card, key) {
  card.settings = { ...card.settings, sort: key };

  /**
   * **Sorted where the data is.** The list is capped at 25 rows by
   * decision 0240, so sorting in the browser would reorder a sample and
   * call it an order.
   */
  await load();
  const fresh = cards.find((c) => c.cardType === "on_my_clock");
  if (fresh) fresh.settings = card.settings;
  render();
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const rendered = cards
    .map((card) => {
      const renderer = RENDERERS[card.cardType];
      if (!renderer || card.data === null) return null;
      try {
        return renderer(card.data, card);
      } catch {
        // One card failing is not the dashboard failing — decision
        // 0240, and the same rule on this side of the wire.
        return null;
      }
    })
    .filter(Boolean);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("dash.heading"), t("dash.sub")),
        el("div", { class: "dashgrid" }, rendered),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("dashboard");
  if (!(await load())) return;
  render();
}

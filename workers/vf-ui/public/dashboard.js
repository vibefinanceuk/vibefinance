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
let catalogue = null;

/**
 * **Arranging is a mode, not a screen** — decision 0243.
 *
 * A dashboard somebody is rearranging is still the dashboard: the cards
 * stay where they are and gain a handle. A separate settings page would
 * make a person choose blind, and the whole question is *"do I want
 * this one here."*
 */
let arranging = false;

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

/**
 * A card with a heading, and whatever it holds.
 *
 * **`weight` decides how much room it asks for** — decision 0244.
 *
 * A count and a table are both cards and are not the same size of
 * thing. The first version gave every card an equal half, so *"waiting
 * for me: 3"* sat in a panel the width of a worklist with a void beside
 * it.
 */
function panel(title, sub, { weight = "half" } = {}, ...children) {
  return el("div", { class: `panel card-${weight}` }, [
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
      null,
      { weight: "tile" },
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
    /**
     * **One stage is a number, not a chart** — decision 0244. A bar
     * chart of one bar is a rectangle, and the rectangle says nothing
     * the figure does not.
     */
    if (stages.length === 1) {
      return panel(t("dash.wherethings"), null, { weight: "tile" },
        figure(stages[0].n, stages[0].stage_name));
    }
    return panel(
      t("dash.wherethings"),
      t("dash.bystage"),
      { weight: "half" },
      stages.length === 0
        ? el("div", { class: "muted", text: t("dash.nothinginflight") })
        : barChart(stages.map((s) => ({ label: s.stage_name, value: s.n })))
    );
  },

  items_at_stage: (data) =>
    panel(
      data.stageName ?? t("dash.astage"),
      null,
      { weight: "tile" },
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
      { weight: "half" },
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
      { weight: "tile" },
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
      { weight: "half" },
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
      { weight: "half" },
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
      { weight: "half" },
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

  /**
   * **A handle on each card while arranging**, and nothing while not.
   * Decision 0161's argument about the unreadable notice: a control
   * with nothing to do should not be there at all.
   */
  const withHandles = rendered.map((node, index) => {
    if (!arranging) return node;
    node.append(
      el("div", { class: "cardactions" }, [
        el("button", { class: "chip", text: "↑", onclick: () => move(index, -1) }),
        el("button", { class: "chip", text: "↓", onclick: () => move(index, 1) }),
        el("button", { class: "chip", text: t("dash.remove"), onclick: () => remove(index) }),
      ])
    );
    return node;
  });

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("dash.heading"), t("dash.sub")),
        el("div", { class: "statebuttons" }, [
          el("button", {
            class: arranging ? "primary" : "secondary",
            text: arranging ? t("dash.done_arranging") : t("dash.arrange"),
            onclick: () => {
              arranging = !arranging;
              render();
            },
          }),
          arranging ? el("button", { class: "secondary", text: t("dash.addcard"), onclick: () => openPicker() }) : null,
          arranging
            ? el("button", {
                class: "secondary",
                text: t("dash.reset"),
                onclick: async () => {
                  await fetch("/api/dashboard", { method: "DELETE" });
                  await load();
                  render();
                },
              })
            : null,
        ].filter(Boolean)),
        el("div", { class: "dashgrid" }, withHandles),
      ])
    )
  );
}

/** The whole set, because that is what the route takes. */
async function save() {
  try {
    const response = await fetch("/api/dashboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cards: cards.map((c) => ({ cardType: c.cardType, settings: c.settings })),
      }),
    });
    if (!response.ok) return false;
    await load();
    render();
    return true;
  } catch {
    return false;
  }
}

function move(index, by) {
  const to = index + by;
  if (to < 0 || to >= cards.length) return;
  const [card] = cards.splice(index, 1);
  cards.splice(to, 0, card);
  save();
}

function remove(index) {
  cards.splice(index, 1);
  save();
}

/** What can be added, and which stage a stage-card would name. */
async function openPicker() {
  if (!catalogue) {
    try {
      catalogue = await (await fetch("/api/dashboard/catalogue")).json();
    } catch {
      return;
    }
  }

  const chosen = { cardType: null, stage: null };
  const problem = el("div", { class: "warn" });
  const stagePick = el("div", {});

  const types = el(
    "div",
    { class: "pickgrid" },
    catalogue.types.map((type) => {
      const button = el("button", { class: "pickcard" }, [
        el("div", { text: t(`dash.${type.cardType}`) }),
        el("div", { class: "muted tiny", text: t(`dash.about.${type.cardType}`) }),
      ]);

      button.onclick = () => {
        chosen.cardType = type.cardType;
        for (const other of types.querySelectorAll(".pickcard")) other.classList.remove("on");
        button.classList.add("on");

        /**
         * **A stage card asks which stage**, from the customer's own
         * list — decision 0239's argument that a hardcoded six would be
         * wrong for the second customer.
         */
        if (type.parameter === "stage") {
          const select = el(
            "select",
            {},
            catalogue.stages.map((stage) =>
              el("option", { value: stage.id, text: `${stage.process_name} · ${stage.name}` })
            )
          );
          select.onchange = () => {
            chosen.stage = select.value;
          };
          chosen.stage = catalogue.stages[0]?.id ?? null;
          stagePick.replaceChildren(el("label", { text: t("dash.whichstage") }), select);
        } else {
          chosen.stage = null;
          stagePick.replaceChildren();
        }
      };

      return button;
    })
  );

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("h3", { text: t("dash.addcard") }),
      types,
      stagePick,
      problem,
      el("div", { class: "statebuttons" }, [
        el("button", {
          class: "primary",
          text: t("dash.add"),
          onclick: async () => {
            if (!chosen.cardType) {
              problem.textContent = t("dash.pickone");
              return;
            }
            cards.push({
              cardType: chosen.cardType,
              settings: chosen.stage ? { stage: chosen.stage } : {},
            });
            if (!(await save())) {
              problem.textContent = t("dash.savefailed");
              return;
            }
            backdrop.remove();
          },
        }),
        el("button", {
          class: "secondary",
          text: t("viewer.supplier.close"),
          onclick: () => backdrop.remove(),
        }),
      ]),
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
}

export async function open() {
  setCurrentScreen("dashboard");
  if (!(await load())) return;
  render();
}

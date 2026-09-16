import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, openTasksFiltered, openTaskById } from "/tasks.js";
import { icon } from "/icons.js";
import { currentOrgId } from "/orgs.js";
import { openDocumentsFiltered, openDocumentsAtStage, openDocumentsCompletedByMe } from "/documents.js";
import { openSuppliersAwaitingErp } from "/suppliers.js";
/**
 * **`sparkline` is built and not used here** — decisions 0242 and 0265.
 *
 * `done()` used it once, for a rolling seven-day trend behind three
 * numbers (decision 0257). Redefined by the operator into seven real,
 * named daily counts plus a total, a `barChart` says the same thing in
 * the open rather than as a faint line behind the figures — leaving
 * `sparkline` without a caller again, the same place `donutChart` sat
 * until it found `whereThingsAre()`.
 *
 * It stays in `charts.js`, tested, for whichever card next has a real
 * trend and no room to show it plainly.
 */
import { barChart, barList, donutChart } from "/charts.js";

/**
 * What a person should do next — decision 0242, on decision 0240's
 * queries.
 *
 * **One request, nine cards.** The route computes the scope once and
 * returns everything, so this screen is a render rather than a
 * conversation.
 */

let cards = [];

/**
 * **Who is signed in**, fetched independently rather than reached for
 * in `tasks.js`'s own, unexported `me` — every screen already owns
 * its own data rather than reaching into another screen's module
 * state, and `tasks.js`'s own `me` is not guaranteed to be set by the
 * time this screen opens in the first place (a test opening this
 * screen directly, never having called `tasks.js`'s own `start()`,
 * is exactly that case).
 */
let me = null;
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
    /**
     * **The chosen org, decision 0316** — extending decisions 0314
     * and 0315's own treatment of Tasks and Documents to the
     * dashboard's own cards.
     */
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/dashboard${query}`);
    if (!response.ok) return false;
    cards = (await response.json()).cards ?? [];
  } catch {
    return false;
  }

  /**
   * **Best-effort, not a reason to fail the whole screen.** The
   * dashboard's own cards are the thing this screen exists to show;
   * a name in the subtitle is a nicety on top of that, the same
   * reasoning `loadStrings()` already gives a failed fetch — a screen
   * with a blank name is better than no screen.
   */
  try {
    const whoami = await fetch("/api/whoami");
    if (whoami.ok) me = await whoami.json();
  } catch {
    // The subtitle falls back to no name at all.
  }

  return true;
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
/**
 * **A background chart, behind the foreground, in that order** —
 * decision 0257.
 *
 * `background` sits as an absolutely positioned first child; the rest
 * is wrapped in `.tilefg` so it never has to know a background is
 * there. This is deliberately not a property every card gets: it is
 * only ever passed where the data behind it is real history — decision
 * 0242's rule that a trend drawn from nothing is a decoration wearing a
 * claim.
 */
function panel(title, sub, { weight = "half", background = null } = {}, ...children) {
  const foreground = el("div", { class: "tilefg" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: title })]),
    sub ? el("div", { class: "sub", text: sub }) : null,
    ...children,
  ].filter(Boolean));

  const backgroundLayer = background ? el("div", { class: "tilebg" }, [background]) : null;

  return el("div", { class: `panel card-${weight}` }, [backgroundLayer, foreground].filter(Boolean));
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
  /**
   * **"Due today", not "due in 0d"** — decision 0248.
   *
   * Zero days is a number nobody says out loud, and on the card that
   * decides what to pay it is the most urgent row there is. It should
   * not read like an arithmetic result.
   */
  if (days === 0) return { text: t("dash.duetoday"), tone: "warn" };
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
/**
 * **The card type is the name** — decision 0249.
 *
 * The picker asks for `dash.<card_type>` and the headings used
 * different keys, so five of the nine listed their own key to a person
 * choosing what to see. Two names for one thing is what decision 0236
 * already cost a morning.
 */
const RENDERERS = {
  waiting_for_me: (data) => {
    /**
     * **Everything mine, across every stage** — decision 0264. The
     * card's own definition has no stage filter (`waitingForMe()`
     * counts open tasks assigned to me, claimed by me, or owned by a
     * team I am on, at any stage), so the click asks for exactly that
     * and nothing narrower — an empty stage filter, `ownership: "mine"`.
     */
    const subtitle = t("dash.acrossstages").replace("{n}", String(data.stages));
    const byStage = data.byStage ?? [];

    /**
     * **One stage is a number, not a chart — decision 0244, applied
     * here too.** The same rule `where_things_are` already follows: a
     * bar chart of one bar is a rectangle, and the rectangle says
     * nothing the figure above it does not. Kept as the original
     * tile, unchanged, for this case.
     */
    if (byStage.length <= 1) {
      const card = panel(t("dash.waiting_for_me"), null, { weight: "tile" }, figure(data.count, subtitle));

      if (data.count > 0) {
        card.classList.add("clickable");
        card.onclick = () => openTasksFiltered({ ownership: "mine" });
      }

      return card;
    }

    /**
     * **Which queues, and how many in each — decision 0363.**
     * Reported live: "update the dashboard, specifically the Waiting
     * for me card, to include a bar chart, indicating which queues,
     * and queue count that items exist in." Laid out the same way
     * `done` already combines a total with its own bar chart, rather
     * than inventing a second shape for the same idea.
     */
    const card = panel(
      t("dash.waiting_for_me"),
      subtitle,
      { weight: "half" },
      el("div", {}, [
        figure(data.count, subtitle),
        barChart(byStage.map((s) => ({ label: s.stage_name, value: s.n }))),
      ])
    );

    card.classList.add("clickable");
    card.onclick = () => openTasksFiltered({ ownership: "mine" });

    return card;
  },

  on_my_clock: (data, card) => {
    const rows = (data.items ?? []).map((item) => {
      const due = dueIn(item.due_date);
      const row = el("tr", { class: "clickable" }, [
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

      /**
       * **A row that names an invoice should open it** — decision 0250.
       * A row that reads like a link and does nothing is worse than one
       * that does not, because somebody clicks it twice before
       * believing.
       */
      row.onclick = () =>
        openTaskById({
          id: item.id,
          stageId: item.stage_id,
          subject: { id: item.invoice_id, type: "invoice" },
        });

      return row;
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
        el("h3", { text: t("dash.on_my_clock") }),
        el("div", { class: "chips" }, sorts),
      ]),
      el("div", { class: "sub", text: t("dash.myclocksub") }),
      rows.length === 0
        ? el("div", { class: "muted", text: t("dash.nothingmine") })
        : el("div", { class: "clockscroll" }, [el("table", { class: "clocktable" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("dash.supplier") }),
                el("th", { class: "num", text: t("dash.held") }),
                el("th", { class: "num", text: t("dash.due") }),
                el("th", { class: "num", text: t("dash.value") }),
              ]),
            ]),
            el("tbody", {}, rows),
          ])]),
    ]);
  },

  where_things_are: (data) => {
    const stages = data.stages ?? [];
    /**
     * **One stage is a number, not a chart** — decision 0244. A bar
     * chart of one bar is a rectangle, and the rectangle says nothing
     * the figure does not.
     */
    if (stages.length <= 1) {
      const card = panel(t("dash.where_things_are"), null, { weight: "tile" },
        stages.length === 0
          ? el("div", { class: "muted", text: t("dash.nothinginflight") })
          : figure(stages[0].n, stages[0].stage_name));

      if (stages.length === 1) {
        card.classList.add("clickable");
        card.onclick = () => openDocumentsAtStage(stages[0].stage_id, stages[0].stage_name);
      }

      return card;
    }
    /**
     * **A ring, because this is a whole being divided** — decision
     * 0247.
     *
     * Every in-flight invoice is at exactly one stage, and the reader's
     * question is *"how much of my work is stuck in Approval"* — which
     * is a proportion. Ageing stays bars, because its buckets have an
     * order a ring destroys.
     */
    return panel(
      t("dash.where_things_are"),
      t("dash.bystage"),
      { weight: "half" },
      donutChart(
        stages.map((s) => ({ label: s.stage_name, value: s.n, stageId: s.stage_id })),
        {
          /**
           * **Documents, not Tasks** — decision 0264. `whereThingsAre()`
           * counts every in-flight document at a stage, regardless of
           * who owns any work on it; the Tasks screen only ever shows
           * *my* work, which would silently narrow this to whatever
           * fraction of a stage happens to be mine — the same
           * disagreement decisions 0252 through 0260 kept finding
           * elsewhere, caught here before it shipped once.
           */
          onSelect: (segment) => openDocumentsAtStage(segment.stageId, segment.label),
        }
      )
    );
  },

  items_at_stage: (data) => {
    if (data.missing) {
      // **A stage that no longer exists says so** rather than showing a
      // zero, which would look like good news.
      return panel(data.stageName ?? t("dash.astage"), null, { weight: "tile" },
        el("div", { class: "warn", text: t("dash.stagegone") }));
    }

    const held = data.held ?? { mine: 0, theirs: 0, unclaimed: 0 };

    /**
     * **Who holds it, beside how many** — decision 0250.
     *
     * A count says *how much* and this says *whether it is anybody's*.
     * **Unclaimed is the one that grows quietly**, and a stage where
     * every item is somebody else's needs nothing from the reader.
     */
    const card = panel(
      data.stageName ?? t("dash.astage"),
      null,
      { weight: "tile" },
      el("div", { class: "stagesplit" }, [
        figure(data.count, t("dash.waitinghere")),
        donutChart(
          [
            { label: t("dash.mine"), value: held.mine },
            { label: t("dash.theirs"), value: held.theirs },
            { label: t("dash.unclaimed"), value: held.unclaimed },
          ].filter((seg) => seg.value > 0),
          { size: 92, legend: false }
        ),
      ])
    );

    /**
     * **The obvious next question, answerable.** *"Eleven at Approval,
     * three of them mine"* invites *"show me those three"*, which the
     * task list could already answer and had no way of being asked.
     */
    if (held.mine > 0) {
      card.classList.add("clickable");
      card.onclick = () => openTasksFiltered({ stage: data.stageId, ownership: "mine" });
      card.append(el("div", { class: "muted tiny", text: t("dash.showmine") }));
    }

    return card;
  },

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

  done: (data) => {
    /**
     * **What I acted on this week, by day** — decision 0265, redefined
     * from the three-number split decision 0257 built, at the
     * operator's own request: *"a daily count of items I have acted
     * upon."*
     *
     * **A half-weight card now, not a tile.** A tile suited three small
     * numbers; seven real daily counts and a total deserve the same
     * room `received` and `ageing` already get for their own bar
     * charts, which this reuses rather than inventing a second way to
     * draw a week.
     */
    const days = data.days ?? [];
    const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    const card = panel(
      t("dash.done"),
      t("dash.donesub"),
      { weight: "half" },
      el("div", {}, [
        figure(data.total ?? 0, t("dash.thisweek")),
        barChart(days.map((d, i) => ({ label: t(`dash.day.${dayKeys[i]}`), value: d.n }))),
      ])
    );

    /**
     * **Clickable only where there is something to show** — decision
     * 0161's rule, and the whole card links to one filtered view rather
     * than each day separately, at the operator's own choice.
     */
    if ((data.total ?? 0) > 0) {
      card.classList.add("clickable");
      card.onclick = () => openDocumentsCompletedByMe();
    }

    return card;
  },

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
    if (suppliers.length === 1) {
      // The same argument as above.
      return panel(t("dash.exceptions_by_supplier"), null, { weight: "tile" },
        figure(suppliers[0].n, suppliers[0].supplier, { warn: true }));
    }

    return panel(
      t("dash.exceptions_by_supplier"),
      t("dash.exceptionssub"),
      { weight: "half" },
      suppliers.length === 0
        ? el("div", { class: "muted", text: t("dash.noexceptions") })
        : barList(suppliers.map((s) => ({ label: s.supplier, value: s.n, warn: true })))
    );
  },

  /**
   * **Three cards, not one** — decision 0259.
   *
   * The operator: *"The needs somebody card holds important items. I
   * think it deserves a separate card each, with a graphic, and a link
   * to those documents."* A combined count could never honestly link
   * anywhere, since a click has to land on one kind of thing.
   *
   * **Clickable only when there is something to click through to** —
   * decision 0161's rule, applied consistently everywhere else a tile
   * links out. And the icon stays muted even when the count is not
   * zero: the figure already carries the alert, so colouring the
   * graphic too would say the same thing twice.
   */
  unplaced_documents: (data) => {
    const card = panel(
      t("dash.unplaced_documents"),
      null,
      { weight: "tile" },
      el("div", { class: "stagesplit" }, [
        figure(data.count, t("dash.about.unplaced_documents"), { warn: data.count > 0 }),
        el("div", { class: "tileicon" }, [icon("unplaced")]),
      ])
    );

    if (data.count > 0) {
      card.classList.add("clickable");
      card.onclick = () => openDocumentsFiltered("unplaced");
    }

    return card;
  },

  suppliers_awaiting_erp: (data) => {
    const card = panel(
      t("dash.suppliers_awaiting_erp"),
      null,
      { weight: "tile" },
      el("div", { class: "stagesplit" }, [
        figure(data.count, t("dash.about.suppliers_awaiting_erp"), { warn: data.count > 0 }),
        el("div", { class: "tileicon" }, [icon("awaitingerp")]),
      ])
    );

    if (data.count > 0) {
      card.classList.add("clickable");
      card.onclick = () => openSuppliersAwaitingErp();
    }

    return card;
  },

  possible_duplicates: (data) => {
    const card = panel(
      t("dash.possible_duplicates"),
      null,
      { weight: "tile" },
      el("div", { class: "stagesplit" }, [
        figure(data.count, t("dash.about.possible_duplicates"), { warn: data.count > 0 }),
        el("div", { class: "tileicon" }, [icon("duplicate")]),
      ])
    );

    if (data.count > 0) {
      card.classList.add("clickable");
      card.onclick = () => openDocumentsFiltered("duplicates");
    }

    return card;
  },
};

/**
 * **The sort is saved, then read back** — decision 0250.
 *
 * The first version set the local object and reloaded, which fetched a
 * dashboard sorted by **what the server had stored** — so the buttons
 * highlighted and nothing moved.
 *
 * Sorted where the data is, because the list is capped at 25 rows by
 * decision 0240 and reordering in the browser would rearrange a sample
 * and call it an order. Which means the server has to be told, and
 * telling it is saving it — **so the choice sticks between visits**,
 * which is what somebody who always sorts by due date would want
 * anyway.
 */
async function sortBy(card, key) {
  const index = cards.indexOf(card);
  if (index >= 0) cards[index] = { ...card, settings: { ...card.settings, sort: key } };

  if (!(await save())) {
    // The save reloads and redraws on success; on failure the buttons
    // should not lie about which sort is in force.
    await load();
    render();
  }
}

/**
 * **A control that looks like the viewer's own** — decision 0262.
 *
 * `actionLink` in `viewer.js` is keyed to the `action.*` string
 * convention and tested against a fixed list of real invoice actions
 * (decisions 0229/0236); this toolbar is not that — it arranges a
 * dashboard, not a document. Same shape, same `.actionlink` class, so
 * it reads as one family of control across the app, reading from
 * `dash.*` strings instead.
 */
function toolButton(iconName, label, { primary = false, onclick } = {}) {
  const node = el("button", {
    class: primary ? "actionlink primary" : "actionlink",
    title: label,
    onclick,
  });
  node.append(icon(iconName), el("span", { text: label }));
  return node;
}

/**
 * Arrange, and what it unhides — decision 0303, moved from a row of
 * its own beneath the heading into the topbar itself.
 *
 * **Extracted rather than left inline** so the same three buttons can
 * be passed into `topbar()`'s own `right` array from `render()`,
 * which is the only place both `topbar()` and this logic are already
 * in scope together.
 */
function arrangeButtons() {
  return [
    toolButton(arranging ? "donearranging" : "arrange", arranging ? t("dash.done_arranging") : t("dash.arrange"), {
      primary: arranging,
      onclick: () => {
        arranging = !arranging;
        render();
      },
    }),
    arranging ? toolButton("addcard", t("dash.addcard"), { onclick: () => openPicker() }) : null,
    arranging
      ? toolButton("restoredefault", t("dash.reset"), {
          onclick: async () => {
            await fetch("/api/dashboard", { method: "DELETE" });
            await load();
            render();
          },
        })
      : null,
  ].filter(Boolean);
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

  /**
   * **Two bands, not one grid** — decision 0246.
   *
   * The first version put tiles and charts in the same grid with
   * `align-items: start`, so every row had a ragged bottom and a short
   * tile beside a tall chart left a void the height of the chart.
   *
   * A strip of figures across the top and the wider cards beneath is
   * what every dashboard worth looking at does, and it is not a style
   * choice: **a figure and a chart are different heights by nature**,
   * and a grid that lets them fight produces holes.
   */
  const tiles = withHandles.filter((node) => node.classList.contains("card-tile"));
  const rest = withHandles.filter((node) => !node.classList.contains("card-tile"));

  shell.replaceChildren(
    frame(
      el("div", { class: "dashboardpage" }, [
        /**
         * **Arrange, top right, left of Night/Day** — decision 0303,
         * reported live: "move the Arrange button to the top right,
         * next to the left of the Night / Day button... Done
         * arranging, Add a card, and Back to the default. These
         * buttons should also display on the top right." Passed into
         * `topbar()`'s own `right` array, the same way decision 0298
         * moved the viewer's own Save and task actions there —
         * `right` renders before `moodPicker`, `languagePicker`, and
         * Sign out, so this lands exactly to their left.
         */
        topbar(
          t("dash.heading"),
          /**
           * **"Items pending for my user - Alice," decision 0307** —
           * reported live, replacing "What is waiting, and what is on
           * the clock." `{name}` is the same placeholder convention
           * `suppliers.loaded`'s own `{n}` and `suppliers.loadedago`'s
           * own `{days}` already use — filled here rather than baked
           * into the string, since the name is a fact about who is
           * looking at the screen, not a fact `ui_strings` itself
           * knows.
           */
          t("dash.sub").replace("{name}", me?.name ?? ""),
          arrangeButtons()
        ),
        tiles.length > 0 ? el("div", { class: "dashstrip" }, tiles) : null,
        rest.length > 0 ? el("div", { class: "dashgrid" }, rest) : null,
      ].filter(Boolean))
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

/**
 * **Two columns, and a working copy** — decision 0262.
 *
 * The operator: *"I picture two columns — Hidden cards on the left and
 * Displayed cards on the right. A user can use center arrows to add or
 * remove cards, based on the user needs."*
 *
 * **A local copy, not the live one.** `save()` reloads the whole
 * dashboard and re-renders the page on every call — right for a single
 * add, wrong for a session of several moves back and forth, since each
 * save would tear down the popout it was called from. This works on a
 * clone and only touches the real `cards` array once, when the person
 * confirms.
 */
async function openPicker() {
  if (!catalogue) {
    try {
      catalogue = await (await fetch("/api/dashboard/catalogue")).json();
    } catch {
      return;
    }
  }

  const stageName = (id) => {
    const stage = catalogue.stages.find((s) => s.id === id);
    return stage ? `${stage.process_name} · ${stage.name}` : id;
  };

  // A working copy, so nothing is saved until the person says so.
  const working = cards.map((c) => ({ cardType: c.cardType, settings: { ...c.settings } }));
  const chosen = { cardType: null, stage: null };
  let selectedHiddenType = null;
  let selectedDisplayedIndex = null;

  const problem = el("div", { class: "warn" });
  const stagePick = el("div", {});
  const hiddenList = el("div", { class: "movercol" });
  const displayedList = el("div", { class: "movercol" });
  const addBtn = el("button", { class: "moverarrow", text: "→" });
  const removeBtn = el("button", { class: "moverarrow", text: "←" });

  /**
   * **A repeatable type never leaves the hidden column** — `items_at_
   * stage` can hold several instances at once (one per stage), so
   * "hidden" for it means "another one can still be added," not "none
   * exist yet."
   */
  function isHidden(type) {
    if (type.repeatable) return true;
    return !working.some((c) => c.cardType === type.cardType);
  }

  function refresh() {
    problem.textContent = "";

    hiddenList.replaceChildren(
      ...catalogue.types.filter(isHidden).map((type) => {
        const row = el("button", { class: "pickcard" }, [
          el("div", { text: t(`dash.${type.cardType}`) }),
          el("div", { class: "muted tiny", text: t(`dash.about.${type.cardType}`) }),
        ]);
        if (selectedHiddenType === type.cardType) row.classList.add("on");
        row.onclick = () => {
          selectedHiddenType = type.cardType;
          selectedDisplayedIndex = null;
          chosen.cardType = type.cardType;

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
          refresh();
        };
        return row;
      })
    );

    displayedList.replaceChildren(
      ...working.map((card, index) => {
        const label =
          card.cardType === "items_at_stage" && card.settings.stage
            ? `${t("dash.items_at_stage")} — ${stageName(card.settings.stage)}`
            : t(`dash.${card.cardType}`);
        const row = el("button", { class: "pickcard" }, [el("div", { text: label })]);
        if (selectedDisplayedIndex === index) row.classList.add("on");
        row.onclick = () => {
          selectedDisplayedIndex = index;
          selectedHiddenType = null;
          stagePick.replaceChildren();
          refresh();
        };
        return row;
      })
    );

    // **Nothing to click has nothing to press** — decision 0161's rule,
    // held here as everywhere else a control can lead nowhere. A
    // stage-parameterised type with no stages to offer (a customer
    // with none defined yet) leaves `chosen.stage` null, and the add
    // arrow should not pretend that is a choice.
    const selectedType = catalogue.types.find((t2) => t2.cardType === selectedHiddenType);
    const needsStageNotChosen = selectedType?.parameter === "stage" && !chosen.stage;
    addBtn.disabled = !selectedHiddenType || needsStageNotChosen;
    removeBtn.disabled = selectedDisplayedIndex === null;
  }

  addBtn.onclick = () => {
    if (!chosen.cardType) return;
    working.push({
      cardType: chosen.cardType,
      settings: chosen.stage ? { stage: chosen.stage } : {},
    });
    selectedHiddenType = null;
    chosen.cardType = null;
    chosen.stage = null;
    stagePick.replaceChildren();
    refresh();
  };

  removeBtn.onclick = () => {
    if (selectedDisplayedIndex === null) return;
    working.splice(selectedDisplayedIndex, 1);
    selectedDisplayedIndex = null;
    refresh();
  };

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout moverpopout" }, [
      el("h3", { text: t("dash.addcard") }),
      el("div", { class: "movergrid" }, [
        el("div", {}, [
          el("div", { class: "muted tiny movercollabel", text: t("dash.hiddencards") }),
          hiddenList,
        ]),
        el("div", { class: "moverarrows" }, [addBtn, removeBtn]),
        el("div", {}, [
          el("div", { class: "muted tiny movercollabel", text: t("dash.displayedcards") }),
          displayedList,
        ]),
      ]),
      stagePick,
      problem,
      el("div", { class: "actionrow" }, [
        toolButton("donearranging", t("dash.savechanges"), {
          primary: true,
          onclick: async () => {
            cards.length = 0;
            cards.push(...working);
            if (!(await save())) {
              problem.textContent = t("dash.savefailed");
              return;
            }
            backdrop.remove();
          },
        }),
        toolButton("close", t("viewer.supplier.close"), { onclick: () => backdrop.remove() }),
      ]),
    ]),
  ]);

  refresh();

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

import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * Loading purchase orders — decision 0371.
 *
 * **A load screen, not a list screen.** There is no `GET` that returns
 * every purchase order on file — only lookup by a single order number
 * (`handleGetPurchaseOrder`), which this screen has no reason to call.
 * Unlike Suppliers, there is nothing here to browse, filter, or edit;
 * a purchase order is reference data invoices are matched against, the
 * same "not a document with work to be done" reasoning decision 0081
 * already gave for keeping ingestion off `/sources/:id/capture`
 * entirely. So this screen is the loader alone, not a smaller version
 * of the Suppliers screen with the list cut away.
 *
 * **No freshness indicator, unlike Suppliers.** `suppliers.js` can say
 * "loaded 4 days ago" because `GET /suppliers` returns `lastLoad`
 * alongside the list. No equivalent exists here — there is no list
 * endpoint to carry it, and building one is a bigger, separate piece
 * this screen does not need in order to do its one job.
 */

function note(message) {
  const box = document.getElementById("purchaseorders-note");
  if (box) box.textContent = message ?? "";
}

/** What a load did, shown where the person can act on it — mirrors suppliers.js's own outcome(). */
function outcome(result) {
  const lines = [
    el("div", { text: t("purchaseorders.ordersloaded").replace("{n}", String(result.ordersLoaded)) }),
  ];

  if (result.ordersReplaced > 0) {
    lines.push(
      el("div", {
        class: "muted",
        text: t("purchaseorders.ordersreplaced").replace("{n}", String(result.ordersReplaced)),
      })
    );
  }

  lines.push(
    el("div", { class: "muted", text: t("purchaseorders.linesloaded").replace("{n}", String(result.linesLoaded)) })
  );

  if (result.refused?.length > 0) {
    // Order numbers, because that is what a person can act on in a
    // spreadsheet — decision 0211's own reasoning, unchanged for orders.
    lines.push(el("h3", { text: t("purchaseorders.refusedheading") }));
    for (const row of result.refused.slice(0, 20)) {
      lines.push(
        el("div", {
          class: "warn",
          text: t("purchaseorders.refusedorder")
            .replace("{order}", row.orderNumber)
            .replace("{reason}", row.reason),
        })
      );
    }
    if (result.refused.length > 20) {
      lines.push(
        el("div", {
          class: "muted",
          text: t("purchaseorders.refusedmore").replace("{n}", String(result.refused.length - 20)),
        })
      );
    }
  }

  return el("div", { class: "panel" }, lines);
}

function loader() {
  const picker = el("input", { type: "file", accept: ".csv,text/csv", id: "purchaseorderfile" });
  // The handler goes in at construction — actionLink disables a button
  // with no onclick (decision 0161), and assigning it afterwards
  // leaves the button disabled and looking fine.
  const button = actionLink("load", { primary: true, onclick: () => runLoad() });

  async function runLoad() {
    const file = picker.files?.[0];
    if (!file) {
      note(t("purchaseorders.nofile"));
      return;
    }

    button.disabled = true;

    // One try per thing that can fail, not one around everything —
    // decision 0216, the same discipline suppliers.js's own loader
    // already follows: a bug in the redraw must never be reported as
    // "we could not reach the service."
    let response;
    try {
      response = await fetch("/api/purchase-orders/csv-load", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
    } catch {
      note(t("purchaseorders.loadfailed"));
      button.disabled = false;
      return;
    }

    try {
      const body = await response.json();

      if (!response.ok) {
        // The route's own words, not a generic failure — a file with
        // no order number column is refused for a specific reason.
        note(body.error);
        return;
      }

      const panel = document.getElementById("purchaseorders-note");
      if (panel) panel.replaceChildren(outcome(body));
    } catch (err) {
      note(`${t("purchaseorders.loadbroke")} ${err?.message ?? ""}`);
    } finally {
      button.disabled = false;
    }
  }

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("purchaseorders.loadheading") }),
      el("div", { class: "statebuttons" }, [button]),
    ]),
    el("p", { class: "muted", text: t("purchaseorders.loadhelp") }),
    picker,
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  // Through frame and topbar, like every other screen — decision
  // 0191's own finding: a screen that writes to #main directly, or
  // imports el/setCurrentScreen from strings.js instead of tasks.js,
  // is a screen the navigation cannot reach.
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("purchaseorders.heading"), t("purchaseorders.subtitle")),
        el("div", { id: "purchaseorders-note", class: "warn" }),
        loader(),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("purchaseorders");
  render();
}

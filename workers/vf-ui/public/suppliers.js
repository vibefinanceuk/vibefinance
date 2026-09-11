import { el, note, setCurrentScreen, t } from "/strings.js";

/**
 * The supplier list, and loading one — decision 0213.
 *
 * **We are the mirror** (decision 0208), and that shapes the whole
 * screen: there is no *Add supplier* and no *Edit*. A person looking at
 * this cannot change it, because changing it here would make this the
 * master and the ERP wrong.
 *
 * What they can do is **load a newer file** and **see how old this one
 * is** — which is the fact an unmatched supplier depends on (decision
 * 0209).
 */

let suppliers = [];
let lastLoad = null;

async function load() {
  try {
    const response = await fetch("/api/suppliers");
    if (!response.ok) return false;
    const body = await response.json();
    suppliers = body.suppliers ?? [];
    lastLoad = body.lastLoad ?? null;
    return true;
  } catch {
    return false;
  }
}

/**
 * **How old this list is, said plainly.**
 *
 * Decision 0208: a stale mirror lies confidently. A supplier added to
 * the ERP on Monday and loaded here on Friday means four days of
 * invoices routed for review, each correct according to this system and
 * wrong in fact.
 *
 * **Never loaded is a different thing from stale**, and only the second
 * is fixed by asking for a newer file.
 */
function freshness() {
  if (!lastLoad) {
    return el("div", { class: "warn", text: t("suppliers.neverloaded") });
  }

  const days = Math.floor((Date.now() - new Date(lastLoad.loadedAt + "Z")) / 86400000);
  const line = el("div", {
    class: days > 30 ? "warn" : "muted",
    text: t("suppliers.loadedago").replace("{days}", String(days)),
  });

  if (lastLoad.refusedCount > 0) {
    // A customer whose export was half wrong should keep seeing that,
    // not only in the response they have since closed.
    return el("div", {}, [
      line,
      el("div", {
        class: "warn",
        text: t("suppliers.hadrefusals").replace("{n}", String(lastLoad.refusedCount)),
      }),
    ]);
  }

  return line;
}

/** What a load did, shown where the person can act on it. */
function outcome(result) {
  const lines = [
    el("div", { text: t("suppliers.loaded").replace("{n}", String(result.loaded)) }),
  ];

  if (result.deactivated > 0) {
    // **Absent means inactive, never deleted** (decision 0208), and a
    // person should know how many disappeared from their own file.
    lines.push(
      el("div", {
        class: "muted",
        text: t("suppliers.deactivated").replace("{n}", String(result.deactivated)),
      })
    );
  }

  if (result.rematched > 0) {
    /**
     * **The part that clears somebody's queue.** Decision 0208 called
     * re-matching part of the feature rather than a refinement, and
     * this is where a person sees it happen.
     */
    lines.push(
      el("div", {
        text: t("suppliers.rematched").replace("{n}", String(result.rematched)),
      })
    );
  }

  if (result.refused?.length > 0) {
    /**
     * **Row numbers, because that is what a person can act on** in a
     * spreadsheet — decision 0211. Not "some rows failed".
     */
    lines.push(el("h3", { text: t("suppliers.refusedheading") }));
    for (const row of result.refused.slice(0, 20)) {
      lines.push(
        el("div", {
          class: "warn",
          text: t("suppliers.refusedrow")
            .replace("{row}", String(row.row))
            .replace("{reason}", row.reason),
        })
      );
    }
    if (result.refused.length > 20) {
      lines.push(
        el("div", {
          class: "muted",
          text: t("suppliers.refusedmore").replace(
            "{n}",
            String(result.refused.length - 20)
          ),
        })
      );
    }
  }

  return el("div", { class: "panel" }, lines);
}

function loader() {
  const picker = el("input", { type: "file", accept: ".csv,text/csv", id: "supplierfile" });
  const button = el("button", { class: "primary", text: t("suppliers.loadbutton") });
  const result = el("div", {});

  button.onclick = async () => {
    const file = picker.files?.[0];
    if (!file) {
      note(t("suppliers.nofile"));
      return;
    }

    button.disabled = true;
    button.textContent = t("suppliers.loading");

    try {
      const response = await fetch("/api/suppliers/load", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
      const body = await response.json();

      if (!response.ok) {
        /**
         * **The route's own words**, not a generic failure. A file with
         * no ERP identifier column is refused for a specific reason and
         * a person can fix it — decision 0190's finding that a generic
         * message blames the user for something they cannot see.
         */
        result.replaceChildren(
          el("div", { class: "panel" }, [el("div", { class: "warn", text: body.error })])
        );
        return;
      }

      result.replaceChildren(outcome(body));
      await load();
      render(result);
    } catch {
      result.replaceChildren(
        el("div", { class: "panel" }, [el("div", { class: "warn", text: t("suppliers.loadfailed") })])
      );
    } finally {
      button.disabled = false;
      button.textContent = t("suppliers.loadbutton");
    }
  };

  return el("div", { class: "panel" }, [
    el("h2", { text: t("suppliers.loadheading") }),
    /**
     * **What this is for**, because a file picker with no explanation
     * is a file picker nobody uses. And it names the one column that is
     * not optional, so a person finds out before the upload rather
     * than after.
     */
    el("p", { class: "muted", text: t("suppliers.loadhelp") }),
    picker,
    button,
    result,
  ]);
}

function supplierRows() {
  if (suppliers.length === 0) {
    return el("div", { class: "muted", text: t("suppliers.none") });
  }

  const rows = suppliers.map((s) =>
    el("tr", { class: s.status === "inactive" ? "muted" : "" }, [
      el("td", { text: s.erpIdentifier }),
      el("td", { text: s.name }),
      el("td", { class: "muted", text: s.vatId ?? "—" }),
      el("td", { class: "muted", text: s.country ?? "—" }),
      el("td", { class: "muted", text: s.paymentTerms ?? "—" }),
      // **A hold is why an invoice routes differently**, so it is not a
      // tick — it is the reason, which is what somebody needs.
      el("td", { class: s.onHold ? "warn" : "muted", text: s.onHold ? s.holdReason : "—" }),
      el("td", { class: "muted", text: s.status }),
    ])
  );

  return el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: t("suppliers.erpid") }),
        el("th", { text: t("suppliers.name") }),
        el("th", { text: t("suppliers.vat") }),
        el("th", { text: t("suppliers.country") }),
        el("th", { text: t("suppliers.terms") }),
        el("th", { text: t("suppliers.hold") }),
        el("th", { text: t("suppliers.status") }),
      ]),
    ]),
    el("tbody", {}, rows),
  ]);
}

function render() {
  const main = document.getElementById("main");
  if (!main) return;

  main.replaceChildren(
    el("div", { class: "topbar" }, [
      el("h2", { text: t("suppliers.heading") }),
      /**
       * **Said on the screen, not only in a record.** A person who does
       * not know this is a mirror will look for an *Add supplier*
       * button and conclude the product is missing one.
       */
      el("div", { class: "sub", text: t("suppliers.mirror") }),
    ]),
    freshness(),
    loader(),
    el("div", { class: "panel" }, [supplierRows()])
  );
}

export async function open() {
  setCurrentScreen("suppliers");
  if (!(await load())) {
    note(t("suppliers.failed"));
    return;
  }
  render();
}

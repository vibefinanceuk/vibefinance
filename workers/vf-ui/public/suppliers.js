import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";

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

/**
 * **Whether an ERP is the master here** — decision 0230.
 *
 * The operator asked to warn on save *"IF the ERP Identifier is
 * populated"*, which is always: decision 0209 made it `NOT NULL` and a
 * standing invariant says so.
 *
 * **What the question really asks** is whether an ERP feeds this list,
 * and a load having happened answers it. Before the first one every row
 * was typed here, and a warning would be telling somebody off for the
 * only thing they can do.
 */
let fedByLoad = false;

async function load() {
  try {
    const response = await fetch("/api/suppliers");
    if (!response.ok) return false;
    const body = await response.json();
    suppliers = body.suppliers ?? [];
    lastLoad = body.lastLoad ?? null;
    fedByLoad = body.fedByLoad === true;
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

  if (result.adopted > 0) {
    /**
     * **The retroactive update, made visible** — decision 0233. A
     * supplier recorded here before the ERP had one now has its
     * identifier, and invoices already matched to it became payable.
     */
    lines.push(
      el("div", {
        text: t("suppliers.adopted").replace("{n}", String(result.adopted)),
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
  /**
   * **The handler goes in at construction** — `actionLink` disables a
   * button with no `onclick` (decision 0161: an action with nothing to
   * do says so). Assigning `.onclick` afterwards leaves it disabled and
   * looking fine.
   */
  const button = actionLink("load", { primary: true, onclick: () => runLoad() });

  async function runLoad() {
    const file = picker.files?.[0];
    if (!file) {
      note(t("suppliers.nofile"));
      return;
    }

    button.disabled = true;

    /**
     * **One `try` per thing that can fail, not one around everything** —
     * decision 0216.
     *
     * The first version wrapped the request, the parse and the redraw
     * together, so a bug in the redraw reported *"we could not reach
     * the service"* — which is decision 0190's finding, where a 500 was
     * reported as *"sign-in failed"* and blamed the person for
     * something they could not see.
     *
     * **A message that names the wrong layer sends somebody to check
     * their network when their screen is broken.**
     */
    let response;
    try {
      response = await fetch("/api/suppliers/load", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
    } catch {
      note(t("suppliers.loadfailed"));
      button.disabled = false;
      button.textContent = t("suppliers.loadbutton");
      return;
    }

    try {
      const body = await response.json();

      if (!response.ok) {
        /**
         * **The route's own words**, not a generic failure. A file with
         * no ERP identifier column is refused for a specific reason and
         * a person can fix it.
         */
        note(body.error);
        return;
      }

      await load();
      render();
      // After the rebuild, so the outcome is not cleared by it.
      const panel = document.getElementById("suppliers-note");
      if (panel) panel.replaceChildren(outcome(body));
    } catch (err) {
      /**
       * **The file reached the service and something here went wrong.**
       *
       * Said as itself, with the real message, because a person who is
       * told the network failed will retry a load that already
       * succeeded.
       */
      note(`${t("suppliers.loadbroke")} ${err?.message ?? ""}`);
    } finally {
      button.disabled = false;
    }
  }

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
    /**
     * **Both ways a supplier gets here, side by side** — decision 0237.
     *
     * A load brings many at once from the ERP; recording one brings a
     * single supplier the ERP does not have yet (decision 0231). They
     * are different acts and the same question — *how does a supplier
     * get into this list* — so a person looking for either should find
     * both.
     */
    el("div", { class: "statebuttons" }, [button, newSupplier()]),
  ]);
}

/**
 * Recording a supplier the ERP does not have yet — decision 0231.
 *
 * **Not a contradiction of the mirror.** A supplier the ERP has is
 * changed there; this creates one it does not, which is the precursor
 * to a new-supplier process rather than an override of a master.
 */
function newSupplier() {
  const button = actionLink("newsupplier", { onclick: () => openNewSupplier() });

  function openNewSupplier() {
    const problem = el("div", { class: "warn" });
    const fields = {};

    const asked = [
      ["name", t("suppliers.name")],
      ["vatId", t("suppliers.vat")],
      ["erpIdentifier", t("suppliers.erpid")],
      ["email", t("viewer.supplier.email")],
      ["phone", t("viewer.supplier.phone")],
      ["addressLine", t("viewer.supplier.street")],
      ["city", t("viewer.supplier.city")],
      ["postalCode", t("viewer.supplier.postcode")],
      ["country", t("viewer.supplier.country")],
    ];

    const form = el(
      "div",
      { class: "editgrid" },
      asked.flatMap(([key, label]) => {
        const input = el("input", { type: "text" });
        fields[key] = input;
        return [el("label", { text: label }), input];
      })
    );

    const backdrop = el("div", { class: "backdrop" }, [
      el("div", { class: "popout" }, [
        el("h3", { text: t("suppliers.new") }),
        /**
         * **Why the ERP number may be left blank**, said before
         * somebody wonders whether they are doing it wrong.
         */
        el("p", { class: "muted", text: t("suppliers.newhelp") }),
        form,
        problem,
        el("div", { class: "statebuttons" }, [
          el("button", {
            class: "primary",
            text: t("suppliers.create"),
            onclick: async () => {
              problem.textContent = "";
              try {
                const response = await fetch("/api/suppliers", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    Object.fromEntries(
                      Object.entries(fields).map(([k, i]) => [k, i.value.trim()])
                    )
                  ),
                });
                if (!response.ok) {
                  problem.textContent = (await response.json()).error ?? t("suppliers.changefailed");
                  return;
                }
                backdrop.remove();
                await load();
                render();
              } catch {
                problem.textContent = t("suppliers.changefailed");
              }
            },
          }),
          actionLink("close", { onclick: () => backdrop.remove() }),
        ]),
      ]),
    ]);

    backdrop.onclick = (e) => {
      if (e.target === backdrop) backdrop.remove();
    };
    document.body.append(backdrop);
    fields.name.focus();
  }

  return button;
}

/**
 * One supplier, with what a person may do to it — decision 0230.
 *
 * **Three kinds of act, and they are not the same kind.**
 *
 * **A hold** stops payment while something is disputed. **Deactivating**
 * stops an arriving invoice matching at all. **Editing** corrects a
 * record the ERP owns — and is the only one of the three the next load
 * overwrites.
 *
 * So the third is separated, and warns.
 */
function openSupplier(s) {
  const problem = el("div", { class: "warn" });
  const fields = {};

  const editable = [
    /**
     * **Editable only while blank** — decision 0231. That is how a
     * supplier awaiting the ERP stops awaiting it; a row the ERP owns
     * keeps its number, and the route refuses a change with a reason.
     */
    ["erpIdentifier", t("suppliers.erpid")],
    ["name", t("suppliers.name")],
    ["vatId", t("suppliers.vat")],
    ["electronicAddress", t("viewer.supplier.endpoint")],
    ["email", t("viewer.supplier.email")],
    ["phone", t("viewer.supplier.phone")],
    ["addressLine", t("viewer.supplier.street")],
    ["city", t("viewer.supplier.city")],
    ["postalCode", t("viewer.supplier.postcode")],
    ["country", t("viewer.supplier.country")],
    ["paymentTerms", t("suppliers.terms")],
  ];

  const form = el(
    "div",
    { class: "editgrid" },
    editable.flatMap(([key, label]) => {
      const input = el("input", {
        type: "text",
        value: s[key] ?? "",
        ...(key === "erpIdentifier" && s.erpIdentifier ? { disabled: "disabled" } : {}),
      });
      fields[key] = input;
      return [el("label", { text: label }), input];
    })
  );

  async function send(method, body, onOk) {
    problem.textContent = "";
    try {
      const response = await fetch(`/api/suppliers/${encodeURIComponent(s.id)}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        problem.textContent = (await response.json()).error ?? t("suppliers.changefailed");
        return;
      }
      await onOk();
    } catch {
      problem.textContent = t("suppliers.changefailed");
    }
  }

  const close = () => backdrop.remove();
  const reload = async () => {
    close();
    await load();
    render();
  };

  const save = actionLink("save", {
    primary: true,
    onclick: () => {
      const body = Object.fromEntries(
        Object.entries(fields).map(([k, input]) => [k, input.value.trim() || null])
      );

      if (!fedByLoad) {
        send("PUT", body, reload);
        return;
      }

      /**
       * **The warning the operator asked for**, shown before the save
       * rather than after: *"the information master is the ERP system,
       * and data changes should be made there."*
       *
       * And it says what will actually happen — **the next load
       * overwrites this** — because *"should be made there"* invites
       * somebody to wonder whether it matters.
       */
      problem.replaceChildren(
        el("div", { class: "warn", text: t("suppliers.mastersays") }),
        el("button", {
          class: "primary",
          text: t("suppliers.saveanyway"),
          onclick: () => send("PUT", body, reload),
        })
      );
    },
  });

  /**
   * Hold, release, activate, deactivate — a flag the ERP also sets, and
   * **each pair replaces the other** — decision 0234.
   *
   * The operator: *"Release Hold and De-activate buttons which appear
   * interchangeably when others are selected."*
   *
   * Which is the honest shape: a held supplier cannot be held again,
   * and offering both would make somebody read two buttons to find the
   * one that applies.
   */
  const stateButtons = el("div", { class: "statebuttons" }, [
    s.onHold
      ? actionLink("releasehold", { onclick: () => send("PATCH", { onHold: false }, reload) })
      : actionLink("hold", {
          onclick: () => {
            /**
             * **A hold needs a reason** — migration 0049 refuses one
             * without, and asking here is better than refusing after.
             */
            const reason = el("input", {
              type: "text",
              class: "searchbox",
              placeholder: t("suppliers.holdreasonhint"),
            });
            problem.replaceChildren(
              el("div", { text: t("suppliers.holdreason") }),
              reason,
              el("button", {
                class: "primary",
                text: t("suppliers.holdconfirm"),
                onclick: () => send("PATCH", { onHold: true, holdReason: reason.value }, reload),
              })
            );
            reason.focus();
          },
        }),
    s.status === "active"
      ? actionLink("deactivate", { onclick: () => send("PATCH", { status: "inactive" }, reload) })
      : actionLink("activate", { onclick: () => send("PATCH", { status: "active" }, reload) }),
    /**
     * **Every action in one row** — decision 0236, at the operator's
     * asking.
     *
     * Save and Close sat below the form while Hold and Deactivate sat
     * above it, which made the form look like it separated two kinds of
     * thing. **It does not**: all four act on the supplier, and a person
     * scanning for what they can do should find one place.
     */
    save,
    actionLink("close", { onclick: () => close() }),
  ]);

  const box = el("div", { class: "popout" }, [
    el("h3", { text: s.name }),
    // **What the ERP calls it**, which is the reason the record exists
    // (decision 0209) and the thing a person quotes to somebody else.
    el("div", {
      class: "sub",
      text: [s.erpIdentifier, s.erpSiteIdentifier, s.isPaySite ? t("suppliers.pay") : null]
        .filter(Boolean)
        .join(" · "),
    }),
    s.onHold ? el("div", { class: "warn", text: `${t("suppliers.hold")}: ${s.holdReason}` }) : null,
    /**
     * **What is actually missing**, said where somebody can act on it —
     * decision 0231. A supplier awaiting the ERP is not broken; it is
     * work waiting for a team.
     */
    s.erpIdentifier ? null : el("div", { class: "warn", text: t("suppliers.awaitingerp") }),
    stateButtons,
    form,
    problem,
  ].filter(Boolean));

  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
}

function supplierRows() {
  if (suppliers.length === 0) {
    return el("div", { class: "muted", text: t("suppliers.none") });
  }

  /**
   * **What a site is for** — decision 0218, and two flags rather than
   * one label because a site can be both.
   *
   * A site that is neither is a site loaded before the columns existed,
   * and shows nothing rather than a guess.
   */
  const purpose = (s) =>
    [s.isPaySite ? t("suppliers.pay") : null, s.isProcurementSite ? t("suppliers.procurement") : null]
      .filter(Boolean)
      .join(", ") || "—";

  /** Where it is, on one line, which is how an address is read. */
  const where = (s) =>
    [s.addressLine, s.postalCode, s.city, s.country].filter(Boolean).join(", ") || "—";

  const rows = suppliers.map((s) => {
    const row = el("tr", { class: s.status === "inactive" ? "clickable muted" : "clickable" }, [
      // **The identifier this record exists for** (decision 0209),
      // named as the thing it is rather than as "supplier number" —
      // what matters is that it is the ERP's, not ours.
      el("td", { text: s.erpIdentifier }),
      el("td", { class: "muted", text: s.erpSiteIdentifier ?? "—" }),
      el("td", { text: s.name }),
      el("td", { class: "muted", text: purpose(s) }),
      el("td", { class: "muted", text: where(s) }),
      el("td", { class: "muted", text: s.vatId ?? "—" }),
      el("td", { class: "muted", text: s.paymentTerms ?? "—" }),
      // **A hold is why an invoice routes differently**, so it is not a
      // tick — it is the reason, which is what somebody needs.
      el("td", { class: s.onHold ? "warn" : "muted", text: s.onHold ? s.holdReason : "—" }),
      el("td", { class: "muted", text: s.status }),
    ]);

    // **The whole row, not a button in it.** A supplier is one thing,
    // and a person looking at a row is looking at that supplier.
    row.onclick = () => openSupplier(s);
    return row;
  });

  return el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: t("suppliers.erpid") }),
        el("th", { text: t("suppliers.site") }),
        el("th", { text: t("suppliers.name") }),
        el("th", { text: t("suppliers.purpose") }),
        el("th", { text: t("suppliers.address") }),
        el("th", { text: t("suppliers.vat") }),
        el("th", { text: t("suppliers.terms") }),
        el("th", { text: t("suppliers.hold") }),
        el("th", { text: t("suppliers.status") }),
      ]),
    ]),
    el("tbody", {}, rows),
  ]);
}

/**
 * A refusal about the last action, where the person can see it.
 *
 * Local, like every other screen's: a note belongs to the screen that
 * raised it, and a shared one would outlive the thing it was about.
 */
function note(message) {
  const box = document.getElementById("suppliers-note");
  if (box) box.textContent = message;
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  /**
   * **Through `frame` and `topbar`, like every other screen.**
   *
   * Writing to `#main` directly is what the first version did, and the
   * menu item then went nowhere: `#main` does not exist, and the module
   * threw on an import that was wrong as well — `el` and
   * `setCurrentScreen` live in `tasks.js`, not `strings.js`.
   *
   * **Decision 0191's finding, again**: a screen that does not follow
   * the shell's own pattern is a screen the navigation cannot reach.
   */
  shell.replaceChildren(
    frame(
      el("div", {}, [
        /**
         * **Said on the screen, not only in a record.**
         *
         * Decision 0213 said this because there was no *Add supplier*
         * and a person who did not know why would conclude the product
         * was missing one.
         *
         * **Decision 0231 added one**, and the sentence still holds: a
         * supplier the ERP **has** is changed there, and what can be
         * created here is one it **does not** — which is telling the
         * master what is missing rather than overriding it.
         */
        topbar(t("suppliers.heading"), t("suppliers.mirror")),
        el("div", { id: "suppliers-note", class: "warn" }),
        freshness(),
        loader(),
        el("div", { class: "panel" }, [supplierRows()]),
      ])
    )
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

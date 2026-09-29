import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { currentOrgId } from "/orgs.js";

/**
 * **The ERP export — decision 0552.** Payment-eligible invoices, each
 * exported once, as a CSV file an ERP can import: one row per
 * distribution (a line, or each row of a split line, 0548).
 *
 * Two panels: what the next export would take, with one button to make
 * it, and the exports made so far, each downloadable again (the same
 * file every time: the server keeps each export's rows as taken).
 *
 * A file download to start with, the operator's choice; an API push
 * and ERP-specific layouts are planned as a later enhancement, reading
 * the same rows.
 */

let data = { pending: { count: 0, invoices: [] }, exports: [] };
let busy = false;

const withOrg = (path) => {
  const org = currentOrgId();
  return org ? `${path}${path.includes("?") ? "&" : "?"}org=${encodeURIComponent(org)}` : path;
};

function note(message, { success = false } = {}) {
  const box = document.getElementById("erpexport-note");
  if (!box) return;
  box.textContent = message ?? "";
  box.className = success ? "ok" : "warn";
}

async function load() {
  try {
    const response = await fetch(withOrg("/api/erp-exports"));
    if (!response.ok) return false;
    data = await response.json();
    return true;
  } catch {
    return false;
  }
}

const money = (v) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fetches an export's file and hands it to the browser to save, under the server's own name. */
async function download(id) {
  try {
    const response = await fetch(withOrg(`/api/erp-exports/${encodeURIComponent(id)}/csv`));
    if (!response.ok) {
      note(t("erpexport.downloadfailed"));
      return false;
    }
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `vibefinance-erp-export-${id}.csv`;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    note(t("erpexport.downloadfailed"));
    return false;
  }
}

/**
 * **Undo an export — decisions 0553 and 0554.** For when the file failed
 * to import on the ERP side: its invoices go back to Ready to export,
 * and the export stays in the list, marked undone, still downloadable.
 *
 * **The app's own pop-out, not the browser's prompt — decision 0554.**
 * Reported live: the browser's native box did not look like the rest of
 * the screen. The same `.backdrop`/`.popout` shape as Discard, Return
 * and Return To Supplier (decisions 0490, 0498), which were each moved
 * off the native prompt for the same reason: a heading with the action
 * and Close, what will happen, a reason box, and a message in place of
 * a round trip when the reason is left empty. Escape closes it.
 */
function openUndoPicker(x) {
  const reasonBox = el("textarea", { class: "erpundoreason", placeholder: t("erpexport.undoplaceholder") });
  const errorBox = el("div", { class: "warn sm", hidden: "hidden" });
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  let busyUndo = false;

  const doUndo = async () => {
    if (busyUndo) return;
    errorBox.hidden = true;
    const reason = reasonBox.value.trim();
    if (reason === "") {
      errorBox.hidden = false;
      errorBox.textContent = t("erpexport.undoneedsreason");
      reasonBox.focus();
      return;
    }
    busyUndo = true;
    try {
      const response = await fetch(withOrg(`/api/erp-exports/${encodeURIComponent(x.id)}/undo`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        errorBox.hidden = false;
        errorBox.textContent = body.error ?? t("erpexport.undofailed");
        return;
      }
      close();
      await load();
      render();
      note(t("erpexport.undonemsg").replace("{n}", String(body.invoicesReleased)), { success: true });
    } catch {
      errorBox.hidden = false;
      errorBox.textContent = t("erpexport.undofailed");
    } finally {
      busyUndo = false;
    }
  };

  const box = el("div", { class: "popout erpundopop", role: "dialog", "aria-label": t("erpexport.undotitle") }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("erpexport.undotitle") }),
      el("div", { class: "statebuttons" }, [
        actionLink("return", { label: t("erpexport.undo"), primary: true, onclick: doUndo }),
        actionLink("close", { onclick: close }),
      ]),
    ]),
    el("p", {
      class: "muted sm",
      text: t("erpexport.undoexplain")
        .replace("{n}", String(x.invoiceCount))
        .replace("{when}", String(x.createdAt ?? "").slice(0, 16).replace("T", " ")),
    }),
    el("div", { class: "kf" }, [el("label", { text: t("erpexport.undolabel") }), reasonBox]),
    errorBox,
  ]);

  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  reasonBox.focus();
}

async function exportNow() {
  if (busy) return;
  busy = true;
  note("");
  try {
    const response = await fetch(withOrg("/api/erp-exports"), { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      note(body.reason === "nothing_to_export" ? t("erpexport.nothing") : body.reason === "export_conflict" ? t("erpexport.conflict") : t("erpexport.failed"));
      return;
    }
    await download(body.id);
    await load();
    render();
    note(t("erpexport.done").replace("{invoices}", String(body.invoiceCount)).replace("{rows}", String(body.rowCount)), { success: true });
  } catch {
    note(t("erpexport.failed"));
  } finally {
    busy = false;
  }
}

function pendingPanel() {
  const { count, invoices } = data.pending;
  const head = [
    el("h3", { text: t("erpexport.ready") }),
    el("div", { class: "erpreadyrow" }, [
      el("p", { class: "muted sm", text: count === 0 ? t("erpexport.none") : t("erpexport.readycount").replace("{n}", String(count)) }),
      ...(count > 0
        ? [actionLink("download", { primary: true, label: t("erpexport.exportnow").replace("{n}", String(count)), onclick: exportNow })]
        : []),
    ]),
  ];
  if (count === 0) return el("div", { class: "panel erpready" }, head);
  return el("div", { class: "panel erpready" }, [
    ...head,
    el("table", { class: "erptable" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("erpexport.col.invoice") }),
          el("th", { text: t("erpexport.col.supplier") }),
          el("th", { text: t("erpexport.col.issued") }),
          el("th", { class: "num", text: t("erpexport.col.total") }),
        ]),
      ]),
      el(
        "tbody",
        {},
        invoices.map((i) =>
          el("tr", {}, [
            el("td", { text: i.number ?? i.id }),
            el("td", { text: i.supplierName ?? "—" }),
            el("td", { class: "muted", text: i.issueDate ?? "—" }),
            el("td", { class: "num", text: `${money(i.total)}${i.currency ? ` ${i.currency}` : ""}` }),
          ])
        )
      ),
    ]),
    ...(count > invoices.length ? [el("p", { class: "muted sm", text: t("erpexport.more").replace("{n}", String(count - invoices.length)) })] : []),
  ]);
}

function historyPanel() {
  return el("div", { class: "panel erphistory" }, [
    el("h3", { text: t("erpexport.history") }),
    data.exports.length === 0
      ? el("p", { class: "muted sm", text: t("erpexport.nohistory") })
      : el("table", { class: "erptable" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { text: t("erpexport.col.when") }),
              el("th", { text: t("erpexport.col.by") }),
              el("th", { class: "num", text: t("erpexport.col.invoices") }),
              el("th", { class: "num", text: t("erpexport.col.rows") }),
              el("th", {}),
            ]),
          ]),
          el(
            "tbody",
            {},
            data.exports.map((x) =>
              el("tr", { class: x.undone ? "erpundone" : "" }, [
                el("td", {}, [
                  el("div", { text: String(x.createdAt ?? "").slice(0, 16).replace("T", " ") }),
                  // Decision 0553 — undone, by whom, when and why.
                  ...(x.undone
                    ? [
                        el("div", { class: "erpundonenote sm" }, [
                          el("span", { class: "erpundonepill", text: t("erpexport.undone") }),
                          ` ${t("erpexport.undoneby").replace("{who}", x.undone.byName ?? "—").replace("{when}", String(x.undone.at ?? "").slice(0, 16).replace("T", " "))}`,
                        ]),
                        el("div", { class: "muted sm", text: x.undone.reason ?? "" }),
                      ]
                    : []),
                ]),
                el("td", { text: x.createdByName ?? "—" }),
                el("td", { class: "num", text: String(x.invoiceCount) }),
                el("td", { class: "num", text: String(x.rowCount) }),
                el("td", { class: "num" }, [
                  el("div", { class: "erpactions" }, [
                    actionLink("download", { onclick: () => download(x.id) }),
                    ...(x.undone ? [] : [actionLink("return", { label: t("erpexport.undo"), onclick: () => openUndoPicker(x) })]),
                  ]),
                ]),
              ])
            )
          ),
        ]),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("erpexport.heading"), t("erpexport.subtitle")),
        el("div", { id: "erpexport-note", class: "warn" }),
        pendingPanel(),
        historyPanel(),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("erpexport");
  const ok = await load();
  render();
  if (!ok) note(t("erpexport.failed"));
}

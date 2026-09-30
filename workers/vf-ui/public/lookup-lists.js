import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **Look-up lists — decision 0568.**
 *
 * The customer's own lists a supplier mapping can look a value up in, through
 * the `look_up` function: a supplier's unit "Rolle" to a code, their article
 * number to the customer's own. **Shared**, as Dan chose: kept once, on the
 * Routes screen, and used by any mapping.
 *
 * A panel on the Routes screen lists them, with how many entries each has
 * and which mappings use it. A list opens in a pop-out, as a two-column
 * table of *From* and *To*: edit a row, add one, remove one, or paste many
 * at once (a tab, `;` or `,` between the two). Save stores the whole list,
 * or says which row is wrong. Retiring asks first, naming the mappings
 * that still use it.
 */

let lists;
let failed = false;

async function call(method, path, body) {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

export async function loadLists() {
  const r = await call("GET", "/lookup-lists");
  failed = !r.ok;
  lists = r.ok ? r.body.lists ?? [] : [];
}

/**
 * Rows pasted from a spreadsheet or typed: one per line, From and To split
 * by the first tab, else `;`, else `,`. A line with nothing is skipped.
 */
export function parsePasted(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
      const at = line.indexOf(sep);
      return at === -1 ? { from: line.trim(), to: "" } : { from: line.slice(0, at).trim(), to: line.slice(at + 1).trim() };
    })
    .filter((r) => r.from !== "" || r.to !== "");
}

/** The panel on the Routes screen. `rerender` draws the screen again after a change. */
export function listsPanel(rerender) {
  if (lists === undefined) return null;
  const name = el("input", { class: "meinput", type: "text", placeholder: t("lookup.newplaceholder"), "aria-label": t("lookup.newname") });
  const note = el("div", { class: "warn sm" });
  const create = async () => {
    const r = await call("POST", "/lookup-lists", { name: name.value });
    if (!r.ok) {
      note.textContent = r.body?.error ?? t("lookup.failed");
      return;
    }
    await loadLists();
    rerender();
    await openList(r.body.id, rerender);
  };
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") create();
  });
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("lookup.heading") })]),
    el("p", { class: "muted sm", text: t("lookup.sub") }),
    failed
      ? el("p", { class: "muted sm", text: t("lookup.loadfailed") })
      : lists.length === 0
        ? el("p", { class: "muted sm", text: t("lookup.none") })
        : el("table", { class: "rtformats rtlookups" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("lookup.col.list") }),
                el("th", { class: "n", text: t("lookup.col.entries") }),
                el("th", { text: t("lookup.col.usedby") }),
                el("th", {}),
              ]),
            ]),
            el(
              "tbody",
              {},
              lists.map((l) =>
                el("tr", {}, [
                  el("td", {}, [el("div", { class: "fname", text: l.name }), ...(l.description ? [el("div", { class: "muted", text: l.description })] : [])]),
                  el("td", { class: "n", text: String(l.entries) }),
                  el("td", { class: "muted", text: l.usedBy.length > 0 ? l.usedBy.join(", ") : t("lookup.unused") }),
                  el("td", { class: "n" }, [actionLink("coding", { label: t("lookup.open"), onclick: () => openList(l.id, rerender) })]),
                ])
              )
            ),
          ]),
    el("div", { class: "rtlookupnew" }, [name, actionLink("addcard", { label: t("lookup.create"), onclick: create })]),
    note,
  ]);
}

/** One list, in a pop-out: its name, its rows, paste, save, retire. */
export async function openList(id, rerender) {
  const r = await call("GET", `/lookup-lists/${encodeURIComponent(id)}`);
  if (!r.ok) return;
  const { list, usedBy } = r.body;
  let rows = r.body.entries.map((e) => ({ ...e }));
  let confirming = false;

  const name = el("input", { class: "meinput", type: "text", value: list.name, "aria-label": t("lookup.name") });
  const errorBox = el("div", { class: "merefused" });
  errorBox.hidden = true;
  const body = el("div", {});
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const say = (text, ok = false) => {
    errorBox.hidden = !text;
    errorBox.className = ok ? "menote ok" : "merefused";
    errorBox.textContent = text ?? "";
  };

  const save = async () => {
    const res = await call("PUT", `/lookup-lists/${encodeURIComponent(id)}`, { name: name.value, entries: rows });
    if (!res.ok) {
      say(res.body?.error ?? t("lookup.failed"));
      return;
    }
    say(t("lookup.saved").replace("{n}", String(res.body.entries)), true);
    await loadLists();
    rerender();
  };
  const retire = async () => {
    const res = await call("POST", `/lookup-lists/${encodeURIComponent(id)}/retire`);
    if (!res.ok) {
      say(res.body?.error ?? t("lookup.failed"));
      return;
    }
    close();
    await loadLists();
    rerender();
  };

  const draw = () => {
    const table = el("table", { class: "rtformats lltable" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: t("lookup.from") }), el("th", { text: t("lookup.to") }), el("th", {})])]),
      el(
        "tbody",
        {},
        rows.map((row, i) => {
          const from = el("input", { class: "meinput", type: "text", value: row.from, "aria-label": `${t("lookup.from")} ${i + 1}` });
          const to = el("input", { class: "meinput", type: "text", value: row.to, "aria-label": `${t("lookup.to")} ${i + 1}` });
          from.oninput = () => (row.from = from.value);
          to.oninput = () => (row.to = to.value);
          return el("tr", {}, [
            el("td", {}, [from]),
            el("td", {}, [to]),
            el("td", { class: "n" }, [
              actionLink("discard", {
                label: t("lookup.removerow"),
                onclick: () => {
                  rows.splice(i, 1);
                  draw();
                },
              }),
            ]),
          ]);
        })
      ),
    ]);
    const paste = el("textarea", { class: "llpaste", rows: "3", placeholder: t("lookup.pasteplaceholder"), "aria-label": t("lookup.paste") });
    body.replaceChildren(
      el("div", { class: "mekv wide" }, [el("span", { class: "l", text: t("lookup.name") }), name]),
      el("p", { class: "muted sm", text: usedBy.length > 0 ? t("lookup.usedbyn").replace("{list}", usedBy.join(", ")) : t("lookup.unused") }),
      rows.length === 0 ? el("p", { class: "muted sm", text: t("lookup.empty") }) : table,
      el("div", { class: "statebuttons mebtns" }, [
        actionLink("addcard", {
          label: t("lookup.addrow"),
          onclick: () => {
            rows.push({ from: "", to: "" });
            draw();
          },
        }),
      ]),
      el("label", { class: "sm muted", text: t("lookup.paste") }),
      paste,
      el("div", { class: "statebuttons mebtns" }, [
        actionLink("addcard", {
          label: t("lookup.pasteadd"),
          onclick: () => {
            rows = [...rows.filter((r) => r.from !== "" || r.to !== ""), ...parsePasted(paste.value)];
            draw();
          },
        }),
      ]),
      ...(confirming
        ? [
            el("div", { class: "llretire" }, [
              el("p", {
                class: "sm",
                text: usedBy.length > 0 ? t("lookup.retireconfirm.used").replace("{list}", usedBy.join(", ")) : t("lookup.retireconfirm"),
              }),
              el("div", { class: "statebuttons mebtns" }, [
                actionLink("retire", { primary: true, label: t("lookup.retireyes"), onclick: retire }),
                actionLink("close", {
                  label: t("lookup.retireno"),
                  onclick: () => {
                    confirming = false;
                    draw();
                  },
                }),
              ]),
            ]),
          ]
        : []),
      errorBox,
    );
  };

  const box = el("div", { class: "popout llpop", role: "dialog", "aria-label": t("lookup.title").replace("{name}", list.name) }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("lookup.title").replace("{name}", list.name) }),
      el("div", { class: "statebuttons" }, [
        actionLink("save", { primary: true, onclick: save }),
        actionLink("retire", {
          label: t("lookup.retire"),
          onclick: () => {
            confirming = true;
            draw();
          },
        }),
        actionLink("close", { onclick: close }),
      ]),
    ]),
    body,
  ]);
  draw();
  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
}

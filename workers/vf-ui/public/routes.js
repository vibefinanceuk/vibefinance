import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { listsPanel, loadLists } from "/lookup-lists.js";

/**
 * **Routes — decision 0557**, slice 3 of the Routes design, as mocked up
 * and agreed.
 *
 * Every route, Sources beside Destinations, and the one chosen laid out
 * as its five parts: receiving gateway, receiving format, translation,
 * delivery format, delivery gateway. Read-only in this slice: these are
 * VibeFinance's standard routes. Copying one, new versions and testing
 * with a sample come with the mapping editor.
 */

let routes = [];
let selectedId = null;

async function load() {
  try {
    const response = await fetch("/api/routes");
    if (!response.ok) return false;
    routes = (await response.json()).routes ?? [];
    return true;
  } catch {
    return false;
  }
}

/** A value's words, or the value itself where the interface has none. */
function words(kind, value) {
  const key = `routes.${kind}.${value}`;
  const found = t(key);
  return found === key ? value : found;
}

function versionPill(route) {
  if (!route.current) return el("span", { class: "rmpill q", text: "—" });
  return el("span", {}, [
    `v${route.current.version} `,
    el("span", { class: `rmpill ${route.live ? "ok" : "q"}`, text: t(route.live ? "routes.live" : "routes.draft") }),
  ]);
}

function placed(route) {
  if (route.processes === 0) return t("routes.notplaced");
  return route.processes === 1 ? route.placedIn[0] : t("routes.placedn").replace("{n}", String(route.processes));
}

function routeTable(direction) {
  const list = routes.filter((r) => r.direction === direction);
  return el("table", { class: "rttable" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: t("routes.col.route") }),
        el("th", { text: t("routes.col.inout") }),
        el("th", { text: t("routes.col.placed") }),
        el("th", { text: t("routes.col.version") }),
      ]),
    ]),
    el(
      "tbody",
      {},
      list.map((r) => {
        const row = el("tr", { class: `clickable${r.id === selectedId ? " sel" : ""}` }, [
          el("td", {}, [
            el("div", { class: "rtname", text: r.name }),
            el(
              "div",
              {},
              r.origin === "standard"
                ? [el("span", { class: "rtstd", text: t("routes.standard") })]
                : [el("span", { class: "muted sm", text: t("routes.copied") })]
            ),
          ]),
          el("td", {}, [
            el("div", {
              text: r.current ? `${words("gw", r.current.receivingGateway)} · ${words("fmt", r.current.receivingFormat)}` : "—",
            }),
            el("div", {
              class: "muted sm",
              text: r.current ? `→ ${words("fmt", r.current.deliveryFormat)} · ${words("gw", r.current.deliveryGateway)}` : "",
            }),
          ]),
          el("td", { text: placed(r) }),
          el("td", {}, [versionPill(r)]),
        ]);
        row.onclick = async () => {
          selectedId = r.id;
          render();
          if (r.direction === "source" && r.current?.receivingFormat === "detected") {
            await loadMappings(r.id);
            if (selectedId === r.id) render();
          }
        };
        return row;
      })
    ),
  ]);
}

/** The five parts of a route, left to right, the middle model marked. */
function chain(route) {
  const v = route.current;
  // Decision 0585: a Destination's delivery gateway says what it does going out ("gwdout"), where that differs.
  const describe = (kind, value, out) => {
    const outKey = `routes.gwdout.${value}`;
    return out && t(outKey) !== outKey ? t(outKey) : words(`${kind}d`, value);
  };
  const part = (n, kind, value, core = false, out = false) =>
    el("div", { class: `rtpart${core ? " core" : ""}` }, [
      el("div", { class: "k", text: `${n} · ${t(`routes.part.${n}`)}` }),
      el("div", { class: "v", text: words(kind, value) }),
      el("div", { class: "d", text: describe(kind, value, out) }),
    ]);
  return el("div", { class: "rtchain" }, [
    part(1, "gw", v.receivingGateway),
    part(2, "fmt", v.receivingFormat, v.receivingFormat === "en16931"),
    part(3, "tr", v.translation),
    part(4, "fmt", v.deliveryFormat, v.deliveryFormat === "en16931"),
    part(5, "gw", v.deliveryGateway, false, route.direction === "destination"),
  ]);
}

/**
 * **What a Source route reads, and what it has received — decision
 * 0560.** Each format in the order detection tries it, how it is read,
 * what it is checked against, and the last 30 days' attachments: how
 * many, and how many broke an EN 16931 rule. Counted from the message
 * parts the Route monitor already keeps.
 */
export const FORMAT_ROWS = ["xrechnung", "peppol_bis_3", "en16931", "factur_x", "other", "supplier_xml", "supplier_csv", "picture"];

/**
 * Which row an attachment counts in. Anything read as data from inside a
 * PDF is a Factur-X / ZUGFeRD, whatever profile it declares; a bare CII
 * declaring a Factur-X profile is one too.
 */
export function formatRow(f) {
  if (f.format === "picture") return "picture";
  if (f.inPdf || f.format.startsWith("factur_x")) return "factur_x";
  if (f.format === "ubl_other" || f.format === "cii_other") return "other";
  return FORMAT_ROWS.includes(f.format) ? f.format : null;
}

export function formatCounts(formats30d) {
  return FORMAT_ROWS.map((key) => {
    const rows = (formats30d ?? []).filter((f) => formatRow(f) === key);
    return {
      key,
      received: rows.reduce((a, f) => a + f.received, 0),
      failing: rows.reduce((a, f) => a + f.failing, 0),
    };
  });
}

function formatsPanel(route) {
  if (route.direction !== "source" || route.current?.receivingFormat !== "detected") return null;
  const counts = formatCounts(route.formats30d);
  const unread = (route.formats30d ?? []).filter((f) => f.format === "unread").reduce((a, f) => a + f.received, 0);
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("routes.formats.heading") })]),
    el("p", { class: "muted sm", text: t("routes.formats.sub") }),
    el("table", { class: "rtformats" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("routes.formats.col.format") }),
          el("th", { text: t("routes.formats.col.how") }),
          el("th", { text: t("routes.formats.col.checked") }),
          el("th", { class: "n", text: t("routes.formats.col.days") }),
        ]),
      ]),
      el(
        "tbody",
        {},
        counts.map((c) =>
          el("tr", {}, [
            el("td", {}, [
              el("div", { class: "fname", text: t(`routes.formats.${c.key}`) }),
              el("div", { class: "muted", text: t(`routes.formats.${c.key}.syntax`) }),
            ]),
            el("td", { text: t(`routes.formats.${c.key}.how`) }),
            el("td", { text: t(`routes.formats.${c.key}.checked`) }),
            el("td", { class: "n" }, [
              el("div", { text: String(c.received) }),
              ...(c.failing > 0
                ? [el("div", { class: "bad", text: t("routes.formats.failing").replace("{n}", String(c.failing)) })]
                : []),
            ]),
          ])
        )
      ),
    ]),
    ...(unread > 0 ? [el("p", { class: "muted sm", text: t("routes.formats.unread").replace("{n}", String(unread)) })] : []),
    el("div", { class: "rtnote" }, [
      el("div", { class: "h", text: t("routes.formats.notstopped.h") }),
      el("div", { text: t("routes.formats.notstopped") }),
    ]),
  ]);
}

/**
 * **Supplier mappings on this route — decision 0561.** Each with its live
 * and draft versions, what it read in the last 30 days, and the failed
 * messages it may read once published; opened in the mapping editor. A
 * new one is drawn from a kept message, in the Route monitor.
 */
let mappings = {};

async function loadMappings(routeId) {
  try {
    const response = await fetch(`/api/supplier-mappings?route=${encodeURIComponent(routeId)}`);
    mappings[routeId] = response.ok ? (await response.json()).mappings ?? [] : null;
  } catch {
    mappings[routeId] = null;
  }
}

function mappingsPanel(route) {
  if (route.direction !== "source" || route.current?.receivingFormat !== "detected") return null;
  const list = mappings[route.id];
  if (list === undefined) return null;
  const open = async (id) => {
    const { open: openEditor } = await import("/mapping-editor.js");
    await openEditor(id);
  };
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("routes.mappings.heading") })]),
    el("p", { class: "muted sm", text: t("routes.mappings.sub") }),
    list === null
      ? el("p", { class: "muted sm", text: t("routes.mappings.failed") })
      : list.length === 0
        ? el("p", { class: "muted sm", text: t("routes.mappings.none") })
        : el("table", { class: "rtformats rtmappings" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("routes.mappings.col.mapping") }),
                el("th", { text: t("routes.mappings.col.version") }),
                el("th", { class: "n", text: t("routes.formats.col.days") }),
                el("th", {}),
              ]),
            ]),
            el(
              "tbody",
              {},
              list.map((m) =>
                el("tr", {}, [
                  el("td", {}, [
                    el("div", { class: "fname", text: m.name }),
                    el("div", { class: "muted", text: `${m.root === "CSV" ? t("routes.format.supplier_csv") : `<${m.root}>`} · ${m.senders ? m.senders.join(", ") : t("routes.mappings.anyone")}` }),
                  ]),
                  el("td", {}, [
                    ...(m.liveVersion ? [el("span", {}, [`v${m.liveVersion} `, el("span", { class: "rmpill ok", text: t("routes.live") })])] : []),
                    ...(m.draftVersion ? [el("div", {}, [`v${m.draftVersion} `, el("span", { class: "rmpill q", text: t("routes.draft") })])] : []),
                  ]),
                  el("td", { class: "n" }, [
                    el("div", { text: t("routes.mappings.read").replace("{n}", String(m.read30d)) }),
                    ...(m.waiting > 0 ? [el("div", { class: "bad", text: t("routes.mappings.waiting").replace("{n}", String(m.waiting)) })] : []),
                  ]),
                  el("td", { class: "n" }, [actionLink("coding", { label: t("routes.mappings.open"), onclick: () => open(m.id) })]),
                ])
              )
            ),
          ]),
  ]);
}

function detailPanel() {
  const route = routes.find((r) => r.id === selectedId);
  if (!route || !route.current) return null;
  const line = [
    t(`routes.dir.${route.direction}`),
    t(route.origin === "standard" ? "routes.standardroute" : "routes.copiedroute"),
    t("routes.versionn").replace("{n}", String(route.current.version)),
    t(route.live ? "routes.live" : "routes.draft"),
    route.processes > 0 ? t("routes.placedinlist").replace("{list}", route.placedIn.join(", ")) : t("routes.notplaced"),
  ].join(" · ");
  return el("div", { class: "panel rtdetail" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: route.name })]),
    el("p", { class: "muted sm", text: line }),
    chain(route),
    el("p", {
      class: "muted sm",
      text: t(route.direction === "source" ? "routes.keeporiginal" : "routes.readsfrom"),
    }),
    el("p", { class: "muted sm", text: t("routes.readonly") }),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const panel = (direction) =>
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t(`routes.${direction}s`) })]),
      el("p", { class: "muted sm", text: t(`routes.${direction}ssub`) }),
      routeTable(direction),
    ]);
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("routes.heading"), t("routes.subtitle"), [], [
          // Decision 0589: the library of ready-made Sources and Destinations.
          el("div", { class: "rtlibrarylink" }, [
            actionLink("addcard", {
              label: t("library.open"),
              onclick: async () => {
                const { open: openLibrary } = await import("/route-library.js");
                await openLibrary();
              },
            }),
          ]),
        ]),
        el("div", { id: "routes-note", class: "warn" }),
        el("div", { class: "rtgrid" }, [panel("source"), panel("destination")]),
        ...[
          detailPanel(),
          formatsPanel(routes.find((r) => r.id === selectedId) ?? {}),
          mappingsPanel(routes.find((r) => r.id === selectedId) ?? {}),
          // Decision 0568: the customer's look-up lists, shared by every mapping.
          listsPanel(render),
        ].filter(Boolean),
      ])
    )
  );
}

/**
 * `notice`: a line to say what just happened, such as a mapping retired
 * from the editor (decision 0563).
 */
export async function open({ notice } = {}) {
  setCurrentScreen("routes");
  const ok = await load();
  if (!selectedId || !routes.some((r) => r.id === selectedId)) {
    selectedId = routes.find((r) => r.direction === "source" && r.live)?.id ?? routes.at(0)?.id ?? null;
  }
  mappings = {};
  await loadLists();
  render();
  const chosen = routes.find((r) => r.id === selectedId);
  if (chosen?.direction === "source" && chosen.current?.receivingFormat === "detected") {
    await loadMappings(chosen.id);
    render();
  }
  if (!ok) {
    const note = document.getElementById("routes-note");
    if (note) note.textContent = t("routes.failed");
  } else if (notice) {
    const note = document.getElementById("routes-note");
    if (note) {
      note.className = "menote ok";
      note.textContent = notice;
    }
  }
}

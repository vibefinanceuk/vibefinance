import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";

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
        row.onclick = () => {
          selectedId = r.id;
          render();
        };
        return row;
      })
    ),
  ]);
}

/** The five parts of a route, left to right, the middle model marked. */
function chain(route) {
  const v = route.current;
  const part = (n, kind, value, core = false) =>
    el("div", { class: `rtpart${core ? " core" : ""}` }, [
      el("div", { class: "k", text: `${n} · ${t(`routes.part.${n}`)}` }),
      el("div", { class: "v", text: words(kind, value) }),
      el("div", { class: "d", text: words(`${kind}d`, value) }),
    ]);
  return el("div", { class: "rtchain" }, [
    part(1, "gw", v.receivingGateway),
    part(2, "fmt", v.receivingFormat, v.receivingFormat === "en16931"),
    part(3, "tr", v.translation),
    part(4, "fmt", v.deliveryFormat, v.deliveryFormat === "en16931"),
    part(5, "gw", v.deliveryGateway),
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
        topbar(t("routes.heading"), t("routes.subtitle")),
        el("div", { id: "routes-note", class: "warn" }),
        el("div", { class: "rtgrid" }, [panel("source"), panel("destination")]),
        ...[detailPanel()].filter(Boolean),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("routes");
  const ok = await load();
  if (!selectedId || !routes.some((r) => r.id === selectedId)) {
    selectedId = routes.find((r) => r.direction === "source" && r.live)?.id ?? routes.at(0)?.id ?? null;
  }
  render();
  if (!ok) {
    const note = document.getElementById("routes-note");
    if (note) note.textContent = t("routes.failed");
  }
}

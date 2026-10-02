import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { slug } from "/sources.js";

/**
 * **The Route library — decision 0589**, slice 2 of the connector
 * framework. Ready-made Sources and Destinations, as definitions: what
 * each sends or receives, how, its version, and where it is already in
 * use. "Add to my routes" makes one in a process, with its defaults; it
 * then opens on Process routes to be set up and tried.
 */

let library = { connectors: [], processes: [] };
let filter = "all";
let partnerFailed = false;

const FILTERS = ["all", "destination", "source", "erp", "automation", "generic", "partner"];

async function load() {
  try {
    const response = await fetch("/api/connector-library");
    if (!response.ok) return false;
    library = await response.json();
    // Decision 0601: partners' connectors could not be fetched just now; the ones already kept are shown.
    partnerFailed = !!library.partnerError;
    return true;
  } catch {
    return false;
  }
}

const pill = (tone, text) => el("span", { class: `rmpill ${tone}`, text });
const words = (key, fallback) => {
  const found = t(key);
  return found === key ? fallback : found;
};

function initials(name) {
  return name
    .split(/[\s/]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function shown(c) {
  if (filter === "all") return true;
  if (filter === "destination" || filter === "source") return c.direction === filter;
  return c.categories.includes(filter);
}

/** Decision 0601: a partner's connector carries its own name and description. */
const nameOf = (c) => c.name ?? words(`connector.${c.id}.name`, c.id);

function card(c) {
  const name = nameOf(c);
  const inUse = c.inUse.length > 0;
  const upgrades = c.inUse.filter((u) => u.upgradeAvailable).length;
  const canAdd = c.status === "available" && (c.multiple || c.inUse.length < library.processes.length);
  const state =
    c.status === "planned"
      ? pill("q", t("library.planned"))
      : c.status === "withdrawn"
        ? pill("warn", t("library.withdrawn"))
      : inUse
        ? pill("ok", t("library.inuse").replace("{n}", String(c.inUse.length)))
        : pill("ok", t("library.available"));
  return el("div", { class: "panel libcard", "data-connector": c.id }, [
    el("div", { class: "libhead" }, [
      el("div", { class: "liblogo", text: initials(name) }),
      el("div", { class: "libtitle" }, [
        el("div", { class: "libkind", text: t(`processroutes.${c.direction}`) }),
        el("h3", { text: name }),
        c.publisher === "partner"
          ? el("div", { class: "sm libpartner", text: t("library.publisher.partner").replace("{name}", c.partner?.name ?? "") })
          : el("div", { class: "muted sm", text: t(`library.publisher.${c.publisher}`) }),
      ]),
      // Decision 0590: top right, as on every other card.
      el("div", { class: "statebuttons libadd" }, canAdd ? [actionLink("addcard", { label: t("library.add"), onclick: () => openAdd(c) })] : []),
    ]),
    el("div", { class: "muted sm libdesc", text: c.description ?? words(`connector.${c.id}.description`, "") }),
    ...((c.lookupLists ?? []).length > 0 ? [el("div", { class: "muted sm liblists", text: `${t("library.listsneeded")} ${c.lookupLists.join(", ")}` })] : []),
    el("div", { class: "libchips" }, [
      pill("q", words(`library.transport.${c.transport}`, c.transport)),
      ...c.formats.map((f) => pill("q", words(`library.format.${f}`, f))),
      pill("q", `v${c.version}`),
    ]),
    ...(inUse
      ? [
          el(
            "ul",
            { class: "libused" },
            c.inUse.map((u) =>
              el("li", {}, [
                el("button", {
                  type: "button",
                  class: "linkish",
                  text: `${u.processName} · ${u.name ?? "—"}`,
                  onclick: () => openInProcess(c, u.processId, u.instanceId),
                }),
                ...(u.upgradeAvailable ? [pill("warn", t("library.upgradeto").replace("{n}", String(c.version)))] : []),
              ])
            )
          ),
        ]
      : []),
    el("div", { class: "libfoot" }, [
      state,
      // Decision 0605: available, not yet proven against the real system.
      ...(c.maturity === "first_version" ? [el("span", { class: "rmpill q", title: t("library.firstversionhint"), text: t("library.firstversion") })] : []),
      ...(upgrades > 0 ? [pill("warn", t("library.upgrades").replace("{n}", String(upgrades)))] : []),
    ]),
  ]);
}

async function openInProcess(c, processId, instanceId) {
  const { open } = await import("/process-routes.js");
  await open({ kind: c.direction, id: instanceId, processId });
}

/** Add a connector to a process: which one, and its name. */
function openAdd(c) {
  const name = nameOf(c);
  const problem = el("div", { class: "warn", id: "lib-problem" });
  const process = el("select", { id: "lib-process" }, library.processes.map((p) => el("option", { value: p.id, text: p.name })));
  const nameInput = el("input", { type: "text", id: "lib-name", value: name });
  const close = () => backdrop.remove();
  const add = actionLink("create", {
    primary: true,
    label: t("library.add"),
    onclick: async () => {
      problem.textContent = "";
      const chosen = nameInput.value.trim();
      if (!chosen) {
        problem.textContent = t("sources.needname");
        return;
      }
      const path =
        c.direction === "destination"
          ? `/api/processes/${encodeURIComponent(process.value)}/destinations`
          : `/api/processes/${encodeURIComponent(process.value)}/sources`;
      const id = slug(chosen);
      const body = c.direction === "destination" ? { name: chosen, connectorId: c.id } : { id, name: chosen, mechanism: c.mechanism };
      try {
        const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const reply = await response.json().catch(() => ({}));
        if (!response.ok) {
          const key = `library.error.${reply.reason}`;
          problem.textContent = reply.reason && t(key) !== key ? t(key) : reply.error || t("sources.failed");
          return;
        }
        close();
        await openInProcess(c, process.value, reply.id ?? id);
      } catch {
        problem.textContent = t("sources.failed");
      }
    },
  });
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout praddpop libaddpop", role: "dialog", "aria-label": t("library.addtitle").replace("{name}", name) }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("library.addtitle").replace("{name}", name) }), el("div", { class: "statebuttons" }, [add, actionLink("close", { onclick: close })])]),
      el("p", { class: "muted sm", text: t(c.direction === "destination" ? "library.addsubdest" : "library.addsubsource") }),
      el("div", { class: "newsource stacked" }, [
        el("div", { class: "kf" }, [el("label", { for: "lib-process", text: t("library.process") }), process]),
        el("div", { class: "kf" }, [el("label", { for: "lib-name", text: t("httpsout.name") }), nameInput]),
      ]),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
  nameInput.focus();
}

function render(failed = false) {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const chips = el(
    "div",
    { class: "rmfilters", id: "lib-filters" },
    FILTERS.map((f) => {
      const b = el("button", { type: "button", class: `rmchip${f === filter ? " on" : ""}`, text: t(`library.filter.${f}`) });
      b.onclick = () => {
        filter = f;
        render();
      };
      return b;
    })
  );
  const cards = library.connectors.filter(shown).map(card);
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("library.heading"), t("library.subtitle")),
        el("div", { class: "panel" }, [chips, el("p", { class: "muted sm", text: t("library.note") })]),
        ...(partnerFailed && !failed ? [el("div", { class: "warn", id: "lib-partnerfailed", text: t("library.partnerfailed") })] : []),
        failed ? el("div", { class: "warn", text: t("library.failed") }) : el("div", { class: "libgrid", id: "lib-grid" }, cards),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("routelibrary");
  filter = "all";
  const ok = await load();
  render(!ok);
}

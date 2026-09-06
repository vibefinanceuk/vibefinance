import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";

/**
 * Where invoices arrive — decision 0126.
 *
 * The first configuration screen. Everything a customer has configured
 * so far has been `curl`, which is fine for an operator and not for the
 * administrator decision 0117 gives them.
 */

let sources = [];

async function load() {
  const response = await fetch("/api/sources");
  if (!response.ok) return false;
  sources = (await response.json()).sources ?? [];
  return true;
}

/**
 * Give an email source its address.
 *
 * **Generated, not chosen** — a customer picking a local part would
 * collide with another customer they have never heard of. The button
 * says so by asking for nothing.
 */
async function claimAddress(sourceId) {
  const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/email`, {
    method: "POST",
  });
  const body = await response.json();

  if (!response.ok) {
    note(body.detail ?? body.error ?? t("sources.failed"));
    return;
  }

  await load();
  render();
  note(body.detail ?? "");
}

function note(message) {
  const box = document.getElementById("sources-note");
  if (box) box.textContent = message;
}

/**
 * One source, and what it is waiting for.
 *
 * **The routing state is shown, not hidden.** An address that looks
 * live while nothing delivers to it would send somebody to tell their
 * suppliers an address that swallows invoices — decision 0126 reports
 * `not_configured` for exactly this reason.
 */
function sourceRow(source) {
  const cells = [
    el("td", { text: source.name }),
    el("td", { class: "muted", text: source.mechanism }),
    el("td", { class: "muted", text: source.processId }),
  ];

  if (source.mechanism !== "email") {
    // An address means nothing to an SFTP feed, and an empty cell says
    // that better than a disabled button.
    cells.push(el("td", { class: "muted", text: "—" }));
  } else if (source.emailAddress) {
    cells.push(
      el("td", {}, [
        el("div", { class: "addr", text: source.emailAddress }),
        el("div", {
          class: source.emailRouting === "active" ? "muted" : "pending",
          text: t(`routing.${source.emailRouting}`),
        }),
      ])
    );
  } else {
    cells.push(
      el("td", {}, [
        el("button", {
          text: t("sources.claim"),
          onclick: () => claimAddress(source.id),
        }),
      ])
    );
  }

  return el("tr", {}, cells);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.sources"), t("sources.subtitle")),
        el("div", { class: "panel" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("sources.name") }),
                el("th", { text: t("sources.mechanism") }),
                el("th", { text: t("sources.process") }),
                el("th", { text: t("sources.address") }),
              ]),
            ]),
            el(
              "tbody",
              {},
              sources.length
                ? sources.map(sourceRow)
                : [el("tr", {}, [el("td", { class: "muted", colspan: "4", text: t("sources.empty") })])]
            ),
          ]),
        ]),
        el("div", { class: "problem", id: "sources-note", role: "status" }),
      ])
    )
  );
}

export async function openSources() {
  setCurrentScreen("sources");
  if (!(await load())) {
    note(t("sources.failed"));
    return;
  }
  render();
}

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
let processes = [];

async function load() {
  const [sourceResponse, processResponse] = await Promise.all([
    fetch("/api/sources"),
    fetch("/api/processes"),
  ]);
  if (!sourceResponse.ok) return false;

  sources = (await sourceResponse.json()).sources ?? [];
  // **A source must belong to a process**, so the form cannot be
  // offered without them. A failure here is not fatal to the list.
  processes = processResponse.ok ? (await processResponse.json()).processes ?? [] : [];
  return true;
}

/**
 * Create a source — decision 0128.
 *
 * The id is derived from the name rather than asked for. **A person
 * configuring where their invoices arrive should not be inventing
 * identifiers**, and every id this screen creates is one nobody will
 * ever type again.
 */
async function createSource() {
  const name = document.getElementById("new-name").value.trim();
  const mechanism = document.getElementById("new-mechanism").value;
  const processId = document.getElementById("new-process").value;

  if (name === "") {
    note(t("sources.needname"));
    return;
  }

  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name, mechanism }),
  });
  const body = await response.json();

  if (!response.ok) {
    note(body.error ?? t("sources.failed"));
    return;
  }

  await load();
  render();
  note("");
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

/**
 * The form, below the list.
 *
 * **Below rather than above**, because a person arrives to look at what
 * exists far more often than to add to it — and a form at the top makes
 * every visit start with a blank box.
 */
function newSourcePanel() {
  if (processes.length === 0) {
    // **No process, no source.** Said plainly rather than offering a
    // form that cannot succeed.
    return el("div", { class: "panel" }, [
      el("h3", { text: t("sources.new") }),
      el("p", { class: "muted", text: t("sources.noprocess") }),
    ]);
  }

  const mechanisms = el("select", { id: "new-mechanism" });
  for (const value of ["email", "https", "sftp", "file_import", "edi"]) {
    mechanisms.append(el("option", { value, text: t(`mechanism.${value}`) }));
  }

  const processPicker = el("select", { id: "new-process" });
  for (const process of processes) {
    processPicker.append(
      el("option", {
        value: process.id,
        // A process with no stages accepts documents and does nothing
        // with them — worth seeing before pointing a source at it.
        text: process.stageCount > 0 ? process.name : `${process.name} · ${t("sources.nostages")}`,
      })
    );
  }

  return el("div", { class: "panel" }, [
    el("h3", { text: t("sources.new") }),
    el("div", { class: "newsource" }, [
      el("div", { class: "kf" }, [
        el("label", { for: "new-name", text: t("sources.name") }),
        el("input", { id: "new-name", type: "text", placeholder: t("sources.nameexample") }),
      ]),
      el("div", { class: "kf" }, [
        el("label", { for: "new-mechanism", text: t("sources.mechanism") }),
        mechanisms,
      ]),
      el("div", { class: "kf" }, [
        el("label", { for: "new-process", text: t("sources.process") }),
        processPicker,
      ]),
      el("button", { class: "primary", text: t("sources.create"), onclick: createSource }),
    ]),
  ]);
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
        newSourcePanel(),
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

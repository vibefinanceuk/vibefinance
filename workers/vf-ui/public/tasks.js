/**
 * The Task Manager — decision 0103.
 *
 * One list across every stage. A person may hold work at Validation and
 * at Approval at once, and a queue that made them choose a stage first
 * would ask them to know what they are trying to find out.
 *
 * **The buttons are not decided here.** Each task arrives carrying its
 * own `actions`, computed by the same rules that enforce them — so a
 * button that appears is one the server will honour. Deriving them in
 * the browser would mean two versions of one rule, which drift.
 */

import { t } from "/strings.js";

const shell = document.getElementById("shell");

/** Set once the page knows who it is talking to. */
let me = null;
let filters = { stage: "", ownership: "" };
/** The last rows loaded, so opening a task does not refetch it. */
let lastTasks = [];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    // textContent, never innerHTML: everything below is data from an
    // API rendered into a page, and a supplier name is exactly the
    // field somebody would try to put a script tag in.
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** How long a task has waited, which is the thing that costs money. */
function waitedFor(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor((Date.now() - then) / 3600000);
  return hours >= 1 ? `${hours}h` : "just now";
}

function money(subject) {
  if (!subject || subject.totalWithVat === null || subject.totalWithVat === undefined) return "—";
  const amount = subject.totalWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 });
  return subject.currency ? `${amount} ${subject.currency}` : amount;
}

/**
 * What a row says about a document nobody could read.
 *
 * Many tasks sit on invoices intake could not extract — no supplier, no
 * amount, no date. A row of dashes is honest and useless, so it says
 * what it is instead: the reason the task exists at all.
 */
function describe(subject) {
  if (!subject) return t("tasks.nodocument");
  if (subject.supplierVatId) return subject.supplierVatId;
  return subject.type === "invoice" ? t("tasks.notkeyed") : subject.type;
}

function ownershipLabel(task) {
  if (task.ownership === "mine") return t("tasks.mine");
  if (task.ownership === "available") return t("tasks.available");
  // Who holds it and since when. "Locked" alone cannot distinguish five
  // minutes ago from since Tuesday, and those mean different things to
  // somebody deciding whether to ask.
  const since = task.lockedBy?.since ? ` · ${waitedFor(task.lockedBy.since)}` : "";
  return `${task.lockedBy?.name ?? "Someone"}${since}`;
}

/** Labels come from the control plane, by key (decision 0107). */
const actionLabel = (action) => t(`action.${action}`);

async function act(taskId, action) {
  // Keying opens a screen rather than calling anything (decision 0106).
  if (action === "key") {
    const task = lastTasks.find((t) => t.id === taskId);
    if (task) {
      const { openViewer } = await import("/viewer.js");
      document.getElementById("shell").hidden = true;
      document.getElementById("viewer").hidden = false;
      openViewer(task, async () => {
        document.getElementById("viewer").hidden = true;
        document.getElementById("shell").hidden = false;
        // Reloaded on the way back, because keying changes what the row
        // says about the document.
        await loadTasks();
      });
    }
    return;
  }

  // Only the two the proxy permits today. The rest are listed by the
  // server and not yet reachable — shown disabled rather than hidden,
  // so the list does not quietly disagree with what the task says.
  if (action !== "claim" && action !== "release") return;

  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    problem(body.error ?? `Could not ${action} that task.`);
    return;
  }
  await loadTasks();
}

function problem(message) {
  document.getElementById("problem").textContent = message;
}

function taskRow(task) {
  const actions = task.actions.map((action) =>
    el("button", {
      class: "act",
      text: actionLabel(action),
      // Actions the proxy does not yet carry are shown and disabled.
      ...(action === "claim" || action === "release" || action === "key"
        ? {}
        : { disabled: "disabled" }),
      onclick: () => act(task.id, action),
    })
  );

  return el("tr", { class: task.ownership }, [
    el("td", { text: task.stageName ?? task.stageId }),
    el("td", { text: describe(task.subject) }),
    el("td", { class: "num", text: money(task.subject) }),
    el("td", { text: waitedFor(task.createdAt) }),
    el("td", { text: ownershipLabel(task) }),
    el("td", {}, actions.length ? actions : [el("span", { class: "muted", text: "—" })]),
  ]);
}

async function loadTasks() {
  problem("");
  const query = new URLSearchParams();
  if (filters.stage) query.set("stage", filters.stage);
  if (filters.ownership) query.set("ownership", filters.ownership);

  const response = await fetch(`/api/tasks?${query}`);
  if (!response.ok) {
    problem(t("tasks.loadfailed"));
    return;
  }

  const { tasks, counts, total } = await response.json();
  lastTasks = tasks;
  const body = document.getElementById("rows");
  body.replaceChildren(
    ...(tasks.length
      ? tasks.map(taskRow)
      : [el("tr", {}, [el("td", { colspan: "6", class: "muted", text: t("tasks.empty") })])])
  );

  // Counts survive paging but not filtering (decision 0103), so these
  // describe what the person is currently looking at.
  document.getElementById("counts").textContent =
    `${total} shown · ${counts.mine} mine · ${counts.available} available · ${counts.locked} held`;
}

function filterBar() {
  const stages = el("select", {
    onchange: (event) => {
      filters.stage = event.target.value;
      loadTasks();
    },
  });
  stages.append(el("option", { value: "", text: t("tasks.allstages") }));
  for (const [id, name] of [
    ["received", "Received"],
    ["validation", "Validation"],
    ["matching", "Matching"],
    ["coding", "Coding"],
    ["approval", "Approval"],
    ["review", "Review"],
  ]) {
    stages.append(el("option", { value: id, text: name }));
  }

  const ownership = el("select", {
    onchange: (event) => {
      filters.ownership = event.target.value;
      loadTasks();
    },
  });
  for (const [value, key] of [
    ["", "tasks.everything"],
    ["mine", "tasks.mine"],
    ["available", "tasks.available"],
    ["locked", "tasks.locked"],
  ]) {
    ownership.append(el("option", { value, text: t(key) }));
  }

  return el("div", { class: "filters" }, [stages, ownership]);
}

function render() {
  shell.replaceChildren(
    el("header", {}, [
      el("div", { class: "mark" }),
      el("div", {}, [
        el("h1", { id: "product", text: "VibeFinance" }),
        el("p", { class: "sub", text: `${me.name} · ${me.environmentId ?? ""}` }),
      ]),
      el("button", {
        class: "signout",
        text: t("tasks.signout"),
        onclick: async () => {
          await fetch("/api/sign-out", { method: "POST" });
          location.reload();
        },
      }),
    ]),
    filterBar(),
    el("p", { class: "counts", id: "counts" }),
    el("table", {}, [
      el(
        "thead",
        {},
        [
          el("tr", {}, [
            el("th", { text: t("tasks.stage") }),
            el("th", { text: t("tasks.supplier") }),
            el("th", { class: "num", text: t("tasks.amount") }),
            el("th", { text: t("tasks.waiting") }),
            el("th", { text: t("tasks.owner") }),
            el("th", { text: "" }),
          ]),
        ]
      ),
      el("tbody", { id: "rows" }),
    ]),
    el("div", { class: "problem", id: "problem", role: "alert" })
  );
}

/**
 * Ask who we are before rendering anything.
 *
 * **This is what makes a surviving session visible.** The cookie
 * persists across a refresh (decision 0102), and until now nothing
 * asked — so a reload showed an empty sign-in form while the session
 * was perfectly alive.
 */
export async function start() {
  const response = await fetch("/api/whoami");
  if (!response.ok) return false;

  me = await response.json();
  render();
  await loadTasks();
  return true;
}

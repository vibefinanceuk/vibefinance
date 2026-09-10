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
import { moodPicker } from "/mood.js";

const shell = document.getElementById("shell");

/** Set once the page knows who it is talking to. */
let me = null;
let filters = { stage: "", ownership: "" };
/** The last rows loaded, so opening a task does not refetch it. */
let lastTasks = [];

/**
 * **Exported since decision 0126**, because a third screen would have
 * been a third copy. It was private and duplicated in `viewer.js`,
 * which is two definitions of what an element is and one of them
 * eventually drifting.
 */
export function el(tag, props = {}, children = []) {
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
/**
 * What this task is about — decision 0183.
 *
 * A stage scoped `per_line` (decision 0027) raises **one task per
 * invoice line**, so an eight-line invoice produces eight rows naming
 * the same supplier, the same amount and the same stage.
 *
 * **Eight identical rows teach somebody the list is broken.** The line
 * is what tells them apart, and what they work through in order.
 */
function describeTask(task) {
  const who = describe(task.subject);
  return task.lineNumber
    ? `${who} · ${t("tasks.line")} ${task.lineNumber}`
    : who;
}

function describe(subject) {
  if (!subject) return t("tasks.nodocument");
  // The seller's NAME first, and its identifier only when the document
  // gave no name (decision 0112). A person scanning a queue is looking
  // for a company, not a tax number.
  if (subject.supplierName) return subject.supplierName;
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

/**
 * Open a task's document — decision 0142.
 *
 * **Not an action the server authorises.** Whether somebody may look at
 * a task is already decided by the task being theirs; what they may
 * *do* once looking is decided by the actions it reports (decision
 * 0103), and what they may *edit* by field visibility at that stage
 * (decision 0114).
 *
 * So this is navigation, and it works for **any** task — an approval
 * task opens the same screen as a validation one, with the amounts
 * read-only because Approval says so and with Complete and Return in
 * place of Save.
 *
 * *"Approvers should approve data, not edit data"* is configuration,
 * not a second screen.
 */
async function openTask(taskId) {
  const task = lastTasks.find((t) => t.id === taskId);
  if (!task?.subject) return;

  const { openViewer } = await import("/viewer.js");
  document.getElementById("shell").hidden = true;
  document.getElementById("viewer").hidden = false;
  await openViewer(task, async () => {
    document.getElementById("viewer").hidden = true;
    document.getElementById("shell").hidden = false;
    await loadTasks();
  });
}

async function act(taskId, action) {
  // Keying opens a screen rather than calling anything (decision 0106).
  if (action === "key") {
    const task = lastTasks.find((t) => t.id === taskId);
    if (task) {
      const { openViewer } = await import("/viewer.js");
      document.getElementById("shell").hidden = true;
      document.getElementById("viewer").hidden = false;
      await openViewer(task, async () => {
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
      // **Every action works now** (decision 0138). This listed three
      // and disabled the rest, which was true until the proxy carried
      // them and three routes accepted a session.
      onclick: () => act(task.id, action),
    })
  );

  return el("tr", { class: task.ownership }, [
    el("td", { text: task.stageName ?? task.stageId }),
    // **The document, clickable** — decision 0142. A row names a
    // document, and looking at one is the first thing anybody wants to
    // do with it; making that a button among the actions would put
    // navigation where decisions live.
    el("td", {}, [
      task.subject
        ? el("button", {
            class: "subjectlink",
            text: describeTask(task),
            onclick: () => openTask(task.id),
          })
        : el("span", { class: "muted", text: describeTask(task) }),
    ]),
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

/**
 * The persistent frame — decision 0108.
 *
 * Navigation and identity stay put while the middle changes, so opening
 * a document feels like looking at something rather than going
 * somewhere and having to find the way back.
 *
 * **One entry today**, because there is nowhere else to go. It exists
 * now so that everything added later sits inside it rather than being
 * retrofitted into one.
 */
/** Which screen the frame is showing, so the nav can mark it. */
let current = "tasks";

/**
 * Tell the frame which screen is rendering — decision 0126.
 *
 * **Set by the screen, not inferred by the nav.** `go()` knows because
 * it was called; a screen opened any other way does not, and a nav
 * marking the wrong entry is worse than one marking none.
 */
export function setCurrentScreen(screen) {
  current = screen;
}

/**
 * Move between screens — decision 0126.
 *
 * **No router, and no history.** One screen has existed until now, so
 * a URL scheme would be a guess at what the second and third want. A
 * function call is honest about that, and the day the back button
 * matters is the day to design it properly.
 */
async function go(screen) {
  current = screen;
  if (screen === "sources") {
    const { openSources } = await import("/sources.js");
    await openSources();
  } else if (screen === "rules") {
    const { open } = await import("/rules.js");
    await open();
  } else if (screen === "documents") {
    const { open } = await import("/documents.js");
    await open();
  } else {
    /**
     * **Rebuild the screen, then fill it** — decision 0191.
     *
     * This called `loadTasks()` alone, which fetches and updates the
     * table. That is right when Tasks is already on screen and does
     * nothing at all when it is not — so Tasks was unreachable from
     * Sources, Rules and Documents, each of which replaces the shell
     * with its own.
     *
     * The other three branches call something that renders. This one
     * assumed it was already rendered, which was true when it was the
     * only screen.
     */
    render();
    await loadTasks();
  }
}

export function frame(main) {
  return el("div", { class: "frame" }, [
    el("nav", { class: "nav" }, [
      /**
       * The mark, at the head of the column — decision 0145.
       *
       * It sat at the foot first, on the argument that the top of a
       * sidebar is where somebody looks to move. **The operator wanted
       * it at the top**, which is the conventional place and the one
       * people look for when orienting themselves rather than
       * navigating — and small enough that it does not compete.
       *
       * Replaces the 30×3 dash decision 0108 left as a placeholder,
       * which is what a placeholder is for.
       *
       * `alt` is empty on purpose: the name is in the page title, and a
       * screen reader announcing "VibeFinance logo" before every
       * navigation is noise rather than information.
       */
      el("img", { class: "brandmark dark", src: "/img/logo.png", alt: "" }),
      el("img", { class: "brandmark light", src: "/img/logo-light.png", alt: "" }),
      // **Each entry names itself** — decision 0149.
      //
      // This read `current === "sources" ? "" : "on"`, written when
      // there were two screens and "not sources" therefore meant
      // "tasks". A third screen made that wrong, and it marked Tasks
      // while showing Rules.
      //
      // A comparison that only works while a list has two members is a
      // comparison that breaks silently when it gains a third.
      el("a", {
        class: current === "tasks" ? "on" : "",
        text: t("nav.tasks"),
        onclick: () => go("tasks"),
      }),
      el("a", {
        class: current === "sources" ? "on" : "",
        text: t("nav.sources"),
        onclick: () => go("sources"),
      }),
      el("a", {
        class: current === "rules" ? "on" : "",
        text: t("nav.rules"),
        onclick: () => go("rules"),
      }),
      el("a", {
        class: current === "documents" ? "on" : "",
        text: t("nav.documents"),
        onclick: () => go("documents"),
      }),
      el("div", { class: "who" }, [
        el("div", { text: me?.name ?? "" }),
        el("div", { class: "muted", text: me?.environmentId ?? "" }),
      ]),
    ]),
    el("div", { class: "main", id: "main" }, [main]),
  ]);
}

/** The document's identity, and where to go from here. */
/**
 * @param extra lines beneath the subtitle, **inside** the topbar.
 *
 * The rule under a topbar separates the heading from the page, so
 * anything that identifies the document belongs above it — decision
 * 0176. Waiting and Owner sat below, which read as the first row of
 * content rather than as part of the heading.
 */
export function topbar(title, subtitle, right = [], extra = []) {
  return el("div", { class: "topbar" }, [
    el("div", {}, [
      el("h2", { text: title }),
      el("p", { class: "sub", text: subtitle }),
      ...extra,
    ]),
    // **Every screen, because the frame carries it** (decision 0108).
    // A preference offered on one screen and not another is one
    // somebody has to remember where to find.
    el("div", { class: "right" }, [...right, moodPicker(t)]),
  ]);
}

function render() {
  document.body.classList.add("working");
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.tasks"), `${me.name} · ${me.environmentId ?? ""}`, [
          el("button", {
            text: t("tasks.signout"),
            onclick: async () => {
              await fetch("/api/sign-out", { method: "POST" });
              location.reload();
            },
          }),
        ]),
        filterBar(),
        el("p", { class: "counts", id: "counts" }),
        // The list in a panel of its own, like everything else
        // (decision 0108).
        el("div", { class: "panel" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("tasks.stage") }),
                el("th", { text: t("tasks.supplier") }),
                el("th", { class: "num", text: t("tasks.amount") }),
                el("th", { text: t("tasks.waiting") }),
                el("th", { text: t("tasks.owner") }),
                el("th", { text: "" }),
              ]),
            ]),
            el("tbody", { id: "rows" }),
          ]),
        ]),
        el("div", { class: "problem", id: "problem", role: "alert" }),
      ])
    )
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

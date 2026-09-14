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

import { t, languagePicker } from "/strings.js";
import { moodPicker } from "/mood.js";
import { orgPicker } from "/orgs.js";
import { icon } from "/icons.js";

const shell = document.getElementById("shell");

/** Set once the page knows who it is talking to. */
let me = null;
let filters = { stage: "", ownership: "" };

/**
 * The stages the task list has seen — decision 0254.
 *
 * A `Map` so a stage appearing twice is one option, and insertion
 * order so they read in the order the list returned them.
 */
let knownStages = new Map();
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
  /**
   * **"Key" is redundant now, decision 0288** — matching decision
   * 0287's own reasoning for Documents. The row itself opens the
   * viewer; a button whose only effect was also opening the viewer
   * duplicates it rather than doing something different. Every other
   * action (Claim, Release, Complete, Return) stays, since each does
   * something the row's own click does not.
   */
  const actions = task.actions
    .filter((action) => action !== "key")
    .map((action) =>
      el("button", {
        class: "act",
        text: actionLabel(action),
        // **Every action works now** (decision 0138). This listed three
        // and disabled the rest, which was true until the proxy carried
        // them and three routes accepted a session.
        onclick: (event) => {
          // The row itself opens the same document this button sits on
          // top of — without this, clicking Claim would also open it.
          event.stopPropagation();
          act(task.id, action);
        },
      })
    );

  return el(
    "tr",
    {
      class: `${task.ownership} clickable`,
      /**
       * **The row opens the document** — decision 0288, matching
       * decision 0287's own change to Documents and decision 0250's
       * original reasoning on the dashboard: a row that names a
       * document and does nothing when clicked is worse than one that
       * does not look clickable at all.
       */
      onclick: () => openTask(task.id),
    },
    [
      el("td", { text: task.stageName ?? task.stageId }),
      // **Plain text, not its own button, decision 0288.** The row
      // itself is what opens the document now; a second clickable
      // element inside a clickable row would fire twice on a click
      // here — its own handler, then the row's again once the click
      // bubbles up to it. The same fix decision 0287 already made for
      // the Documents list's own number cell.
      el("td", {}, [
        task.subject
          ? el("span", { text: describeTask(task) })
          : el("span", { class: "muted", text: describeTask(task) }),
      ]),
      el("td", { class: "num", text: money(task.subject) }),
      el("td", { text: waitedFor(task.createdAt) }),
      el("td", { text: ownershipLabel(task) }),
      el("td", {}, actions.length ? actions : [el("span", { class: "muted", text: "—" })]),
    ]
  );
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

  /**
   * **Remember every stage seen** — decision 0254, so the filter offers
   * the customer's own rather than six named by hand.
   *
   * Only added to, never replaced: filtering to one stage should not
   * shrink the list of stages you can filter to.
   */
  for (const task of tasks) {
    if (task.stageId && task.stageName) knownStages.set(task.stageId, task.stageName);
  }
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

  /**
   * **The customer's own stages** — decision 0254.
   *
   * Six were named here by hand, which decision 0239 called the trap in
   * the dashboard and did not check for here: `process_stages` is
   * customer data, a customer may rename one, and a list that does not
   * contain a stage cannot select it.
   *
   * `knownStages` is filled from whatever the task list returns, so it
   * offers what actually exists.
   */
  for (const [id, name] of knownStages) {
    stages.append(el("option", { value: id, text: name }));
  }

  /**
   * **And it shows the filter that is in force.** Arriving from a
   * dashboard card set `filters.stage` and the select still read *all
   * stages*, so the list was filtered and said it was not.
   */
  stages.value = filters.stage;

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

  /**
   * **Set after the options exist, like the stage select beside it** —
   * decision 0256. A `select`'s `value` attribute has nothing to bind
   * to at construction, before any `option` is a child of it.
   *
   * Decision 0254 fixed exactly this for `stages` and left `ownership`
   * with the same fault: arriving from a dashboard card set
   * `filters.ownership = "mine"`, the list filtered to mine correctly,
   * and the dropdown kept showing *Everything* — so five items looked
   * like all of them when four were hidden.
   */
  ownership.value = filters.ownership;

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
/**
 * Open the task list already filtered — decision 0250.
 *
 * **The filters existed and nothing else could set them.** A stage card
 * on the dashboard says *"eleven at Approval, three of them mine"*, and
 * the obvious next question is *"show me those three"* — which the task
 * list could already answer and had no way of being asked.
 */
export async function openTasksFiltered(next) {
  filters = { stage: next.stage ?? "", ownership: next.ownership ?? "" };
  await go("tasks");
}

/**
 * Open one document from anywhere — decision 0250.
 *
 * The worklist on the dashboard names an invoice and could not open it.
 * **A row that reads like a link and does nothing is worse than a row
 * that does not**, because somebody clicks it twice before believing.
 */
export async function openTaskById(task) {
  const { openViewer } = await import("/viewer.js");
  document.getElementById("shell").hidden = true;
  document.getElementById("viewer").hidden = false;
  await openViewer(task, async () => {
    document.getElementById("viewer").hidden = true;
    document.getElementById("shell").hidden = false;
    await go(current);
  });
}

async function go(screen) {
  current = screen;
  if (screen === "sources") {
    const { openSources } = await import("/sources.js");
    await openSources();
  } else if (screen === "rules") {
    const { open } = await import("/rules.js");
    await open();
  } else if (screen === "dashboard") {
    const { open } = await import("/dashboard.js");
    await open();
  } else if (screen === "suppliers") {
    const { open } = await import("/suppliers.js");
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

/**
 * The nav's own folded state — decision 0274.
 *
 * **Persisted the same way mood is** (decision 0139): a person's own
 * setting, not a customer's, and a browser refusing storage still
 * gets a usable nav, just one that forgets the choice next visit.
 */
const NAV_COLLAPSED_KEY = "vf-nav-collapsed";

function navCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setNavCollapsed(collapsed) {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // The nav is still usable this session either way.
  }
}

/**
 * **Which permission unlocks which menu item** — decision 0276, the
 * operator's own instruction to "underpin with some kind of role, menu
 * mapping so that we can control who sees certain menus," now that a
 * Role permissions screen for an administrator is a real, named future
 * plan rather than a someday idea.
 *
 * Reuses whatever the underlying screen's own API already requires
 * wherever one exists (`Admin.Configure` for Sources, `Admin.RuleManagement`
 * for Rules, `AP.Review` for Documents) rather than inventing a second,
 * nav-only notion of access that could drift from what the API
 * actually enforces. Dashboard, Tasks and Suppliers had no such
 * permission to reuse — see decision 0276 for the three added
 * specifically for this.
 *
 * A person with none of these sees an empty nav below the logo, which
 * is an honest description of an account with no AP role assigned yet
 * — not a bug to guard against.
 */
const NAV_PERMISSIONS = {
  dashboard: "AP.Dashboard",
  tasks: "AP.TaskView",
  sources: "Admin.Configure",
  suppliers: "AP.Supplier",
  rules: "Admin.RuleManagement",
  documents: "AP.Review",
};

/** One nav entry: an icon, a label, and which screen it opens. */
function navLink(screen, iconName) {
  return el(
    "a",
    {
      class: `navitem${current === screen ? " on" : ""}`,
      title: t(`nav.${screen}`),
      onclick: () => go(screen),
    },
    [icon(iconName), el("span", { class: "navlabel", text: t(`nav.${screen}`) })]
  );
}

export function frame(main) {
  /**
   * **A flat list again, decision 0276** — the "Vibe AP" group
   * decision 0274 built was reverted at the operator's own request:
   * "I've decided that the sub menu... looks bad... I'd like to
   * revert that change, so that no sub menu exists and the menu items
   * beneath it are always displayed." The icons, the rename, and the
   * fold-to-icons toggle it shipped alongside all stayed — only the
   * grouping wrapper is gone.
   */
  const SCREENS = [
    ["dashboard", "dashboard"],
    ["tasks", "tasks"],
    ["sources", "sources"],
    ["suppliers", "suppliers"],
    ["rules", "rules"],
    ["documents", "documents"],
  ];
  const navItems = SCREENS.filter(([screen]) => me?.permissions?.includes(NAV_PERMISSIONS[screen])).map(
    ([screen, iconName]) => navLink(screen, iconName)
  );

  const navEl = el("nav", { class: navCollapsed() ? "nav collapsed" : "nav" }, [
    /**
     * The mark, at the head of the column — decision 0145.
     *
     * It sat at the foot first, on the argument that the top of a
     * sidebar is where somebody looks to move. **The operator wanted
     * it at the top**, which is the conventional place and the one
     * people look for when orienting themselves rather than
     * navigating — and small enough that it does not compete.
     *
     * **A third image, decision 0274**: `navmark` is the same "V" the
     * full wordmark already draws as its first letter, cropped from
     * the same source rather than redrawn — shown only when the nav
     * is folded to icons, in place of the full logo neither collapsed
     * width can hold.
     *
     * `alt` is empty on purpose: the name is in the page title, and a
     * screen reader announcing "VibeFinance logo" before every
     * navigation is noise rather than information.
     */
    el("img", { class: "brandmark dark", src: "/img/logo.png", alt: "" }),
    el("img", { class: "brandmark light", src: "/img/logo-light.png", alt: "" }),
    el("img", { class: "navmark", src: "/img/logo-mark.png", alt: "" }),
    ...navItems,
    el("div", { class: "who" }, [
      el("div", { text: me?.name ?? "" }),
      el("div", { class: "muted", text: me?.environmentId ?? "" }),
    ]),
  ]);

  /**
   * **The nav itself is the toggle, decision 0311** — reported live:
   * "remove the collapse and expand button from the side menu... the
   * collapse and expand functionality happen when a user clicks on
   * the side menu, if they do not select a button that redirects to
   * another screen." A click anywhere in `navEl` bubbles here;
   * `.closest(\".navitem\")` tells a real navigation click apart from
   * everywhere else in the nav — the logo, `.who`, the empty space a
   * `.navcollapsetoggle` button used to occupy — without needing
   * `stopPropagation()` on every nav item individually.
   *
   * **Toggles the class directly, not a re-render** — decision 0274's
   * own reasoning, unchanged. Every other choice on this nav already
   * lives as a DOM class a click can flip; folding the whole nav is
   * the same kind of change, not a reason to rebuild the screen
   * underneath it.
   */
  navEl.onclick = (e) => {
    if (e.target.closest(".navitem")) return;
    const collapsed = !frameEl.classList.contains("collapsed");
    frameEl.classList.toggle("collapsed", collapsed);
    navEl.classList.toggle("collapsed", collapsed);
    setNavCollapsed(collapsed);
  };

  const frameEl = el("div", { class: navCollapsed() ? "frame collapsed" : "frame" }, [
    navEl,
    el("div", { class: "main", id: "main" }, [main]),
  ]);
  return frameEl;
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
    el(
      "div",
      {},
      [
        el("h2", { text: title }),
        // **Omitted rather than rendered empty** — decision 0312. A
        // `<p class="sub">` with nothing in it still occupies its own
        // line-height, leaving a visible gap between the title and
        // whatever `extra` renders beneath it; the same "nothing to
        // show" reasoning decision 0161 already gives a button applies
        // here to a line of text.
        subtitle ? el("p", { class: "sub", text: subtitle }) : null,
        ...extra,
      ].filter(Boolean)
    ),
    /**
     * **Every screen, because the frame carries it** (decision 0108).
     * A preference offered on one screen and not another is one
     * somebody has to remember where to find.
     *
     * **Sign out joined it here, decision 0283.** It used to be the
     * Tasks screen's own, one-off addition to its own topbar call —
     * present on Tasks, absent everywhere else, the exact class of
     * gap this comment already named for the mood picker. Built the
     * same way `actionLink()` builds every other icon-and-label
     * button (viewer.js's own document actions, a card's "Change
     * Seller") rather than imported from there directly: tasks.js is
     * already what viewer.js imports `topbar` from, and importing
     * `actionLink` back the other way would be a circular one.
     */
    el("div", { class: "right" }, [
      ...right,
      /**
       * **A rule between what this page added and what every screen
       * has** — decision 0304, from a mock-up: "a small vertical
       * line... which distinguishes the standard set of icons, Night
       * / Day, Language & Sign out, from the other page specific
       * icons which would appear to the left."
       *
       * **Only when there is something to separate.** Most screens
       * pass nothing of their own into `right` — Documents, Suppliers
       * — and a rule with nothing to its left is a stray mark, not a
       * boundary.
       */
      right.length > 0 ? el("div", { class: "topbardivider" }) : null,
      moodPicker(t),
      /**
       * **The org switcher, decision 0313** — reported live: "the
       * ability for a user to switch between Orgs." `me` is already
       * populated by the time any screen's own `topbar()` call runs,
       * since `start()` awaits `/api/whoami` before rendering
       * anything — the same reasoning that already lets this file's
       * own render call read `me.name` directly, two lines below this
       * function.
       */
      orgPicker(me?.units ?? [], me?.holdsEverywhere ?? false),
      /**
       * **Language, between Night/Day and Sign out** — decision 0302,
       * reported live: "At the top of the page, between Night / Day,
       * and Sign out... add a Language button."
       */
      languagePicker(),
      el(
        "button",
        {
          class: "actionlink",
          title: t("tasks.signout"),
          onclick: async () => {
            await fetch("/api/sign-out", { method: "POST" });
            location.reload();
          },
        },
        [icon("signout"), el("span", { text: t("tasks.signout") })]
      ),
    ].filter(Boolean)),
  ]);
}

function render() {
  document.body.classList.add("working");
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.tasks"), `${me.name} · ${me.environmentId ?? ""}`),
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

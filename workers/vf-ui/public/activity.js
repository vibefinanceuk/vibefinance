import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * The activity panel — decision 0267.
 *
 * **Hidden by default, opens into real room** — the operator's own
 * words: "it can be hidden but also opened." A tab at the edge when
 * closed; a wide drawer when open, not a strip squeezed into whatever
 * space was left over.
 *
 * **Self-contained.** `viewer.js` rebuilds its whole shell on every
 * render (`shell.replaceChildren(...)`), which would reset this
 * panel's own open/closed state and throw away whatever was loaded —
 * so this manages its own container directly rather than depending on
 * the viewer re-inserting it. `activityPanel()` is called once per
 * document; everything after that is this module updating the same
 * node.
 */

let open = false;
let items = null;
let loading = false;
let error = null;

function reset() {
  open = false;
  items = null;
  loading = false;
  error = null;
}

async function load(invoiceId, container) {
  loading = true;
  error = null;
  renderInto(container, invoiceId);

  const response = await fetch(`/api/documents/${encodeURIComponent(invoiceId)}/activity`);
  if (!response.ok) {
    loading = false;
    error = t("activity.loadfailed");
    renderInto(container, invoiceId);
    return;
  }

  items = (await response.json()).items ?? [];
  loading = false;
  renderInto(container, invoiceId);
}

async function post(invoiceId, container) {
  const box = document.getElementById("activity-input");
  const body = box?.value.trim();
  if (!body) return;

  const button = document.getElementById("activity-post");
  if (button) button.disabled = true;

  const response = await fetch(`/api/documents/${encodeURIComponent(invoiceId)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    error = t("activity.postfailed");
    if (button) button.disabled = false;
    renderInto(container, invoiceId);
    return;
  }

  // **Reload rather than append locally** — the same read-after-write
  // discipline the rest of this app follows: the server's own
  // ordering and timestamp are what render, not a client guess at
  // what it just sent.
  await load(invoiceId, container);
}

/**
 * One fired rule, in words — the same closed-vocabulary phrasing
 * `activity-route.ts` builds server-side, simply joined for reading.
 */
function ruleFiredLine(item) {
  const actions = (item.actionDescriptions ?? []).join(" and ");
  return t("activity.rulefired").replace("{rule}", item.ruleName).replace("{actions}", actions);
}

function systemMessage(item) {
  if (item.kind === "received") return t("activity.received");
  if (item.kind === "stage_completed") {
    return t("activity.stagecompleted").replace("{who}", item.userName).replace("{stage}", item.stageName);
  }
  if (item.kind === "rule_fired") return ruleFiredLine(item);
  return "";
}

function initials(name) {
  return String(name)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function itemRow(item) {
  if (item.kind === "comment") {
    return el("div", { class: "activitycomment" }, [
      el("span", { class: "activityavatar", text: initials(item.userName) }),
      el("div", { class: "activitybubble" }, [
        el("div", { class: "activitywho" }, [
          el("span", { text: item.userName }),
          el("span", { class: "activitywhen", text: item.at }),
        ]),
        el("div", { class: "activitybody", text: item.body }),
      ]),
    ]);
  }

  return el("div", { class: "activitysysline" }, [
    el("span", { class: "activitydot" }),
    el("span", { class: "activitymsg", text: systemMessage(item) }),
    el("span", { class: "activitywhen", text: item.at }),
  ]);
}

function drawer(invoiceId, container) {
  const feed = el(
    "div",
    { class: "activityfeed" },
    loading
      ? [el("div", { class: "muted", text: t("activity.loading") })]
      : (items ?? []).length === 0
        ? [el("div", { class: "muted", text: t("activity.empty") })]
        : items.map(itemRow)
  );

  const box = el("textarea", { id: "activity-input", placeholder: t("activity.placeholder") });
  const postButton = el("button", {
    id: "activity-post",
    class: "activitypost",
    text: t("activity.post"),
    onclick: () => post(invoiceId, container),
  });

  return el(
    "div",
    { class: "activitydrawer" },
    [
      el("div", { class: "activityhead" }, [
        el("h3", {}, [el("span", { text: t("activity.title") })]),
        el("button", {
          class: "activityclose",
          text: "\u2715",
          onclick: () => {
            open = false;
            renderInto(container, invoiceId);
          },
        }),
      ]),
      error ? el("div", { class: "warn sm", text: error }) : null,
      feed,
      el("div", { class: "activityinput" }, [box, postButton]),
      el("div", { class: "activityfoot", text: t("activity.internalonly") }),
    ].filter(Boolean)
  );
}

function renderInto(container, invoiceId) {
  container.className = open ? "activitywrap open" : "activitywrap";
  const tab = el(
    "button",
    {
      class: "activitytab",
      onclick: () => {
        open = !open;
        renderInto(container, invoiceId);
        if (open && items === null && !loading) load(invoiceId, container);
      },
    },
    [
      el("span", { text: t("activity.tab") }),
      items !== null ? el("span", { class: "activitycount", text: String(items.length) }) : null,
    ].filter(Boolean)
  );

  container.replaceChildren(...[tab, open ? drawer(invoiceId, container) : null].filter(Boolean));
}

/**
 * Build the panel for one document — called once per `openViewer()`.
 *
 * **State resets per document.** Opening invoice B must not show
 * invoice A's comments for a moment before they are replaced — a
 * fresh document starts closed and unloaded, the same as arriving at
 * the viewer for the first time.
 */
export function activityPanel(invoiceId) {
  reset();
  const container = el("div", { class: "activitywrap" });
  renderInto(container, invoiceId);
  return container;
}

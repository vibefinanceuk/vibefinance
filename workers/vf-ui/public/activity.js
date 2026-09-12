import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * The activity tab — decision 0269.
 *
 * **Was a self-contained drawer (decision 0267); is now one pane of a
 * shared tab row.** The operator's own picture: "two tabs, reading
 * 'Document' and 'Timeline / Chat'" in the same panel the document
 * preview already lives in — not a separate strip that opens below it.
 * `viewer.js` owns the tab row and which pane is showing; this module
 * only builds the count badge and the pane's own content.
 *
 * **Loads eagerly now, not on first click.** The tab wants to show a
 * real count before anyone switches to it — showing "Timeline / Chat"
 * with no number until clicked once would be a tab lying about how
 * much is behind it for its entire first moment on screen.
 *
 * **Still self-contained against re-renders.** `viewer.js` rebuilds
 * its whole shell on every save or action, which would otherwise
 * throw away whatever this loaded — so this keeps updating the exact
 * `content` node it was first given, the same discipline the drawer
 * version used.
 */

let items = null;
let loading = false;
let error = null;

function reset() {
  items = null;
  loading = false;
  error = null;
}

async function load(invoiceId, content, countBadge) {
  loading = true;
  error = null;
  renderContent(content, countBadge, invoiceId);

  const response = await fetch(`/api/documents/${encodeURIComponent(invoiceId)}/activity`);
  if (!response.ok) {
    loading = false;
    error = t("activity.loadfailed");
    renderContent(content, countBadge, invoiceId);
    return;
  }

  items = (await response.json()).items ?? [];
  loading = false;
  renderContent(content, countBadge, invoiceId);
}

async function post(invoiceId, content, countBadge) {
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
    renderContent(content, countBadge, invoiceId);
    return;
  }

  // **Reload rather than append locally** — the same read-after-write
  // discipline the rest of this app follows: the server's own
  // ordering and timestamp are what render, not a client guess at
  // what it just sent.
  await load(invoiceId, content, countBadge);
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

function renderContent(content, countBadge, invoiceId) {
  countBadge.textContent = items !== null ? String(items.length) : "";
  countBadge.hidden = items === null;

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
    onclick: () => post(invoiceId, content, countBadge),
  });
  postButton.append(icon("post"), el("span", { text: t("activity.post") }));

  content.replaceChildren(
    ...[
      error ? el("div", { class: "warn sm", text: error }) : null,
      feed,
      el("div", { class: "activityinput" }, [box, postButton]),
      el("div", { class: "activityfoot", text: t("activity.internalonly") }),
    ].filter(Boolean)
  );
}

/**
 * Build the tab's pane and its count badge for one document — called
 * once per `openViewer()`.
 *
 * **State resets per document.** Opening invoice B must not show
 * invoice A's comments for a moment before they are replaced.
 *
 * Returns `{ content, countBadge }`: `content` is the pane
 * `viewer.js` shows or hides alongside the document preview;
 * `countBadge` is a live node meant to sit inside `viewer.js`'s own
 * tab button, updated in place as loading completes.
 */
export function buildActivityTab(invoiceId) {
  reset();
  const content = el("div", { class: "activitytabcontent" });
  const countBadge = el("span", { class: "activitycount", hidden: "hidden" });
  load(invoiceId, content, countBadge);
  return { content, countBadge };
}

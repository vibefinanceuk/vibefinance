import { stamp } from "/timestamp.js";
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
 * **Which lines, when a rule fired once per line rather than once for
 * the whole document — decision 0409.** `activity-route.ts` now
 * collapses one entry per (visit, rule) instead of one per line, so
 * this is what keeps "which lines?" answerable rather than silently
 * lost. Plain, unlocalized text, matching `describeAction()`'s own
 * action descriptions — the sentence this appends to is already only
 * partly localized (the frame comes from `activity.rulefired`; the
 * actions inside it never have been), so this does not introduce a
 * new gap, only sits in the one that already exists.
 */
function lineSuffix(lines) {
  if (!lines || lines.length === 0) return "";
  const word = lines.length === 1 ? "line" : "lines";
  return ` (${word} ${lines.join(", ")})`;
}

/**
 * One fired rule, in words — the same closed-vocabulary phrasing
 * `activity-route.ts` builds server-side, simply joined for reading.
 */
function ruleFiredLine(item) {
  const actions = (item.actionDescriptions ?? []).join(" and ");
  return (
    t("activity.rulefired").replace("{rule}", item.ruleName).replace("{actions}", actions) + lineSuffix(item.lines)
  );
}

/**
 * A button/action taken — decisions 0488, 0489, and 0497. `item.action`
 * is the same closed vocabulary `task-route.ts`/`return-route.ts`/
 * `icons.js` already share (`claim`, `release`, `return`,
 * `return_to_supplier`, `discard`, `reassign`, `route_to_approver`), so
 * it doubles as the icon lookup key in `itemRow` below.
 */
/** Actions whose icon is another button's (decision 0553): the export's Download, and Undo's Return. */
const ACTION_ICONS = { erp_export: "download", erp_export_undone: "return", receipt_closed: "goodsreceipts" };

function actionTakenLine(item) {
  const who = item.userName;
  switch (item.action) {
    case "claim":
      return t("activity.claimed").replace("{who}", who);
    case "release":
      return t("activity.released").replace("{who}", who);
    case "return":
      return t("activity.returned").replace("{who}", who).replace("{stage}", item.targetStageName ?? "");
    case "return_to_supplier":
      return t("activity.returnedtosupplier").replace("{who}", who);
    case "discard":
      return t("activity.discarded").replace("{who}", who);
    // Decision 0631 — a reminder an agent prepared and a person approved; the note shows as the comment.
    // Decision 0632 — a supplier chased; the subject shows as the comment.
    case "chase":
      return t("activity.chased").replace("{who}", who).replace("{target}", item.targetUserName ?? "");
    case "remind":
      return t("activity.reminded").replace("{who}", who).replace("{target}", item.targetUserName ?? "");
    case "reassign":
      return t("activity.reassigned").replace("{who}", who).replace("{target}", item.targetUserName ?? "");
    case "route_to_approver":
      return t("activity.routedtoapprover").replace("{who}", who).replace("{target}", item.targetUserName ?? "");
    // Decision 0530 — `comment` carries the order number linked to.
    case "po_link":
      return t("activity.polinked").replace("{who}", who).replace("{po}", item.comment ?? "");
    // Decision 0532 — `comment` is "<invoice line>:<PO line>", the PO line empty when cleared.
    // Decision 0537 — "non-po" in place of the PO line, and ":coding-cleared" when manual coding went.
    case "po_pair": {
      const [line, poLine, extra] = String(item.comment ?? "").split(":");
      const said = (poLine === "non-po" ? t("activity.ponpo") : poLine ? t("activity.popaired").replace("{poline}", poLine) : t("activity.pocleared"))
        .replace("{who}", who)
        .replace("{line}", line ?? "");
      return extra === "coding-cleared" ? `${said} ${t("activity.pocodingcleared")}` : said;
    }
    // Decision 0553 — exported to the ERP (0552), and an export undone (its reason shows below as the comment).
    case "erp_export":
      return t("activity.erpexported").replace("{who}", who);
    case "erp_export_undone":
      return t("activity.erpexportundone").replace("{who}", who);
    // Decision 0648 — a receipt rule's task closed by itself once the goods arrived.
    case "receipt_closed":
      return t("activity.receiptclosed").replace("{rule}", item.ruleName ?? "").replace("{receipt}", item.receiptNumber ?? "").replace("{who}", who);
    default:
      return "";
  }
}

/**
 * Decision 0498 — what happened to the email, if anything, in words.
 * Only ever present on a `return_to_supplier` item (`activity-route.ts`
 * only populates `emailStatus` there); `undefined` renders nothing,
 * the same "no key, no line" convention every other optional field on
 * this item already follows.
 */
function emailStatusLine(item) {
  if (item.action !== "return_to_supplier" || !item.emailStatus) return null;
  return t(`activity.email.${item.emailStatus}`).replace("{to}", item.emailToAddress ?? "");
}

function systemMessage(item) {
  if (item.kind === "received") {
    // Decision 0571 — the route message it came in, with its source and sender.
    if (!item.messageId) return t("activity.received");
    // Decision 0575: made on Create, keyed by hand.
    if (item.keyed) {
      return t("activity.receivedkeyed").replace("{sender}", item.sender ?? "").replace("{message}", item.messageId);
    }
    return t(item.sender ? "activity.receivedroutefrom" : "activity.receivedroute")
      .replace("{source}", item.source ?? "")
      .replace("{sender}", item.sender ?? "")
      .replace("{message}", item.messageId);
  }
  if (item.kind === "stage_completed") {
    return t("activity.stagecompleted").replace("{who}", item.userName).replace("{stage}", item.stageName);
  }
  if (item.kind === "rule_fired") return ruleFiredLine(item);
  if (item.kind === "action_taken") return actionTakenLine(item);
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
          el("span", { class: "activitywhen", text: stamp(item.at) }),
        ]),
        el("div", { class: "activitybody", text: item.body }),
      ]),
    ]);
  }

  if (item.kind === "action_taken") {
    // **The icon of the button taken**, asked for live — the same
    // closed vocabulary `icons.js` already draws for the action row
    // itself, not a generic dot, so Reassign one day looks like
    // Reassign here too rather than every action reading the same.
    return el("div", { class: "activitysysline activityaction" }, [
      // Decision 0553 — the ERP export's lines take the icons of its own buttons.
      el("span", { class: "activityactionicon" }, [icon(ACTION_ICONS[item.action] ?? item.action)]),
      el(
        "div",
        { class: "activityactionbody" },
        [
          el("div", { class: "activitymsgrow" }, [
            el("span", { class: "activitymsg", text: systemMessage(item) }),
            el("span", { class: "activitywhen", text: stamp(item.at) }),
          ]),
          // A po_link's comment is the order number, already in the line above.
          item.comment && item.action !== "po_link" && item.action !== "po_pair" ? el("div", { class: "activityactioncomment", text: item.comment }) : null,
          // Decision 0498 — the supplier-facing comment (separate from
          // the reason above) and what happened to the email, both
          // only ever present on a return_to_supplier item.
          item.supplierComment ? el("div", { class: "activityactioncomment", text: item.supplierComment }) : null,
          emailStatusLine(item) ? el("div", { class: "activityactioncomment muted sm", text: emailStatusLine(item) }) : null,
        ].filter(Boolean)
      ),
    ]);
  }

  if (item.kind === "received" && item.messageId) {
    // Decision 0571 — the message reference, and the file this invoice was read from.
    return el("div", { class: "activitysysline activityreceived" }, [
      el("span", { class: "activitydot" }),
      el("div", { class: "activityactionbody" }, [
        el("div", { class: "activitymsgrow" }, [
          el("span", { class: "activitymsg", text: systemMessage(item) }),
          el("span", { class: "activitywhen", text: stamp(item.at) }),
        ]),
        item.filename
          ? el("div", { class: "activityactioncomment muted sm", text: t("activity.receivedfile").replace("{file}", item.filename) })
          : null,
      ].filter(Boolean)),
    ]);
  }

  return el("div", { class: "activitysysline" }, [
    el("span", { class: "activitydot" }),
    el("span", { class: "activitymsg", text: systemMessage(item) }),
    el("span", { class: "activitywhen", text: stamp(item.at) }),
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

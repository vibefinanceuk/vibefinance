import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";
import { stamp } from "/timestamp.js";

/**
 * **One look for a Timeline entry — decision 0675**, from the mock-up
 * Dan chose (option B).
 *
 * - **What the system did is a slim card**: a coloured left edge and a
 *   symbol for the kind of event, a bold label (*Received*, *Rule
 *   fired*), the words, and the time.
 * - **What a person wrote stays a bubble**, with their initials; your
 *   own sits on the right.
 * - **The colours are Day's in both themes** (`.tlfeed` in `app.css`):
 *   Dan found Night's deeper tones too heavy here.
 *
 * The Document viewer (`activity.js`) and the receipt's Timeline
 * (`receipt-timeline.js`) both draw their entries with this, so the two
 * read alike. They keep the classes the tests and the rest of the CSS
 * already know (`activitysysline`, `activitymsg`, `activityactioncomment`).
 *
 * **Tones:** `info` blue (arrived, exported), `warn` amber (needs
 * attention), `ok` green (done), `bad` red (a problem), `act` grey (a
 * person's action, with that action's own icon).
 */
export const EVENTS = {
  received: { tone: "info", icon: "inbox" },
  erp_export: { tone: "info", icon: "download" },

  rule_fired: { tone: "warn", icon: "systemalert" },
  stopped: { tone: "warn", icon: "systemalert" },
  return: { tone: "warn", icon: "return" },
  return_to_supplier: { tone: "warn", icon: "return_to_supplier" },
  chase: { tone: "warn", icon: "post" },
  remind: { tone: "warn", icon: "post" },
  erp_export_undone: { tone: "warn", icon: "return" },

  stage_completed: { tone: "ok", icon: "tick" },
  registered: { tone: "ok", icon: "tick" },
  lines_released: { tone: "ok", icon: "tick" },
  receipt_closed: { tone: "ok", icon: "tick" },

  email_failed: { tone: "bad", icon: "alertcircle" },
  discard: { tone: "bad", icon: "alertcircle" },
  line_rejected: { tone: "bad", icon: "alertcircle" },
  rejected: { tone: "bad", icon: "alertcircle" },
  cancelled: { tone: "bad", icon: "alertcircle" },

  claim: { tone: "act", icon: "claim" },
  release: { tone: "act", icon: "release" },
  reassign: { tone: "act", icon: "reassign" },
  route_to_approver: { tone: "act", icon: "route_to_approver" },
  po_link: { tone: "act", icon: "purchaseorders" },
  po_pair: { tone: "act", icon: "purchaseorders" },
  // Decision 0701 — a value taken from the document with the box.
  value_from_document: { tone: "act", icon: "lasso" },
  line_corrected: { tone: "act", icon: "rename" },
  line_repointed: { tone: "act", icon: "rename" },
  collaborator_added: { tone: "act", icon: "newperson" },
  collaborator_removed: { tone: "act", icon: "close" },
};

/** The date part of a shown moment, so a card can leave it off when the one before had the same day. */
export function dayOf(at) {
  return stamp(at).slice(0, 10);
}

/**
 * The time a card shows: `16:37` on the same day as the entry before
 * it, and `2026-10-07 16:37` when the day changes (or for the first).
 * The whole moment, to the second, is its tooltip.
 */
function cardWhen(at, prevAt) {
  const full = stamp(at);
  const short = prevAt && dayOf(prevAt) === full.slice(0, 10) ? full.slice(11, 16) : full.slice(0, 16);
  return el("span", { class: "activitywhen", text: short, title: full });
}

/**
 * A system entry. `key` picks tone, icon and label from `EVENTS`
 * (`timeline.label.<key>`); `classes` keeps any class a caller already
 * had (`activityaction`, `activityreceived`); `subs` are the grey lines
 * beneath.
 */
export function systemCard(key, { text, subs = [], at, prevAt, classes = "", kind }) {
  const event = EVENTS[key] ?? { tone: "info", icon: "inbox" };
  const label = t(`timeline.label.${key}`);
  return el("div", { class: `activitysysline tlcard tl-${event.tone}${classes ? ` ${classes}` : ""}`, "data-kind": kind ?? key, "data-tone": event.tone }, [
    el("div", { class: "tltop" }, [
      el("span", { class: "activityactionicon" }, [icon(event.icon)]),
      el("span", { class: "tltext" }, [
        label && label !== `timeline.label.${key}` ? el("b", { class: "tllabel", text: label }) : null,
        el("span", { class: "activitymsg", text }),
      ].filter(Boolean)),
      cardWhen(at, prevAt),
    ]),
    ...subs.filter(Boolean).map((sub) => el("div", { class: "activityactioncomment", text: sub })),
  ]);
}

function initials(name) {
  return String(name ?? "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** A person's message: initials, name, the moment to the second, and the words; yours on the right. */
export function chatBubble({ name, body, at, mine = false }) {
  return el("div", { class: `activitycomment tlchat${mine ? " mine" : ""}`, "data-kind": "comment" }, [
    el("span", { class: "activityavatar", text: initials(name) }),
    el("div", { class: "activitybubble" }, [
      el("div", { class: "activitywho" }, [el("span", { text: name ?? "—" }), el("span", { class: "activitywhen", text: stamp(at) })]),
      el("div", { class: "activitybody", text: body }),
    ]),
  ]);
}

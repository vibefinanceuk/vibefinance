import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";
import { chatBubble, systemCard } from "/timeline-entry.js";
import { stamp } from "/timestamp.js";

/**
 * **The conversation with the supplier — decision 0721** (Phase 2a of
 * docs/design/supplier-portal.md).
 *
 * - **Its own tab, Supplier**, beside Timeline / Chat: what is written
 *   here goes outside the company, so it is never mixed with the
 *   internal comments. Offered only when the supplier portal is licensed
 *   and somebody at this supplier is linked for the invoice's company,
 *   or a conversation already exists.
 * - **Ask supplier** (a task action) asks a question: the invoice stays
 *   where it is, the task stays open, and the invoice shows *Query
 *   raised* in the supplier network until they answer.
 * - **Both sides by email.** The supplier's people are emailed with a
 *   link to the network; their reply emails whoever holds the task and
 *   whoever last wrote.
 *
 * The data comes from `GET /api/invoices/:id/supplier-messages`; the
 * viewer fetches it with the invoice (`stored.supplierChat`) so the tab
 * and the action can be decided before the screen is drawn.
 */

const base = (invoiceId) => `/api/invoices/${encodeURIComponent(invoiceId)}/supplier-messages`;

/** The conversation for one invoice, or null when it cannot be read (no permission, an older server). */
export async function fetchSupplierChat(invoiceId, url = base(invoiceId)) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Send one message. `{ ok, body }`; the body is the server's answer either way. */
export async function sendToSupplier(invoiceId, payload, url = base(invoiceId)) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, body: {} };
  }
}

const fill = (key, values) => Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v ?? "")), t(key));

/** Who a message to the supplier goes to, in one line. */
export function recipientsLine(chat) {
  return chat.recipients?.length
    ? fill("supplierchat.to", { people: chat.recipients.join(", ") })
    : fill("supplierchat.noone", { supplier: chat.supplierName ?? "" });
}

function messageRow(m, chat) {
  const lines = m.lines?.length ? ` · ${fill("supplierchat.aboutlines", { lines: m.lines.join(", ") })}` : "";
  if (m.direction === "from_supplier") {
    const node = chatBubble({ name: `${m.authorEmail ?? m.authorName ?? ""} · ${chat.supplierName ?? ""}`, body: m.body, at: m.at });
    node.classList.add("supplierreply");
    return node;
  }
  const node = chatBubble({ name: `${m.authorName ?? ""}${m.kind === "question" ? ` · ${t("supplierchat.question")}` : m.kind === "return" ? ` · ${t("supplierchat.returned")}` : ""}${lines}`, body: m.body, at: m.at, mine: true });
  const sent = m.emailError
    ? fill("supplierchat.emailfailed", { error: m.emailError })
    : m.emailed?.length
      ? fill("supplierchat.emailed", { people: m.emailed.join(", ") })
      : null;
  if (sent) node.querySelector(".activitybubble")?.append(el("div", { class: `supplieremailed${m.emailError ? " warn" : ""}`, text: sent }));
  return node;
}

/**
 * The tab's pane and its count badge. `initial` is what the viewer
 * already fetched; posting reloads from the server rather than
 * appending a guess.
 */
/**
 * Decision 0740: a goods receipt's conversation too, at its own address
 * (`url`); everything else the same.
 */
export function buildSupplierTab(invoiceId, initial, { url = base(invoiceId) } = {}) {
  let chat = initial;
  let error = null;
  const content = el("div", { class: "activitytabcontent suppliertab" });
  const countBadge = el("span", { class: "activitycount", hidden: "hidden" });

  function render() {
    const messages = chat?.messages ?? [];
    countBadge.textContent = String(messages.length);
    countBadge.hidden = messages.length === 0;

    const feed = el(
      "div",
      { class: "activityfeed tlfeed" },
      messages.length === 0
        ? [el("div", { class: "muted", text: fill("supplierchat.empty", { supplier: chat?.supplierName ?? "" }) })]
        : messages.map((m) => messageRow(m, chat))
    );
    if (chat?.awaiting) {
      feed.append(systemCard("supplier_asked", { text: fill("supplierchat.awaiting", { supplier: chat.supplierName ?? "" }), at: null }));
    }

    const who = el("div", { class: "supplierto muted sm" }, [icon("ask_supplier"), el("span", { text: recipientsLine(chat ?? {}) })]);

    const box = el("textarea", { class: "supplierinput", placeholder: fill("supplierchat.placeholder", { supplier: chat?.supplierName ?? "" }) });
    const send = el("button", { class: "activitypost", type: "button" });
    send.append(icon("post"), el("span", { text: t("supplierchat.send") }));
    send.onclick = async () => {
      const body = box.value.trim();
      if (!body) return;
      send.disabled = true;
      const result = await sendToSupplier(invoiceId, { body }, url);
      if (!result.ok) {
        error = result.body?.reason === "no_recipients" ? recipientsLine({ supplierName: chat?.supplierName }) : t("supplierchat.failed");
        send.disabled = false;
        render();
        return;
      }
      error = null;
      chat = (await fetchSupplierChat(invoiceId, url)) ?? chat;
      render();
    };

    content.replaceChildren(
      ...[
        who,
        error ? el("div", { class: "warn sm", text: error }) : null,
        feed,
        chat?.canWrite ? el("div", { class: "activityinput" }, [box, send]) : null,
      ].filter(Boolean)
    );
  }

  render();
  return { content, countBadge };
}

/**
 * **Ask supplier — decision 0721.** A question, the lines it is about
 * (optional), and who will be emailed. Asking leaves the invoice and the
 * task exactly where they are; `onAsked` redraws the viewer so the
 * banner says the question is waiting.
 *
 * Decision 0748: a goods receipt's too, at its own address (`url`) and
 * with its own note (`noteKey`).
 */
export function openAskSupplier(invoiceId, chat, lines, { onAsked, url = base(invoiceId), noteKey = "asksupplier.note" } = {}) {
  const close = () => backdrop.remove();
  const supplier = chat.supplierName ?? "";
  const question = el("textarea", { class: "asksupplierquestion", placeholder: t("asksupplier.placeholder") });
  const ticks = lines.map((n) => {
    const box = el("input", { type: "checkbox", value: String(n) });
    return { n, box, node: el("label", { class: "askline" }, [box, el("span", { text: String(n) })]) };
  });
  const errorBox = el("div", { class: "warn sm", hidden: "hidden" });

  const ask = async () => {
    const body = question.value.trim();
    if (!body) {
      errorBox.hidden = false;
      errorBox.textContent = t("asksupplier.empty");
      return;
    }
    const result = await sendToSupplier(invoiceId, { body, ask: true, lines: ticks.filter((x) => x.box.checked).map((x) => x.n) }, url);
    if (!result.ok) {
      errorBox.hidden = false;
      errorBox.textContent = result.body?.reason === "no_recipients" ? recipientsLine({ supplierName: supplier }) : t("supplierchat.failed");
      return;
    }
    close();
    onAsked?.();
  };

  const askButton = el("button", { class: "actionlink primary", type: "button", title: t("action.ask_supplier"), onclick: ask });
  askButton.append(icon("ask_supplier"), el("span", { text: t("action.ask_supplier") }));
  const closeButton = el("button", { class: "actionlink", type: "button", title: t("action.close"), onclick: close });
  closeButton.append(icon("close"), el("span", { text: t("action.close") }));

  const box = el("div", { class: "popout asksupplier", role: "dialog", "aria-label": fill("asksupplier.title", { supplier }) }, [
    el("div", { class: "cardhead" }, [el("h3", { text: fill("asksupplier.title", { supplier }) }), el("div", { class: "statebuttons" }, [askButton, closeButton])]),
    el("div", { class: "kf" }, [el("label", { text: t("asksupplier.question") }), question]),
    ...(ticks.length
      ? [el("div", { class: "kf" }, [el("label", { text: t("asksupplier.lines") }), el("div", { class: "asklines" }, ticks.map((x) => x.node))])]
      : []),
    el("div", { class: "muted sm", text: recipientsLine(chat) }),
    el("div", { class: "muted sm", text: fill(noteKey, { supplier }) }),
    errorBox,
  ]);

  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
  question.focus();
}

/** The banner line while a question waits: who asked, when. */
export function supplierQueryText(query) {
  return fill("supplierchat.banner", { supplier: query.supplierName ?? "", who: query.askedBy ?? "", when: stamp(query.askedAt) });
}

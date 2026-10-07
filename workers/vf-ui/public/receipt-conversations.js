import { t } from "/strings.js";
import { el as make, setNavBadge } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **Conversations — decision 0660.** At the top of Tasks (and of Goods
 * Receipts for the Warehouse), as the agents' section is (0622): the
 * goods receipts a person was added to, or that have new messages for
 * them. Hidden when there are none. Agreed with Dan against a mock-up.
 *
 * **Open** shows the receipt with its Timeline / Chat, which catches the
 * person up; **Done** does so without opening it. Either way the row goes
 * until something new happens. The menu's Tasks (or Goods Receipts)
 * carries how many there are.
 */

const el = (tag, props = {}, children = []) => make(tag, props, children.filter((c) => c !== null && c !== undefined && c !== false));

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function stamp(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso ?? "") : d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const words = (key, values) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v === null || v === undefined ? "" : String(v)), t(key));

/** What a row says under its title: who added you, when, the supplier and orders. */
function metaLine(c) {
  const parts = [];
  if (c.added) parts.push(words(c.added.team ? "receipts.conv.addedteam" : "receipts.conv.added", { by: c.added.by ?? "—", team: c.added.team }), stamp(c.added.at));
  else if (c.latest) parts.push(words("receipts.conv.lastmessage", { when: stamp(c.latest.at) }));
  if (c.supplier) parts.push(c.supplier);
  if (c.orders?.length) parts.push(words("receipts.conv.orders", { orders: c.orders.join(", ") }));
  return parts.join(" · ");
}

/**
 * Fills the place for the section; hidden while there is nothing new.
 * `navScreen` is the menu item that carries the count. Returns how many.
 */
export async function fill(holder, { navScreen = "tasks" } = {}) {
  if (!holder) return 0;
  const r = await call("/api/receipt-conversations");
  const conversations = r.ok ? r.body?.conversations ?? [] : [];
  setNavBadge(navScreen, conversations.length);
  if (conversations.length === 0) {
    holder.hidden = true;
    holder.replaceChildren();
    return 0;
  }
  holder.hidden = false;
  const refill = () => fill(holder, { navScreen });

  const row = (c) => {
    const title = [words("receipts.conv.receipt", { number: c.receiptNumber }), c.organisation].filter(Boolean).join(" · ");
    return el("div", { class: "agentnote receiptconv", "data-receipt": c.receiptId }, [
      el("div", { class: "agentnotehead" }, [
        el("div", {}, [
          el("span", { class: "agentnotename", text: title }),
          c.added
            ? el("span", { class: "rmpill q agentnotetag", text: t("receipts.conv.tag.added") })
            : el("span", { class: "rmpill warn agentnotetag", text: t("receipts.conv.tag.new") }),
          c.newMessages > 0 ? el("span", { class: "rmpill bad agentnotetag receiptconvcount", text: words("receipts.conv.newcount", { n: c.newMessages }) }) : null,
          el("div", { class: "muted sm", text: metaLine(c) }),
          c.latest ? el("div", { class: "agentnotewhy", text: words("receipts.conv.quote", { by: c.latest.by ?? "—", body: c.latest.body }) }) : null,
        ]),
        el("div", { class: "dobuttons" }, [
          actionLink("expand", {
            label: t("receipts.conv.open"),
            onclick: async () => {
              // Opening it is catching up: said first, so the section is right whatever happens in the pop-out.
              await call(`/api/receipt-conversations/${encodeURIComponent(c.receiptId)}/done`, { method: "POST" });
              const { openReceipt } = await import("/goods-receipts.js");
              await openReceipt(c.receiptId, { onDone: refill });
              refill();
            },
          }),
          actionLink("done", {
            label: t("receipts.conv.done"),
            onclick: async () => {
              const done = await call(`/api/receipt-conversations/${encodeURIComponent(c.receiptId)}/done`, { method: "POST" });
              if (done.ok) refill();
            },
          }),
        ]),
      ]),
    ]);
  };

  holder.replaceChildren(
    el("div", { class: "panel agentnotes receiptconversations" }, [
      el("h3", { text: t("receipts.conv.heading") }),
      el("p", { class: "muted sm", text: t("receipts.conv.sub") }),
      // Dan: a maximum height, scrolling past about four, so the tasks below stay in view.
      el("div", { class: "receiptconvlist", id: "receiptconvlist" }, conversations.map(row)),
    ])
  );
  return conversations.length;
}

/**
 * **The invoice form and its document, talking — decision 0697.**
 *
 * Clicking a field asks the document to show where that value is; a lasso
 * on the document sends its words back to the field. The document may be
 * the card beside the form or the pop-out window on a second screen
 * (decision 0384), so they talk over a **`BroadcastChannel` named for the
 * invoice**: one per side, and a message posted on one reaches every other
 * channel of that name — in the same window or another of this site —
 * without either knowing where the other is. The popped-out window and
 * the card behave the same, and two invoices open at once never cross.
 *
 * Messages:
 *   form → document  `{ type: "locate", field, label, kind, value, near }`
 *                    `{ type: "clear" }`
 *   document → form  `{ type: "lassoed", text, pageNumber, box, wordCount, source }`
 *                    `{ type: "located", field, count }`
 */

/** Where no `BroadcastChannel` exists (an old browser), a link that says nothing and hears nothing. */
const SILENT = { send() {}, on() { return () => {}; }, close() {} };

/**
 * One side of the link for `invoiceId`. `Channel` is injectable for tests.
 */
export function docLink(invoiceId, Channel = globalThis.BroadcastChannel) {
  if (!invoiceId || typeof Channel !== "function") return SILENT;
  const channel = new Channel(`vf-doc:${invoiceId}`);
  const handlers = new Map();
  channel.onmessage = (event) => {
    const message = event?.data;
    if (!message || typeof message.type !== "string") return;
    for (const fn of handlers.get(message.type) ?? []) fn(message);
  };
  return {
    send(type, data = {}) {
      channel.postMessage({ ...data, type });
    },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    close() {
      handlers.clear();
      channel.close?.();
    },
  };
}

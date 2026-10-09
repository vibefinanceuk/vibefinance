import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageViewer } from "/page-renderer.js";
import { connectFields, fillTarget, markField } from "/field-link.js";
import { docLink } from "/doc-link.js";
import { readingOrder } from "/doc-words.js";

/**
 * Clicking a field shows where its value is; a lasso fills the field with
 * focus — decision 0697. The document's words are injected (`pageWords`),
 * and the link between the form and the document is a fake channel pair,
 * so what is tested is the conversation, not pdf.js.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "viewer.lasso": "Lasso",
    "viewer.highlight": "Highlight",
    "viewer.lasso.hint": "Click a field, then draw round its value on the page",
    "viewer.locate.notfound": "Not found on the document",
    "viewer.locate.notext": "This document has no text to search yet",
    "viewer.lasso.notext": "This page has no readable text yet",
    "viewer.lasso.empty": "No text inside the lasso",
    "viewer.lasso.filled": "Put in {field}",
    "viewer.lasso.nofield": "Click the field to fill first",
    "viewer.lasso.wrongkind.amount": "No amount in the lasso for {field}",
    "field.bt-112": "Invoice total",
    "field.bt-2": "Invoice date",
  },
};

/** An in-memory BroadcastChannel: every channel of a name hears every other. */
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all) {
      if (other !== this && other.name === this.name && !other.closed) other.onmessage?.({ data: structuredClone(data) });
    }
  }
  close() {
    this.closed = true;
  }
}

/** Words on a page, on a 1000-unit grid. */
function words(rows: string[][]) {
  const out: { text: string; x: number; y: number; w: number; h: number }[] = [];
  rows.forEach((row, r) => {
    let x = 100;
    for (const text of row) {
      out.push({ text, x: x / 1000, y: (100 + r * 50) / 1000, w: (text.length * 10) / 1000, h: 20 / 1000 });
      x += (text.length + 1) * 10;
    }
  });
  return readingOrder(out);
}

const PAGE_WORDS = words([
  ["Invoice", "date", "09.10.2026"],
  ["Widgets", "740,70"],
  ["Total", "740,70"],
]);

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function mountViewer(pageWords: unknown = PAGE_WORDS) {
  const page = { pageNumber: 1, kind: "pdf", load: vi.fn(async () => ({})) };
  const deps = {
    resolvePages: vi.fn(async () => [page]),
    drawPdfPage: vi.fn(async () => {}),
    drawImage: vi.fn(async () => {}),
    pageWords: vi.fn(async () => pageWords),
    docLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel),
  };
  const root = pageViewer("inv-1", "application/pdf", deps) as HTMLElement;
  document.body.append(root);
  const canvas = root.querySelector(".vcanvas") as HTMLElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON() {} });
  return { root, deps };
}

describe("the lasso and finding a value — decision 0697", () => {
  beforeEach(async () => {
    FakeChannel.all = [];
    document.body.replaceChildren();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
        throw new Error(`no stub for ${url}`);
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking a field outlines its value on the document, beside its label", async () => {
    const { root } = mountViewer();
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    input.value = "740.70";
    document.body.append(input);
    connectFields("inv-1", { makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel) });
    await flush();

    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();

    const best = root.querySelector(".vlocate.best") as HTMLElement;
    expect(best).toBeTruthy();
    // Total's row is the third: top at 200/1000, less the outline's padding.
    expect(best.getAttribute("style")).toMatch(/top:19\.\d+%/);
    // The same amount on the Widgets row is shown too, dashed.
    expect(root.querySelectorAll(".vlocate:not(.best)")).toHaveLength(1);
  });

  it("says so when the value is not on the document", async () => {
    const { root } = mountViewer();
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    input.value = "1.00";
    document.body.append(input);
    connectFields("inv-1", { makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel) });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(root.querySelector(".vlocate")).toBeNull();
    expect(root.querySelector(".vhint")?.textContent).toBe("Not found on the document");
  });

  it("a lasso round a value puts it in the field that had focus, as if typed", async () => {
    const { root } = mountViewer();
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    document.body.append(input);
    const typed = vi.fn();
    input.addEventListener("input", typed);
    connectFields("inv-1", {
      currency: () => "EUR",
      makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel),
    });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();

    (root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement).click();
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    // Round "Total 740,70" (y 200–220, x 100–260).
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 90, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 230 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 90, clientY: 230 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 90, clientY: 230 }));
    await flush();

    expect(typed).toHaveBeenCalled();
    // Shown as money in the invoice's currency, which `parseAmount` reads back as 740.7.
    expect(input.value).toContain("740.70");
    expect(root.querySelector(".vlassoed")).toBeTruthy();
    expect(root.querySelector(".vhint")?.textContent).toBe("Put in Invoice total");
  });

  it("tells the person to choose a field when none has had focus", async () => {
    const { root } = mountViewer();
    connectFields("inv-1", { makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel) });
    await flush();
    (root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement).click();
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 90, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 230 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 90, clientY: 230 }));
    await flush();
    expect(root.querySelector(".vhint")?.textContent).toBe("Click the field to fill first");
  });

  it("says a page has no readable text when it has no words (a scan, until decision 0698)", async () => {
    const { root } = mountViewer(null);
    await flush();
    (root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement).click();
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 90, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 230 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 90, clientY: 230 }));
    await flush();
    expect(root.querySelector(".vhint")?.textContent).toBe("This page has no readable text yet");
  });

  it("the lasso and the highlight tool are one or the other", async () => {
    const { root } = mountViewer();
    await flush();
    const lasso = root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement;
    const highlight = root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement;
    lasso.click();
    highlight.click();
    expect(lasso.classList.contains("on")).toBe(false);
    lasso.click();
    expect(highlight.classList.contains("on")).toBe(false);
  });
});

describe("fillTarget — the lasso's text as the field's value", () => {
  beforeEach(() => {
    FakeChannel.all = [];
    document.body.replaceChildren();
  });

  it("refuses an amount field a lasso with no amount in it, and leaves it alone", () => {
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    input.value = "5";
    document.body.append(input);
    const sent: unknown[] = [];
    connectFields("inv-2", {
      makeLink: () => ({ send: (type: string, data: unknown) => sent.push({ type, ...(data as object) }), on: () => () => {}, close() {} }),
    });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    fillTarget({ text: "Thank you" });
    expect(input.value).toBe("5");
    expect(sent.at(-1)).toMatchObject({ type: "filled", ok: false, reason: "viewer.lasso.wrongkind.amount" });
  });

  it("puts a date in as ISO", () => {
    const input = markField(document.createElement("input"), { field: "BT-2", kind: "date" }) as HTMLInputElement;
    input.type = "date";
    document.body.append(input);
    connectFields("inv-3", { makeLink: () => ({ send() {}, on: () => () => {}, close() {} }) });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    fillTarget({ text: "Invoice date 09.10.2026" });
    expect(input.value).toBe("2026-10-09");
  });

  it("chooses a picker's option by its code", () => {
    const select = document.createElement("select");
    for (const code of ["", "EUR", "GBP"]) select.append(new Option(code ? `${code} · name` : "—", code));
    markField(select, { field: "BT-5", kind: "text" });
    document.body.append(select);
    connectFields("inv-4", { makeLink: () => ({ send() {}, on: () => () => {}, close() {} }) });
    select.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    fillTarget({ text: "gbp" });
    expect(select.value).toBe("GBP");
  });

  it("asks the line's description to be looked for beside a line amount", () => {
    const input = markField(document.createElement("input"), { field: "BT-131", kind: "amount", line: 0 }) as HTMLInputElement;
    input.value = "740.70";
    document.body.append(input);
    const sent: { type: string; near?: { value: string } }[] = [];
    connectFields("inv-5", {
      lineDescription: () => "Widgets",
      makeLink: () => ({ send: (type: string, data: object) => sent.push({ type, ...data }), on: () => () => {}, close() {} }),
    });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(sent.at(-1)).toMatchObject({ type: "locate", field: "BT-131", value: "740.7", near: { field: "BT-153", value: "Widgets" } });
  });
});

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
    "viewer.ocr.reading": "Reading the page…",
    "viewer.lasso.ai.reading": "Reading it with AI…",
    "viewer.lasso.ai.allowance": "The AI allowance is used up today: please type it in",
    "viewer.lasso.suggest": "Looks like {field}",
    "viewer.lasso.suggest.put": "Put it there",
    "field.bt-9": "Due date",
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

function mountViewer(pageWords: unknown = PAGE_WORDS, extra: Record<string, unknown> = {}) {
  const page = { pageNumber: 1, kind: "pdf", load: vi.fn(async () => ({})) };
  const deps = {
    resolvePages: vi.fn(async () => [page]),
    drawPdfPage: vi.fn(async () => {}),
    drawImage: vi.fn(async () => {}),
    pageWords: vi.fn(() => Promise.resolve(pageWords)),
    docLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel),
    ...extra,
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

  it("a page Tesseract read nothing from still goes to the AI (0699)", async () => {
    const readRegion = vi.fn(async () => ({ ok: true, text: "INV-0042" }));
    const { root } = mountViewer(null, { cropRegion: vi.fn(async () => "x"), readRegion });
    const input = markField(document.createElement("input"), { field: "BT-1", kind: "text" }) as HTMLInputElement;
    document.body.append(input);
    connectFields("inv-1", { makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel) });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    (root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement).click();
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 90, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 190 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 230 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 90, clientY: 230 }));
    await flush();
    await flush();
    expect(readRegion).toHaveBeenCalled();
    expect(input.value).toBe("INV-0042");
  });

  it("looks for a line's amount beside the line's own description", async () => {
    // The same amount on two rows; the line is "Widgets", which is the second.
    const { root } = mountViewer(words([["Gadgets", "740,70"], ["Widgets", "740,70"]]));
    const input = markField(document.createElement("input"), { field: "BT-131", kind: "amount", line: 0 }) as HTMLInputElement;
    input.value = "740.70";
    document.body.append(input);
    connectFields("inv-1", {
      lineDescription: () => "Widgets",
      makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel),
    });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    // The Widgets row starts at 150/1000.
    expect((root.querySelector(".vlocate.best") as HTMLElement).getAttribute("style")).toMatch(/top:14\.\d+%/);
  });

  it("says it is reading the page while a scan is read for the first time (0698)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish: (w: unknown) => void = () => {};
    const { root } = mountViewer(new Promise((r) => (finish = r)));
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    input.value = "740.70";
    document.body.append(input);
    connectFields("inv-1", { makeLink: (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel) });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    vi.advanceTimersByTime(400);
    expect(root.querySelector(".vhint")?.textContent).toBe("Reading the page…");
    finish(PAGE_WORDS);
    vi.useRealTimers();
    await flush();
    expect(root.querySelector(".vhint")?.textContent).toBe("");
    expect(root.querySelector(".vlocate.best")).toBeTruthy();
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

/** A scan's words, as Tesseract gives them: with confidence (decision 0698). */
function scanned(rows: [string, number][][]) {
  const out: { text: string; x: number; y: number; w: number; h: number; conf: number }[] = [];
  rows.forEach((row, r) => {
    let x = 100;
    for (const [text, conf] of row) {
      out.push({ text, x: x / 1000, y: (100 + r * 50) / 1000, w: (text.length * 10) / 1000, h: 20 / 1000, conf });
      x += (text.length + 1) * 10;
    }
  });
  return readingOrder(out);
}

function lassoRound(root: HTMLElement, x0: number, y0: number, x1: number, y1: number) {
  (root.querySelector('[aria-label="Lasso"]') as HTMLButtonElement).click();
  const holder = root.querySelector(".vcanvasholder") as HTMLElement;
  holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: x0, clientY: y0 }));
  holder.dispatchEvent(new MouseEvent("pointermove", { clientX: x1, clientY: y0 }));
  holder.dispatchEvent(new MouseEvent("pointermove", { clientX: x1, clientY: y1 }));
  holder.dispatchEvent(new MouseEvent("pointerup", { clientX: x0, clientY: y1 }));
}

describe("the AI reads a lasso Tesseract was unsure of — decision 0699", () => {
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

  const link = (id: string) => docLink(id, FakeChannel as unknown as typeof BroadcastChannel);

  it("sends the cut-out to be read when a word is below the trusted confidence, and fills the field with the answer", async () => {
    const cropRegion = vi.fn(async () => "data:image/jpeg;base64,AAAA");
    const readRegion = vi.fn(async () => ({ ok: true, text: "740,70" }));
    const { root } = mountViewer(scanned([[["Total", 95], ["74O,7O", 41]]]), { cropRegion, readRegion });
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    document.body.append(input);
    connectFields("inv-1", { currency: () => "EUR", makeLink: link });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    lassoRound(root, 90, 90, 300, 130);
    await flush();
    await flush();
    expect(readRegion).toHaveBeenCalledWith("inv-1", expect.objectContaining({ kind: "amount", label: "Invoice total", ocrText: "Total 74O,7O" }));
    expect(input.value).toContain("740.70");
    expect(root.querySelector(".vhint")?.textContent).toBe("Put in Invoice total");
  });

  it("trusts words Tesseract was sure of, and asks nothing", async () => {
    const readRegion = vi.fn();
    const { root } = mountViewer(scanned([[["Total", 95], ["740,70", 96]]]), { cropRegion: vi.fn(), readRegion });
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    document.body.append(input);
    connectFields("inv-1", { currency: () => "EUR", makeLink: link });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    lassoRound(root, 90, 90, 300, 130);
    await flush();
    expect(readRegion).not.toHaveBeenCalled();
    expect(input.value).toContain("740.70");
  });

  it("says when the AI allowance is used up, and leaves the field alone", async () => {
    const readRegion = vi.fn(async () => ({ ok: false, reason: "ai_allowance" }));
    const { root } = mountViewer(scanned([[["74O,7O", 30]]]), { cropRegion: vi.fn(async () => "x"), readRegion });
    const input = markField(document.createElement("input"), { field: "BT-112", kind: "amount" }) as HTMLInputElement;
    input.value = "1";
    document.body.append(input);
    connectFields("inv-1", { makeLink: link });
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    lassoRound(root, 90, 90, 300, 130);
    await flush();
    await flush();
    expect(input.value).toBe("1");
    expect(root.querySelector(".vhint")?.textContent).toBe("The AI allowance is used up today: please type it in");
  });

  it("with no field chosen, offers the field the AI thinks it is, and fills it only when asked", async () => {
    const readRegion = vi.fn(async () => ({ ok: true, text: "30.10.2026", field: "BT-9" }));
    const { root } = mountViewer(scanned([[["Due", 90], ["30.10.2026", 92]]]), { cropRegion: vi.fn(async () => "x"), readRegion });
    const due = markField(document.createElement("input"), { field: "BT-9", kind: "date" }) as HTMLInputElement;
    due.type = "date";
    const issued = markField(document.createElement("input"), { field: "BT-2", kind: "date" }) as HTMLInputElement;
    document.body.append(due, issued);
    connectFields("inv-1", { makeLink: link });
    await flush();
    lassoRound(root, 90, 90, 300, 130);
    await flush();
    await flush();
    expect(readRegion).toHaveBeenCalledWith("inv-1", expect.objectContaining({ fields: [
      { field: "BT-9", label: "Due date", kind: "date" },
      { field: "BT-2", label: "Invoice date", kind: "date" },
    ] }));
    expect(due.value).toBe("");
    expect(root.querySelector(".vhint")?.textContent).toBe("Looks like Due date · Put it there");
    (root.querySelector(".vsuggest") as HTMLButtonElement).click();
    await flush();
    expect(due.value).toBe("2026-10-30");
  });
});

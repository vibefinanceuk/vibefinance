import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import conversationSql from "../../vf-licence/migrations/0326_supplier_conversation_strings.sql?raw";

/**
 * **The conversation with the supplier — decision 0721**: the invoice's
 * Supplier tab, Ask supplier, and the banner while a question waits. The
 * real English strings, read from their migration.
 */

const strings: Record<string, string> = { "action.close": "Close" };
for (const m of conversationSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

const CHAT = {
  available: true,
  canWrite: true,
  supplierName: "Lager Nord GmbH",
  recipients: ["jo@lager-nord.example"],
  awaiting: true,
  messages: [
    { id: "m1", direction: "to_supplier", kind: "question", authorName: "Alice McDonald", authorEmail: null, body: "Line 4 is not on the PO.", lines: [4], at: "2026-10-10T09:00:00Z", emailed: ["jo@lager-nord.example"], emailError: null },
  ],
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function stub(answer: () => { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/invoices/inv-1/supplier-messages" && method === "POST") {
        const a = answer();
        return reply(a.status, a.body);
      }
      if (path === "/api/invoices/inv-1/supplier-messages") return reply(200, CHAT);
      return reply(404, {});
    })
  );
  return calls;
}

async function load() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  return import("/supplier-chat.js");
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the Supplier tab", () => {
  it("says who a message goes to, shows the question with its lines and who was emailed, and that it waits", async () => {
    stub(() => ({ status: 201, body: {} }));
    const { buildSupplierTab } = await load();
    const { content, countBadge } = buildSupplierTab("inv-1", CHAT);
    document.body.append(content);
    expect(content.querySelector(".supplierto")?.textContent).toBe("Goes to jo@lager-nord.example by email, to answer in the supplier network");
    expect(content.querySelector(".activitywho span")?.textContent).toBe("Alice McDonald · Question · about line 4");
    expect(content.querySelector(".supplieremailed")?.textContent).toBe("Emailed jo@lager-nord.example");
    expect(content.querySelector(".tlcard .activitymsg")?.textContent).toBe("Waiting for Lager Nord GmbH to answer");
    expect(countBadge.textContent).toBe("1");
  });

  it("shows the supplier's reply under their address and the supplier's name", async () => {
    stub(() => ({ status: 201, body: {} }));
    const { buildSupplierTab } = await load();
    const reply = { id: "m2", direction: "from_supplier", kind: "message", authorName: "jo@lager-nord.example", authorEmail: "jo@lager-nord.example", body: "For PO 318.", lines: null, at: "2026-10-10T10:00:00Z", emailed: [], emailError: null };
    const { content } = buildSupplierTab("inv-1", { ...CHAT, awaiting: false, messages: [...CHAT.messages, reply] });
    const bubbles = [...content.querySelectorAll(".activitycomment")];
    expect(bubbles[1].classList.contains("supplierreply")).toBe(true);
    expect(bubbles[1].classList.contains("mine")).toBe(false);
    expect(bubbles[1].querySelector(".activitywho span")?.textContent).toBe("jo@lager-nord.example · Lager Nord GmbH");
    expect(content.querySelector(".tlcard")).toBeNull();
  });

  it("sends what is written and redraws from the server", async () => {
    const calls = stub(() => ({ status: 201, body: {} }));
    const { buildSupplierTab } = await load();
    const { content } = buildSupplierTab("inv-1", { ...CHAT, messages: [] });
    document.body.append(content);
    expect(content.textContent).toContain("Nothing written to Lager Nord GmbH yet.");
    (content.querySelector("textarea") as HTMLTextAreaElement).value = "Thanks";
    (content.querySelector(".activitypost") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(content.querySelectorAll(".activitycomment").length).toBe(1));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ body: "Thanks" });
  });

  it("offers no box to write in when nobody is linked, and says why", async () => {
    stub(() => ({ status: 201, body: {} }));
    const { buildSupplierTab } = await load();
    const { content } = buildSupplierTab("inv-1", { ...CHAT, canWrite: false, recipients: [] });
    expect(content.querySelector("textarea")).toBeNull();
    expect(content.querySelector(".supplierto")?.textContent).toContain("Nobody at Lager Nord GmbH is linked");
  });
});

describe("Ask supplier", () => {
  it("asks with the question and the lines ticked, then hands back so the viewer redraws", async () => {
    const calls = stub(() => ({ status: 201, body: {} }));
    const { openAskSupplier } = await load();
    const onAsked = vi.fn();
    openAskSupplier("inv-1", CHAT, [1, 2, 3, 4], { onAsked });
    const box = document.querySelector(".popout.asksupplier")!;
    expect(box.querySelector("h3")?.textContent).toBe("Ask Lager Nord GmbH");
    expect(box.textContent).toContain("The invoice stays where it is and this task stays open.");
    (box.querySelector("textarea") as HTMLTextAreaElement).value = "Line 4 is not on the PO.";
    (box.querySelectorAll(".askline input")[3] as HTMLInputElement).checked = true;
    (box.querySelector(".actionlink.primary") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onAsked).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ body: "Line 4 is not on the PO.", ask: true, lines: [4] });
    expect(document.querySelector(".popout.asksupplier")).toBeNull();
  });

  it("asks for a question before sending anything, and says when nobody is linked any more", async () => {
    const calls = stub(() => ({ status: 409, body: { reason: "no_recipients" } }));
    const { openAskSupplier } = await load();
    openAskSupplier("inv-1", CHAT, [], {});
    const box = document.querySelector(".popout.asksupplier")!;
    (box.querySelector(".actionlink.primary") as HTMLButtonElement).click();
    expect(box.querySelector(".warn")?.textContent).toBe("Write your question first.");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    (box.querySelector("textarea") as HTMLTextAreaElement).value = "Hello";
    (box.querySelector(".actionlink.primary") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(box.querySelector(".warn")?.textContent).toContain("Nobody at Lager Nord GmbH is linked"));
  });

  it("gives the question box the pop-out's full width (Dan, 10 October)", async () => {
    stub(() => ({ status: 201, body: {} }));
    const css = (await import("virtual:stylesheets")).default as Record<string, string>;
    const style = document.createElement("style");
    style.textContent = `${css["tokens.css"] ?? ""}\n${css["app.css"]}`;
    document.head.append(style);
    const { openAskSupplier } = await load();
    openAskSupplier("inv-1", CHAT, [1], {});
    const box = document.querySelector(".popout.asksupplier textarea")!;
    expect(box.getBoundingClientRect().width).toBe(box.parentElement!.getBoundingClientRect().width);
    style.remove();
  });

  it("the banner names who asked and when", async () => {
    stub(() => ({ status: 201, body: {} }));
    const { supplierQueryText } = await load();
    expect(supplierQueryText({ supplierName: "Lager Nord GmbH", askedBy: "Alice McDonald", askedAt: "2026-10-10T09:00:00Z" })).toMatch(
      /^Asked Lager Nord GmbH on 2026-10-10 \d\d:\d\d:\d\d \(Alice McDonald\), awaiting their reply$/
    );
  });
});

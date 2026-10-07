import { describe, it, expect } from "vitest";
import { systemCard, chatBubble, EVENTS } from "/timeline-entry.js";

/** Decision 0675: one look for a Timeline entry, in the Document viewer and a receipt's. */
describe("a Timeline entry", () => {
  it("draws a system entry as a card with its tone, its symbol, the words and the time", () => {
    const card = systemCard("rule_fired", { text: "Business rule fired", at: "2026-10-07T15:37:20.848Z" });
    expect(card.classList.contains("tlcard")).toBe(true);
    expect(card.classList.contains("activitysysline")).toBe(true);
    expect(card.dataset.tone).toBe("warn");
    expect(card.querySelector(".activityactionicon svg")?.innerHTML).not.toBe("");
    expect(card.querySelector(".activitymsg")?.textContent).toBe("Business rule fired");
    // The first entry shows its date; the whole moment is the tooltip.
    const when = card.querySelector(".activitywhen") as HTMLElement;
    expect(when.textContent).toMatch(/^2026-10-07 \d\d:\d\d$/);
    expect(when.title).toMatch(/^2026-10-07 \d\d:\d\d:\d\d$/);
  });

  it("shows only the time when the entry before it was the same day, and the date when the day changes", () => {
    const same = systemCard("received", { text: "x", at: "2026-10-07T12:00:00Z", prevAt: "2026-10-07T11:00:00Z" });
    expect(same.querySelector(".activitywhen")?.textContent).toMatch(/^\d\d:\d\d$/);
    const next = systemCard("received", { text: "x", at: "2026-10-09T12:00:00Z", prevAt: "2026-10-07T11:00:00Z" });
    expect(next.querySelector(".activitywhen")?.textContent).toMatch(/^2026-10-09 \d\d:\d\d$/);
  });

  it("gives each kind of event a tone: information, attention, done, a problem, or a person's action", () => {
    expect(EVENTS.received.tone).toBe("info");
    expect(EVENTS.stopped.tone).toBe("warn");
    expect(EVENTS.registered.tone).toBe("ok");
    expect(EVENTS.email_failed.tone).toBe("bad");
    expect(EVENTS.discard.tone).toBe("bad");
    expect(EVENTS.claim.tone).toBe("act");
    expect(EVENTS.claim.icon).toBe("claim");
  });

  it("keeps a caller's own classes and kind", () => {
    const card = systemCard("claim", { text: "x", at: "2026-10-07T12:00:00Z", classes: "activityaction", kind: "action_taken" });
    expect(card.classList.contains("activityaction")).toBe(true);
    expect(card.dataset.kind).toBe("action_taken");
  });

  it("draws a person's message as a bubble with their initials and the moment to the second, their own on the right", () => {
    const theirs = chatBubble({ name: "Alice McDonald", body: "Hello", at: "2026-10-07T15:38:34Z" });
    expect(theirs.querySelector(".activityavatar")?.textContent).toBe("AM");
    expect(theirs.querySelector(".activitybody")?.textContent).toBe("Hello");
    expect(theirs.querySelector(".activitywhen")?.textContent).toMatch(/^2026-10-07 \d\d:\d\d:\d\d$/);
    expect(theirs.classList.contains("mine")).toBe(false);
    expect(chatBubble({ name: "Dan Young", body: "Hi", at: "2026-10-07T15:39:00Z", mine: true }).classList.contains("mine")).toBe(true);
  });

  it("keeps Day's colours for the entries in Night too, and puts your own message on the right", async () => {
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const rule = css.slice(css.indexOf(".tlfeed {"), css.indexOf("}", css.indexOf(".tlfeed {")));
    expect(rule).toContain("--surface-1: #e8eff8;");
    expect(rule).toContain("--text-primary: #121a26;");
    expect(rule).toContain("--bg-danger: #fbe4e1;");
    expect(css).toContain(".tlchat.mine { flex-direction: row-reverse; }");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import stylesheets from "virtual:stylesheets";

/**
 * Day time or night time — decision 0139.
 *
 * **A person's setting, not a customer's** (decision 0108): light and
 * dark are comfort and accessibility, not brand.
 */

const t = (key: string) =>
  ({ "mood.label": "Mood", "mood.day": "Day time", "mood.night": "Night time" })[key] ?? key;

function withSystem(dark: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-mood");
  localStorage.clear();
  vi.resetModules();
});

describe("what somebody sees before choosing", () => {
  it("follows the machine when nothing is stored", async () => {
    // **Two options and no third.** A "follow the system" entry would
    // make the control read as three states when the screen has two —
    // so the initial *selection* is derived from the system instead.
    withSystem(true);
    const { currentMood } = await import("/mood.js");
    expect(currentMood()).toBe("night");
  });

  it("shows day when the machine is light", async () => {
    withSystem(false);
    const { currentMood } = await import("/mood.js");
    expect(currentMood()).toBe("day");
  });

  it("prefers what they chose over what the machine says", async () => {
    withSystem(true);
    localStorage.setItem("vf-mood", "day");
    const { currentMood } = await import("/mood.js");
    expect(currentMood()).toBe("day");
  });
});

describe("choosing", () => {
  it("puts the mood on the document, not on the body", async () => {
    // The stylesheet needs it before anything renders, and `<html>` is
    // the only element that exists that early.
    const { applyMood } = await import("/mood.js");
    applyMood("night");
    expect(document.documentElement.getAttribute("data-mood")).toBe("night");
  });

  it("remembers it", async () => {
    const { applyMood } = await import("/mood.js");
    applyMood("night");
    expect(localStorage.getItem("vf-mood")).toBe("night");
  });

  it("still works when storage is refused", async () => {
    // A browser refusing storage is a browser that still needs a
    // readable screen.
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };

    const { applyMood } = await import("/mood.js");
    expect(() => applyMood("night")).not.toThrow();
    expect(document.documentElement.getAttribute("data-mood")).toBe("night");

    Storage.prototype.setItem = setItem;
  });

  it("offers exactly the two moods, named", async () => {
    withSystem(false);
    const { moodPicker } = await import("/mood.js");
    const select = moodPicker(t);

    expect([...select.options].map((o) => o.textContent)).toEqual(["Day time", "Night time"]);
  });

  it("applies the choice when it changes", async () => {
    withSystem(false);
    const { moodPicker } = await import("/mood.js");
    const select = moodPicker(t);
    document.body.append(select);

    select.value = "night";
    select.dispatchEvent(new Event("change"));

    expect(document.documentElement.getAttribute("data-mood")).toBe("night");
  });
});

describe("the palettes", () => {
  const css = stylesheets["tokens.css"];

  it("says the same thing twice, and they agree", () => {
    // **Duplicated deliberately**: a single rule cannot express "dark
    // unless overridden, or when chosen" without gymnastics that read
    // worse. This is what stops the two drifting.
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const chosen = css.slice(css.indexOf(':root[data-mood="night"]'));

    for (const token of ["--surface-0", "--surface-1", "--text-primary", "--border"]) {
      const inMedia = media.match(new RegExp(`${token}: ([^;]+);`))?.[1];
      const inChosen = chosen.match(new RegExp(`${token}: ([^;]+);`))?.[1];
      expect(inChosen, token).toBe(inMedia);
    }
  });

  it("lets an explicit day choice beat a dark machine", () => {
    // Somebody on a dark laptop who wants Day time gets it.
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(media).toContain(':root:not([data-mood="day"])');
  });

  it("is blue rather than grey, in both", () => {
    // Asked for by name: lighter blues by day, midnight blues at night.
    expect(css).toContain("#f2f6fb");
    expect(css).toContain("#0d1626");
  });

  it("does not use a true black at night", () => {
    // A black surface makes a white document in the preview panel
    // (decision 0123) glare, and this is a screen somebody reads all
    // day.
    expect(css).not.toContain("--surface-0: #000");
  });
});

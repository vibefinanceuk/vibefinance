import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUiStrings, handleSetUiString, resolveUiLocale } from "../src/ui-strings.js";

async function strings(locale: string | null) {
  const response = await handleUiStrings(env.CONTROL_DB, locale);
  return (await response.json()) as { locale: string; strings: Record<string, string> };
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("which language to answer in", () => {
  it("takes the language, not the region", () => {
    // `de-DE` and `de` are one language here, and a browser sends the
    // first.
    expect(resolveUiLocale("de-DE")).toBe("de");
    expect(resolveUiLocale("de-AT,de;q=0.9,en;q=0.8")).toBe("de");
  });

  it("falls back to English, never an error", () => {
    // The one rule decision 0008 established that carries over
    // unchanged.
    for (const requested of [null, "", "pt", "klingon", "!!!"]) {
      expect(resolveUiLocale(requested)).toBe("en");
    }
  });
});

describe("serving the words", () => {
  it("answers in English by default", async () => {
    const body = await strings(null);
    expect(body.locale).toBe("en");
    expect(body.strings["action.claim"]).toBe("Claim");
  });

  it("answers in German when asked", async () => {
    const body = await strings("de");
    expect(body.locale).toBe("de");
    expect(body.strings["action.claim"]).toBe("Übernehmen");
  });

  it("falls back per key, not per language", async () => {
    // A partially translated locale shows what it has and English for
    // the rest, rather than collapsing entirely because one string is
    // missing.
    await env.CONTROL_DB.prepare(
      "INSERT INTO ui_strings (key, locale, value) VALUES ('new.thing', 'en', 'A new thing')"
    ).run();

    const body = await strings("de");
    expect(body.strings["action.claim"]).toBe("Übernehmen");
    expect(body.strings["new.thing"]).toBe("A new thing");
  });

  it("gives English for an unsupported language rather than nothing", async () => {
    const body = await strings("pt-BR");
    expect(body.locale).toBe("en");
    expect(body.strings["action.claim"]).toBe("Claim");
  });

  it("covers every string the interface uses", async () => {
    // A missing key renders as a dotted name to somebody trying to
    // work, which is worse than an untranslated English word.
    const body = await strings("en");
    for (const key of [
      "signin.title",
      "tasks.mine",
      "tasks.notkeyed",
      "action.claim",
      "action.release",
      "viewer.title",
      "viewer.save",
      "field.bt-112",
    ]) {
      expect(body.strings[key], key).toBeTruthy();
    }
  });

  it("is cacheable but not for long", async () => {
    // Long enough that every page load does not reach the control
    // plane; short enough that a wording fix appears without a
    // deployment -- which is most of why these live in a database.
    const response = await handleUiStrings(env.CONTROL_DB, "en");
    expect(response.headers.get("Cache-Control")).toContain("max-age=300");
    expect(response.headers.get("Vary")).toBe("Accept-Language");
  });
});

describe("changing a word", () => {
  it("updates an existing one", async () => {
    await handleSetUiString(env.CONTROL_DB, { key: "action.claim", locale: "en", value: "Take" });
    expect((await strings("en")).strings["action.claim"]).toBe("Take");
  });

  it("refuses a translation with no English to fall back to", async () => {
    // A German string with no English sibling breaks the fallback for
    // everybody who is not German.
    const result = await handleSetUiString(env.CONTROL_DB, {
      key: "brand.new",
      locale: "de",
      value: "Neu",
    });
    expect(result.status).toBe(422);
    expect(String((result.body as { detail: string }).detail)).toContain("fallback");
  });

  it("accepts a translation once English exists", async () => {
    await handleSetUiString(env.CONTROL_DB, { key: "brand.new", locale: "en", value: "New" });
    expect(
      (await handleSetUiString(env.CONTROL_DB, { key: "brand.new", locale: "de", value: "Neu" })).status
    ).toBe(200);
  });

  it("refuses an empty value", async () => {
    // Worse than an absent key: the absent one falls back, the blank
    // one renders nothing.
    const result = await handleSetUiString(env.CONTROL_DB, {
      key: "action.claim",
      locale: "en",
      value: "   ",
    });
    expect(result.status).toBe(422);
  });

  it("refuses an unsupported locale", async () => {
    expect(
      (await handleSetUiString(env.CONTROL_DB, { key: "action.claim", locale: "pt", value: "Reivindicar" })).status
    ).toBe(422);
  });

  it("refuses a key that is not a lowercase dotted name", async () => {
    // A key nobody can read is one somebody eventually inlines the
    // English beside "for clarity".
    expect(
      (await handleSetUiString(env.CONTROL_DB, { key: "Action.Claim", locale: "en", value: "Claim" })).status
    ).toBe(422);
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";

/** **Access Control and Process Rules — decision 0608.** */
beforeEach(async () => {
  await applyTestSchema();
});

describe("the menu's names — decision 0608", () => {
  it("names Access Control and Process Rules, in English and German, and the AP Setup notes follow", async () => {
    const rows = (await env.CONTROL_DB.prepare("SELECT key, locale, value FROM ui_strings WHERE key IN ('nav.access', 'nav.rules') ORDER BY key, locale").all()).results;
    expect(rows).toEqual([
      { key: "nav.access", locale: "de", value: "Zugriffssteuerung" },
      { key: "nav.access", locale: "en", value: "Access Control" },
      { key: "nav.rules", locale: "de", value: "Prozessregeln" },
      { key: "nav.rules", locale: "en", value: "Process Rules" },
    ]);
    const note = await env.CONTROL_DB.prepare("SELECT value FROM ui_strings WHERE key = 'apsetup.standardrulessub' AND locale = 'en'").first<{ value: string }>();
    expect(note!.value).toContain("its own stage's Process Rules screen");
  });
});

import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, resolveLocale, t } from "./i18n.js";
import type { Locale, MessageKey } from "./i18n.js";

describe("resolveLocale", () => {
  it("passes through a supported locale unchanged", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("fr")).toBe("fr");
  });

  it("falls back to en for an unsupported locale", () => {
    expect(resolveLocale("ja")).toBe("en");
    expect(resolveLocale("zh-CN")).toBe("en");
  });

  it("falls back to en for undefined, null, or a non-string value", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(42)).toBe("en");
    expect(resolveLocale({})).toBe("en");
  });
});

describe("t — rendering", () => {
  it("renders the correct template for a non-English locale", () => {
    expect(t("processingBlocked", "de")).toBe("Verarbeitung blockiert");
    expect(t("processingBlocked", "fr")).toBe("Traitement bloqué");
  });

  it("substitutes a single placeholder", () => {
    expect(t("exampleDoesNotExist", "en", { exampleId: "ex-123" })).toBe(
      "example ex-123 does not exist"
    );
    expect(t("exampleDoesNotExist", "de", { exampleId: "ex-123" })).toBe(
      "Beispiel ex-123 existiert nicht"
    );
  });

  it("substitutes multiple placeholders", () => {
    expect(t("ruleVersionDoesNotExist", "en", { ruleId: "r1", version: 2 })).toBe(
      "rule r1 version 2 does not exist"
    );
    expect(t("cannotActivateUnconfirmed", "en", { unconfirmed: 1, total: 3 })).toBe(
      "cannot activate: 1 of 3 example(s) not yet confirmed"
    );
  });

  it("leaves a placeholder literally in place if its param was not provided", () => {
    expect(t("exampleDoesNotExist", "en", {})).toBe("example {exampleId} does not exist");
  });

  it("returns the template unchanged when no params are given for a key with none", () => {
    expect(t("alreadyActivated", "en")).toBe("already activated");
    expect(t("alreadyActivated", "nl")).toBe("Al geactiveerd");
  });
});

describe("t — completeness across every locale and message key", () => {
  const ALL_KEYS: MessageKey[] = [
    "invalidJsonBody",
    "factsInvoiceIdRequired",
    "exactlyOneRuleSetRequired",
    "ruleSetDoesNotExist",
    "ruleRejectedByVocabulary",
    "processingBlocked",
    "noLicenceProvisioned",
    "licenceBlockedFallback",
    "ruleSetIdSourceTextRequired",
    "confirmedByRequired",
    "exampleDoesNotExist",
    "activatedByRequired",
    "ruleVersionDoesNotExist",
    "alreadyActivated",
    "cannotActivateNoExamples",
    "cannotActivateUnconfirmed",
    "unauthorized",
    "forbidden",
    "ruleIdMustBeString",
    "ruleDoesNotExistInRuleSet",
    "invoiceDoesNotExist",
  ];

  it("every supported locale has a real, non-empty, distinct-from-English translation for every key", () => {
    // The property that actually matters: a future added key that
    // forgets one language should be caught here, not discovered by a
    // customer seeing English text despite LOCALE being set. "distinct
    // from English" catches an accidentally copy-pasted English
    // placeholder value for a non-English locale.
    for (const key of ALL_KEYS) {
      for (const locale of SUPPORTED_LOCALES) {
        const rendered = t(key, locale as Locale);
        expect(rendered.length, `${key}/${locale} was empty`).toBeGreaterThan(0);
        if (locale !== "en") {
          expect(rendered, `${key}/${locale} was identical to English — likely a missed translation`).not.toBe(
            t(key, "en")
          );
        }
      }
    }
  });
});

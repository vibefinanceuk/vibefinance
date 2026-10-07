import { describe, it, expect, vi, afterEach } from "vitest";

/** Decision 0677: amounts shown as money, in English or German, stored as the plain number. */
async function withLocale(locale: "en" | "de") {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ locale, strings: {} }) }) as Response));
  const strings = await import("/strings.js");
  await strings.loadStrings();
  return import("/money.js");
}

afterEach(() => vi.unstubAllGlobals());

describe("money in English", () => {
  it("shows the invoice's currency, grouped, to two decimals", async () => {
    const { formatMoney } = await withLocale("en");
    expect(formatMoney(12500.2, "GBP")).toBe("£12,500.20");
    expect(formatMoney("12500.2", "EUR")).toBe("€12,500.20");
    expect(formatMoney(-15, "GBP")).toBe("-£15.00");
  });

  it("without a currency, a grouped number; nothing for nothing; a non-number as it is", async () => {
    const { formatMoney } = await withLocale("en");
    expect(formatMoney(1200)).toBe("1,200.00");
    expect(formatMoney("")).toBe("");
    expect(formatMoney("abc", "GBP")).toBe("abc");
    expect(formatMoney(5, "XX")).toBe("5.00");
  });

  it("lets a unit price keep up to four decimals", async () => {
    const { formatMoney } = await withLocale("en");
    expect(formatMoney(1.23456, "GBP", "BT-146")).toBe("£1.2346");
    expect(formatMoney(1.5, "GBP", "BT-146")).toBe("£1.50");
    expect(formatMoney(1.23456, "GBP", "BT-131")).toBe("£1.23");
  });

  it("reads what is shown or typed back to the plain number", async () => {
    const { parseAmount } = await withLocale("en");
    expect(parseAmount("£12,500.20")).toBe("12500.2");
    expect(parseAmount("12500.20")).toBe("12500.2");
    expect(parseAmount("12500,20")).toBe("12500.2"); // a single comma before two digits can only be decimal
    expect(parseAmount("1,234")).toBe("1234");
    expect(parseAmount("-£15.00")).toBe("-15");
    expect(parseAmount("")).toBe("");
    expect(parseAmount("abc")).toBe("abc");
  });
});

describe("money in German", () => {
  it("shows 12.500,20 with the currency after", async () => {
    const { formatMoney, plainAmount } = await withLocale("de");
    // Intl puts a non-breaking space before the symbol.
    expect(formatMoney(12500.2, "EUR")).toBe("12.500,20\u00a0€");
    expect(formatMoney(1200)).toBe("1.200,00");
    expect(plainAmount(12500.2)).toBe("12500,20");
  });

  it("reads German amounts, and a UK-style one typed by habit", async () => {
    const { parseAmount } = await withLocale("de");
    expect(parseAmount("12.500,20 €")).toBe("12500.2");
    expect(parseAmount("12500,20")).toBe("12500.2");
    expect(parseAmount("12500.20")).toBe("12500.2");
    expect(parseAmount("1.234")).toBe("1234"); // three digits after a single point: thousands, in German
  });
});

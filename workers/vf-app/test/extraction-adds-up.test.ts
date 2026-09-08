import { describe, expect, it, vi } from "vitest";
import { extractInvoiceFromImages } from "../src/extraction.js";

/**
 * Does the reading add up? — decision 0170.
 *
 * **A real freight invoice** came back with eight plausible lines
 * summing to 3,137.47 against a header `BT-106` of 2,272.47 — out by
 * 865.00 — and reported `extraction.confidence: 0.9` with no conflicts.
 *
 * The model was confident about a reading that does not balance, and
 * the arithmetic was available the whole time.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A model that answers with whatever the test gives it. */
function modelSaying(response: Record<string, unknown>) {
  return { extract: vi.fn(async () => JSON.stringify(response)) } as never;
}

/** The real invoice's own numbers. */
const FREIGHT = {
  invoiceNumber: "SKELS26003894",
  netTotalBeforeVat: 2272.47,
  totalWithVat: 2272.47,
  _confidence: 0.9,
  lines: [
    { description: "International Freight", amount: 1797.47 },
    { description: "Destination Terminal Handling Charges", amount: 275 },
    { description: "ISPS / Port Security Charge", amount: 35 },
    { description: "Destination Documentation Fee", amount: 75 },
    { description: "Equipment Fee", amount: 25 },
    { description: "Delivery Cartage", amount: 585 },
    { description: "Destination Customs Clearance Fee", amount: 85 },
    { description: "Drop off", amount: 260 },
  ],
};

describe("lines that do not sum to the header", () => {
  it("names the difference", async () => {
    const result = await extractInvoiceFromImages(modelSaying(FREIGHT), [PNG]);
    expect(result.facts["extraction.linesDiffer"]).toBe(865);
  });

  it("stops claiming to be confident", async () => {
    // **Halved rather than zeroed.** The facts are still worth having;
    // what is not warranted is telling somebody we are 90% sure.
    const result = await extractInvoiceFromImages(modelSaying(FREIGHT), [PNG]);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it("keeps the facts it read", async () => {
    // A header read cleanly is a header read cleanly, and a person
    // keying needs somewhere to start.
    const result = await extractInvoiceFromImages(modelSaying(FREIGHT), [PNG]);
    expect(result.facts["BT-1"]).toBe("SKELS26003894");
    expect(result.lines).toHaveLength(8);
  });
});

describe("lines that do sum", () => {
  it("says the difference is zero", async () => {
    const result = await extractInvoiceFromImages(
      modelSaying({
        invoiceNumber: "OK-1",
        netTotalBeforeVat: 300,
        _confidence: 0.9,
        lines: [
          { description: "One", amount: 100 },
          { description: "Two", amount: 200 },
        ],
      }),
      [PNG]
    );

    expect(result.facts["extraction.linesDiffer"]).toBe(0);
  });

  it("leaves the confidence alone", async () => {
    const result = await extractInvoiceFromImages(
      modelSaying({
        invoiceNumber: "OK-1",
        netTotalBeforeVat: 300,
        _confidence: 0.9,
        lines: [
          { description: "One", amount: 100 },
          { description: "Two", amount: 200 },
        ],
      }),
      [PNG]
    );

    expect(result.confidence).toBe(0.9);
  });

  it("tolerates a penny of floating point", async () => {
    // **Rounded before comparing**: a sum of decimals disagrees with
    // itself, and a rule about half a penny would fire on arithmetic
    // rather than on documents.
    const result = await extractInvoiceFromImages(
      modelSaying({
        invoiceNumber: "OK-1",
        netTotalBeforeVat: 0.3,
        _confidence: 0.9,
        lines: [
          { description: "One", amount: 0.1 },
          { description: "Two", amount: 0.2 },
        ],
      }),
      [PNG]
    );

    expect(result.facts["extraction.linesDiffer"]).toBe(0);
  });
});

describe("a document with no lines at all", () => {
  it("says nothing about arithmetic it cannot do", async () => {
    // A header-only reading is not a mismatch.
    const result = await extractInvoiceFromImages(
      modelSaying({ invoiceNumber: "OK-1", netTotalBeforeVat: 300, _confidence: 0.9 }),
      [PNG]
    );

    expect(result.facts["extraction.linesDiffer"]).toBeUndefined();
    expect(result.confidence).toBe(0.9);
  });
});

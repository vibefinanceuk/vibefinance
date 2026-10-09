import { describe, expect, it } from "vitest";
import {
  pdfWords,
  readingOrder,
  amountCandidates,
  dateCandidates,
  findValue,
  locate,
  rotateBox,
  unrotatePoint,
  wordsInLasso,
  valueFromLasso,
  squash,
  ocrWords,
  columnHeading,
} from "/doc-words.js";
import { parseAmount } from "/money.js";

/**
 * Finding a value on a page, and reading a lasso — decision 0697. Pure
 * functions over a list of words with boxes, which is what both a PDF's
 * text layer and (decision 0698) OCR come down to.
 */

/** A page of words laid out on a 1000×1000 grid, one line per row. */
function page(rows: string[][], { lineHeight = 20, charWidth = 8, left = 50 } = {}) {
  const words: { text: string; x: number; y: number; w: number; h: number }[] = [];
  rows.forEach((row, r) => {
    let x = left;
    for (const text of row) {
      words.push({ text, x: x / 1000, y: (100 + r * 40) / 1000, w: (text.length * charWidth) / 1000, h: lineHeight / 1000 });
      x += (text.length + 1) * charWidth;
    }
  });
  return readingOrder(words);
}

describe("pdfWords — runs of PDF text as boxed words", () => {
  // An A4 page at scale 1: 595×842 points, y flipped by the viewport.
  const viewport = { width: 595, height: 842, scale: 1, transform: [1, 0, 0, -1, 0, 842] };

  it("splits a run on spaces and places each word along it", () => {
    const content = {
      items: [{ str: "Total 1,234.50", transform: [10, 0, 0, 10, 100, 742], width: 70, height: 10 }],
    };
    const words = pdfWords(content, viewport);
    expect(words.map((w: { text: string }) => w.text)).toEqual(["Total", "1,234.50"]);
    // Baseline 742 in PDF space is 100 from the top; the box starts one font height above it.
    expect(words[0].y).toBeCloseTo(90 / 842, 3);
    expect(words[0].x).toBeCloseTo(100 / 595, 3);
    // "Total " is 6 of 14 characters, so the amount starts 6/14 of the way along.
    expect(words[1].x).toBeCloseTo((100 + (70 * 6) / 14) / 595, 3);
  });

  it("puts the words in reading order whatever order the PDF wrote them", () => {
    const content = {
      items: [
        { str: "second", transform: [10, 0, 0, 10, 100, 700], width: 30, height: 10 },
        { str: "right", transform: [10, 0, 0, 10, 300, 742], width: 25, height: 10 },
        { str: "left", transform: [10, 0, 0, 10, 100, 742], width: 20, height: 10 },
      ],
    };
    expect(pdfWords(content, viewport).map((w: { text: string }) => w.text)).toEqual(["left", "right", "second"]);
  });

  it("skips empty runs", () => {
    const content = { items: [{ str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10 }] };
    expect(pdfWords(content, viewport)).toEqual([]);
  });
});

describe("amountCandidates — an amount however it is written", () => {
  it.each([
    ["1,234.50", 1234.5],
    ["1.234,50", 1234.5],
    ["£1,234.50", 1234.5],
    ["€ 1.234,50", 1234.5],
    ["1234.5", 1234.5],
    ["(12.00)", -12],
    ["12.00-", -12],
    ["1,234,567.89", 1234567.89],
    ["1.234.567,89", 1234567.89],
  ])("%s reads as %d", (text, n) => {
    expect(amountCandidates(text)).toContain(n);
  });

  it("offers both readings of an ambiguous single mark", () => {
    expect(amountCandidates("1.234").sort()).toEqual([1.234, 1234].sort());
  });

  it("is nothing for words with no digits", () => {
    expect(amountCandidates("Total")).toEqual([]);
  });
});

describe("dateCandidates — a date however it is written", () => {
  it.each([
    ["2026-10-09", "2026-10-09"],
    ["09.10.2026", "2026-10-09"],
    ["09/10/2026", "2026-10-09"],
    ["9 October 2026", "2026-10-09"],
    ["9th Oct 2026", "2026-10-09"],
    ["October 9, 2026", "2026-10-09"],
    ["9. Oktober 2026", "2026-10-09"],
    ["09-Oct-26", "2026-10-09"],
  ])("%s reads as %s", (text, iso) => {
    expect(dateCandidates(text)).toContain(iso);
  });

  it("offers both orders when day and month could swap, day first", () => {
    expect(dateCandidates("03/04/2026")).toEqual(["2026-04-03", "2026-03-04"]);
  });

  it("refuses an impossible date", () => {
    expect(dateCandidates("31/02/2026")).toEqual([]);
  });
});

describe("findValue and locate — where a value is", () => {
  const words = page([
    ["ACME", "Ltd"],
    ["Invoice", "No:", "INV-0042"],
    ["Date:", "09.10.2026"],
    ["VAT", "Reg:", "GB", "123", "4567", "89"],
    ["Widgets", "2", "617,25"],
    ["Net", "617,25"],
    ["VAT", "123,45"],
    ["Total", "€", "740,70"],
  ]);

  it("finds an amount written the German way", () => {
    const [found] = locate([{ pageNumber: 1, words }], { field: "BT-112", value: "740.7", kind: "amount" });
    expect(found.text).toBe("740,70");
  });

  it("finds a date written day.month.year", () => {
    expect(locate([{ pageNumber: 1, words }], { field: "BT-2", value: "2026-10-09", kind: "date" })[0].text).toBe("09.10.2026");
  });

  it("finds a VAT number printed in groups", () => {
    expect(locate([{ pageNumber: 1, words }], { field: "BT-31", value: "GB123456789", kind: "text" })[0].text).toBe("GB 123 4567 89");
  });

  it("finds text without case or punctuation mattering", () => {
    expect(locate([{ pageNumber: 1, words }], { field: "BT-27", value: "acme ltd.", kind: "text" })[0].text).toBe("ACME Ltd");
  });

  it("finds the invoice number", () => {
    expect(locate([{ pageNumber: 1, words }], { field: "BT-1", value: "INV-0042", kind: "text" })[0].text).toBe("INV-0042");
  });

  it("prefers the place beside the field's own label when a value appears twice", () => {
    // 617,25 is both the line amount and the net total.
    const net = locate([{ pageNumber: 1, words }], { field: "BT-109", value: "617.25", kind: "amount" });
    expect(net).toHaveLength(2);
    const netLine = words.find((w: { text: string }) => w.text === "Net")!.line;
    expect(net[0].words[0].line).toBe(netLine);
  });

  it("prefers the place on a line's own row for a line amount", () => {
    const widgets = words.find((w: { text: string }) => w.text === "Widgets")!;
    const found = locate([{ pageNumber: 1, words }], {
      field: "BT-131",
      value: "617.25",
      kind: "amount",
      near: { pageNumber: 1, box: widgets },
    });
    expect(found[0].words[0].line).toBe(widgets.line);
  });

  it("does not find a short value inside another word", () => {
    expect(findValue(words, "2", "text").map((run: { text: string }[]) => run[0].text)).toEqual(["2"]);
  });

  it("finds nothing for a value that is not there", () => {
    expect(locate([{ pageNumber: 1, words }], { field: "BT-112", value: "999.99", kind: "amount" })).toEqual([]);
  });

  it("joins an amount printed with a space as the thousands separator", () => {
    const spaced = page([["Total", "1", "234,50"]]);
    expect(findValue(spaced, "1234.5", "amount")[0].map((w: { text: string }) => w.text)).toEqual(["1", "234,50"]);
  });

  it("finds a value on a later page", () => {
    const second = page([["Total", "740,70"]]);
    const found = locate(
      [
        { pageNumber: 1, words: page([["Nothing", "here"]]) },
        { pageNumber: 2, words: second },
      ],
      { field: "BT-112", value: "740.70", kind: "amount" }
    );
    expect(found[0].pageNumber).toBe(2);
  });
});

describe("rotation", () => {
  const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

  it.each([0, 90, 180, 270])("a corner of a box turned %i° comes back to where it was", (rotation) => {
    const turned = rotateBox(box, rotation);
    const corners = [
      { x: turned.x, y: turned.y },
      { x: turned.x + turned.w, y: turned.y + turned.h },
    ].map((p) => unrotatePoint(p, rotation));
    const xs = corners.map((p) => p.x).sort();
    const ys = corners.map((p) => p.y).sort();
    expect(xs[0]).toBeCloseTo(box.x);
    expect(xs[1]).toBeCloseTo(box.x + box.w);
    expect(ys[0]).toBeCloseTo(box.y);
    expect(ys[1]).toBeCloseTo(box.y + box.h);
  });

  it("turns the top-left corner to the top-right at 90°", () => {
    const turned = rotateBox({ x: 0, y: 0, w: 0.1, h: 0.1 }, 90);
    expect(turned.x).toBeCloseTo(0.9);
    expect(turned.y).toBeCloseTo(0);
  });
});

describe("wordsInLasso", () => {
  const words = page([["Total", "€", "740,70"], ["Thank", "you"]]);

  it("takes the words whose centres are inside the shape, in reading order", () => {
    const amount = words.find((w: { text: string }) => w.text === "740,70")!;
    const polygon = [
      { x: amount.x - 0.01, y: amount.y - 0.01 },
      { x: amount.x + amount.w + 0.01, y: amount.y - 0.01 },
      { x: amount.x + amount.w + 0.01, y: amount.y + amount.h + 0.01 },
      { x: amount.x - 0.01, y: amount.y + amount.h + 0.01 },
    ];
    const taken = wordsInLasso(words, polygon);
    expect(taken.text).toBe("740,70");
    expect(taken.box.x).toBeCloseTo(amount.x);
  });

  it("joins two lines with a space", () => {
    const all = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(wordsInLasso(words, all).text).toBe("Total € 740,70 Thank you");
  });

  it("is empty for a shape of fewer than three points", () => {
    expect(wordsInLasso(words, [{ x: 0, y: 0 }]).text).toBe("");
  });
});

describe("valueFromLasso — the lasso's text as the field's value", () => {
  it("takes the last amount when the lasso caught the label too", () => {
    expect(valueFromLasso("Total £1,234.50", "amount", parseAmount)).toBe("1234.5");
  });

  it("reads a space-grouped amount", () => {
    expect(valueFromLasso("1 234.50", "amount", parseAmount)).toBe("1234.5");
  });

  it("gives a date as ISO", () => {
    expect(valueFromLasso("Invoice date: 9 October 2026", "date")).toBe("2026-10-09");
  });

  it("reads an ambiguous date day first", () => {
    expect(valueFromLasso("03/04/2026", "date")).toBe("2026-04-03");
  });

  it("gives text as it reads", () => {
    expect(valueFromLasso("  INV-0042 ", "text")).toBe("INV-0042");
  });

  it("is null when there is no value of that kind", () => {
    expect(valueFromLasso("Thank you", "amount", parseAmount)).toBeNull();
    expect(valueFromLasso("Thank you", "date")).toBeNull();
  });
});

describe("squash", () => {
  it("drops case, spaces, punctuation and accents", () => {
    expect(squash("Société Générale, S.A.")).toBe("societegeneralesa");
  });
});

describe("ocrWords — Tesseract's words as boxes on the page (decision 0698)", () => {
  // As tesseract.js 6 gives them for a 1157×1637 page (read from a real scan in testing).
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: "Gesamtbetrag", confidence: 96, bbox: { x0: 681, y0: 470, x1: 802, y1: 497 } },
                { text: "1.683,26", confidence: 95, bbox: { x0: 960, y0: 475, x1: 1033, y1: 492 } },
                { text: "€", confidence: 95, bbox: { x0: 1039, y0: 475, x1: 1049, y1: 489 } },
              ],
            },
          ],
        },
      ],
    },
    { paragraphs: [{ lines: [{ words: [{ text: "Müller", confidence: 96, bbox: { x0: 99, y0: 77, x1: 188, y1: 100 } }] }] }] },
  ];

  it("gives each word as a fraction of the image, in reading order, with its confidence", () => {
    const words = ocrWords(blocks, 1157, 1637);
    expect(words.map((w: { text: string }) => w.text)).toEqual(["Müller", "Gesamtbetrag", "1.683,26", "€"]);
    expect(words[2].x).toBeCloseTo(960 / 1157);
    expect(words[2].h).toBeCloseTo(17 / 1637);
    expect(words[2].conf).toBe(95);
  });

  it("is found by the same search as a PDF's text", () => {
    const words = ocrWords(blocks, 1157, 1637);
    expect(locate([{ pageNumber: 1, words }], { field: "BT-112", value: "1683.26", kind: "amount" })[0].text).toBe("1.683,26");
  });

  it("is nothing without the image's size", () => {
    expect(ocrWords(blocks, 0, 0)).toEqual([]);
  });
});

describe("columnHeading — the heading over a value's column (decision 0705)", () => {
  // Beschreibung at 50, Menge from 300, Betrag from 500; two line rows below.
  function table() {
    const at = (text: string, x: number, row: number) => ({ text, x: x / 1000, y: (100 + row * 40) / 1000, w: (text.length * 8) / 1000, h: 0.02 });
    return readingOrder([
      at("Rechnung", 50, 0),
      at("Beschreibung", 50, 1), at("Menge", 300, 1), at("Betrag", 500, 1),
      at("Kopierpapier", 50, 2), at("A4", 160, 2), at("10", 310, 2), at("1.234,50", 500, 2),
      at("Toner", 50, 3), at("schwarz", 100, 3), at("2", 315, 3), at("180,00", 500, 3),
    ]);
  }

  it("finds the heading row above, past the rows of numbers", () => {
    const words = table();
    const two = words.find((w: { text: string }) => w.text === "2")!;
    expect(columnHeading(words, two)).toBe("Menge");
    const amount = words.find((w: { text: string }) => w.text === "180,00")!;
    expect(columnHeading(words, amount)).toBe("Betrag");
  });

  it("is empty with no heading row above", () => {
    const words = table();
    const rechnung = words.find((w: { text: string }) => w.text === "Rechnung")!;
    expect(columnHeading(words, rechnung)).toBe("");
  });
});

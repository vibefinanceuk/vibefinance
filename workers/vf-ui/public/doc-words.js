/**
 * **The words on a page, and where each one is — decision 0697.**
 *
 * Dan, 9 October 2026: *"when a field is clicked for the image viewer to
 * highlight the field that has been extracted. If the user lasso's another
 * field on the image, the data from that lasso should be returned to the
 * cell that has focus."*
 *
 * Everything here is pure: a page is a list of **words**, each with its
 * text and its box as a **fraction of the unrotated page** (`x`, `y`, `w`,
 * `h` from 0 to 1, origin top-left). A fraction stays true at every zoom,
 * and rotation is applied only when drawing (`rotateBox`), so a highlight
 * survives both. Where the words come from is the caller's business: the
 * PDF's own text layer through pdf.js (`pdfWords`, this decision), and
 * OCR of a scanned page (decision 0698) — both end as the same list, so
 * finding a value and reading a lasso work the same for either.
 */

// ---------------------------------------------------------------------
// Words from a PDF's text layer (pdf.js `getTextContent`).
// ---------------------------------------------------------------------

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * Every word of one PDF page as a box on it. `textContent` is pdf.js's
 * `page.getTextContent()`; `viewport` is `page.getViewport({ scale: 1,
 * rotation: 0 })` — the page as the viewer draws it before any rotation.
 *
 * pdf.js gives **runs** of text, not words: one item can be
 * `"Invoice total: 1,234.50"`. A run is split on spaces and each word
 * given its share of the run's width. `measure(text, fontFamily)`, where
 * given, measures that share in a font like the PDF's (the browser passes
 * a canvas's `measureText`), so a word's box starts where its ink does;
 * without it, the share is by character count.
 */
export function pdfWords(textContent, viewport, measure = null) {
  const words = [];
  const pageW = viewport.width;
  const pageH = viewport.height;
  if (!pageW || !pageH) return words;
  for (const item of textContent?.items ?? []) {
    const str = item?.str ?? "";
    if (!str.trim() || !Array.isArray(item.transform)) continue;
    const tx = multiply(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height ?? 0) * viewport.scale;
    const runWidth = (item.width ?? 0) * (viewport.scale ?? 1);
    if (!fontHeight || !runWidth) continue;
    // A run's baseline sits at tx[5]; its box reaches one font height above
    // it and a little below, for descenders.
    const top = tx[5] - fontHeight;
    const height = fontHeight * 1.2;
    const family = textContent.styles?.[item.fontName]?.fontFamily ?? "sans-serif";
    const span = (text) => (measure ? measure(text, family) : text.length);
    const whole = span(str) || str.length;
    const scale = runWidth / whole;
    let offset = "";
    for (const part of str.split(/(\s+)/)) {
      if (part && !/^\s+$/.test(part)) {
        const left = tx[4] + span(offset) * scale;
        const width = span(part) * scale;
        words.push({
          text: part,
          x: clamp(left / pageW),
          y: clamp(top / pageH),
          w: Math.min(width / pageW, 1),
          h: Math.min(height / pageH, 1),
        });
      }
      offset += part;
    }
  }
  return readingOrder(words);
}

/**
 * Every word Tesseract read on a page image as a box on it — decision 0698.
 * `blocks` is tesseract.js's `data.blocks` (blocks → paragraphs → lines →
 * words, each word with a pixel `bbox` and a `confidence` from 0 to 100);
 * `width` and `height` are the image's own size in pixels. A word keeps its
 * confidence (`conf`), so a lasso over words Tesseract was unsure of can be
 * read again another way (decision 0699).
 */
export function ocrWords(blocks, width, height) {
  const words = [];
  if (!width || !height) return words;
  for (const block of blocks ?? []) {
    for (const paragraph of block?.paragraphs ?? []) {
      for (const line of paragraph?.lines ?? []) {
        for (const word of line?.words ?? []) {
          const text = String(word?.text ?? "").trim();
          const b = word?.bbox;
          if (!text || !b) continue;
          words.push({
            text,
            x: clamp(b.x0 / width),
            y: clamp(b.y0 / height),
            w: Math.min(1, (b.x1 - b.x0) / width),
            h: Math.min(1, (b.y1 - b.y0) / height),
            conf: Number(word.confidence ?? 0),
          });
        }
      }
    }
  }
  return readingOrder(words);
}

function clamp(n) {
  return Math.min(1, Math.max(0, n));
}

/**
 * Words in the order a person reads them: by line, then left to right. A
 * PDF stores text in whatever order its producer wrote it, which is often
 * not that — and finding `"1,234.50"` split over two words needs them
 * next to each other.
 */
export function readingOrder(words) {
  const sorted = [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines = [];
  for (const word of sorted) {
    const mid = word.y + word.h / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.min(l.h, word.h) * 0.5);
    if (line) {
      line.words.push(word);
    } else {
      lines.push({ mid, h: word.h, words: [word] });
    }
  }
  lines.sort((a, b) => a.mid - b.mid);
  const out = [];
  lines.forEach((line, index) => {
    line.words.sort((a, b) => a.x - b.x);
    for (const word of line.words) out.push({ ...word, line: index });
  });
  return out;
}

// ---------------------------------------------------------------------
// Boxes, rotation and the lasso's shape.
// ---------------------------------------------------------------------

/** The smallest box around `words`, or null. */
export function unionBox(words) {
  if (!words.length) return null;
  const x = Math.min(...words.map((w) => w.x));
  const y = Math.min(...words.map((w) => w.y));
  const right = Math.max(...words.map((w) => w.x + w.w));
  const bottom = Math.max(...words.map((w) => w.y + w.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * A box on the unrotated page, as it lands on the page turned clockwise by
 * `rotation` (0, 90, 180, 270) — how the viewer's canvas draws it.
 */
export function rotateBox(box, rotation) {
  switch (rotation) {
    case 90:
      return { x: 1 - (box.y + box.h), y: box.x, w: box.h, h: box.w };
    case 180:
      return { x: 1 - (box.x + box.w), y: 1 - (box.y + box.h), w: box.w, h: box.h };
    case 270:
      return { x: box.y, y: 1 - (box.x + box.w), w: box.h, h: box.w };
    default:
      return { ...box };
  }
}

/** A point on the turned page back to the unrotated page — the inverse of `rotateBox`. */
export function unrotatePoint(point, rotation) {
  switch (rotation) {
    case 90:
      return { x: point.y, y: 1 - point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: 1 - point.y, y: point.x };
    default:
      return { ...point };
  }
}

/** Whether `point` is inside the closed shape `polygon` (even-odd rule). */
export function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The words a lasso took, in reading order, and their text — lines joined
 * by a space, since a field holds one line. A word is taken when its
 * centre is inside the shape, so a loose loop around a value takes the
 * value and not its neighbours' edges.
 */
export function wordsInLasso(words, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return { words: [], text: "", box: null };
  const taken = words.filter((w) => insidePolygon({ x: w.x + w.w / 2, y: w.y + w.h / 2 }, polygon));
  return { words: taken, text: taken.map((w) => w.text).join(" "), box: unionBox(taken) };
}

/**
 * What is printed beside `box` on the page, for the model reading a lasso
 * to know what it is looking at (decision 0699): the words on the same
 * line to its left (a label, usually), then the line just above it, left
 * to right. At most `max` characters.
 */
/**
 * The label printed beside a value — decision 0701: the words to its left
 * on the same line, or failing those the line above it. What a supplier's
 * layout is recognised by ("Gesamtbetrag", "Rechnungsnr.").
 */
export function labelBeside(words, box, taken = []) {
  const [left, above = ""] = contextFor(words, box, taken).split("|").map((part) => part.trim());
  return left || above;
}

export function contextFor(words, box, taken = [], max = 200) {
  if (!box) return "";
  const mid = box.y + box.h / 2;
  const left = words.filter(
    (w) => !taken.includes(w) && Math.abs(w.y + w.h / 2 - mid) < Math.max(w.h, box.h * 0.6) && w.x + w.w <= box.x + 0.005 && box.x - (w.x + w.w) < 0.4
  );
  const above = words.filter(
    (w) => !taken.includes(w) && w.y + w.h <= box.y + 0.003 && box.y - (w.y + w.h) < 0.03 && w.x < box.x + box.w && w.x + w.w > box.x - 0.15
  );
  const text = [...left.map((w) => w.text), ...(above.length ? ["|", ...above.map((w) => w.text)] : [])].join(" ");
  return text.slice(0, max);
}

/**
 * The heading of the table column a value sits in — decision 0705: going up
 * from the value, the first line that reads like a table's heading row
 * (three or more words, none of them an amount) and has a word over the
 * value's column. `""` when there is none within reach.
 */
export function columnHeading(words, box, reach = 0.45) {
  if (!box) return "";
  const lines = new Map();
  for (const w of words) {
    if (w.y + w.h > box.y + 0.002 || box.y - (w.y + w.h) > reach) continue;
    if (!lines.has(w.line)) lines.set(w.line, []);
    lines.get(w.line).push(w);
  }
  const numeric = (t) => amountCandidates(t).length > 0 && !/[a-z]{2}/i.test(t);
  const left = box.x - 0.01;
  const right = box.x + box.w + 0.01;
  for (const line of [...lines.keys()].sort((a, b) => b - a)) {
    const row = lines.get(line);
    const wordsOnly = row.filter((w) => !numeric(w.text));
    if (wordsOnly.length < 3 || wordsOnly.length < row.length) continue;
    const over = row.filter((w) => w.x < right && w.x + w.w > left);
    if (over.length) return over.map((w) => w.text).join(" ");
  }
  return "";
}

/** The smallest box around a lasso's points. */
export function polygonBox(points) {
  if (!points?.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  return { x, y, w: Math.min(1, Math.max(...xs)) - x, h: Math.min(1, Math.max(...ys)) - y };
}

// ---------------------------------------------------------------------
// Reading a value the way a document writes it.
// ---------------------------------------------------------------------

/**
 * Every number `text` could mean as an amount. `"1.234"` is one thousand
 * two hundred and thirty-four in German and one point two three four in
 * English, and the page does not say which — so both are candidates, and
 * a value is found if it is either. Currency signs, codes and brackets are
 * ignored; a minus or brackets make it negative.
 */
export function amountCandidates(text) {
  const raw = String(text ?? "").trim();
  if (!/\d/.test(raw)) return [];
  const negative = /^\(.*\)$|^-|-$/.test(raw.replace(/[^\d.,()\-]/g, ""));
  const s = raw.replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!s || !/^\d[\d.,]*$/.test(s)) return [];
  const marks = s.replace(/\d/g, "");
  const out = new Set();
  const add = (str) => {
    const n = Number(str);
    if (Number.isFinite(n)) out.add(negative ? -n : n);
  };
  if (marks.length === 0) {
    add(s);
  } else if (new Set(marks).size === 2) {
    // Both marks: the last one is the decimal mark.
    const decimal = marks[marks.length - 1];
    const group = decimal === "." ? "," : ".";
    const [int, frac] = [s.slice(0, s.lastIndexOf(decimal)), s.slice(s.lastIndexOf(decimal) + 1)];
    if (int.split(group).slice(1).every((g) => g.length === 3)) add(`${int.split(group).join("")}.${frac}`);
  } else if (marks.length === 1) {
    const after = s.length - s.search(/[.,]/) - 1;
    add(s.replace(/[.,]/, "."));
    // Three digits after a single mark could be a thousands separator.
    if (after === 3) add(s.replace(/[.,]/, ""));
  } else {
    // One kind of mark, several times: thousands separators.
    const groups = s.split(marks[0]);
    if (groups.slice(1).every((g) => g.length === 3)) add(groups.join(""));
  }
  return [...out];
}

const MONTHS = {
  jan: 1, january: 1, januar: 1, jänner: 1, janv: 1, janvier: 1,
  feb: 2, february: 2, februar: 2, fév: 2, fev: 2, février: 2, fevrier: 2,
  mar: 3, march: 3, märz: 3, maerz: 3, mär: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juni: 6, juin: 6,
  jul: 7, july: 7, juli: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aoû: 8, aou: 8, août: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, dez: 12, dezember: 12, déc: 12, décembre: 12, decembre: 12,
};

function iso(y, m, d) {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2200)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every ISO date `text` could mean. `"03/04/2026"` is the 3rd of April in
 * Britain and the 4th of March in America; both are candidates. Month
 * names are read in English, German and French.
 */
export function dateCandidates(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const out = new Set();
  const add = (v) => v && out.add(v);
  let m;
  if ((m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) add(iso(m[1], m[2], m[3]));
  if ((m = s.match(/(?:^|[^\d])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d])/))) {
    add(iso(m[3], m[2], m[1]));
    add(iso(m[3], m[1], m[2]));
  }
  if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th|\.)?[ -]?([a-zäéû]{3,9})\.?[ -]?(\d{4}|\d{2})(?!\d)/))) {
    const month = MONTHS[m[2]];
    if (month) add(iso(m[3], month, m[1]));
  }
  if ((m = s.match(/([a-zäéû]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})/))) {
    const month = MONTHS[m[1]];
    if (month) add(iso(m[3], month, m[2]));
  }
  return [...out];
}

/** Text compared without case, spaces or punctuation: `GB 123 4567 89` is `gb123456789`. */
export function squash(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// ---------------------------------------------------------------------
// Finding a value on the page.
// ---------------------------------------------------------------------

/**
 * Labels a value is printed beside, used to choose between two places the
 * same value appears — an invoice total is often also the only line's
 * amount. English, German and French, compared squashed.
 */
export const FIELD_LABELS = {
  "BT-1": ["invoice no", "invoice number", "invoice", "inv no", "rechnungsnummer", "rechnung nr", "facture n", "numéro de facture"],
  "BT-2": ["invoice date", "date", "issue date", "tax point", "rechnungsdatum", "datum", "date de facture"],
  "BT-9": ["due date", "payment due", "due", "fällig", "fälligkeitsdatum", "zahlbar bis", "échéance"],
  "BT-13": ["purchase order", "po", "order no", "order number", "your order", "bestellnummer", "bestellung", "commande"],
  "BT-31": ["vat", "vat no", "vat reg", "vat number", "ust-idnr", "ust id", "tva"],
  "BT-106": ["subtotal", "sub total", "net", "zwischensumme", "sous-total"],
  "BT-109": ["net", "net total", "total net", "total excl", "subtotal", "nettobetrag", "netto", "total ht"],
  "BT-110": ["vat", "vat total", "tax", "mwst", "umsatzsteuer", "tva"],
  "BT-112": ["total", "invoice total", "total due", "gross", "total incl", "gesamt", "gesamtbetrag", "brutto", "total ttc"],
  "BT-115": ["amount due", "balance due", "total due", "to pay", "zahlbetrag", "zu zahlen", "net à payer"],
};

const LABEL_SQUASHED = Object.fromEntries(
  Object.entries(FIELD_LABELS).map(([field, labels]) => [field, labels.map((l) => l.split(" ").map(squash).filter(Boolean))])
);

/** How a field's value is written: `amount`, `number`, `date` or `text`. */
function matches(kind, joined, value) {
  if (kind === "amount" || kind === "number") {
    const target = Number(value);
    if (!Number.isFinite(target)) return false;
    return amountCandidates(joined).some((n) => Math.abs(Math.abs(n) - Math.abs(target)) < 0.005);
  }
  if (kind === "date") return dateCandidates(joined).includes(String(value).slice(0, 10));
  return squash(joined) === squash(value);
}

function startsValue(text, kind) {
  if (/\d/.test(text)) return true;
  return kind === "date" && Object.hasOwn(MONTHS, text.toLowerCase().replace(/[^a-zäéû]/g, ""));
}

/**
 * Whether the word after `word` can belong to the same number: `1 234,50`
 * printed with a space as the thousands separator is two words.
 */
function continuesNumber(next) {
  return /^\d{3}([.,]\d+)?[^\d]*$/.test(next.text);
}

/**
 * Every place `value` appears among `words` (one page), as runs of
 * consecutive words on one line. A value is compared the way its kind is
 * written — an amount whatever its separators and currency, a date
 * whatever its order and month names, text without case, spaces or
 * punctuation — so `1234.5` finds `€1.234,50`, `2026-10-09` finds
 * `09.10.2026`, and `GB123456789` finds `GB 123 4567 89`.
 *
 * For text, a run may carry a little more than the value at its ends
 * (`No.INV-001` for `INV-001`) — the box is then a word wider than the
 * value, which still shows where it is.
 */
export function findValue(words, value, kind = "text") {
  const target = String(value ?? "").trim();
  if (!target) return [];
  const found = [];
  if (kind === "amount" || kind === "number" || kind === "date") {
    const maxRun = kind === "date" ? 4 : 3;
    for (let i = 0; i < words.length; i++) {
      // A value starts at its own first word, not at a label or a currency sign before it.
      if (!startsValue(words[i].text, kind)) continue;
      let joined = "";
      for (let k = 0; k < maxRun && i + k < words.length; k++) {
        const word = words[i + k];
        if (k > 0 && word.line !== words[i].line) break;
        if (k > 0 && kind !== "date" && !continuesNumber(word)) break;
        joined = k === 0 ? word.text : `${joined}${kind === "date" ? " " : ""}${word.text}`;
        if (matches(kind, joined, target)) {
          found.push(words.slice(i, i + k + 1));
          break;
        }
      }
    }
    return dropOverlaps(found);
  }

  const goal = squash(target);
  if (!goal) return [];
  const maxRun = target.split(/\s+/).length + 4;
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let k = 0; k < maxRun && i + k < words.length; k++) {
      const word = words[i + k];
      // A value may wrap onto the next line (a long name or address).
      if (k > 0 && word.line - words[i + k - 1].line > 1) break;
      joined += squash(word.text);
      if (joined.length > goal.length + 8) break;
      // A short value ("1", "A4") must be a whole word: inside another it means nothing.
      if (joined === goal || (goal.length >= 4 && joined.includes(goal) && minimalRun(words, i, k, goal))) {
        found.push(words.slice(i, i + k + 1));
        break;
      }
    }
  }
  return dropOverlaps(found);
}

/** A run containing the goal is kept only when neither end word could be dropped. */
function minimalRun(words, i, k, goal) {
  if (k === 0) return true;
  const without = (from, to) => words.slice(from, to + 1).map((w) => squash(w.text)).join("");
  return !without(i + 1, i + k).includes(goal) && !without(i, i + k - 1).includes(goal);
}

function dropOverlaps(runs) {
  const used = new Set();
  const out = [];
  for (const run of runs) {
    if (run.some((w) => used.has(w))) continue;
    run.forEach((w) => used.add(w));
    out.push(run);
  }
  return out;
}

/**
 * How far a found value is from the nearest of its field's labels: beside
 * it on the same line (to its left) or just above it. `Infinity` when no
 * label is on the page.
 */
function labelDistance(words, box, field) {
  const labels = LABEL_SQUASHED[field];
  if (!labels) return Infinity;
  let best = Infinity;
  for (let i = 0; i < words.length; i++) {
    for (const label of labels) {
      const run = words.slice(i, i + label.length);
      if (run.length !== label.length) continue;
      if (!run.every((w, k) => squash(w.text).startsWith(label[k]) && squash(w.text).length <= label[k].length + 2)) continue;
      const lb = unionBox(run);
      const sameLine = Math.abs(lb.y + lb.h / 2 - (box.y + box.h / 2)) < Math.max(lb.h, box.h) * 0.7;
      if (sameLine && lb.x + lb.w <= box.x + 0.01) {
        best = Math.min(best, box.x - (lb.x + lb.w));
      } else if (lb.y + lb.h <= box.y + 0.005 && box.y - (lb.y + lb.h) < 0.05 && lb.x < box.x + box.w && lb.x + lb.w > box.x - 0.05) {
        best = Math.min(best, (box.y - (lb.y + lb.h)) * 2 + 0.02);
      }
    }
  }
  return best;
}

/**
 * Where `value` is on the document, best first. `pages` is
 * `[{ pageNumber, words }]`. The best place is beside the field's own
 * label where there is one; failing that, near `near` (a box on a page —
 * a line's description, for that line's amount); failing that, for a
 * total, the last place it appears (totals are at the foot), otherwise
 * the first.
 *
 * @returns `[{ pageNumber, box, words }]`
 */
export function locate(pages, { field, value, kind = "text", near = null }) {
  const found = [];
  let order = 0;
  for (const page of pages ?? []) {
    for (const run of findValue(page.words ?? [], value, kind)) {
      const box = unionBox(run);
      let score = labelDistance(page.words, box, field);
      const byLabel = score < Infinity;
      if (near && near.pageNumber === page.pageNumber) {
        const dy = Math.abs(near.box.y + near.box.h / 2 - (box.y + box.h / 2));
        score = Math.min(score, dy < Math.max(near.box.h, box.h) * 0.7 ? 0.001 : dy * 4);
      }
      found.push({ pageNumber: page.pageNumber, box, words: run, text: run.map((w) => w.text).join(" "), score, order: order++, byLabel });
    }
  }
  const totals = new Set(["BT-106", "BT-109", "BT-110", "BT-112", "BT-115"]);
  found.sort((a, b) => a.score - b.score || (totals.has(field) ? b.order - a.order : a.order - b.order));
  return found.map(({ score, order: _o, ...rest }) => rest);
}

// ---------------------------------------------------------------------
// A lasso's text as the value of a field.
// ---------------------------------------------------------------------

/**
 * What a lasso's text means for a field of `kind`, as the stored form:
 * an amount as a plain number (`"1234.5"`), a date as ISO
 * (`"2026-10-09"`), text as it reads. `parseAmountForScreen` is
 * `money.js`'s `parseAmount`, which reads `1.234` the way the screen's
 * language does — the person lassoing is looking at that screen.
 *
 * A lasso round a label and its value (`Total £1,234.50`) gives the
 * value: for an amount or a number, the **last** number in it; for a
 * date, the first date. `null` when nothing of that kind is there.
 */
export function valueFromLasso(text, kind, parseAmountForScreen) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (kind === "amount" || kind === "number") {
    const tokens = s.match(/[-(]?[£$€¥]?\s?\d[\d.,]*(?:\s\d{3}(?:[.,]\d+)?)*\)?/g) ?? [];
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i].replace(/\s(?=\d{3})/g, "");
      const parsed = parseAmountForScreen ? parseAmountForScreen(token) : String(amountCandidates(token)[0] ?? "");
      if (parsed !== "" && Number.isFinite(Number(parsed))) return String(Number(parsed));
    }
    return null;
  }
  if (kind === "date") {
    const words = s.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      for (let k = 1; k <= 4 && i + k <= words.length; k++) {
        const candidates = dateCandidates(words.slice(i, i + k).join(" "));
        // Day first where the page leaves it open: this is a European product.
        if (candidates.length) return candidates[0];
      }
    }
    return null;
  }
  return s;
}

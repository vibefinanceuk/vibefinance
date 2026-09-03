// Generates the Word edition of Document 4 from its markdown source.
//
// The markdown in docs/documents/ is the source of truth — it diffs, it
// reviews, and every other design artefact in this repository is text.
// The .docx is a rendering for people who read Word documents, and is
// deliberately NOT committed: a binary that cannot be diffed would break
// the traceability the rest of docs/ depends on.
//
// House style follows Documents 1-3: title block, generated contents,
// numbered headings, single-cell callout tables, and an appendix index.

const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  TableOfContents,
  PageBreak,
} = require("docx");

const SRC = path.join(__dirname, "..", "docs", "documents", "04-source-and-intake.md");
const OUT = process.argv[2] || "/mnt/user-data/outputs/04__VibeFinance-Design-Document-Source-and-Intake.docx";

const PAGE_WIDTH_DXA = 9026; // A4 portrait minus 1" margins each side

/** Inline **bold**, *italic* and `code` within a line of markdown. */
function runs(text, base = {}) {
  const out = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) {
      // A code span inside bold is common in this document
      // (**`sources`**), so recurse rather than emitting literal
      // backticks.
      out.push(...runs(tok.slice(2, -2), { ...base, bold: true }));
    } else if (tok.startsWith("`")) {
      out.push(new TextRun({ text: tok.slice(1, -1), font: "Consolas", size: 19, ...base }));
    } else {
      out.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: "", ...base })];
}

function cell(text, { bold = false, widthDxa, shaded = false } = {}) {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: shaded ? { type: ShadingType.CLEAR, fill: "F2F2F2" } : undefined,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    children: [new Paragraph({ children: runs(text, bold ? { bold: true } : {}) })],
  });
}

/** A single-cell callout — the house style's emphasis device. */
function callout(text) {
  return new Table({
    columnWidths: [PAGE_WIDTH_DXA],
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F7F7F5" },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: [new Paragraph({ children: runs(text), spacing: { line: 276 } })],
          }),
        ],
      }),
    ],
  });
}

function dataTable(rows) {
  const cols = rows[0].length;
  const w = Math.floor(PAGE_WIDTH_DXA / cols);
  const widths = new Array(cols).fill(w);
  widths[cols - 1] = PAGE_WIDTH_DXA - w * (cols - 1);
  return new Table({
    columnWidths: widths,
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: i === 0,
          children: r.map((c, j) => cell(c, { bold: i === 0, widthDxa: widths[j], shaded: i === 0 })),
        })
    ),
  });
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim());
}

const md = fs.readFileSync(SRC, "utf8").split("\n");
const children = [];

// ---- Title block, matching Documents 1-3 -------------------------------
children.push(
  new Paragraph({ children: [new TextRun({ text: "VibeFinance", bold: true, size: 40 })], spacing: { after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: "Design Document — Source and Intake", size: 32 })], spacing: { after: 120 } }),
  new Paragraph({
    children: [new TextRun({ text: "Document 4 of a series · From a document to a trusted fact", italics: true, size: 24 })],
    spacing: { after: 240 },
  }),
  new Paragraph({ children: [new TextRun({ text: "3 September 2026", size: 22 })], spacing: { after: 120 } }),
  new Paragraph({
    children: [
      new TextRun({
        text: "Status: living document — reflects the system as built and as designed at time of writing",
        italics: true,
        size: 22,
      }),
    ],
    spacing: { after: 360 },
  }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
  new Paragraph({
    children: [
      new TextRun({
        text: "(Right-click and choose “Update Field,” or press Ctrl+A then F9, to populate this table on first open.)",
        italics: true,
        size: 20,
      }),
    ],
    spacing: { after: 160 },
  }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" }),
  new Paragraph({ children: [new PageBreak()] })
);

let i = 0;
// Skip the markdown title and its subtitle block — reproduced above.
while (i < md.length && !md[i].startsWith("## ")) i++;

while (i < md.length) {
  const line = md[i];

  if (line.trim() === "---" || line.trim() === "") {
    i++;
    continue;
  }

  // Blockquote → callout table (joins wrapped lines into one paragraph).
  if (line.startsWith("> ")) {
    const buf = [];
    while (i < md.length && md[i].startsWith(">")) {
      buf.push(md[i].replace(/^>\s?/, "").trim());
      i++;
    }
    children.push(callout(buf.filter(Boolean).join(" ")));
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    continue;
  }

  // Fenced code block.
  if (line.startsWith("```")) {
    i++;
    const buf = [];
    while (i < md.length && !md[i].startsWith("```")) {
      buf.push(md[i]);
      i++;
    }
    i++;
    for (const b of buf) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: b || " ", font: "Consolas", size: 18 })],
          shading: { type: ShadingType.CLEAR, fill: "F7F7F5" },
          spacing: { before: 0, after: 0 },
        })
      );
    }
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    continue;
  }

  // Table.
  if (line.trim().startsWith("|")) {
    const rows = [];
    while (i < md.length && md[i].trim().startsWith("|")) {
      if (!/^\|[\s|:-]+\|$/.test(md[i].trim())) rows.push(splitRow(md[i]));
      i++;
    }
    children.push(dataTable(rows));
    children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
    continue;
  }

  // Headings.
  const h = line.match(/^(#{2,4})\s+(.*)$/);
  if (h) {
    const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][h[1].length - 2];
    children.push(
      new Paragraph({ heading: level, children: runs(h[2]), spacing: { before: 320, after: 140 } })
    );
    i++;
    continue;
  }

  // Bullet. Markdown wraps long items across lines; continuation lines
  // are indented and must join the item rather than becoming their own
  // unindented paragraph.
  if (/^[-*]\s+/.test(line)) {
    const buf = [line.replace(/^[-*]\s+/, "").trim()];
    i++;
    while (i < md.length && /^\s{2,}\S/.test(md[i]) && !/^\s*[-*]\s+/.test(md[i])) {
      buf.push(md[i].trim());
      i++;
    }
    children.push(
      new Paragraph({ children: runs(buf.join(" ")), bullet: { level: 0 }, spacing: { after: 100 } })
    );
    continue;
  }

  // Numbered item.
  const num = line.match(/^(\d+)\.\s+(.*)$/);
  if (num) {
    const buf = [num[2]];
    i++;
    while (i < md.length && /^\s{3,}\S/.test(md[i])) {
      buf.push(md[i].trim());
      i++;
    }
    children.push(
      new Paragraph({
        children: runs(`${num[1]}.  ${buf.join(" ")}`),
        indent: { left: 360 },
        spacing: { after: 100 },
      })
    );
    continue;
  }

  // Ordinary paragraph — join wrapped lines.
  const buf = [line.trim()];
  i++;
  while (
    i < md.length &&
    md[i].trim() !== "" &&
    !md[i].startsWith("#") &&
    !md[i].startsWith(">") &&
    !md[i].startsWith("|") &&
    !md[i].startsWith("```") &&
    !/^[-*]\s+/.test(md[i]) &&
    !/^\d+\.\s+/.test(md[i]) &&
    md[i].trim() !== "---"
  ) {
    buf.push(md[i].trim());
    i++;
  }
  children.push(new Paragraph({ children: runs(buf.join(" ")), spacing: { after: 160, line: 276 } }));
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
      heading1: { run: { font: "Calibri", size: 32, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 360, after: 160 } } },
      heading2: { run: { font: "Calibri", size: 26, bold: true, color: "2E5496" }, paragraph: { spacing: { before: 300, after: 140 } } },
      heading3: { run: { font: "Calibri", size: 23, bold: true, color: "2E5496" }, paragraph: { spacing: { before: 240, after: 120 } } },
    },
  },
  sections: [{ properties: {}, children }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${OUT} (${buf.length} bytes)`);
});

import { describe, expect, it } from "vitest";

/**
 * One font, one scale — decision 0124.
 *
 * **This is the kind of thing that erodes.** The interface reached
 * seven hardcoded sizes with 11, 12 and 13px all in use, because each
 * new panel picked whichever looked right beside its neighbour and
 * nothing said what the difference meant.
 */

/**
 * The stylesheets as text, through a virtual module.
 *
 * **Vite processes CSS before `?raw` sees it** and hands back an empty
 * string — and a test reading an empty string passes everything, which
 * is worse than no test. The config reads them from disk instead.
 */
import stylesheets, { shippedFonts } from "virtual:stylesheets";

const CSS = { "tokens.css": stylesheets["tokens.css"] };
const ALL = Object.entries(stylesheets);

describe("every size is on the scale", () => {
  it("hardcodes none of them", () => {
    // A size not on the scale is a decision somebody should have to
    // justify — and a `px` value in a stylesheet justifies nothing.
    const offenders: string[] = [];
    for (const [file, source] of ALL) {
      for (const match of source.matchAll(/font-size:\s*(\d+)px/g)) {
        offenders.push(`${file.split("/").pop()}: ${match[0]}`);
      }
    }

    expect(
      offenders,
      `Hardcoded font sizes: ${offenders.join(", ")}. Use --text-sm, ` +
        "--text-base, --text-lg or --text-xl, or add a step and say what it is for."
    ).toEqual([]);
  });

  it("defines exactly the four steps", () => {
    const tokens = Object.values(CSS).join("\n");
    for (const step of ["--text-sm", "--text-base", "--text-lg", "--text-xl"]) {
      expect(tokens, step).toContain(`${step}:`);
    }
  });
});

describe("one font, everywhere", () => {
  it("ships the font rather than hoping for it", () => {
    // Naming Calibri in a stack gives Calibri on Windows and something
    // else everywhere else — which is what the operator saw after
    // deploying, and correctly reported as "no changes".
    const tokens = Object.values(CSS).join("\n");
    expect(tokens).toContain("@font-face");
    expect(tokens).toContain("carlito-latin-400-normal.woff2");
  });

  it("swaps rather than blocking on the font", () => {
    // A person keying an invoice should not wait on a font, and the
    // fallback is metric-compatible so the reflow is slight.
    const faces = Object.values(CSS).join("\n").match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain("font-display: swap");
    }
  });

  it("asks for Calibri, with a metric-compatible fallback", () => {
    // Carlito matches Calibri's metrics, so a machine without Calibri
    // gets the same shapes at the same widths rather than a fallback
    // that reflows every panel.
    const tokens = Object.values(CSS).join("\n");
    expect(tokens).toContain("Calibri");
    expect(tokens).toContain("Carlito");
  });

  it("makes form controls take the page's font entirely", () => {
    // `font: inherit`, not `font-family: inherit`. A browser gives a
    // control its own family, SIZE, weight and line-height, and
    // inheriting only the family leaves three of those at the browser's
    // defaults — which is why the entry cells always looked larger than
    // everything around them.
    const tokens = Object.values(CSS).join("\n");
    const controlRule = tokens.slice(tokens.indexOf("input,\ntextarea,\nbutton,\nselect {"));
    expect(controlRule).toContain("font: inherit");
  });

  it("sets the family in one place", () => {
    // A second font-family declaration is a second opinion about what
    // this interface looks like.
    //
    // **Comments are stripped first.** The first version of this
    // counted the word wherever it appeared and failed on its own
    // explanatory comment — a test that reads prose as code will keep
    // finding things that are not there.
    const withoutComments = Object.values(CSS)
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // **`@font-face` blocks are not opinions about the interface**;
    // they name a file. Only declarations outside them count, which is
    // the distinction the first version of this missed once fonts were
    // shipped (decision 0124).
    const withoutFaces = withoutComments.replace(/@font-face\s*\{[^}]*\}/g, "");

    expect(withoutFaces.match(/font-family:/g)).toHaveLength(1);
  });
});

describe("the brand mark is swapped, not recoloured (decision 0145)", () => {
  const css = stylesheets["index.html"];

  it("hides the dark mark at night and the light one by day", () => {
    // **Swapped in CSS rather than in script**, so it follows the mood
    // without a second thing to remember and needs no repaint.
    expect(css).toContain('[data-mood="night"] .brandmark.dark');
    expect(css).toContain('[data-mood="day"] .brandmark.light');
  });

  it("follows the machine too, where nobody has chosen", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(media).toContain(".brandmark");
  });
});

describe("the stylesheet names files that exist (decision 0124)", () => {
  /**
   * **A stylesheet can reference a font that is not there**, and the
   * only symptom is text in the fallback face — which is what this
   * whole change was meant to stop, and what nobody would notice.
   *
   * Checked against the filesystem rather than by fetching, because
   * `vitest-pool-workers` **does not simulate the asset layer at all**:
   * `/tokens.css` and `/viewer.js` both come back as `text/html`
   * through the Worker's catch-all. A test asserting a font is served
   * would have been asserting something the environment cannot answer.
   */
  it("ships every face it declares", () => {
    const declared = [...Object.values(CSS).join("\n").matchAll(/url\("([^"]+\.woff2)"\)/g)].map(
      (m) => m[1]
    );

    expect(declared.length).toBeGreaterThan(0);
    for (const path of declared) {
      expect(shippedFonts, path).toContain(path.replace("/fonts/", ""));
    }
  });
});

describe("a box somebody writes in (decision 0156)", () => {
  const css = Object.values(CSS).join("\n");

  it("fills the width it is given", () => {
    // **Nothing set one**, so a browser's default of roughly twenty
    // characters applied — reasonable in a narrow form and absurd in a
    // full-width panel. Reported from the rule screen.
    const rule = css.slice(css.indexOf("textarea {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("width: 100%");
  });

  it("stops where prose stops being readable", () => {
    // **A sentence is read on one line**, and a rule box at 1600px
    // would put a clause at each end and nothing in the middle.
    const page = stylesheets["index.html"];
    expect(page).toContain("#sentence { max-width: 62ch; }");
  });
});

describe("class names mean one thing (decision 0177)", () => {
  /**
   * **`.columns` meant two things.** The viewer and the sources screen
   * have used it for a two-column layout since decision 0108; decision
   * 0164's column picker took the same name, came later in the
   * stylesheet, and won — so the viewer's layout was styled as a
   * dropdown and its panels collapsed against each other.
   *
   * Reported as the process flow touching the seller and buyer boxes.
   */
  // The layout rules live in the page, not in the tokens.
  const css = stylesheets["index.html"];

  it("keeps .columns as a grid", async () => {
    const rule = css.slice(css.indexOf(".columns {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("display: grid");
  });

  it("gives the picker its own name", () => {
    expect(css).toContain(".columnpicker");
  });

  it("styles the picker, whichever screen draws it", () => {
    // The rendered check lives in documents.test.ts, which opens the
    // screen; this asserts the stylesheet has something to apply.
    const rule = css.slice(css.indexOf(".columnpicker {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("position: relative");
  });
});

describe("panels in a stack do not touch (decision 0178)", () => {
  /**
   * **`.panel` had no bottom margin at all.** The grid's own `gap`
   * spaced the two columns and nothing spaced panels *within* one — so
   * the process row met the party boxes, and the invoice header met its
   * lines.
   *
   * Reported twice, as two separate screens, because it looks like a
   * different problem each time.
   */
  const css = stylesheets["index.html"];

  it("gives every panel room beneath it", () => {
    const rule = css.slice(css.indexOf(".panel {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("margin: 0 0 14px");
  });

  it("leaves nothing dangling below the last one", () => {
    expect(css).toContain(".panel:last-child { margin-bottom: 0; }");
  });
});

describe("a grid spaces its own children (decision 0179)", () => {
  /**
   * **`.parties` is a grid**, so the Seller and Buyer panels stretch to
   * the same row height. Decision 0178 gave every panel a bottom margin
   * — right for a stack — and its `:last-child` reset applied to the
   * Buyer alone, so the Seller lost 14px inside an equally-tall box and
   * the two borders stopped lining up.
   *
   * Reported as *"why is the border under seller different from the
   * border under buyer?"*, which is the sort of thing only a person
   * looking at it would ask.
   */
  const css = stylesheets["index.html"];

  it("takes the margin off a panel inside the parties grid", () => {
    expect(css).toContain(".parties > .panel { margin-bottom: 0; }");
  });

  it("keeps the gap that spaces them", () => {
    const rule = css.slice(css.indexOf(".parties {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("gap:");
  });

  it("leaves no styles for the card decision 0175 removed", () => {
    // Dead CSS outlives what it styled, and reads as a thing that
    // exists.
    expect(css).not.toContain(".statusbar");
    expect(css).not.toContain(".statitem");
  });
});

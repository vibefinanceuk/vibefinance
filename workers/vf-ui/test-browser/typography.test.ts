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

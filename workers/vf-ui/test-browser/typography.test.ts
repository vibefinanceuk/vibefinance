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
    const controlRule = tokens.slice(
      tokens.indexOf('input:not([type="checkbox"]):not([type="radio"]),\ntextarea,\nbutton,\nselect {')
    );
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
  const css = stylesheets["app.css"];

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
    const page = stylesheets["app.css"];
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
  const css = stylesheets["app.css"];

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
  const css = stylesheets["app.css"];

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
  const css = stylesheets["app.css"];

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

describe("the heading's four lines match (decision 0181)", () => {
  /**
   * **`.topbar .sub` was set twice**, and the later rule won with
   * `--text-base` while the subhead sat at `--text-sm`. Two lines meant
   * to read as one list did not.
   *
   * Reported as *"same font, same weight, same size — they look
   * different"*, which they were.
   */
  const css = stylesheets["app.css"];

  it("styles the subtitle and the subhead together", () => {
    expect(css).toContain(".topbar .sub,\n  .subhead > div {");
  });

  it("declares no font-size for the subtitle on its own", () => {
    // **A second `.topbar .sub { font-size }` rule is how this
    // happened**: it came later and won.
    expect(css).not.toMatch(/\.topbar \.sub \{[^}]*font-size/);
  });
});

describe("the viewer's four lines are one list (decision 0182)", () => {
  /**
   * **Asked for twice and not done twice.**
   *
   * Decision 0180 matched the subtitle and the subhead. Decision 0181
   * found a duplicate rule that had been beating them. Both left the
   * `h2` bold and a size larger, **on my own reasoning that a heading
   * is a heading** — which is not what was asked for.
   *
   * `Stage`, `Unique Ref`, `Waiting` and `Owner` answer the same kind
   * of question. They match.
   */
  const css = stylesheets["app.css"];

  it("styles the viewer's heading with the rest", () => {
    expect(css).toContain("#viewer .topbar h2,");
  });

  it("wins over the general heading rule, by an id", () => {
    // `.topbar h2` comes later in the file and sets a larger, bolder
    // size; an id beats a class regardless of order.
    const scoped = css.indexOf("#viewer .topbar h2");
    const general = css.indexOf(".topbar h2 { margin: 0;");
    expect(scoped).toBeLessThan(general);
    /**
     * **`--text-xl` since decision 0308**, not the `--text-lg` this
     * test originally checked — Tasks, Sources, Suppliers, Rules and
     * Documents all asked for the same larger size Dashboard already
     * had, so the shared rule grew to match rather than five more
     * screens each getting their own copy of it. The claim this test
     * exists to prove — an id wins regardless of the general rule's
     * own value — is unchanged by which value that happens to be.
     */
    expect(css).toContain(".topbar h2 { margin: 0; font-size: var(--text-xl)");
  });

  it("leaves other screens their heading", () => {
    // A heading is a heading on Tasks, Sources, Rules and Documents.
    expect(css).toContain(".topbar h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }");
  });
});

describe("a card's own title, and a rule beneath it (decision 0396)", () => {
  /**
   * The second of the four pieces borrowed from
   * e-invoicingcompliancecorner.com and agreed with the operator: a
   * bold condensed heading in a single accent colour, and a full-width
   * rule beneath every card title.
   */
  const app = stylesheets["app.css"];
  const tokens = stylesheets["tokens.css"];

  it("ships Big Shoulders Display rather than hoping for it", () => {
    expect(tokens).toContain('font-family: "Big Shoulders Display";');
    expect(tokens).toContain("big-shoulders-display-latin-800-normal.woff2");
  });

  it("reserves the second face for headings, not the whole app", () => {
    // `--font-sans` is still what decides the body's own face; this is
    // additive, not a second opinion about it — the "one font,
    // everywhere" tests above are what protect that.
    expect(tokens).toContain('--font-heading: "Big Shoulders Display", var(--font-sans);');
  });

  it("gives every panel title the same treatment", () => {
    const rule = app.slice(app.indexOf(".panel > h3,\n  .panel > .cardhead > h3,"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("font-family: var(--font-heading);");
    expect(body).toContain("color: var(--heading-accent);");
    expect(body).toContain("text-transform: uppercase;");
  });

  it("draws the rule in the same colour in both moods, via --border-strong", () => {
    const rule = app.slice(app.indexOf(".panel > h3,\n  .panel > .cardhead,"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("border-bottom: 1px solid var(--border-strong);");
  });

  it("stays off every modal dialog's own title", () => {
    // `.cardhead` on its own is shared with every "Save"/"Close"
    // pop-out (access.js, sources.js, suppliers.js, processes.js,
    // purchase-orders.js); only `.panel > .cardhead` gets the
    // treatment. The bare rule — `.cardhead { display: flex; ... }`,
    // the layout every one of those pop-out heads relies on too —
    // must not itself carry the accent or the second face.
    const rule = app.slice(app.indexOf(".cardhead {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("display: flex");
    expect(body).not.toContain("--heading-accent");
    expect(body).not.toContain("--font-heading");
  });
});

describe("the title sits on the line, whatever the action beside it (decision 0397)", () => {
  /**
   * Reported live once decision 0396 shipped: a card whose action is
   * `actionLink()`'s icon-above-label shape (decision 0122) — Purchase
   * Orders' own CSV Template/Load CSV, wrapped in `.statebuttons` and
   * so outside `.cardhead > .actionlink`'s existing `-6px` pull — made
   * the whole heading row as tall as the action, with the title
   * pinned to the top by `.cardhead`'s own `align-items: flex-start`
   * and a bare gap opening beneath it, above 0396's new rule.
   */
  const app = stylesheets["app.css"];

  it("bottom-aligns a card's own heading row", () => {
    const rule = app.slice(app.indexOf(".panel > .cardhead {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("align-items: flex-end;");
  });

  it("compacts a card's own corner action, not .actionlink everywhere", () => {
    const rule = app.slice(app.indexOf(".panel > .cardhead > .actionlink,"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("padding: 4px 6px;");
    // The base `.actionlink` rule — the control row, the pagination
    // arrows' own row — must keep its own, larger padding. Matched by
    // the full declaration, not a bare `.actionlink {` substring,
    // which `.cardhead > .actionlink {` (earlier in the file) also
    // contains.
    const base = app.slice(app.indexOf("\n  .actionlink {"));
    expect(base.slice(0, base.indexOf("}"))).toContain("padding: 9px 6px;");
  });
});

describe("the dashboard's own tiles get the same line (decision 0397)", () => {
  /**
   * Shown live against the rest of the dashboard, alongside two other
   * ways to resolve the inconsistency: chosen directly, over keeping
   * every tile quiet or reverting "On my clock" to match them.
   */
  const app = stylesheets["app.css"];

  it("reaches through .tilefg to the tile's own title", () => {
    const rule = app.slice(app.indexOf(".panel > h3,\n  .panel > .cardhead > h3,"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain(".panel > .tilefg > .cardhead > h3");
  });

  it("draws the same rule beneath a tile's own title", () => {
    const rule = app.slice(app.indexOf(".panel > h3,\n  .panel > .cardhead,"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain(".panel > .tilefg > .cardhead");
    expect(body).toContain("border-bottom: 1px solid var(--border-strong);");
  });

  it("leaves no styling behind for the quiet title decision 0396 gave these on the way in", () => {
    // Dead CSS outlives what it styled, and reads as a thing that
    // exists — decision 0179's own reasoning. This selector never
    // actually matched anything (`.tilefg` sits between `.card-narrow`
    // and `.cardhead`), so nothing renders differently for it being
    // gone; it is removed because it now also contradicts this file's
    // own tests, once dead code disagreeing with a real rule would
    // otherwise sit beside it unremarked.
    expect(app).not.toContain(".card-narrow > .cardhead > h3");
  });
});

describe("the document tabs, restyled as a segmented pill (decision 0398)", () => {
  /**
   * The third of the four pieces from e-invoicingcompliancecorner.com,
   * agreed with the operator: the Document/XML/Timeline & Chat tab
   * row, in the shape of the reference site's own "Arrivals board /
   * List view" toggle. Styling only — `.doctabs`, `.doctab`,
   * `.doctab.on` and `.activitycount` are the same class names
   * `buildDocTabs()` (`viewer.js`) already builds; no JS file changes.
   */
  const app = stylesheets["app.css"];
  const tokens = stylesheets["tokens.css"];

  it("gives the row itself the pill: a filled, fully rounded background", () => {
    const rule = app.slice(app.indexOf(".doctabs {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background: var(--surface-1);");
    expect(body).toContain("border-radius: 999px;");
  });

  it("lifts the active tab off the pill", () => {
    const rule = app.slice(app.indexOf(".doctab.on {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background: var(--surface-2);");
    expect(body).toContain("box-shadow: var(--tab-active-shadow);");
    expect(body).toContain("color: var(--text-primary);");
  });

  it("ships the shadow token the active tab uses, Day and Night both", () => {
    expect(tokens).toContain("--tab-active-shadow: 0 1px 2px rgba(18, 26, 38, 0.12);");
    expect(tokens).toContain("--tab-active-shadow: none;");
  });

  it("gives the timeline's own count badge the accent colour, not a neutral grey", () => {
    const rule = app.slice(app.indexOf(".activitycount {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background: var(--bg-accent);");
    expect(body).toContain("color: var(--text-accent);");
  });

  it("leaves .tabbar underline-only, decision 0333 — a different row for a different job", () => {
    // The Access screen's own Organizations/Roles/Teams/People
    // switcher is sections of one page, not views of one thing; the
    // two keep different shapes on purpose, so a pill background or
    // card wrapper here would be the wrong kind of drift for either.
    const rule = app.slice(app.indexOf(".tabbar {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toContain("border-radius");
    expect(body).not.toContain("background");
  });
});

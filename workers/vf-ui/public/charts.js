/**
 * Charts, drawn by hand — decision 0242.
 *
 * **No library.** This app is vanilla modules with no build step, and a
 * charting dependency would be the first — for four shapes that are
 * forty lines each.
 *
 * **Every colour comes from a token**, which decision 0223 learned the
 * hard way: a variable nothing defines is not an error, it is
 * transparent, and a chart drawn in an invented hex would look fine
 * until somebody changed the theme.
 */

const NS = "http://www.w3.org/2000/svg";

/**
 * **A chart fills the card it is in** — decision 0245.
 *
 * The first version set a fixed pixel height with the aspect ratio
 * preserved, so a 300-wide drawing in an 840px card rendered **300px
 * wide and centred**, floating in white space.
 *
 * `height: auto` lets the viewBox decide the shape and the container
 * decide the size — a wide card gets a wide chart, a narrow one gets a
 * short chart, and the text stays upright either way.
 */
function svg(width, height, extra = {}) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", `0 0 ${width} ${height}`);
  node.setAttribute("preserveAspectRatio", extra.stretch ? "none" : "xMidYMid meet");
  /**
   * **Fixed means fixed in both directions** — decision 0248.
   *
   * The first version kept `width: 100%` even for a ring, so the donut
   * took the whole flex row and **the legend was squeezed to zero**:
   * five coloured dots in a column and not one word beside them.
   *
   * A chart that fills its card is right for bars, whose meaning is
   * their width. A ring has no width to mean anything with.
   *
   * **A third mode, `fill`** — decision 0257, for a background
   * sparkline. Neither existing mode fit it: `fixed` is a literal pixel
   * box (right for a ring, wrong for a tile of unknown width), and the
   * default `auto` height scales with the viewBox's own aspect ratio
   * (right for a bar chart, wrong here because it would make a wide
   * tile's line disproportionately tall). `fill` takes both dimensions
   * from a sized, positioned ancestor instead — the tile itself.
   */
  if (extra.fixed) {
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
  } else if (extra.fill) {
    node.style.width = "100%";
    node.style.height = "100%";
  } else {
    node.style.width = "100%";
    node.style.height = "auto";
  }
  node.style.display = "block";
  return node;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = String(text);
  return node;
}

/**
 * A line with a filled area beneath it.
 *
 * **No axes and no labels.** A sparkline answers *"which way is this
 * going"* and nothing else; a reader who needs the number has it
 * beside, in type they can read.
 *
 * **First built and never used** — decision 0242 held it back for the
 * honest reason that no card had real history behind it. Decision 0257
 * gives it its first real caller: a week of completions, which
 * `completed_at` genuinely records day by day.
 *
 * **`background: true` fills its container** rather than sitting at a
 * fixed 150×38 — a card can be resized (decision 0257 just made these
 * ones bigger) and a sparkline meant to sit low in the card behind the
 * figure has to fill whatever width and height it is given, not a size
 * chosen when this function was written.
 */
export function sparkline(values, { colour = "var(--chart-1)", height = 38, background = false } = {}) {
  const width = 150;
  const node = svg(width, height, background ? { stretch: true, fill: true } : { stretch: true, fixed: true });

  if (values.length < 2) return node;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A flat line should sit in the middle rather than at the top or
  // divide by zero.
  const span = hi - lo || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => [i * step, height - 4 - ((v - lo) / span) * (height - 10)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  node.append(
    el("polygon", {
      points: `0,${height} ${line} ${width},${height}`,
      fill: colour,
      // **Quieter behind text than beside it.** A background line has
      // to lose to the number sitting on top of it, not compete with it.
      opacity: background ? 0.16 : 0.12,
    }),
    el("polyline", {
      points: line,
      fill: "none",
      stroke: colour,
      "stroke-width": 1.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      opacity: background ? 0.55 : 1,
    })
  );

  return node;
}

/**
 * Vertical bars with their value above and their label below.
 *
 * @param rows `[{ label, value, warn }]` — `warn` colours one bar as
 * something to look at, which is why the palette and the warning colour
 * are separate (decision 0242).
 */
export function barChart(rows, { height = 112 } = {}) {
  /**
   * **Wider than it is tall, and more so than at first** — decision
   * 0246.
   *
   * A chart that fills its card takes the card's proportions, so the
   * viewBox decides how much vertical room the card asks for. At 3:1 a
   * half-width card was three hundred pixels tall for five bars and
   * four labels, most of it air.
   *
   * At 5:1 the same card is a band rather than a box, which is what a
   * count-by-category chart is: the bars carry the meaning and the
   * height above them carries none.
   */
  const width = 560;
  const node = svg(width, height);
  if (rows.length === 0) return node;

  const hi = Math.max(...rows.map((r) => r.value), 1);
  const slot = width / rows.length;

  /**
   * **A bar that is alone should not be a wall** — decision 0244.
   *
   * With one row, `slot` is the whole width and a 55% bar is 165px of
   * flat colour. The eye reads size as quantity, and one bar has
   * nothing to be larger than.
   */
  const barWidth = Math.min(slot * 0.55, 54);

  /**
   * **A hairline grid**, so a bar is read against something.
   *
   * Four lines at quarters of the tallest value. Without them the
   * heights are relative to each other and to nothing else, which is
   * fine for two bars and guesswork for six.
   */
  const plot = height - 34;
  for (let i = 1; i <= 4; i++) {
    const y = height - 22 - (plot * i) / 4;
    node.append(
      el("line", {
        x1: 0,
        x2: width,
        y1: y.toFixed(1),
        y2: y.toFixed(1),
        stroke: "var(--border)",
        "stroke-width": 0.5,
        opacity: 0.55,
      })
    );
  }

  rows.forEach((row, i) => {
    const barHeight = (row.value / hi) * (height - 34);
    const x = i * slot + (slot - barWidth) / 2;
    const y = height - 22 - barHeight;

    /**
     * **A bar fading downward**, which is where the reference's depth
     * comes from — and is four lines of SVG rather than a library.
     *
     * Each needs its own gradient because the id must be unique in the
     * document, and two charts on one screen would otherwise share one.
     */
    const gradientId = `bar-${Math.random().toString(36).slice(2, 9)}`;
    const colour = row.warn ? "var(--text-warning)" : "var(--chart-1)";
    const gradient = el("linearGradient", { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(
      el("stop", { offset: "0%", "stop-color": colour, "stop-opacity": 0.95 }),
      el("stop", { offset: "100%", "stop-color": colour, "stop-opacity": 0.45 })
    );
    const defs = el("defs");
    defs.append(gradient);

    node.append(
      defs,
      el("rect", {
        x: x.toFixed(1),
        y: y.toFixed(1),
        width: barWidth.toFixed(1),
        // **A zero is a hairline, not a bar.** One pixel of colour
        // reads as "a little"; nothing reads as nothing, and the
        // number above says which.
        height: Math.max(barHeight, row.value === 0 ? 0.5 : 2).toFixed(1),
        rx: 3,
        fill: row.value === 0 ? "var(--border)" : `url(#${gradientId})`,
      }),
      el(
        "text",
        {
          x: (x + barWidth / 2).toFixed(1),
          y: (y - 4).toFixed(1),
          "text-anchor": "middle",
          "font-size": 10,
          fill: "var(--text-secondary)",
        },
        row.value
      ),
      el(
        "text",
        {
          x: (x + barWidth / 2).toFixed(1),
          y: height - 8,
          "text-anchor": "middle",
          "font-size": 9,
          fill: "var(--text-muted)",
        },
        row.label
      )
    );
  });

  return node;
}

/**
 * A ring with a figure in the middle.
 *
 * **One proportion, not a pie.** A pie of five slices is a table drawn
 * badly; this says *"64% of them"* and leaves the rest to a number.
 */
export function donut(percent, { label = "", colour = "var(--chart-2)" } = {}) {
  // A ring is square, so it keeps its pixels rather than filling.
  const node = svg(140, 140, { fixed: true });
  const r = 52;
  const c = 70;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));

  node.append(
    el("circle", { cx: c, cy: c, r, fill: "none", stroke: "var(--border)", "stroke-width": 14 }),
    el("circle", {
      cx: c,
      cy: c,
      r,
      fill: "none",
      stroke: colour,
      "stroke-width": 14,
      "stroke-dasharray": `${((circumference * clamped) / 100).toFixed(1)} ${circumference.toFixed(1)}`,
      "stroke-linecap": "round",
      transform: `rotate(-90 ${c} ${c})`,
    }),
    el(
      "text",
      { x: c, y: c - 2, "text-anchor": "middle", "font-size": 26, fill: "var(--text-primary)" },
      `${Math.round(clamped)}%`
    ),
    el(
      "text",
      { x: c, y: c + 16, "text-anchor": "middle", "font-size": 10, fill: "var(--text-muted)" },
      label
    )
  );

  return node;
}

/**
 * Labelled rows with a proportional bar beneath each.
 *
 * **HTML rather than SVG**, because the labels are supplier names —
 * arbitrary length, and text that has to wrap and be selectable. An SVG
 * label is a picture of a word.
 */
export function barList(rows, { colour = "var(--chart-1)" } = {}) {
  /**
   * **One row is not a proportion** — decision 0245.
   *
   * A single bar is always full width, which reads as *"100%"* and
   * means nothing. The caller shows a figure instead; this guards the
   * case anyway, because a list that shrinks to one is a list that will.
   */
  const hi = Math.max(...rows.map((r) => r.value), 1);
  const wrap = document.createElement("div");

  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "barlist-row";

    const head = document.createElement("div");
    head.className = "barlist-head";

    const name = document.createElement("span");
    name.textContent = row.label;

    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = row.note ? `${row.value} · ${row.note}` : String(row.value);

    head.append(name, note);

    const track = document.createElement("div");
    track.className = "barlist-track";

    const fill = document.createElement("div");
    fill.className = "barlist-fill";
    fill.style.width = `${(row.value / hi) * 100}%`;
    fill.style.background = row.warn ? "var(--text-warning)" : colour;

    track.append(fill);
    line.append(head, track);
    wrap.append(line);
  }

  return wrap;
}

/**
 * Parts of a whole, with a legend — decision 0247.
 *
 * **A donut is for a share, and bars are for a comparison.** Every
 * in-flight invoice is at exactly one stage, so *"where things are"* is
 * genuinely a whole being divided — and the reader's question is *"how
 * much of my work is stuck in Approval"*, which is a proportion.
 *
 * **Ageing stays bars**, because its buckets have an order and a ring
 * destroys it: *under a day* and *over thirty days* are not two slices
 * of a pie, they are two ends of a line.
 */
export function donutChart(segments, { size = 150, legend = true } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "donutwrap";

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return wrap;

  const node = svg(size, size, { fixed: true });
  const r = size * 0.37;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const thickness = size * 0.12;

  /**
   * **Six or more becomes five and a rest.** A ring of nine slices is a
   * colour-matching exercise, and the palette has five (decision 0242).
   */
  const shown =
    segments.length > 5
      ? [
          ...segments.slice(0, 4),
          {
            label: "…",
            value: segments.slice(4).reduce((sum, s) => sum + s.value, 0),
            rest: true,
          },
        ]
      : segments;

  let offset = 0;
  shown.forEach((segment, i) => {
    const length = (segment.value / total) * circumference;
    const colour = segment.rest ? "var(--text-muted)" : `var(--chart-${(i % 5) + 1})`;

    node.append(
      el("circle", {
        cx: c,
        cy: c,
        r,
        fill: "none",
        stroke: colour,
        "stroke-width": thickness,
        "stroke-dasharray": `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`,
        "stroke-dashoffset": (-offset).toFixed(2),
        transform: `rotate(-90 ${c} ${c})`,
      })
    );
    offset += length;
    segment.colour = colour;
  });

  /**
   * **The total in the middle**, because a ring says the shape and a
   * reader still wants the number — and a donut without one makes
   * somebody add up the legend.
   */
  node.append(
    el(
      "text",
      { x: c, y: c - 1, "text-anchor": "middle", "font-size": 24, fill: "var(--text-primary)" },
      total
    ),
    el(
      "text",
      { x: c, y: c + 15, "text-anchor": "middle", "font-size": 9, fill: "var(--text-muted)" },
      shown.length === 1 ? shown[0].label : "in all"
    )
  );

  /**
   * **A ring without a legend, where the colours are the whole point**
   * — decision 0250's stage card, which has three segments and a
   * heading that names none of them.
   *
   * The card's own text carries the meaning there; a legend would
   * repeat it in a tile that has no room.
   */
  if (!legend) {
    wrap.append(node);
    return wrap;
  }

  const keys = document.createElement("div");
  keys.className = "donutlegend";

  for (const segment of shown) {
    const row = document.createElement("div");
    row.className = "donutkey";

    const dot = document.createElement("span");
    dot.className = "donutdot";
    dot.style.background = segment.colour;

    const name = document.createElement("span");
    name.textContent = segment.label;

    const value = document.createElement("span");
    value.className = "muted";
    value.textContent = String(segment.value);

    row.append(dot, name, value);
    keys.append(row);
  }

  wrap.append(node, keys);
  return wrap;
}

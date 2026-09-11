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

function svg(width, height, extra = {}) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", `0 0 ${width} ${height}`);
  node.setAttribute("preserveAspectRatio", extra.stretch ? "none" : "xMidYMid meet");
  node.style.width = "100%";
  node.style.height = `${height}px`;
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
 */
export function sparkline(values, { colour = "var(--chart-1)", height = 38 } = {}) {
  const width = 150;
  const node = svg(width, height, { stretch: true });

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
    el("polygon", { points: `0,${height} ${line} ${width},${height}`, fill: colour, opacity: 0.12 }),
    el("polyline", {
      points: line,
      fill: "none",
      stroke: colour,
      "stroke-width": 1.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
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
export function barChart(rows, { height = 150 } = {}) {
  const width = 300;
  const node = svg(width, height);
  if (rows.length === 0) return node;

  const hi = Math.max(...rows.map((r) => r.value), 1);
  const slot = width / rows.length;
  const barWidth = slot * 0.55;

  rows.forEach((row, i) => {
    const barHeight = (row.value / hi) * (height - 34);
    const x = i * slot + (slot - barWidth) / 2;
    const y = height - 22 - barHeight;

    node.append(
      el("rect", {
        x: x.toFixed(1),
        y: y.toFixed(1),
        width: barWidth.toFixed(1),
        height: Math.max(barHeight, 1).toFixed(1),
        rx: 2,
        fill: row.warn ? "var(--text-warning)" : "var(--chart-1)",
        opacity: 0.8,
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
  const node = svg(140, 140);
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

/**
 * The icon set — decisions 0122, 0149.
 *
 * **Moved out of `viewer.js`.** Decision 0122 put them beside the
 * action row because that was the only place using them; a second
 * screen needs them, and copying eight paths is copying eight paths
 * that can differ.
 *
 * `stroke="currentColor"` so they follow the customer's livery
 * (decision 0096) and the light or dark surface (0139) without a second
 * set. **This is why they are drawn rather than fetched**: a mark that
 * cannot take a colour cannot be white-labelled.
 */

/**
 * The action icons — decision 0122.
 *
 * Drawn inline rather than pulled from a library: this interface has no
 * build step, and a dependency for eight shapes would be a dependency
 * to keep current for eight shapes.
 *
 * `stroke="currentColor"` so they follow the customer's livery and the
 * light/dark surface without a second set (decisions 0096, 0108).
 *
 * **Each icon has to be true.** `discard` archives and deletes nothing
 * (decision 0078), so a waste bin would say something the system does
 * not do — the archive box is the honest shape. `release` is an open
 * padlock because claiming a task *is* a lock and locks never expire
 * (decision 0104), so letting go is unlocking.
 */
export const ICONS = {
  /**
   * **Three graphics for the dashboard's split-out alert cards** —
   * decision 0259. Drawn purely as decoration on a tile, not as an
   * `actionLink` glyph, so they are not part of the `action.*` naming
   * convention decision 0229/0236 test against — nothing here is
   * clicked directly; the whole tile is.
   */

  // A pin with no place to land — a document assigned to no unit.
  unplaced:
    '<path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.3"/><path d="M4 4l16 16"/>',

  // A tag with nothing written on it — a supplier with no ERP number.
  awaitingerp:
    '<path d="M3 12 12 3h6a3 3 0 0 1 3 3v6l-9 9-9-9z"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/>',

  // Two sheets, offset — a document that may be the same as another.
  duplicate:
    '<rect x="4" y="7" width="12" height="15" rx="2"/><rect x="8" y="3" width="12" height="15" rx="2"/>',

  // Arrows to the four corners — "make this bigger", not "leave here".
  expand:
    '<path d="M4 8V4h4M16 4h4v4M20 12v4h-4M8 20H4v-4"/>',
  /**
   * **Two arrows circling** — decision 0228, for *change buyer* and
   * *change seller*.
   *
   * Not a pencil: a pencil says *edit this value*, and neither of these
   * does. They **replace one record with another** — the invoice stops
   * pointing at Acme UK and starts pointing at Acme Deutschland, and
   * nothing about either record changes.
   *
   * Deliberately the same glyph for both. They are the same act on
   * either side of the document, and two icons would say they were not.
   */
  /**
   * **Keyed by action name, not by what the picture is** — decision
   * 0229.
   *
   * `actionLink` looks a glyph up by the action it labels, so an entry
   * called `swap` was found by nothing and the button rendered with an
   * empty `<svg>`: the label appeared, the icon did not, and nothing
   * failed.
   *
   * Two keys and one path, because they are the same act on either side
   * of the document (decision 0228).
   */
  /**
   * **Hold and release, as pause and play** — decision 0234.
   *
   * A hold is **temporary and reversible**: payment stops while
   * something is disputed, and resumes. A stop square would say
   * *finished* and a raised hand would say *refused*; neither is what a
   * held supplier is.
   *
   * The same two bars as `paused`, under their own key — `actionLink`
   * looks a glyph up by the **action name**, which decision 0229 found
   * the hard way.
   */
  hold: '<path d="M9.5 7v10M14.5 7v10"/>',

  /**
   * **A cross, because close is not cancel** — decision 0236.
   *
   * Every pop-out has one and none had an icon. An arrow out would say
   * *go back somewhere*, and these open over a screen that is still
   * there — **nothing is undone by closing**, which is exactly what a
   * cross means and what *cancel* would not.
   */
  close: '<path d="M6 6l12 12M18 6 6 18"/>',

  /**
   * **A person with a plus** — decision 0237, for recording a supplier
   * the ERP does not have.
   *
   * Not a bare plus, which would say *add a row*. This adds a
   * **party** — and the figure is what distinguishes it from the load
   * beside it, which adds many at once and is about the file rather
   * than about anybody.
   */
  newsupplier:
    '<path d="M13 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="7.5" cy="6.5" r="3.5"/><path d="M18 8v6M15 11h6"/>',

  /**
   * **A file going up**, because a load is about the file.
   *
   * The inverse of `save`, whose arrow goes down into a tray — and
   * deliberately so: one takes something out of the screen and the
   * other puts something in.
   */
  load: '<path d="M12 20V10m0 0-4 4m4-4 4 4M4 7V4h16v3"/>',
  releasehold: '<path d="M8 6.5 18 12 8 17.5z"/>',

  /**
   * **Deactivate is `activate` mirrored** — the same switch with the
   * knob on the other side.
   *
   * A pair a person reads without learning anything: one is the other,
   * reversed. A slashed circle or an archive box would have been a
   * second idea to hold.
   */
  deactivate: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2.6"/>',

  changeseller:
    '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3 3m-3-3 3-3"/>',
  changebuyer:
    '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3 3m-3-3 3-3"/>',
  // A down arrow into a tray, as the reference has it.
  save:
    '<path d="M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
  // A checkmark. Nothing else reads as "done" as immediately.
  complete:
    '<path d="M4 12.5 9.5 18 20 6"/>',
  // An open padlock: a claim is a lock, so releasing is unlocking.
  release:
    '<path d="M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0"/>',
  // An arrow curving back — to an earlier stage.
  return:
    '<path d="M9 5 4 10l5 5M4 10h11a5 5 0 0 1 0 10h-6"/>',
  // Leaving the building entirely: an arrow out of a box.
  return_to_supplier:
    '<path d="M14 4h6v16h-6M10 8l4 4-4 4M14 12H3"/>',
  // An archive box, NOT a waste bin: discarding archives and deletes
  // nothing.
  discard:
    '<path d="M3 6h18v4H3zM5 10v10h14V10M10 14h4"/>',
  // A closed padlock, the mirror of release.
  claim:
    '<path d="M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4"/>',
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}


/**
 * Rule authoring — decision 0149.
 *
 * **Each has to be true**, which is decision 0122's discipline: it
 * refused a waste bin for `discard` because discarding archives.
 */
Object.assign(ICONS, {
  // Lines becoming a bracket: a sentence given structure, which is what
  // the compiler does. **Not a wand** — nothing here is magic, and the
  // vocabulary is closed precisely so it is not.
  compile: '<path d="M3 6h9M3 11h6M3 16h9"/><path d="M17 5v14M15 5h4M15 19h4"/>',

  // A switch thrown, not a play button: a rule is not something that
  // runs once.
  activate: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.6"/>',

  // A magnifier over a stack — looking at what is already there, which
  // is why testing a rule against captured invoices costs so little
  // (decision 0003's pure interpreter).
  backtest:
    '<path d="M4 5h9M4 9h9M4 13h5"/><circle cx="15.5" cy="15.5" r="4"/><path d="M18.5 18.5 21 21"/>',

  // Two bars. The convention nobody has to learn.
  paused: '<path d="M9.5 7v10M14.5 7v10"/>',
});

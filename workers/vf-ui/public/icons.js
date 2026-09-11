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
  swap:
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

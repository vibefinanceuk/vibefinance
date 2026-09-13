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

  /**
   * **Four graphics for the dashboard's own toolbar** — decision 0262,
   * so it reads as a row of controls the way the document viewer's
   * does rather than a row of plain text buttons. Also decorative
   * rather than `actionLink` glyphs in the domain sense — these sit
   * outside the `action.*` convention decisions 0229/0236 test, the
   * same as the alert-card icons above.
   */

  // Two sliders — the shape a settings/adjustment control usually
  // takes, which "arrange" genuinely is: choosing what shows and where.
  arrange: '<path d="M4 7h10M18 7h2M4 17h2M8 17h12"/><circle cx="16" cy="7" r="2"/><circle cx="6" cy="17" r="2"/>',

  // A plain checkmark — leaving arrange mode is confirming a choice,
  // not undoing one, so this is not the same glyph as `close`.
  donearranging: '<path d="M5 13l4 4L19 7"/>',

  // A plus, standing alone rather than attached to a person or a file
  // the way `newsupplier`'s is — this adds a card, not a record.
  addcard: '<path d="M12 5v14M5 12h14"/>',

  // An arrow curling back on itself — undoing every choice made since
  // the default, not undoing one step at a time.
  restoredefault: '<path d="M4 4v6h6"/><path d="M20 12a8 8 0 1 1-2.5-5.8L20 10"/>',

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

  // A triangle with an exclamation mark — decision 0272. Not coloured
  // orange itself (that lives in CSS, not the shape); the shape says
  // "worth noticing" honestly regardless of which colour a card around
  // it ends up using.
  systemalert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',

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

  // A paper plane, for posting a comment on the activity panel —
  // decision 0268. The same shape almost every messaging surface
  // already uses for "send", chosen over inventing a new one for the
  // sake of it: a person should recognise this without reading the
  // label beside it.
  post: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',

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

/**
 * The navigation's own icons — decision 0274, for the operator's own
 * request: "create icons for each of the side menu items that
 * exist... Tasks, Dashboard, Sources, Suppliers, Rule and Documents."
 *
 * **Each icon says what the screen is, not what it does.** `compile`
 * is an action drawn for a button; a nav icon has to be recognised at
 * a glance, in passing, on the way to something else — so these are
 * plainer shapes than the action set, chosen for what a person
 * already associates with the word beside them.
 */
Object.assign(ICONS, {
  // A checklist — two rows, a box and a line each. The thing a task
  // list actually is.
  tasks: '<rect x="4" y="5" width="4" height="4" rx="1"/><path d="M11 7h9"/><rect x="4" y="15" width="4" height="4" rx="1"/><path d="M11 17h9"/>',

  // Four tiles of different sizes — the dashboard's own cards are
  // never uniform (decision 0244's tile/half weighting), so a grid of
  // identical squares would say something the screen does not.
  dashboard:
    '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',

  // An inbox tray — where a document arrives from, not what it says
  // once it has.
  sources: '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M4 12 5.5 5h13L20 12"/><path d="M3 12v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/>',

  // A building, not a person — a supplier here is an organisation
  // this app matches invoices to, never an individual it has a name
  // and a face for.
  suppliers:
    '<path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16"/><path d="M14 21v-9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9"/><path d="M4 21h16"/><path d="M7 7h2M7 11h2M7 15h2M11 7h1M11 11h1M11 15h1"/>',

  // A branch, not the lines-and-brackets `compile` already draws for
  // the act of writing one. This is what a rule *is* once it exists:
  // one condition, two ways an invoice can go from it.
  rules:
    '<circle cx="6" cy="5" r="2"/><path d="M6 7v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v3"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10"/><circle cx="6" cy="19" r="2"/>',

  // A page with a folded corner — the plainest possible "a document,"
  // deliberately generic since this screen holds every kind at once.
  documents: '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><path d="M8 12h8M8 16h5"/>',

  // A panel with a chevron — decision 0274's collapse toggle. One
  // icon rather than two: the chevron is flipped with a CSS transform
  // for "expand," since the shape is the same claim pointed the other
  // way, not a different one.
  navcollapse: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M14 9l-2 3 2 3"/>',
});

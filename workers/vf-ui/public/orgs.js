import { t } from "/strings.js";
import { icon } from "/icons.js";

/**
 * Which org a person is currently focused on — decision 0313, the
 * second piece of the operator's own request: "the ability for a
 * user to switch between Orgs... let me pick one org to focus on,
 * seeing only that org's work until I switch."
 *
 * **Remembered the same way `mood.js`'s own choice is** —
 * `localStorage`, read once at render time and written the moment
 * somebody picks. `null` means "All organisations," the same
 * unfiltered default every screen already shows today.
 *
 * **A real filter since decisions 0314 onward** — Dashboard, Tasks,
 * Documents, and Suppliers each narrow by `currentOrgId()` on their
 * own fetch. This module still only stores the choice and offers a
 * way to read it; which screens act on that choice is each screen's
 * own decision, not this one's.
 *
 * **No import from `tasks.js`.** `tasks.js` already imports
 * `orgPicker` from this file; importing `el` back the other way would
 * be a circular import, the same reasoning `mood.js`'s own
 * `moodPicker` already gives for building its DOM with
 * `document.createElement` directly rather than `tasks.js`'s own
 * helper. `orgPicker` takes what it needs to act on a choice
 * (`onChosen`, decision 0362) as a plain callback for the same
 * reason: this file describes the control, never the app around it.
 */
const CURRENT_ORG_KEY = "vf-current-org";

/** A small, local stand-in for `tasks.js`'s own `el()` — see above for why. */
function node(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") n.textContent = value;
    else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
    else n.setAttribute(key, value);
  }
  for (const child of children) n.append(child);
  return n;
}

export function currentOrgId() {
  try {
    return localStorage.getItem(CURRENT_ORG_KEY);
  } catch {
    return null;
  }
}

function setCurrentOrgId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_ORG_KEY, id);
    else localStorage.removeItem(CURRENT_ORG_KEY);
  } catch {
    // The choice still holds for this load; it just will not survive
    // a reload. A screen that cannot remember a preference is a
    // smaller failure than one that cannot be used at all.
  }
}

/**
 * **One backdrop, reopened rather than rebuilt** — the same guard
 * decision 0291's own Header Fields pop-out uses, so reopening after
 * a close does not leave a second, duplicate set of ids behind.
 */
let backdrop = null;

/**
 * The control itself, for a screen's top bar.
 *
 * **No picker at all with nothing to pick between** — decision 0161's
 * own argument, applied here: one org, or none, offers no real
 * choice, and a control with nothing to do should not be there.
 *
 * **A pop-out, not a toggle.** `moodPicker`'s own two-state flip
 * (decision 0286) fits two options; an org list can genuinely be
 * long, and the same `.backdrop`/`.popout`/`.searchresult` shape the
 * viewer's own supplier search already uses fits a list of any length
 * without inventing a second pattern for it.
 *
 * **`onChosen`, decision 0362** — called after the choice is stored,
 * so whoever built this button decides what "acting on it" means.
 * `tasks.js` passes `relaunchAfterOrgChange`; nothing in this file
 * needs to know that name, or that it exists, to remain correct.
 */
export function orgPicker(units, holdsEverywhere, onChosen) {
  if (units.length < 2) return null;

  const label = node("span");
  const button = node("button", { class: "actionlink" }, [icon("building"), label]);

  function render() {
    const chosen = currentOrgId();
    const org = units.find((u) => u.id === chosen);
    /**
     * **Falls back to the first real unit, not "All organisations,"
     * when nothing is held everywhere.** That label is only ever
     * true, and only ever offered as a choice, when `holdsEverywhere`
     * is true — showing it regardless would name a focus this person
     * cannot actually pick from the very list this same button opens.
     */
    const fallback = holdsEverywhere ? t("org.all") : units[0].name;
    const text = org ? org.name : fallback;
    button.title = text;
    label.textContent = text;
  }

  async function choose(id) {
    setCurrentOrgId(id);
    render();
    /**
     * **The pop-out closes itself, decision 0362.** It lives on
     * `document.body`, outside `#shell`, so relaunching whatever
     * screen is current — which only ever replaces `#shell`'s own
     * content — would otherwise leave it sitting open over the top
     * of a screen it no longer has anything left to say about.
     */
    if (backdrop) backdrop.hidden = true;
    /**
     * **Relaunched, not reloaded — decision 0362.** Reported live:
     * "when changing Org via the button on the page, [...] relaunch
     * the current page that has focus." Decision 0314's own
     * `location.reload()` reasoning — no way, from outside a screen,
     * to ask whichever one is open to re-fetch itself — no longer
     * held once `onChosen` gave this button that exact way. A full
     * reload also always landed back on the default screen
     * regardless of what had been open, which the operator's own
     * report named directly as no longer the wanted behaviour.
     */
    await onChosen?.();
  }

  function row(text, onclick) {
    const n = node("button", { class: "searchresult", text });
    n.onclick = onclick;
    return n;
  }

  button.onclick = () => {
    if (backdrop) {
      backdrop.hidden = false;
      return;
    }

    const close = () => {
      backdrop.hidden = true;
    };

    const box = node("div", { class: "popout" }, [
      node("div", { class: "cardhead" }, [
        node("h3", { text: t("org.switchheading") }),
        node("button", { class: "actionlink", title: t("action.close"), onclick: close }, [
          icon("close"),
        ]),
      ]),
      // "All organisations" only when holding a role that genuinely
      // covers everything — offering it to somebody who does not
      // would be a choice with no real effect.
      ...(holdsEverywhere ? [row(t("org.all"), () => choose(null))] : []),
      ...units.map((u) => row(u.name, () => choose(u.id))),
    ]);

    backdrop = node("div", { class: "backdrop" }, [box]);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
    document.body.append(backdrop);
  };

  render();
  return button;
}

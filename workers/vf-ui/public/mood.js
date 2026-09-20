/**
 * Day time or night time — decision 0139.
 *
 * **A person's setting, not a customer's.** Decision 0108 settled that:
 * light and dark are comfort and accessibility, not brand, and a
 * customer forcing one on everybody is a support ticket. A customer's
 * livery sets the accent (0096); this sets the surfaces.
 */

import { icon } from "/icons.js";

const KEY = "vf-mood";

/**
 * What the machine already says, when nobody has chosen.
 *
 * **Two options and no third.** A "follow the system" entry would be
 * honest and would also make the control read as three states when the
 * screen only has two — so the initial *selection* is derived from the
 * system instead, and somebody whose machine is dark sees "Night time"
 * already chosen.
 */
function systemMood() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function currentMood() {
  try {
    return localStorage.getItem(KEY) ?? systemMood();
  } catch {
    // A browser refusing storage is a browser that still needs a
    // readable screen.
    return systemMood();
  }
}

/**
 * Apply it to the document.
 *
 * **`data-mood` on `<html>`, not a class on `<body>`.** The stylesheet
 * needs it before anything renders, and `<html>` is the only element
 * that exists that early — a class applied after the first paint is a
 * flash of the wrong palette, which decision 0103 already recorded as
 * the thing a person notices and nobody tests.
 */
export function applyMood(mood) {
  document.documentElement.setAttribute("data-mood", mood);
  try {
    localStorage.setItem(KEY, mood);
  } catch {
    // The screen is right for this session either way.
  }
}

/**
 * Re-theme a window that carries no mood button of its own, the moment
 * a *different* window changes it — decision 0412.
 *
 * **For the document pop-out (decision 0384) only.** The main window
 * needs nothing here: `moodPicker()`'s own `onclick` calls `applyMood()`
 * directly, in the same document, which is already as live as a change
 * can be. The pop-out has no picker of its own — it only ever shows
 * whichever mood the main window's own button last set, read once at
 * its own boot. Reported live: *"when a different skin ... is selected
 * in the main browser, [it] is pushed to the current screen, but also
 * push ... to the breakout window."*
 *
 * **`storage`, not `postMessage` or `BroadcastChannel`.** It is the one
 * event a same-origin window receives automatically when a *different*
 * window of its own writes to `localStorage` — never fired back at the
 * window that made the change, so the button's own window never loops
 * on its own click. `document-window.js` (decision 0384) already
 * chose plain navigation over a message channel for retargeting the
 * pop-out to a different task; this reaches for the platform's own
 * cross-window primitive the same way, rather than building a channel
 * neither of those needed.
 */
export function watchMoodChanges() {
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    document.documentElement.setAttribute("data-mood", event.newValue ?? systemMood());
  });
}

/**
 * The control itself, for a screen's top bar — decision 0286's own
 * toggle button, replacing the `<select>` decision 0139 built.
 *
 * **A toggle, not a dropdown, now that there are only ever two
 * states.** A `<select>` with two options was always going to look
 * like a dropdown rather than a button beside it — the operator's own
 * request: "the same size and width as other buttons." A button that
 * shows the current mood and flips it on click needs no menu to open
 * at all.
 *
 * **`document.createElement`, not `el()` from tasks.js.** `tasks.js`
 * already imports `moodPicker` from this file; importing anything
 * back the other way would be a circular import, the same reasoning
 * decision 0283 gave for building its own button locally rather than
 * importing `actionLink` from viewer.js.
 */
export function moodPicker(t) {
  const button = document.createElement("button");
  button.className = "actionlink";

  function render(mood) {
    button.title = t(`mood.${mood}`);
    const span = document.createElement("span");
    span.textContent = t(`mood.${mood}`);
    button.replaceChildren(icon(mood === "night" ? "moon" : "sun"), span);
  }

  button.onclick = () => {
    const next = currentMood() === "night" ? "day" : "night";
    applyMood(next);
    render(next);
  };

  render(currentMood());
  return button;
}

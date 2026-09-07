/**
 * Day time or night time — decision 0139.
 *
 * **A person's setting, not a customer's.** Decision 0108 settled that:
 * light and dark are comfort and accessibility, not brand, and a
 * customer forcing one on everybody is a support ticket. A customer's
 * livery sets the accent (0096); this sets the surfaces.
 */

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

/** The control itself, for a screen's top bar. */
export function moodPicker(t) {
  const select = document.createElement("select");
  select.id = "mood";
  select.className = "mood";
  select.setAttribute("aria-label", t("mood.label"));

  for (const value of ["day", "night"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(`mood.${value}`);
    select.append(option);
  }

  select.value = currentMood();
  select.addEventListener("change", (event) => applyMood(event.target.value));
  return select;
}

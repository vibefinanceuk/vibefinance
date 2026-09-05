/**
 * The interface's words — decision 0107.
 *
 * Fetched from the control plane rather than bundled, so fixing a
 * wording or adding a language does not need a UI deployment.
 *
 * **The language comes from the browser.** `vf-app` takes it from a
 * per-deployment var, on the reasoning that one Worker serves one
 * customer operating in one language (decision 0008). `vf-ui` is one
 * shared deployment, so that reasoning does not carry and the person's
 * own browser is the best available answer.
 */

let strings = {};
let locale = "en";

export async function loadStrings() {
  try {
    const response = await fetch(`/api/ui-strings?locale=${encodeURIComponent(navigator.language ?? "en")}`);
    if (!response.ok) return;
    const body = await response.json();
    strings = body.strings ?? {};
    locale = body.locale ?? "en";
    document.documentElement.lang = locale;
  } catch {
    // A screen in English is better than no screen. The fallback is
    // the key itself, which is at least readable.
  }
}

/**
 * A word, by key.
 *
 * **Returns the key when it is missing**, rather than an empty string.
 * A screen reading `tasks.notkeyed` is obviously broken and somebody
 * reports it; a screen with a blank where a word should be looks like
 * a data problem and gets lived with.
 */
export function t(key) {
  return strings[key] ?? key;
}

export function currentLocale() {
  return locale;
}

/**
 * Fill any element carrying a `data-t` key.
 *
 * The scripted screens build their own nodes and call `t()` directly.
 * The sign-in form is markup, so its words are marked in the HTML and
 * filled here — **left empty in the source** rather than defaulted to
 * English, because a default flashes the wrong language to the person
 * least able to read it.
 */
export function applyStrings(root = document) {
  for (const node of root.querySelectorAll("[data-t]")) {
    node.textContent = t(node.dataset.t);
  }
}

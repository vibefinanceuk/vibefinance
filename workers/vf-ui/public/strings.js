/**
 * The interface's words — decision 0107.
 *
 * Fetched from the control plane rather than bundled, so fixing a
 * wording or adding a language does not need a UI deployment.
 *
 * **The language comes from the browser, unless a person has chosen
 * their own — decision 0302.** `vf-app` takes it from a per-deployment
 * var, on the reasoning that one Worker serves one customer operating
 * in one language (decision 0008). `vf-ui` is one shared deployment,
 * so that reasoning does not carry and the person's own browser is
 * the best *default* available — but a person using this in a
 * language their own browser was never set to should not have to
 * change their operating system's own locale to read the screen in
 * theirs.
 */

let strings = {};
let locale = "en";

const LOCALE_KEY = "vf-locale";

/**
 * **A person's own choice, the same way `mood.js`'s own `KEY` is** —
 * `localStorage`, read once at load and written the moment somebody
 * picks a language explicitly. `null` means nobody has chosen, which
 * is different from "chose English" — the browser's own language
 * still decides until somebody actually picks one.
 */
function storedLocale() {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    // A browser refusing storage still gets the browser's own guess.
    return null;
  }
}

export async function loadStrings() {
  try {
    const requested = storedLocale() ?? navigator.language ?? "en";
    const response = await fetch(`/api/ui-strings?locale=${encodeURIComponent(requested)}`);
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

/**
 * The two languages a person can actually pick — decision 0302.
 *
 * **Not the server's own `SUPPORTED` list.** vf-licence accepts six
 * codes so a translation can be added one language at a time without
 * a schema change first; only `en` and `de` have any rows behind them
 * today. Offering the other four here would be a menu of screens that
 * render entirely in English regardless of what was picked — a choice
 * that does nothing is worse than a choice not offered.
 *
 * **Native names, not translated ones.** "Deutsch" reads the same
 * whichever language the screen is currently in, on purpose: the
 * point of a language picker is to be findable by someone who cannot
 * read the language currently on screen, which a name translated into
 * that same language would defeat.
 */
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
];

/**
 * Reload a window that carries no language button of its own, the
 * moment a *different* window changes the language — decision 0412.
 *
 * **For the document pop-out only**, the same reasoning as `mood.js`'s
 * own `watchMoodChanges()`: the pop-out has no `languagePicker()` of
 * its own, only ever the main window does, and `storage` is the one
 * event a same-origin window gets for free when a *different* window
 * writes to `localStorage`.
 *
 * **A reload here, matching what `languagePicker()`'s own `onclick`
 * already does on the window where somebody actually clicked it** —
 * decision 0302 chose a full reload over an in-place re-render because
 * there is no router to re-open whichever screen is showing; the
 * pop-out is simpler still, since `document-window.js` already reads
 * which invoice to show from its own URL on every load (decision
 * 0384), so reloading it lands back on the exact same document, now in
 * the newly chosen language.
 */
export function watchLocaleChanges() {
  window.addEventListener("storage", (event) => {
    if (event.key !== LOCALE_KEY) return;
    location.reload();
  });
}

/**
 * The control itself, for a screen's top bar — decision 0302, reported
 * live: "add a Language button and icon, where English, or German can
 * be selected... Use De, or En as the Icon perhaps."
 *
 * **A toggle, matching `moodPicker`'s own shape** — decision 0286's
 * own reasoning carries over unchanged: two real options today, and a
 * button that shows the current one and flips it needs no menu to
 * open. A third language, the day one is actually translated, is the
 * day this earns a real dropdown; building one now for a choice
 * nobody can make yet would be speculative.
 *
 * **A short code stands in for the SVG `icon()` every other button
 * here uses** — there is no glyph for "this is now in German" the way
 * there is for day and night, and the operator's own suggestion was
 * the code itself.
 *
 * **A full reload, not a re-render in place.** Decision 0126 built no
 * router and no in-memory way to re-open whichever screen is
 * currently showing from outside itself — the same reason Sign Out
 * (decision 0283) reloads rather than re-renders. Every screen's own
 * `render()` calls `t()` throughout, and a fresh `loadStrings()` on
 * load is the one place already guaranteed to run before any of them
 * do.
 */
export function languagePicker() {
  const button = document.createElement("button");
  button.className = "actionlink";

  function render(code) {
    const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
    button.title = lang.name;
    const badge = document.createElement("span");
    badge.className = "langbadge";
    badge.textContent = lang.code.toUpperCase();
    const label = document.createElement("span");
    label.textContent = lang.name;
    button.replaceChildren(badge, label);
  }

  button.onclick = () => {
    const current = storedLocale() ?? locale;
    const next = LANGUAGES.find((l) => l.code !== current)?.code ?? "en";
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // The screen is right for this session either way, since
      // loadStrings() falls back to the browser's own language.
    }
    location.reload();
  };

  render(storedLocale() ?? locale);
  return button;
}

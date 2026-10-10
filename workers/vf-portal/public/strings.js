/**
 * The network's words, from the control plane (decision 0107), in the
 * browser's language; the key itself where a word is missing.
 */
let strings = {};

/** Decision 0723: English or Deutsch, chosen in the top bar and remembered in this browser. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
];
const LOCALE_KEY = "vfn-locale";

export function chosenLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    // The browser's own language, then.
  }
  return null;
}

export function chooseLocale(code) {
  try {
    localStorage.setItem(LOCALE_KEY, code);
  } catch {
    // Right for this page either way: the caller reloads the words.
  }
}

export async function loadStrings() {
  try {
    const res = await fetch(`/api/ui-strings?locale=${encodeURIComponent(chosenLocale() ?? (navigator.language || "en"))}`);
    if (!res.ok) return;
    const body = await res.json();
    strings = body.strings ?? {};
    document.documentElement.lang = body.locale ?? "en";
  } catch {
    // English keys are better than nothing.
  }
}

export function t(key, params = {}) {
  let s = strings[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Every element with data-t gets its word. */
export function fill(root = document) {
  for (const node of root.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
  for (const node of root.querySelectorAll("[data-t-placeholder]")) node.placeholder = t(node.dataset.tPlaceholder);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

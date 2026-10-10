/**
 * The network's words, from the control plane (decision 0107), in the
 * browser's language; the key itself where a word is missing.
 */
let strings = {};

export async function loadStrings() {
  try {
    const res = await fetch(`/api/ui-strings?locale=${encodeURIComponent(navigator.language || "en")}`);
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

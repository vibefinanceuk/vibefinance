// Day or night, as the product's own pages choose it (tokens.css reads data-mood).
try {
  document.documentElement.setAttribute("data-mood", window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day");
} catch {
  // tokens.css has a default.
}

// Day or night (decision 0723): the person's own choice from the top bar,
// else what their machine says. Read before the first paint; tokens.css reads data-mood.
try {
  var chosen = null;
  try {
    chosen = localStorage.getItem("vfn-mood");
  } catch {
    chosen = null;
  }
  document.documentElement.setAttribute("data-mood", chosen === "day" || chosen === "night" ? chosen : window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day");
} catch {
  // tokens.css has a default.
}

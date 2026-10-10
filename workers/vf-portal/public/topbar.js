import { t, el, fill, loadStrings, LANGUAGES, chooseLocale } from "/strings.js";
import { icon } from "/icons.js";

/**
 * **The network's top bar, as the application's — decision 0723.** Dan:
 * *"introduce the icons on the top right, in the same way we have in the
 * application… Sign out, Day / Night, Help and Language (En, De)."* An
 * icon above its word, in the application's order: Night / Day,
 * Language, Help, Sign out. Sign out only while signed in.
 */

const MOOD_KEY = "vfn-mood";

export function currentMood() {
  return document.documentElement.getAttribute("data-mood") === "night" ? "night" : "day";
}

function button(iconNode, label, onclick, id) {
  return el("button", { class: "actionlink", type: "button", title: label, onclick, ...(id ? { id } : {}) }, [iconNode, el("span", { text: label })]);
}

function moodButton() {
  const mood = currentMood();
  return button(icon(mood === "night" ? "moon" : "sun"), t(`network.mood.${mood}`), () => {
    const next = currentMood() === "night" ? "day" : "night";
    document.documentElement.setAttribute("data-mood", next);
    try {
      localStorage.setItem(MOOD_KEY, next);
    } catch {
      // Right for this page either way.
    }
    render();
  });
}

function languageButton() {
  const code = document.documentElement.lang?.slice(0, 2) === "de" ? "de" : "en";
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  const badge = el("span", { class: "langbadge", text: lang.code.toUpperCase() });
  return button(badge, lang.name, async () => {
    chooseLocale(LANGUAGES.find((l) => l.code !== code)?.code ?? "en");
    await loadStrings();
    fill();
    state.onLanguage?.();
    render();
  });
}

const state = { signedIn: false, onSignOut: null, onLanguage: null };

function render() {
  const right = document.querySelector(".topbar .right");
  if (!right) return;
  right.replaceChildren(
    moodButton(),
    languageButton(),
    button(icon("help"), t("network.help"), openHelp, "help"),
    ...(state.signedIn ? [button(icon("signout"), t("network.signout"), () => state.onSignOut?.(), "signout")] : [])
  );
}

/** Draw the controls. `onLanguage` redraws whatever the page shows; `onSignOut` signs out. */
export function mountTopbar({ onSignOut = null, onLanguage = null } = {}) {
  state.onSignOut = onSignOut;
  state.onLanguage = onLanguage;
  if (!document.querySelector(".topbar .right")) document.querySelector(".topbar")?.append(el("div", { class: "right" }));
  render();
}

export function setSignedIn(signedIn) {
  state.signedIn = signedIn;
  render();
}

/**
 * **Help — what the network is, what each status means, how to answer a
 * question, and who sees what.** A panel on the right, as the
 * application's Help; Close or Escape shuts it.
 */
export function openHelp() {
  document.getElementById("helppanel")?.remove();
  const close = () => panel.remove();
  const statuses = ["received", "in_review", "query_raised", "approved", "sent_for_payment", "paid", "rejected"];
  const panel = el("aside", { class: "helppanel", id: "helppanel", role: "dialog", "aria-label": t("network.help") }, [
    el("div", { class: "helphead" }, [el("h2", { text: t("network.help") }), button(icon("close"), t("network.close"), close)]),
    el("p", { text: t("network.help.intro") }),
    el("h3", { text: t("network.help.statuses") }),
    el(
      "dl",
      { class: "helpstatuses" },
      statuses.flatMap((s) => [el("dt", {}, [el("span", { class: `status ${s}`, text: t(`network.status.${s}`) })]), el("dd", { text: t(`network.help.status.${s}`) })])
    ),
    el("h3", { text: t("network.help.questions.title") }),
    el("p", { text: t("network.help.questions") }),
    el("h3", { text: t("network.help.access.title") }),
    el("p", { text: t("network.help.access") }),
    el("p", { class: "muted", text: t("network.help.free") }),
  ]);
  panel.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(panel);
  panel.querySelector("button")?.focus();
}

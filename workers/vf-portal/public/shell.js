import { t, el, fill, loadStrings, LANGUAGES, chooseLocale } from "/strings.js";
import { icon } from "/icons.js";

/**
 * **The application's frame, for the supplier network — decision 0725.**
 * Dan: *"introduce a side menu, the same as the main application, with
 * Documents, and Create menu items. So the UI look and feel is
 * consistent."* The same markup `vf-ui`'s `frame()` and `topbar()` build
 * (`tasks.js`), styled by the same `app.css` (copied here; a test keeps
 * the copy the same as the app's): the menu on the left with the logo and
 * who is signed in, a title and the controls along the top.
 *
 * The controls are the network's four (0723) in the application's order:
 * Night / Day, Language, Help, Sign out. A screen's own buttons sit to
 * their left, past a divider, as in the app (0304).
 */

const MOOD_KEY = "vfn-mood";
const NAV_KEY = "vfn-nav";

/** The menu, in order (0725, 0727), with the app's colour for each: Documents 4, Create 5. */
export const SCREENS = [
  ["documents", "documents", 4],
  ["create", "create", 5],
];

function currentMood() {
  return document.documentElement.getAttribute("data-mood") === "night" ? "night" : "day";
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Right for this page either way.
  }
}

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function control(iconNode, label, onclick, extraClass = "") {
  return el("button", { class: `actionlink${extraClass}`, type: "button", title: label, onclick }, [iconNode, el("span", { text: label })]);
}

/**
 * The frame: the side menu and the page. `who` is the signed-in person
 * and their supplier; `current` the screen showing; `go` opens one.
 */
export function frame({ current, go, who, page, badges = {} }) {
  const collapsed = stored(NAV_KEY) === "collapsed";
  const items = SCREENS.map(([screen, iconName, hue]) =>
    el("a", { class: `navitem navhue${hue}${current === screen ? " on" : ""}`, title: t(`network.nav.${screen}`), "data-screen": screen, onclick: () => go(screen) }, [
      el("span", { class: "navicon" }, [icon(iconName)]),
      el("span", { class: "navlabel", text: t(`network.nav.${screen}`) }),
      // Decision 0728: how many invoices have unread messages, as the app's own menu counts.
      badges[screen] > 0 ? el("span", { class: "navbadge", title: t("network.nav.unread", { n: badges[screen] }), text: String(badges[screen]) }) : null,
    ])
  );
  const nav = el("nav", { class: collapsed ? "nav collapsed" : "nav" }, [
    el("div", { class: "navscroll" }, [
      el("img", { class: "brandmark dark", src: "/img/logo.png", alt: "" }),
      el("img", { class: "brandmark light", src: "/img/logo-light.png", alt: "" }),
      el("img", { class: "navmark", src: "/img/logo-mark.png", alt: "" }),
      el("div", { class: "navgroup" }, [
        el("span", { class: "navgrouplong", text: t("network.nav.group") }),
        el("span", { class: "navgroupshort", "aria-hidden": "true", text: t("network.nav.groupshort") }),
      ]),
      ...items,
    ]),
    el("div", { class: "who" }, [el("div", { text: who.email ?? "" }), el("div", { class: "muted", text: who.supplier ?? "" })]),
  ]);
  const root = el("div", { class: collapsed ? "frame collapsed" : "frame" }, [nav, el("div", { class: "main", id: "main" }, [page])]);
  // As the app: a click on the menu's empty space folds it to its icons.
  nav.addEventListener("click", (e) => {
    if (e.target.closest(".navitem")) return;
    const now = !root.classList.contains("collapsed");
    root.classList.toggle("collapsed", now);
    nav.classList.toggle("collapsed", now);
    store(NAV_KEY, now ? "collapsed" : "open");
  });
  return root;
}

/** Decision 0728: change a menu item's count in place, once the list has been asked for. */
export function setBadge(screen, n) {
  const item = document.querySelector(`.navitem[data-screen="${screen}"]`);
  if (!item) return;
  item.querySelector(".navbadge")?.remove();
  if (n > 0) item.append(el("span", { class: "navbadge", title: t("network.nav.unread", { n }), text: String(n) }));
}

/**
 * The top bar: title and subtitle, then the screen's own buttons, a
 * divider when there are any, and the four controls.
 */
export function topbar(title, subtitle, own, { onSignOut, onLanguage, onMood }) {
  const mood = currentMood();
  const code = document.documentElement.lang?.slice(0, 2) === "de" ? "de" : "en";
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  return el("div", { class: "topbar" }, [
    el("div", {}, [el("h2", { text: title }), subtitle ? el("p", { class: "sub", text: subtitle }) : null]),
    el("div", { class: "right" }, [
      ...own,
      own.length ? el("div", { class: "topbardivider" }) : null,
      control(icon(mood === "night" ? "moon" : "sun"), t(`network.mood.${mood}`), () => {
        const next = currentMood() === "night" ? "day" : "night";
        document.documentElement.setAttribute("data-mood", next);
        store(MOOD_KEY, next);
        onMood?.();
      }),
      control(el("span", { class: "langbadge", text: lang.code.toUpperCase() }), lang.name, async () => {
        chooseLocale(LANGUAGES.find((l) => l.code !== code)?.code ?? "en");
        await loadStrings();
        fill();
        await onLanguage?.();
      }),
      control(icon("help"), t("network.help"), openHelp),
      control(icon("signout"), t("network.signout"), () => onSignOut?.()),
    ]),
  ]);
}

/**
 * **Help (0723)** — what the network is, what each status means, how to
 * answer a question, and who sees what. A panel on the right; Close or
 * Escape shuts it.
 */
export function openHelp() {
  document.getElementById("helppanel")?.remove();
  const close = () => panel.remove();
  // Decision 0738: a goods receipt's three after an invoice's.
  const statuses = ["received", "in_review", "query_raised", "returned", "approved", "sent_for_payment", "paid", "rejected", "credited", "goods_received", "goods_returned", "goods_checking"];
  const panel = el("aside", { class: "helppanel", id: "helppanel", role: "dialog", "aria-label": t("network.help") }, [
    el("div", { class: "helphead" }, [el("h2", { text: t("network.help") }), control(icon("close"), t("network.close"), close)]),
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

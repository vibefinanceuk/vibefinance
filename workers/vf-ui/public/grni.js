import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { actionLink } from "/viewer.js";

/**
 * **Goods received not invoiced — decision 0650.** A card on AP
 * Analytics' Financial Performance tab, beside Accruals, built as that
 * card is: `load()` and `renderCard()`, the tab owns the rest.
 *
 * As at a date (today unless chosen), per currency: what is in and not
 * yet invoiced, at the PO's price, and how much of it is over 60 days
 * old; then by supplier, aged 0–30, 31–60 and over 60 days. **Download
 * CSV** gives every PO line, for the accrual journal.
 */

let data = null;
let asAt = null;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function query(extra = {}) {
  const params = new URLSearchParams();
  const org = currentOrgId();
  if (org) params.set("org", org);
  params.set("asAt", asAt ?? today());
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/api/grni?${params}`;
}

export async function load() {
  try {
    const response = await fetch(query());
    if (!response.ok) return false;
    data = await response.json();
    asAt = data.asAt ?? asAt;
  } catch {
    return false;
  }
  return true;
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

async function download() {
  try {
    const response = await fetch(query({ format: "csv" }));
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const a = el("a", { href: url, download: `grni-${asAt ?? today()}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Nothing to download; the card still shows the figures.
  }
}

function controls(card) {
  const date = el("input", { type: "date", id: "grni-asat", value: asAt ?? today(), "aria-label": t("grni.asat") });
  date.onchange = async () => {
    asAt = date.value || today();
    if (await load()) card.replaceWith(renderCard());
  };
  const button = actionLink("download", { label: t("grni.download"), onclick: () => download() });
  button.id = "grni-download";
  return el("div", { class: "grnicontrols" }, [el("label", { for: "grni-asat", class: "sm muted", text: t("grni.asat") }), date, button]);
}

function tiles() {
  return el(
    "div",
    { class: "grnitiles" },
    data.currencies.map((c) =>
      el("div", { class: "grnitile" }, [
        el("b", { text: money(c.total, c.currency) }),
        el("span", { class: "sm muted", text: t("grni.lines").replace("{n}", String(c.lines)) }),
        c.over60 > 0 ? el("span", { class: "sm grniover", text: t("grni.over60").replace("{amount}", money(c.over60, c.currency)) }) : null,
        c.unpriced > 0 ? el("span", { class: "sm muted", text: t("grni.unpriced").replace("{n}", String(c.unpriced)) }) : null,
      ].filter(Boolean))
    )
  );
}

function supplierTable() {
  const head = ["grni.col.supplier", "grni.col.orders", "grni.col.d30", "grni.col.d60", "grni.col.over60", "grni.col.total"];
  return el("div", { class: "tablewrap" }, [
    el("table", { class: "grnitable" }, [
      el("thead", {}, [el("tr", {}, head.map((k, i) => el("th", { class: i >= 2 ? "num" : "", text: t(k) })))]),
      el(
        "tbody",
        {},
        data.suppliers.map((s) =>
          el("tr", {}, [
            el("td", { text: s.supplier ?? t("grni.nosupplier") }),
            el("td", { class: "muted", text: s.orders.join(", ") }),
            el("td", { class: "num", text: s.d30 ? money(s.d30, s.currency) : "—" }),
            el("td", { class: "num", text: s.d60 ? money(s.d60, s.currency) : "—" }),
            el("td", { class: s.over60 ? "num grniover" : "num", text: s.over60 ? money(s.over60, s.currency) : "—" }),
            el("td", { class: "num" }, [el("b", { text: money(s.total, s.currency) })]),
          ])
        )
      ),
    ]),
  ]);
}

export function renderCard() {
  const card = el("div", { class: "panel card-graphic", id: "grni-card" });
  const empty = !data || data.lines.length === 0;
  card.append(
    el("div", { class: "cardhead" }, [el("h3", { text: t("grni.heading") })]),
    el("div", { class: "sub", text: t("grni.sub") }),
    controls(card),
    ...(empty ? [el("div", { class: "muted", text: t("grni.none") })] : [tiles(), supplierTable()])
  );
  return card;
}

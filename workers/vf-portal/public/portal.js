import { loadStrings, t, fill, el } from "/strings.js";

/**
 * **The supplier network's main page — decision 0717.** Sign in; then one
 * list of the supplier's invoices across every customer they are linked
 * to, asked of each customer live; an invoice opens with its lines.
 */

export const STATUSES = ["received", "in_review", "query_raised", "approved", "sent_for_payment", "paid", "rejected"];

const $ = (id) => document.getElementById(id);

export function money(amount, currency) {
  if (typeof amount !== "number") return "—";
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: currency || "GBP" }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}

const statusChip = (s) => el("span", { class: `status ${s}`, text: t(`network.status.${s}`) });

async function api(path, init) {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/sign-in") showSignIn();
  return { res, body };
}

function showSignIn() {
  $("list").hidden = true;
  $("who").hidden = true;
  $("signout").hidden = true;
  $("signin").hidden = false;
}

let timer = null;
export async function loadInvoices() {
  const params = new URLSearchParams();
  if ($("search").value.trim()) params.set("q", $("search").value.trim());
  if ($("status").value) params.set("status", $("status").value);
  const { res, body } = await api(`/invoices${params.toString() ? `?${params}` : ""}`);
  if (!res.ok) return;
  const rows = (body.invoices ?? []).map((inv) =>
    el("tr", { tabindex: "0", onclick: () => openInvoice(inv), onkeydown: (e) => e.key === "Enter" && openInvoice(inv) }, [
      el("td", { text: inv.customer }),
      el("td", { class: "nowrap", text: inv.invoiceNumber ?? "—" }),
      el("td", { class: "hide-narrow", text: inv.issueDate ?? "—" }),
      el("td", { class: "num", text: money(inv.total, inv.currency) }),
      el("td", { class: "hide-narrow", text: inv.purchaseOrder ?? "—" }),
      el("td", { class: "hide-narrow", text: inv.company ?? "" }),
      el("td", {}, [statusChip(inv.status)]),
    ])
  );
  $("rows").replaceChildren(...rows);
  $("empty").hidden = rows.length > 0;
  const gone = body.unavailable ?? [];
  $("unavailable").hidden = gone.length === 0;
  $("unavailable").textContent = t("network.unavailable", { list: gone.map((g) => g.customer).join(", ") });
}

export async function openInvoice(inv) {
  const { res, body } = await api(`/invoices/${encodeURIComponent(inv.linkId)}/${encodeURIComponent(inv.id)}`);
  if (!res.ok) return;
  const close = () => backdrop.remove();
  const fact = (label, value) => el("div", {}, [el("span", { text: t(label) }), value ?? "—"]);
  const lines = body.lines ?? [];
  const pop = el("div", { class: "popout", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "head" }, [el("h2", { text: body.invoiceNumber ?? "—" }), statusChip(body.status), el("button", { class: "linkbutton", text: t("network.close"), onclick: close })]),
    el("div", { class: "muted sm", text: `${body.customer} · ${body.company ?? ""}` }),
    body.comment ? el("div", { class: "comment" }, [el("div", { class: "sm", text: t("network.comment", { customer: body.customer }) }), el("div", { text: body.comment })]) : null,
    el("div", { class: "facts" }, [
      fact("network.col.date", body.issueDate),
      fact("network.col.amount", money(body.total, body.currency)),
      fact("network.col.po", body.purchaseOrder),
      fact("network.receivedat", (body.receivedAt ?? "").slice(0, 10)),
    ]),
    lines.length
      ? el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, [
              el("th", { text: "#" }),
              el("th", { text: t("network.line.description") }),
              el("th", { class: "num", text: t("network.line.quantity") }),
              el("th", { class: "num", text: t("network.line.unitprice") }),
              el("th", { class: "num", text: t("network.line.net") }),
            ])]),
            el("tbody", {}, lines.map((l) => el("tr", {}, [
              el("td", { text: String(l.lineNumber) }),
              el("td", { text: l.description ?? "—" }),
              el("td", { class: "num", text: l.quantity ?? "—" }),
              el("td", { class: "num", text: typeof l.unitPrice === "number" ? money(l.unitPrice, body.currency) : "—" }),
              el("td", { class: "num", text: money(l.netAmount, body.currency) }),
            ]))),
          ]),
        ])
      : null,
  ]);
  const backdrop = el("div", { class: "backdrop", onclick: (e) => e.target === backdrop && close(), onkeydown: (e) => e.key === "Escape" && close() }, [pop]);
  document.body.append(backdrop);
  pop.querySelector(".linkbutton").focus();
}

async function showList() {
  const { res, body } = await api("/me");
  if (!res.ok) return;
  $("signin").hidden = true;
  $("list").hidden = false;
  $("who").hidden = false;
  $("signout").hidden = false;
  $("who").textContent = body.email ?? "";
  const customers = body.customers ?? [];
  $("customers").textContent = customers.length
    ? t("network.customers", { list: customers.map((c) => `${c.customer} (${c.companies.join(", ")})`).join(" · ") })
    : t("network.nocustomers");
  await loadInvoices();
}

export async function start() {
  await loadStrings();
  fill();
  $("status").replaceChildren(el("option", { value: "", text: t("network.status.all") }), ...STATUSES.map((s) => el("option", { value: s, text: t(`network.status.${s}`) })));
  $("status").addEventListener("change", loadInvoices);
  $("search").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadInvoices, 300);
  });
  $("signout").addEventListener("click", async () => {
    await fetch("/api/sign-out", { method: "POST" });
    showSignIn();
  });
  $("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-problem").textContent = "";
    const { res, body } = await api("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
    });
    if (res.ok) return showList();
    $("signin-problem").textContent = res.status === 429 ? t("network.signin.wait", { n: body.retryAfterSeconds ?? "" }) : t("network.signin.failed");
  });
  // Signed in already shows the list; signed out, the API's 401 shows the form.
  await showList();
}

if (!globalThis.__VF_TEST__) start();

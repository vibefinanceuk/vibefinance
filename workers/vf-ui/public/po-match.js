import { t, currentLocale } from "/strings.js";
import { icon } from "/icons.js";

/**
 * The Matching stage's PO matching panel, phase 1 — decision 0530.
 *
 * The operator's own request: *"a UI, within which a user can view any
 * automatic matching that has taken place with an existing purchase
 * order, and furthermore correct, or search for a match purchase order
 * from the information stored in the system. The UI should also
 * indicate how much of a PO is used up / consumed."* Built from the
 * agreed mock-up, including its one change: "Already invoiced" in grey,
 * "This invoice" in blue, so the two read apart.
 *
 * Three sections, every figure computed by the server:
 * 1. **The linked PO** and how much of it is used (`GET
 *    /invoices/:id/po-match`).
 * 2. **Each invoice line against the PO line it names**, with the same
 *    verdict the Matching rules read.
 * 3. **Search** (`GET /invoices/:id/po-candidates`) and **Use this PO**
 *    (`POST /invoices/:id/po-link`), offered only to the person whose
 *    task it is.
 *
 * Phase 1 is read-and-relink only: pairing a line by hand, per-line
 * consumption and suggestions are later phases.
 *
 * Builds its own nodes rather than importing `el` from `tasks.js`, the
 * same choice `help.js` made: no import cycle to reason about.
 */

function node(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") n.className = value;
    else if (key === "text") n.textContent = value;
    else if (key === "style") n.setAttribute("style", value);
    else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
    else n.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) n.append(child);
  return n;
}

/** `{name}` placeholders — `t()` itself takes no parameters. */
function fill(key, params = {}) {
  return t(key).replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined || params[name] === null ? "" : String(params[name])));
}

function money(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value) {
  if (value === null || value === undefined) return "";
  return `${Number(value).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })}%`;
}

/** The Purchase Orders screen's own status words (0377): `on_hold` reads as `purchaseorders.status.onhold`. */
function statusPill(status) {
  const tone = status === "closed" ? "muted" : status === "on_hold" ? "warn" : "ok";
  return node("span", { class: `pmpill ${tone}`, text: t(`purchaseorders.status.${String(status).replace("_", "")}`) });
}

/** A line's verdict, in words. Mirrors `computePoLineMatch` exactly, never re-deciding it. */
function lineVerdict(line) {
  const r = line.result;
  if (!r.referenceFound) return { tone: "bad", text: t("pomatch.r.nopoline") };
  if (r.matched) return { tone: "ok", text: t("pomatch.r.matched") };
  if (r.unitMismatch) return { tone: "warn", text: t("pomatch.r.unit") };
  if (r.priceMatched === false) return { tone: "warn", text: fill("pomatch.r.price", { pct: pct(r.variancePct) }) };
  if (r.quantityMatched === false) return { tone: "warn", text: fill("pomatch.r.qty", { pct: pct(r.quantityVariancePct) }) };
  return { tone: "warn", text: t("pomatch.r.nocompare") };
}

/**
 * **How much of one PO line is used — decision 0533.** Quantities when
 * the PO line has one, otherwise amounts (a service line). A small bar
 * in the same colours as the PO's own (already invoiced grey, this
 * invoice blue, red once over), then the four figures in words.
 */
function lineUseRow(use) {
  if (!use) return null;
  const byQty = use.orderedQuantity !== null && use.orderedQuantity > 0;
  const ordered = byQty ? use.orderedQuantity : use.orderedAmount;
  if (ordered === null || ordered <= 0) return null;
  const before = byQty ? use.beforeQuantity : use.beforeAmount;
  const mine = byQty ? use.thisQuantity : use.thisAmount;
  const left = byQty ? use.leftQuantity : use.leftAmount;
  const over = left !== null && left < 0;
  const share = (v) => Math.max(0, Math.min(100, (v / ordered) * 100));
  const show = (v) => (byQty ? Number(v).toLocaleString(currentLocale(), { maximumFractionDigits: 3 }) : money(v));
  return node("div", { class: "pmlineuse" }, [
    node("span", { class: "pmbar" }, [
      node("span", { class: "pmseg others", style: `width:${share(before)}%` }),
      node("span", { class: `pmseg mine${over ? " over" : ""}`, style: `width:${share(mine)}%` }),
    ]),
    node("span", {
      class: over ? "sm pmover" : "muted sm",
      text: fill("pomatch.lineuse", { ordered: show(ordered), before: show(before), mine: show(mine), left: show(left) }),
    }),
  ]);
}

function lineSummary(l) {
  const parts = [];
  if (l.quantity !== null) parts.push(`${l.quantity}${l.unit ? ` ${l.unit}` : ""}`);
  if (l.price !== null) parts.push(`× ${money(l.price)}`);
  return `${parts.join(" ")}${parts.length ? " = " : ""}${money(l.amount)}`;
}

function usageSection(view) {
  const u = view.usage;
  if (!u || u.poTotal === null || u.poTotal <= 0) return null;
  const share = (v) => Math.max(0, Math.min(100, (v / u.poTotal) * 100));
  const over = u.left !== null && u.left < 0;
  const usedPct = Math.round(((u.invoicedByOthers + u.thisInvoice) / u.poTotal) * 100);
  const others = u.otherInvoices.map((o) => o.number ?? "—").join(", ");
  return node("div", { class: "pmusage" }, [
    node("div", { class: "pmusagehead" }, [
      node("b", { text: t("pomatch.used") }),
      node("span", {
        class: over ? "pmover" : "muted",
        text: over ? fill("pomatch.over", { amount: money(-u.left) }) : fill("pomatch.usedpct", { pct: usedPct }),
      }),
    ]),
    node("div", { class: "pmbar big", role: "img", "aria-label": t("pomatch.used") }, [
      node("span", { class: "pmseg others", style: `width:${share(u.invoicedByOthers)}%` }),
      node("span", { class: `pmseg mine${over ? " over" : ""}`, style: `width:${share(u.thisInvoice)}%` }),
    ]),
    node("div", { class: "pmlegend" }, [
      node("span", {}, [
        node("i", { class: "others" }),
        `${t("pomatch.already")} `,
        node("b", { text: money(u.invoicedByOthers) }),
        others ? node("em", { text: ` (${others})` }) : null,
      ]),
      node("span", {}, [node("i", { class: "mine" }), `${t("pomatch.thisinvoice")} `, node("b", { text: money(u.thisInvoice) })]),
      node("span", {}, [node("i", { class: "left" }), `${t("pomatch.left")} `, node("b", { class: over ? "pmover" : undefined, text: money(u.left) })]),
      node("span", { class: "muted", text: fill("pomatch.of", { total: `${money(u.poTotal)}${view.po.currency ? ` ${view.po.currency}` : ""}` }) }),
    ]),
  ]);
}

function poSection(view) {
  const heading = node("div", { class: "pmhead" }, [node("h4", { text: t("pomatch.linked") })]);
  if (!view.po) {
    return node("section", { class: "pmblock" }, [
      heading,
      node("div", {
        class: "pmempty",
        text: view.referenceNotFound ? fill("pomatch.notheld", { po: view.invoice.orderReference }) : t("pomatch.none"),
      }),
    ]);
  }
  heading.append(node("span", { class: "muted sm", text: fill("pomatch.how", { po: view.po.orderNumber }) }));
  const meta = (labelKey, value) => node("div", {}, [node("span", { class: "pmlabel", text: t(labelKey) }), value]);
  return node("section", { class: "pmblock" }, [
    heading,
    node("div", { class: "pmcard" }, [
      node("div", { class: "pmmeta" }, [
        meta("pomatch.ponumber", node("b", { text: view.po.orderNumber })),
        meta("pomatch.supplier", node("b", { text: view.po.supplierName ?? view.po.sellerPartyId ?? "—" })),
        meta("pomatch.buyer", node("b", { text: view.po.buyerName ?? "—" })),
        meta("pomatch.issued", node("b", { text: view.po.issueDate ?? "—" })),
        meta("pomatch.status", statusPill(view.po.status)),
      ]),
      usageSection(view),
    ]),
  ]);
}

/**
 * **The PO line a person can pick — decision 0532.** The first option
 * is the invoice's own reference (choosing it clears a saved pairing);
 * then every line of the linked PO.
 */
function pairingPicker(l, view, onPair) {
  const current = l.pairing ? String(l.pairing.poLineNumber) : "";
  const first = node("option", {
    value: "",
    text: l.orderLineReference ? fill("pomatch.pair.own", { ref: l.orderLineReference }) : t("pomatch.pair.choose"),
  });
  const options = view.poLineOptions.map((o) =>
    node("option", {
      value: String(o.lineNumber),
      text: `${fill("pomatch.pair.option", { n: o.lineNumber, name: o.name ?? "" })} (${lineSummary({ ...o, amount: null }).replace(/ = —$/, "")})`,
    })
  );
  const select = node("select", { class: "pmpair", "aria-label": fill("pomatch.pair.label", { n: l.lineNumber }) }, [first, ...options]);
  select.value = current;
  select.addEventListener("change", () => onPair(l.lineNumber, select.value === "" ? null : Number(select.value)));
  return select;
}

/**
 * **A suggested PO line — decision 0534.** The line, how sure (the
 * score), and why, in words. Accept saves it as an ordinary pairing
 * (0532); only the person whose task it is sees the button.
 */
function suggestionBox(l, view, onPair) {
  const s = l.suggestion;
  if (!s) return null;
  const option = view.poLineOptions.find((o) => o.lineNumber === s.poLineNumber);
  const why = s.reasons.map((r) => t(`pomatch.suggest.why.${r}`)).join(" · ");
  return node("div", { class: "pmsuggest sm" }, [
    node("span", {}, [
      `${fill("pomatch.suggest", { n: s.poLineNumber, name: option?.name ?? "" })} `,
      node("span", { class: "muted", text: `(${fill("pomatch.suggest.score", { pct: s.score })}${why ? `: ${why}` : ""})` }),
    ]),
    view.canRelink && onPair
      ? node("button", { class: "pmaccept", onclick: () => onPair(l.lineNumber, s.poLineNumber) }, [t("pomatch.suggest.accept")])
      : null,
  ]);
}

function linesSection(view, onPair) {
  if (!view.po) return null;
  const clear = view.lines.filter((l) => l.result.matched).length;
  const rows = view.lines.map((l) => {
    const verdict = lineVerdict(l);
    // A saved pairing says who made it, and what the invoice itself said (0532).
    const how = l.pairing
      ? node("span", {
          class: "pmpaired",
          text: [
            fill("pomatch.pairedby", { who: l.pairing.pairedByName ?? "" }),
            l.orderLineReference ? fill("pomatch.supplierref", { ref: l.orderLineReference }) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })
      : !l.orderLineReference
        ? node("span", { class: "pmwarntext", text: t("pomatch.noref") })
        : l.poLine
          ? node("span", { text: fill("pomatch.byref", { ref: l.orderLineReference }) })
          : node("span", { class: "pmwarntext", text: fill("pomatch.refnotfound", { ref: l.orderLineReference }) });
    return node("tr", { "data-line": String(l.lineNumber) }, [
      node("td", {}, [
        node("div", {}, [node("b", { text: `${l.lineNumber} ` }), l.name ?? ""]),
        node("div", { class: "muted sm", text: lineSummary(l) }),
      ]),
      node("td", { class: "pmarrow", text: "→" }),
      node("td", {}, [
        view.canRelink && onPair
          ? pairingPicker(l, view, onPair)
          : l.poLine
            ? node("div", {}, [node("b", { text: `${l.poLine.lineNumber} ` }), l.poLine.name ?? ""])
            : node("div", { class: "muted", text: "—" }),
        l.poLine
          ? node("div", {
              class: "muted sm",
              // With the picker showing "the invoice's own reference", say which PO line that is.
              text: view.canRelink && onPair ? `${l.poLine.lineNumber} ${l.poLine.name ?? ""} · ${lineSummary(l.poLine)}` : lineSummary(l.poLine),
            })
          : null,
        node("div", { class: "sm" }, [how]),
        suggestionBox(l, view, onPair),
        lineUseRow(l.poLine?.use),
      ]),
      node("td", {}, [node("span", { class: `pmpill ${verdict.tone}`, text: verdict.text })]),
    ]);
  });
  const tol = view.tolerance;
  return node("section", { class: "pmblock" }, [
    node("div", { class: "pmhead" }, [
      node("h4", { text: t("pomatch.lines") }),
      node("span", {
        class: "muted sm",
        text: `${fill("pomatch.clear", { n: clear, total: view.lines.length })} · ${fill("pomatch.tolerance", { pct: pct(tol.amountPct) })}`,
      }),
    ]),
    node("table", { class: "pmtable" }, [
      node("thead", {}, [
        node("tr", {}, [
          node("th", { text: t("pomatch.invoiceline") }),
          node("th", {}),
          node("th", { text: t("pomatch.poline") }),
          node("th", { text: t("pomatch.result") }),
        ]),
      ]),
      node("tbody", {}, rows),
    ]),
    view.unusedPoLines.length
      ? node("p", { class: "pmunused sm" }, [
          node("b", { text: `${t("pomatch.unused")} ` }),
          view.unusedPoLines
            .map((p) => {
              // What is still open on it, when other invoices have taken some (decision 0533).
              const left = p.use && p.use.leftQuantity !== null && p.use.beforeQuantity > 0 ? ` · ${fill("pomatch.unusedleft", { n: p.use.leftQuantity })}` : "";
              return `${p.lineNumber} ${p.name ?? ""} (${lineSummary(p)}${left})`;
            })
            .join("; "),
        ])
      : null,
  ]);
}

/**
 * Opens the panel over the document. `onRelinked` is called when the
 * panel closes after a successful re-link, so the viewer can redraw with
 * the new BT-13.
 */
export async function openPoMatchingPanel(invoiceId, { onRelinked } = {}) {
  const base = `/api/invoices/${encodeURIComponent(invoiceId)}`;
  // Anything saved (a re-link, 0530, or a pairing, 0532) redraws the document on close.
  let changed = false;
  let view = null;

  const errorBox = node("div", { class: "warn sm", hidden: true });
  const body = node("div", { class: "pmbody" }, [node("p", { class: "muted", text: t("pomatch.loading") })]);
  const sub = node("p", { class: "pmsub" });

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    if (changed) onRelinked?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const closeButton = node("button", { class: "actionlink", title: t("action.close"), onclick: close }, [
    icon("close"),
    node("span", { text: t("action.close") }),
  ]);

  // Search controls live across re-renders, so a typed term survives a re-link.
  const searchBox = node("input", { type: "search", placeholder: t("pomatch.search.placeholder") });
  const check = (key, checked) => {
    const input = node("input", { type: "checkbox", checked });
    return { input, label: node("label", {}, [input, ` ${t(key)}`]) };
  };
  const fSupplier = check("pomatch.f.supplier", true);
  const fActive = check("pomatch.f.active", true);
  const fCovers = check("pomatch.f.covers", false);
  const resultsBody = node("tbody");
  const searchTitle = node("h4");

  let searchSeq = 0;
  async function runSearch() {
    const seq = ++searchSeq;
    const params = new URLSearchParams();
    if (searchBox.value.trim()) params.set("search", searchBox.value.trim());
    if (fSupplier.input.checked) params.set("supplierOnly", "1");
    if (fActive.input.checked) params.set("activeOnly", "1");
    if (fCovers.input.checked) params.set("coversInvoice", "1");
    let candidates = [];
    try {
      const response = await fetch(`${base}/po-candidates?${params}`);
      candidates = response.ok ? ((await response.json()).candidates ?? []) : [];
    } catch {
      candidates = [];
    }
    // Only the newest answer counts, so a slow early reply never overwrites a later one.
    if (seq !== searchSeq) return;
    resultsBody.replaceChildren(
      ...(candidates.length
        ? candidates.map(candidateRow)
        : [node("tr", {}, [node("td", { colspan: "9", class: "muted", text: t("pomatch.noresults") })])])
    );
  }
  let searchTimer = null;
  searchBox.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  for (const f of [fSupplier, fActive, fCovers]) f.input.addEventListener("change", runSearch);

  function candidateRow(c) {
    const usedPct = c.payableAmount ? Math.round((c.invoicedByOthers / c.payableAmount) * 100) : 0;
    const why = [
      c.reasons.sameSupplier ? t("pomatch.why.supplier") : null,
      c.reasons.coversInvoice ? t("pomatch.why.covers") : null,
      c.reasons.sameCurrency ? t("pomatch.why.currency") : null,
      // Decision 0534 — how many of this invoice's lines look like one of this PO's.
      c.reasons.linesAlike ? fill("pomatch.why.lines", { n: c.reasons.linesAlike, total: c.reasons.lineCount }) : null,
    ].filter(Boolean);
    let action;
    if (c.current) action = node("span", { class: "muted sm", text: t("pomatch.current") });
    else if (view?.canRelink && c.status !== "closed")
      action = node("button", { class: "pmuse", onclick: () => link(c.orderNumber) }, [t("pomatch.use")]);
    else action = null;
    return node("tr", { class: c.current ? "current" : undefined, "data-po": c.orderNumber }, [
      node("td", {}, [node("b", { text: c.orderNumber })]),
      node("td", { text: c.supplierName ?? c.sellerPartyId ?? "—" }),
      node("td", { text: c.issueDate ?? "—" }),
      node("td", { class: "num", text: money(c.payableAmount) }),
      node("td", {}, [
        node("span", { class: "pmbar mini" }, [node("span", { class: "pmseg others", style: `width:${Math.min(100, usedPct)}%` })]),
        node("span", { class: "muted sm", text: `${usedPct}%` }),
      ]),
      node("td", { class: "num", text: money(c.left) }),
      node("td", {}, [statusPill(c.status)]),
      node("td", { class: "muted sm", text: why.join(" · ") }),
      node("td", {}, [action]),
    ]);
  }

  async function link(orderNumber) {
    errorBox.hidden = true;
    try {
      const response = await fetch(`${base}/po-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        errorBox.textContent = failure.error ?? t("pomatch.linkfailed");
        errorBox.hidden = false;
        return;
      }
      changed = true;
      await load();
    } catch {
      errorBox.textContent = t("pomatch.linkfailed");
      errorBox.hidden = false;
    }
  }

  async function pair(lineNumber, poLineNumber) {
    errorBox.hidden = true;
    try {
      const response = await fetch(`${base}/po-pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineNumber, poLineNumber }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        errorBox.textContent = failure.error ?? t("pomatch.pairfailed");
        errorBox.hidden = false;
        return;
      }
      changed = true;
      await load();
    } catch {
      errorBox.textContent = t("pomatch.pairfailed");
      errorBox.hidden = false;
    }
  }

  async function load() {
    try {
      const response = await fetch(`${base}/po-match`);
      if (!response.ok) throw new Error("load");
      view = await response.json();
    } catch {
      body.replaceChildren(node("p", { class: "warn sm", text: t("pomatch.loadfailed") }));
      return;
    }
    const inv = view.invoice;
    sub.textContent = [inv.number, inv.supplierName, inv.total !== null ? `${money(inv.total)}${inv.currency ? ` ${inv.currency}` : ""}` : null]
      .filter(Boolean)
      .join(" · ");
    searchTitle.textContent = t(view.po ? "pomatch.search.title" : "pomatch.search.titlenone");
    body.replaceChildren(
      poSection(view),
      linesSection(view, pair) ?? "",
      node("section", { class: "pmblock" }, [
        node("div", { class: "pmhead" }, [searchTitle]),
        node("div", { class: "pmsearchbar" }, [searchBox, fSupplier.label, fActive.label, fCovers.label]),
        view.canRelink ? null : node("p", { class: "muted sm", text: t("pomatch.relinkhint") }),
        node("div", { class: "pmtablewrap" }, [
          node("table", { class: "pmtable pmresults" }, [
            node("thead", {}, [
              node(
                "tr",
                {},
                ["po", "supplier", "issued", "total", "used", "left", "status", "why", ""].map((k) =>
                  node("th", { class: k === "total" || k === "left" ? "num" : undefined, text: k ? t(`pomatch.col.${k}`) : "" })
                )
              ),
            ]),
            resultsBody,
          ]),
        ]),
      ]),
      errorBox
    );
    await runSearch();
  }

  const box = node("div", { class: "popout pompanel", role: "dialog", "aria-label": t("pomatch.title") }, [
    node("div", { class: "cardhead" }, [node("div", {}, [node("h3", { text: t("pomatch.title") }), sub]), closeButton]),
    body,
    node("p", { class: "pmfoot muted sm", text: t("pomatch.foot") }),
  ]);
  const backdrop = node("div", { class: "backdrop" }, [box]);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  document.addEventListener("keydown", onKey);
  await load();
  return { close };
}

import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **HTTPS out, on a Destination — decision 0585**, slice 1 of the
 * connector framework. Shown in the Destination panel on Process routes
 * for an HTTPS out Destination: where it sends, how it signs in, a test
 * with a real invoice (shown before anything is sent), starting it, and
 * what it has delivered or failed to, with Send again.
 */

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** A refusal in words: the reason's own string where there is one, else what the server said. */
function why(body) {
  const key = body?.reason ? `httpsout.error.${body.reason}` : null;
  const words = key ? t(key) : key;
  return words && words !== key ? words : (body?.error ?? t("httpsout.failed"));
}

const pill = (tone, text) => el("span", { class: `rmpill ${tone}`, text });

function field(label, control, hint, id) {
  return el("div", { class: "dofield", ...(id ? { id } : {}) }, [
    el("label", { text: label }),
    control,
    ...(hint ? [el("div", { class: "muted sm", text: hint })] : []),
  ]);
}

function select(id, options, value) {
  const node = el("select", { id }, options.map(([v, label]) => el("option", { value: v, text: label })));
  node.value = value;
  return node;
}

/** The settings form: address, method, format, sign-in, its secret, and the reference back. */
function settingsCard(state, reload) {
  const s = state.settings;
  const url = el("input", { type: "url", id: "do-url", value: s.url, placeholder: "https://erp.example.com/api/ap/invoices" });
  const method = select("do-method", [["POST", "POST"], ["PUT", "PUT"]], s.method);
  const format = select("do-format", [["vf_json", t("httpsout.format.vf_json")], ["csv", t("httpsout.format.csv")]], s.format);
  const auth = select(
    "do-auth",
    ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"].map((a) => [a, t(`httpsout.auth.${a}`)]),
    s.auth.type
  );
  const header = el("input", { type: "text", id: "do-header", value: s.auth.header ?? "X-API-Key" });
  const username = el("input", { type: "text", id: "do-username", value: s.auth.username ?? "" });
  const tokenUrl = el("input", { type: "url", id: "do-tokenurl", value: s.auth.tokenUrl ?? "" });
  const clientId = el("input", { type: "text", id: "do-clientid", value: s.auth.clientId ?? "" });
  const scope = el("input", { type: "text", id: "do-scope", value: s.auth.scope ?? "" });
  const secret = el("input", { type: "password", id: "do-secret", autocomplete: "new-password" });
  const reference = el("input", { type: "text", id: "do-reference", value: s.referencePath ?? "", placeholder: "$.id" });
  const problem = el("div", { class: "warn", id: "do-problem" });
  const saved = el("div", { class: "muted sm", id: "do-saved" });

  const secretName = { api_key_header: "key", bearer: "token", basic: "password", oauth2_client_credentials: "client_secret" };
  const authFields = el("div", { class: "dotwo" });
  const drawAuth = () => {
    const type = auth.value;
    const name = secretName[type];
    const setAt = name ? state.secrets[name] : null;
    secret.placeholder = setAt ? t("httpsout.secretset").replace("{when}", when(setAt)) : t("httpsout.secretnotset");
    authFields.replaceChildren(
      ...(type === "api_key_header" ? [field(t("httpsout.header"), header)] : []),
      ...(type === "basic" ? [field(t("httpsout.username"), username)] : []),
      ...(type === "oauth2_client_credentials" ? [field(t("httpsout.tokenurl"), tokenUrl), field(t("httpsout.clientid"), clientId), field(t("httpsout.scope"), scope)] : []),
      ...(name ? [field(t(`httpsout.secret.${name}`), secret, t("httpsout.secrethint"))] : [])
    );
  };
  auth.onchange = drawAuth;
  drawAuth();

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      saved.textContent = "";
      const settings = {
        url: url.value,
        method: method.value,
        format: format.value,
        referencePath: reference.value,
        auth: {
          type: auth.value,
          header: header.value,
          username: username.value,
          tokenUrl: tokenUrl.value,
          clientId: clientId.value,
          scope: scope.value,
        },
      };
      const result = await call(`/api/route-instances/${encodeURIComponent(state.instance.id)}/connector`, json("PUT", { settings, secret: secret.value }));
      if (!result.ok) {
        problem.textContent = why(result.body);
        return;
      }
      await reload();
      const again = document.getElementById("do-saved");
      if (again) again.textContent = t("httpsout.saved");
    },
  });

  return el("div", { class: "docard", id: "do-settings" }, [
    el("div", { class: "cardhead" }, [el("h4", { text: t("httpsout.settings") }), el("div", { class: "dobuttons" }, [save])]),
    el("div", { class: "dotwo" }, [field(t("httpsout.url"), url), field(t("httpsout.method"), method)]),
    el("div", { class: "dotwo" }, [field(t("httpsout.formatlabel"), format, t("httpsout.formathint")), field(t("httpsout.authlabel"), auth)]),
    authFields,
    field(t("httpsout.reference"), reference, t("httpsout.referencehint")),
    problem,
    saved,
  ]);
}

/** Try it with a real invoice: see exactly what would be sent, then send it if wanted. */
function tryCard(state, reload) {
  const result = el("div", { id: "do-result" });
  if (state.candidates.length === 0) {
    return el("div", { class: "docard", id: "do-try" }, [el("h4", { text: t("httpsout.try") }), el("p", { class: "muted sm", text: t("httpsout.nocandidates") })]);
  }
  const pick = select(
    "do-invoice",
    state.candidates.map((c) => [c.id, `${c.number ?? c.id} · ${c.supplier ?? "—"}${c.total !== null ? ` · ${c.currency ?? ""} ${c.total}` : ""}`]),
    state.candidates[0].id
  );
  const preview = actionLink("expand", {
    label: t("httpsout.preview"),
    onclick: async () => {
      const r = await call(`/api/route-instances/${encodeURIComponent(state.instance.id)}/connector/preview`, json("POST", { invoiceId: pick.value }));
      if (!r.ok) {
        result.replaceChildren(el("div", { class: "warn", text: why(r.body) }));
        return;
      }
      const headers = Object.entries(r.body.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
      result.replaceChildren(
        ...r.body.checks.map((c) => el("div", { class: "warn sm", text: t(`httpsout.check.${c}`) })),
        el("pre", { class: "httpspre", id: "do-preview", text: `${r.body.method} ${r.body.url}\n${headers}\n\n${r.body.body}` }),
        el("p", { class: "muted sm", text: t("httpsout.previewhint") })
      );
    },
  });
  const send = actionLink("post", {
    label: t("httpsout.send"),
    onclick: async () => {
      const r = await call(`/api/route-instances/${encodeURIComponent(state.instance.id)}/connector/send`, json("POST", { invoiceId: pick.value }));
      if (!r.ok) {
        result.replaceChildren(el("div", { class: "warn", text: why(r.body) }));
        return;
      }
      await reload();
      const again = document.getElementById("do-result");
      if (again) again.replaceChildren(outcomeLine(r.body));
    },
  });
  return el("div", { class: "docard", id: "do-try" }, [
    el("div", { class: "cardhead" }, [el("h4", { text: t("httpsout.try") }), el("div", { class: "dobuttons" }, [preview, send])]),
    el("p", { class: "muted sm", text: t("httpsout.tryhint") }),
    field(t("httpsout.invoice"), pick),
    result,
  ]);
}

function outcomeLine(o) {
  if (o.status === "delivered") {
    return el("div", { class: "ok", id: "do-outcome", text: t("httpsout.outcome.delivered").replace("{status}", String(o.httpStatus)) + (o.reference ? ` ${t("httpsout.outcome.reference").replace("{ref}", o.reference)}` : "") });
  }
  const reason = o.httpStatus ? `HTTP ${o.httpStatus}: ${o.error ?? ""}` : (o.error ?? "");
  return el("div", { class: "warn", id: "do-outcome", text: t(`httpsout.outcome.${o.status}`).replace("{why}", reason) });
}

const STATUS_TONE = { delivered: "ok", failed: "bad", retrying: "warn", pending: "q" };

/**
 * A Destination's deliveries. HTTPS out's offer Send again; the ERP CSV
 * file's (decision 0586) are its exports, each named, undone from the
 * ERP export screen.
 */
function deliveriesCard(state, reload, erp = false) {
  const rows = state.deliveries.map((d) =>
    el("tr", {}, [
      el("td", { text: d.invoiceNumber ?? d.invoiceId }),
      el("td", { text: d.supplier ?? "" }),
      el("td", {}, [pill(STATUS_TONE[d.status] ?? "q", t(`httpsout.status.${d.status}`))]),
      el("td", {
        text:
          d.status === "delivered"
            ? `${when(d.deliveredAt)}${d.reference ? ` · ${erp ? t("erpout.export").replace("{id}", String(d.reference).slice(0, 8)) : d.reference}` : ""}`
            : d.status === "retrying"
              ? t("httpsout.nexttry").replace("{when}", when(d.nextAttemptAt)).replace("{n}", String(d.attempts))
              : `${d.lastStatus ? `HTTP ${d.lastStatus} · ` : ""}${d.lastError ?? ""}`,
      }),
      el(
        "td",
        { class: "httpsactions" },
        !erp && (d.status === "failed" || d.status === "retrying")
          ? [
              actionLink("post", {
                label: t("httpsout.sendagain"),
                onclick: async () => {
                  await call(`/api/route-instances/${encodeURIComponent(state.instance.id)}/connector/send`, json("POST", { invoiceId: d.invoiceId }));
                  await reload();
                },
              }),
            ]
          : []
      ),
    ])
  );
  return el("div", { class: "docard", id: "do-deliveries" }, [
    el("h4", { text: t("httpsout.deliveries") }),
    state.deliveries.length === 0
      ? el("p", { class: "muted sm", text: t("httpsout.nodeliveries") })
      : el("table", { class: "httpskeys" }, [
          el("thead", {}, [el("tr", {}, ["httpsout.col.invoice", "httpsout.col.supplier", "httpsout.col.status", "httpsout.col.detail", null].map((k) => el("th", { text: k ? t(k) : "" })))]),
          el("tbody", {}, rows),
        ]),
    el("p", { class: "muted sm", text: t(erp ? "erpout.deliverieshint" : "httpsout.deliverieshint") }),
  ]);
}

/** **The ERP CSV file's deliveries — decision 0586**: each invoice its exports took, on the same ledger as HTTPS out. */
export function erpDeliveriesSection(destination) {
  const holder = el("div", { class: "httpsin", id: "erpout" }, [el("div", { class: "muted", text: t("httpsout.loading") })]);
  (async () => {
    const r = await call(`/api/route-instances/${encodeURIComponent(destination.id)}/deliveries`);
    if (!r.ok) {
      holder.replaceChildren(el("div", { class: "warn", text: t("httpsout.failed") }));
      return;
    }
    holder.replaceChildren(deliveriesCard({ instance: { id: destination.id }, deliveries: r.body.deliveries }, async () => {}, true));
  })();
  return holder;
}

/** Start sending: what is already waiting is sent only if the person says so. */
function openStart(state, onStarted) {
  const only = el("input", { type: "radio", name: "do-start", id: "do-start-new", checked: "checked" });
  const all = el("input", { type: "radio", name: "do-start", id: "do-start-all" });
  const problem = el("div", { class: "warn" });
  const close = () => backdrop.remove();
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout dostartpop", role: "dialog", "aria-label": t("httpsout.start") }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("httpsout.start") }),
        el("div", { class: "statebuttons" }, [
          actionLink("release", {
            primary: true,
            label: t("httpsout.start"),
            onclick: async () => {
              const r = await call(`/api/route-instances/${encodeURIComponent(state.instance.id)}/connector/start`, json("POST", { includeWaiting: all.checked }));
              if (!r.ok) {
                problem.textContent = why(r.body);
                return;
              }
              close();
              await onStarted();
            },
          }),
          actionLink("close", { label: t("httpsout.cancel"), onclick: close }),
        ]),
      ]),
      el("p", { class: "muted sm", text: t("httpsout.startsub") }),
      el("label", { class: "httpscheck", for: "do-start-new" }, [only, el("span", { text: t("httpsout.startnew").replace("{n}", String(state.waitingNotTaken)) })]),
      el("label", { class: "httpscheck", for: "do-start-all" }, [all, el("span", { text: t("httpsout.startall").replace("{n}", String(state.waitingNotTaken)) })]),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
}

/** The HTTPS out section of a Destination panel. `onChanged` reloads the flow (its cards' counts). */
export function httpsOutSection(destination, onChanged) {
  const holder = el("div", { class: "httpsin", id: "httpsout" }, [el("div", { class: "muted", text: t("httpsout.loading") })]);
  const reload = async () => {
    const r = await call(`/api/route-instances/${encodeURIComponent(destination.id)}/connector`);
    if (!r.ok) {
      holder.replaceChildren(el("div", { class: "warn", text: t("httpsout.failed") }));
      return;
    }
    const state = r.body;
    const startBlock = state.instance.startedAt
      ? []
      : [
          el("div", { class: "dostart", id: "do-notstarted" }, [
            el("div", {}, [el("strong", { text: t("httpsout.notstarted") }), el("div", { class: "muted sm", text: t("httpsout.notstartedhint") })]),
            actionLink("release", { primary: true, label: t("httpsout.start"), onclick: () => openStart(state, onChanged) }),
          ]),
        ];
    holder.replaceChildren(
      el("div", { class: "cardhead httpshead" }, [el("h4", { text: t("httpsout.heading") })]),
      ...startBlock,
      settingsCard(state, reload),
      tryCard(state, reload),
      deliveriesCard(state, reload)
    );
  };
  reload();
  return holder;
}

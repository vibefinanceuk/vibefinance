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
  // Decision 0589: what its connector keeps fixed, and the ways of signing in it allows.
  const fixed = state.connector?.fixed ?? [];
  const authTypes = state.connector?.authTypes ?? ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"];
  const method = select("do-method", [["POST", "POST"], ["PUT", "PUT"]], s.method);
  // Decision 0591: its own layout, once one is published.
  const formats = [["vf_json", t("httpsout.format.vf_json")], ["csv", t("httpsout.format.csv")]];
  if (state.mapping?.live || s.format === "mapped") formats.push(["mapped", t("httpsout.format.mapped")]);
  const format = select("do-format", formats, s.format);
  if (fixed.includes("method")) method.disabled = true;
  if (fixed.includes("format")) format.disabled = true;
  const auth = select(
    "do-auth",
    authTypes.map((a) => [a, t(`httpsout.auth.${a}`)]),
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
        // Decision 0591: what its own mapping cannot lay out. It will not be sent.
        ...(r.body.problems ?? []).map((p) => el("div", { class: "warn sm doproblem", text: `${t("outmap.notsent")} ${p}` })),
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

/**
 * **Which connector it runs, and its version — decision 0589**, with
 * Upgrade where the library has a later one: what the connector fixes is
 * applied, and the Destination's own settings stay.
 */
function connectorLine(destination, connector, reload) {
  const name = t(`connector.${connector.id}.name`);
  const result = el("span", { class: "muted sm", id: "do-upgraded" });
  return el("div", { class: "doconnector", id: "do-connector" }, [
    el("span", { text: t("library.connectorline").replace("{name}", name).replace("{v}", String(connector.version)) }),
    ...(connector.upgradeAvailable
      ? [
          el("span", { class: "rmpill warn", text: t("library.upgradeto").replace("{n}", String(connector.latestVersion)) }),
          actionLink("release", {
            label: t("library.upgrade"),
            onclick: async () => {
              const r = await call(`/api/route-instances/${encodeURIComponent(destination.id)}/connector/upgrade`, { method: "POST" });
              if (!r.ok) {
                result.textContent = why(r.body);
                return;
              }
              await reload();
              const again = document.getElementById("do-upgraded");
              if (again && r.body.authChanged) again.textContent = t("library.authchanged");
            },
          }),
        ]
      : []),
    result,
  ]);
}

/**
 * **How each invoice is laid out — decision 0591.** The standard
 * VibeFinance invoice JSON, until the Destination has its own mapping:
 * Make my own copy starts one, and Open the mapping edits it.
 */
function mappingCard(state, destination) {
  const m = state.mapping ?? { live: null, draft: null };
  const fixed = (state.connector?.fixed ?? []).includes("format");
  const result = el("div", { class: "warn", id: "do-mappingproblem" });
  const openEditor = async () => {
    const { open } = await import("/outbound-editor.js");
    await open(destination.id);
  };
  const has = m.live !== null || m.draft !== null;
  const status = !has
    ? t("outmap.card.standard")
    : [
        m.live !== null ? t("outmap.card.live").replace("{n}", String(m.live)) : "",
        m.draft !== null ? t("outmap.card.draft").replace("{n}", String(m.draft)) : "",
        m.live !== null ? t(state.settings.format === "mapped" ? "outmap.card.sending" : "outmap.card.notsending") : "",
      ]
        .filter(Boolean)
        .join(" · ");
  const button = fixed
    ? []
    : has
      ? [actionLink("coding", { label: t("outmap.card.open"), onclick: openEditor })]
      : [
          actionLink("startdraft", {
            label: t("outmap.card.copy"),
            onclick: async () => {
              const r = await call(`/api/route-instances/${encodeURIComponent(destination.id)}/mapping/copy`, { method: "POST" });
              if (!r.ok) {
                result.textContent = why(r.body);
                return;
              }
              await openEditor();
            },
          }),
        ];
  return el("div", { class: "docard", id: "do-mapping" }, [
    el("div", { class: "cardhead" }, [el("h4", { text: t("outmap.card.heading") }), el("div", { class: "dobuttons" }, button)]),
    el("p", { class: "sm", id: "do-mappingstatus", text: status }),
    el("p", { class: "muted sm", text: t(fixed ? "outmap.card.fixed" : "outmap.card.hint") }),
    result,
  ]);
}

const SUBMISSION_TONE = { submitted: "warn", approved: "ok", returned: "bad", withdrawn: "q" };

/**
 * **Submit for review — decision 0595.** Only in a partner's sandbox:
 * this Destination, with its settings and published mapping, sent to
 * VibeFinance as a connector for the partner's customers. Its versions
 * and their review, Withdraw while one waits, and the form to submit.
 */
function submissionCard(destination) {
  const holder = el("div", { class: "docard", id: "do-submission", hidden: "" });
  const base = `/api/route-instances/${encodeURIComponent(destination.id)}/library-submission`;
  const draw = async (note) => {
    const r = await call(base);
    if (!r.ok || !r.body?.partner) {
      holder.hidden = true;
      return;
    }
    holder.hidden = false;
    const s = r.body;
    const d = s.destination;
    const versions = s.connector?.versions ?? [];
    const waiting = versions.find((v) => v.status === "submitted");
    const result = el("div", { class: "warn", id: "do-submitproblem", ...(note ? { text: note } : {}) });

    const rows = versions.map((v) =>
      el("tr", {}, [
        el("td", { text: `${t("submit.version")} ${v.version}` }),
        el("td", {}, [pill(SUBMISSION_TONE[v.status] ?? "q", t(`submit.status.${v.status}`))]),
        el("td", { class: "sm", text: `${when(v.submittedAt)} · ${v.submittedBy}` }),
        el("td", { class: "sm", text: v.status === "returned" && v.reviewReason ? v.reviewReason : v.audience === "all" ? t("submit.audience.all") : v.audience.map((id) => s.customers.find((c) => c.id === id)?.name ?? id).join(", ") }),
        el("td", {}, v.status === "submitted" && s.canSubmit
          ? [actionLink("discard", { label: t("submit.withdraw"), onclick: async () => {
              const w = await call(`${base}/withdraw`, json("POST", { version: v.version }));
              await draw(w.ok ? t("submit.withdrawn") : why(w.body));
            } })]
          : []),
      ])
    );

    const blocks = [];
    for (const p of d.problems) blocks.push(el("div", { class: "warn sm", text: t(`submit.problem.${p}`) }));
    if (d.draftNotPublished) blocks.push(el("div", { class: "muted sm", text: t("submit.draftnote").replace("{n}", String(d.draftNotPublished)) }));
    if (!s.canSubmit) blocks.push(el("div", { class: "muted sm", text: t(s.partner.status === "active" ? "submit.notperson" : "submit.suspended").replace("{partner}", s.partner.name) }));

    let form = null;
    let submit = null;
    if (s.canSubmit && !waiting && d.problems.length === 0) {
      const name = el("input", { type: "text", id: "do-sub-name", value: s.connector?.name ?? d.name ?? "" });
      const description = el("textarea", { id: "do-sub-description", rows: "3" });
      description.value = versions[0]?.description ?? "";
      const notes = el("textarea", { id: "do-sub-notes", rows: "2" });
      const docs = el("input", { type: "url", id: "do-sub-docs", placeholder: "https://" });
      /** A box with its words beside it, on one line. */
      const check = (id, label, checked, type = "checkbox", name = undefined) => {
        const box = el("input", { type, id, ...(name ? { name } : {}) });
        box.checked = checked;
        return { box, node: el("label", { class: "docheck" }, [box, el("span", { text: label })]) };
      };
      const fixedMethod = check("do-sub-fixmethod", t("httpsout.method"), false);
      const fixedFormat = check("do-sub-fixformat", t("httpsout.formatlabel"), d.format === "mapped");
      const auths = ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"].map((a) => [a, check(`do-sub-auth-${a}`, t(`httpsout.auth.${a}`), a === d.authType)]);
      const everyone = check("do-sub-all", `${t("submit.audience.all")} (${s.customers.length})`, true, "radio", "do-sub-aud");
      const chosen = check("do-sub-some", t("submit.audience.some"), false, "radio", "do-sub-aud");
      const customers = s.customers.map((c) => [c.id, check(`do-sub-c-${c.id}`, c.name, false)]);
      form = el("div", { class: "dosubform" }, [
        el("div", { class: "dotwo" }, [field(t("submit.name"), name), field(t("submit.docs"), docs)]),
        field(t("submit.description"), description, t("submit.descriptionhint")),
        field(t("submit.notes"), notes, t("submit.noteshint")),
        el("div", { class: "dotwo" }, [
          field(t("submit.fixed"), el("div", {}, [fixedMethod.node, fixedFormat.node]), t("submit.fixedhint")),
          field(t("submit.auths"), el("div", {}, auths.map(([, c]) => c.node))),
        ]),
        field(
          t("submit.audience"),
          el("div", {}, [everyone.node, chosen.node, el("div", { class: "dosubcustomers" }, customers.map(([, c]) => c.node))])
        ),
      ]);
      submit = actionLink("publish", {
        primary: true,
        label: t(versions.length ? "submit.again" : "submit.submit").replace("{n}", String((versions[0]?.version ?? 0) + 1)),
        onclick: async () => {
          const audience = chosen.box.checked ? customers.filter(([, c]) => c.box.checked).map(([id]) => id) : "all";
          const r2 = await call(
            base,
            json("POST", {
              name: name.value,
              description: description.value,
              notes: notes.value,
              vendorDocs: docs.value,
              audience,
              fixed: [...(fixedMethod.box.checked ? ["method"] : []), ...(fixedFormat.box.checked ? ["format"] : [])],
              authTypes: auths.filter(([, c]) => c.box.checked).map(([a]) => a),
            })
          );
          await draw(r2.ok ? t("submit.sent").replace("{n}", String(r2.body.version)) : why(r2.body));
        },
      });
    }

    holder.replaceChildren(
      el("div", { class: "cardhead" }, [el("h4", { text: t("submit.heading") }), el("div", { class: "dobuttons" }, submit ? [submit] : [])]),
      el("p", { class: "muted sm", text: t("submit.hint").replace("{partner}", s.partner.name) }),
      ...blocks,
      ...(rows.length > 0 ? [el("table", { class: "dotable", id: "do-sub-versions" }, [el("tbody", {}, rows)])] : []),
      ...(form ? [form] : []),
      result
    );
  };
  draw();
  return holder;
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
      ...(state.connector ? [connectorLine(destination, state.connector, reload)] : []),
      ...startBlock,
      settingsCard(state, reload),
      mappingCard(state, destination),
      // Decision 0595: in a partner's sandbox only.
      submissionCard(destination),
      tryCard(state, reload),
      deliveriesCard(state, reload)
    );
  };
  reload();
  return holder;
}

/** "All business units", or the units' names. */
export function unitsSummary(unitIds, units) {
  if (!unitIds || unitIds.length === 0) return t("destunits.all");
  return unitIds.map((id) => units.find((u) => u.id === id)?.name ?? id).join(", ");
}

/** The units in tree order, each with its depth, so the picker indents children under their parent. */
function asTree(units) {
  const children = new Map();
  for (const u of units) children.set(u.parentUnitId ?? null, [...(children.get(u.parentUnitId ?? null) ?? []), u]);
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  const seen = new Set();
  const walk = (parent, depth) => {
    for (const u of children.get(parent) ?? []) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  // Any whose parent is not in the list.
  for (const u of units) if (!seen.has(u.id)) out.push({ ...u, depth: 0 });
  return out;
}

/**
 * **Which business units a Destination sends for — decision 0587.** The
 * summary, and Choose: all units, or some (each with the units beneath
 * it). Adding units to a started HTTPS out Destination asks first about
 * invoices already waiting in them, as Start sending did (0585).
 */
export function unitsField(destination, units, onChanged) {
  const summary = el("span", { id: "du-summary", text: unitsSummary(destination.unitIds, units) });
  const choose = actionLink("rename", { label: t("destunits.choose"), onclick: () => openUnits(destination, units, onChanged) });
  return el("div", { class: "duline" }, [summary, choose]);
}

function openUnits(destination, units, onChanged) {
  const chosen = new Set(destination.unitIds ?? []);
  const all = el("input", { type: "checkbox", id: "du-all", ...(chosen.size === 0 ? { checked: "checked" } : {}) });
  const boxes = asTree(units).map((u) => {
    const box = el("input", { type: "checkbox", value: u.id, ...(chosen.has(u.id) ? { checked: "checked" } : {}) });
    box.onchange = () => {
      if (box.checked) all.checked = false;
    };
    return { box, row: el("label", { class: "httpscheck", style: `padding-left:${u.depth * 18}px` }, [box, el("span", { text: u.name })]) };
  });
  all.onchange = () => {
    if (all.checked) for (const b of boxes) b.box.checked = false;
  };
  const problem = el("div", { class: "warn", id: "du-problem" });
  const decide = el("div", { id: "du-decide" });
  let includeWaiting;
  const close = () => backdrop.remove();
  const save = async () => {
    problem.textContent = "";
    const unitIds = all.checked ? null : boxes.filter((b) => b.box.checked).map((b) => b.box.value);
    if (unitIds && unitIds.length === 0) {
      problem.textContent = t("destunits.chooseone");
      return;
    }
    const body = { unitIds, ...(includeWaiting === undefined ? {} : { includeWaiting }) };
    const r = await call(`/api/route-instances/${encodeURIComponent(destination.id)}/units`, json("PUT", body));
    if (r.status === 409 && r.body?.reason === "decide_waiting") {
      const only = el("input", { type: "radio", name: "du-waiting", id: "du-setaside", checked: "checked" });
      const send = el("input", { type: "radio", name: "du-waiting", id: "du-sendtoo" });
      decide.replaceChildren(
        el("p", { class: "warn", text: t("destunits.waiting").replace("{n}", String(r.body.waiting)) }),
        el("label", { class: "httpscheck", for: "du-setaside" }, [only, el("span", { text: t("destunits.setaside") })]),
        el("label", { class: "httpscheck", for: "du-sendtoo" }, [send, el("span", { text: t("destunits.sendtoo") })])
      );
      includeWaiting = false;
      only.onchange = () => (includeWaiting = false);
      send.onchange = () => (includeWaiting = true);
      return;
    }
    if (!r.ok) {
      problem.textContent = why(r.body);
      return;
    }
    close();
    await onChanged();
  };
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout dounitspop", role: "dialog", "aria-label": t("destunits.title") }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("destunits.title") }),
        el("div", { class: "statebuttons" }, [actionLink("save", { primary: true, onclick: save }), actionLink("close", { label: t("httpsout.cancel"), onclick: close })]),
      ]),
      el("p", { class: "muted sm", text: t("destunits.sub") }),
      el("label", { class: "httpscheck" }, [all, el("strong", { text: t("destunits.all") })]),
      el("div", { class: "dounits" }, boxes.map((b) => b.row)),
      decide,
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
}

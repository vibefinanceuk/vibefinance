import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **HTTPS in, on a Source instance — decision 0578**, from the mock-up
 * Dan approved on 1 October: the address a sender's system posts invoices
 * to, the keys that may send (named, shown once, revocable), and how to
 * send. Shown in the Source panel on Process routes for an HTTPS source.
 */

async function getJson(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function when(iso) {
  if (!iso) return t("httpsin.never");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function copyButton(text) {
  return actionLink("duplicate", {
    label: t("httpsin.copy"),
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Selecting it by hand still works.
      }
    },
  });
}

function popout(title, body, buttons) {
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout httpspop", role: "dialog", "aria-label": title }, [
      el("div", { class: "cardhead" }, [el("h3", { text: title }), el("div", { class: "statebuttons" }, buttons(() => backdrop.remove()))]),
      ...body,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  return backdrop;
}

/** Make a key: a name, then the key itself, shown this once. */
function openMakeKey(source, reload) {
  const name = el("input", { type: "text", id: "httpsin-keyname", placeholder: t("httpsin.keynameexample") });
  const problem = el("div", { class: "warn", id: "httpsin-problem" });
  const body = el("div", {}, [
    el("p", { class: "muted sm", text: t("httpsin.makekeysub").replace("{source}", source.name) }),
    el("div", { class: "kf" }, [el("label", { for: "httpsin-keyname", text: t("httpsin.keyname") }), name]),
    problem,
  ]);
  const backdrop = popout(t("httpsin.makekey"), [body], (close) => [
    actionLink("create", {
      primary: true,
      label: t("httpsin.make"),
      onclick: async () => {
        problem.textContent = "";
        const result = await getJson(`/api/sources/${encodeURIComponent(source.id)}/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.value }),
        });
        if (!result.ok) {
          problem.textContent = result.body?.error ?? t("httpsin.failed");
          return;
        }
        showKeyOnce(backdrop, body, result.body.key, close, reload);
      },
    }),
    actionLink("close", { onclick: close }),
  ]);
  name.focus();
}

/** The new key, shown this once: the key and its Copy, and Done. — decisions 0578, 0581 */
function showKeyOnce(backdrop, body, key, close, reload) {
  body.replaceChildren(
    el("p", { class: "warn", text: t("httpsin.onlyonce") }),
    el("div", { class: "httpscopy" }, [el("code", { id: "httpsin-newkey", text: key }), copyButton(key)])
  );
  backdrop.querySelector(".statebuttons").replaceChildren(
    actionLink("done", {
      primary: true,
      label: t("httpsin.done"),
      onclick: () => {
        close();
        reload();
      },
    })
  );
}

/**
 * **Replace a key — decision 0581.** A new key with the same name, so a
 * mapping's Who it is for still names the sender. The old key works for
 * 24 hours unless Stop the old key now is ticked.
 */
function openReplace(source, key, reload) {
  const stopNow = el("input", { type: "checkbox", id: "httpsin-stopnow" });
  const problem = el("div", { class: "warn" });
  const body = el("div", {}, [
    el("p", { class: "muted sm", text: t("httpsin.replacesub").replaceAll("{name}", key.name) }),
    el("label", { class: "httpscheck", for: "httpsin-stopnow" }, [stopNow, el("span", { text: t("httpsin.stopnow") })]),
    el("p", { class: "muted sm", text: t("httpsin.stopnowhint") }),
    problem,
  ]);
  const backdrop = popout(t("httpsin.replacetitle"), [body], (close) => [
    actionLink("rotate", {
      primary: true,
      label: t("httpsin.replace"),
      onclick: async () => {
        problem.textContent = "";
        const result = await getJson(`/api/sources/${encodeURIComponent(source.id)}/keys/${encodeURIComponent(key.id)}/replace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stopNow: stopNow.checked }),
        });
        if (!result.ok) {
          problem.textContent = result.body?.error ?? t("httpsin.failed");
          return;
        }
        showKeyOnce(backdrop, body, result.body.key, close, reload);
      },
    }),
    actionLink("close", { label: t("httpsin.cancel"), onclick: close }),
  ]);
}

function confirmRevoke(source, key, reload) {
  const problem = el("div", { class: "warn" });
  popout(t("httpsin.revoketitle"), [el("p", { text: t("httpsin.revokesub").replace("{name}", key.name) }), problem], (close) => [
    actionLink("retire", {
      primary: true,
      label: t("httpsin.revoke"),
      onclick: async () => {
        const result = await getJson(`/api/sources/${encodeURIComponent(source.id)}/keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
        if (!result.ok) {
          problem.textContent = result.body?.error ?? t("httpsin.failed");
          return;
        }
        close();
        reload();
      },
    }),
    actionLink("close", { label: t("httpsin.cancel"), onclick: close }),
  ]);
}

function render(holder, source, data, reload) {
  if (!data) {
    holder.replaceChildren(el("div", { class: "muted", text: t("httpsin.failed") }));
    return;
  }
  const nowIso = new Date().toISOString();
  const rows = data.keys.map((k) => {
    // Decision 0581: a replaced key works until its expiry, then has stopped.
    const stopped = Boolean(k.revokedAt) || (k.expiresAt != null && k.expiresAt <= nowIso);
    const replacing = !stopped && k.replacedBy != null;
    const state = k.revokedAt
      ? t("httpsin.revokedon").replace("{when}", when(k.revokedAt))
      : stopped
        ? t("httpsin.stoppedon").replace("{when}", when(k.expiresAt))
        : replacing
          ? t("httpsin.replacedstops").replace("{when}", when(k.expiresAt))
          : when(k.lastUsedAt);
    const actions =
      stopped || source.status === "retired"
        ? []
        : [
            ...(replacing ? [] : [actionLink("rotate", { label: t("httpsin.replace"), onclick: () => openReplace(source, k, reload) })]),
            actionLink("retire", { label: t("httpsin.revoke"), onclick: () => confirmRevoke(source, k, reload) }),
          ];
    return el("tr", { class: stopped ? "httpsrevoked" : replacing ? "httpsreplaced" : "" }, [
      el("td", { text: k.name }),
      el("td", {}, [el("code", { text: `${k.prefix}…` })]),
      el("td", { text: `${when(k.createdAt)}${k.createdBy ? ` · ${k.createdBy}` : ""}` }),
      el("td", { text: state }),
      el("td", { class: "httpsactions" }, actions),
    ]);
  });
  // Decision 0581: the example names no key's start, which looked like a key to paste.
  const example = `curl -X POST "${data.address}" \\\n  -H "Authorization: Bearer <your key>" \\\n  -H "Content-Type: application/xml" \\\n  -H "X-Filename: Rechnung_88240.xml" \\\n  --data-binary @Rechnung_88240.xml`;
  holder.replaceChildren(
    el("div", { class: "cardhead httpshead" }, [
      el("h4", { text: t("httpsin.heading") }),
      el("div", { class: "httpsbuttons" }, source.status === "retired" ? [] : [actionLink("addcard", { label: t("httpsin.makekey"), onclick: () => openMakeKey(source, reload) })]),
    ]),
    el("div", { class: "httpsfield" }, [
      el("label", { text: t("httpsin.address") }),
      el("div", { class: "httpscopy" }, [el("code", { id: "httpsin-address", text: `POST ${data.address}` }), copyButton(data.address)]),
    ]),
    el("div", { class: "httpsfield" }, [
      el("label", { text: t("httpsin.keys") }),
      data.keys.length === 0
        ? el("div", { class: "muted sm", id: "httpsin-nokeys", text: t("httpsin.nokeys") })
        : el("table", { class: "httpskeys" }, [
            el("thead", {}, [el("tr", {}, ["httpsin.colname", "httpsin.colkey", "httpsin.colmade", "httpsin.colused", null].map((k) => el("th", { text: k ? t(k) : "" })))]),
            el("tbody", {}, rows),
          ]),
      el("div", { class: "muted sm", text: t("httpsin.keyshint") }),
    ]),
    el("div", { class: "httpsfield" }, [
      el("label", { text: t("httpsin.howto") }),
      el("pre", { class: "httpspre", text: example }),
      el("div", { class: "muted sm", text: t("httpsin.howtohint") }),
    ]),
  );
}

/** The HTTPS section of a Source panel: loads its address and keys, and keeps itself up to date. */
export function httpsSection(source) {
  const holder = el("div", { class: "httpsin", id: "httpsin" }, [el("div", { class: "muted", text: t("httpsin.loading") })]);
  const reload = async () => {
    const result = await getJson(`/api/sources/${encodeURIComponent(source.id)}/keys`);
    render(holder, source, result.ok ? result.body : null, reload);
  };
  reload();
  return holder;
}

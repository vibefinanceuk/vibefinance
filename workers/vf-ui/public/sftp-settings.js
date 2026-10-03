import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **SFTP, on a Destination or a Source — decision 0620**, the proof of
 * concept. The server, the user and its password or private key, the
 * folder; for SFTP out the file's format and name, for SFTP in which
 * files to collect and where they are moved. *Test connection* signs in
 * and lists the folder, and the first success keeps the server's
 * identity, shown here with *Forget*. On a Source, *Check now* collects
 * what is waiting.
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

/** A refusal in words: the reason's own string where there is one, else what the server said. */
function why(body) {
  const code = body?.reason ?? body?.code;
  const key = code ? `sftp.error.${code}` : null;
  const words = key ? t(key) : null;
  return words && words !== key ? words : (body?.error ?? body?.message ?? t("sftp.failed"));
}

function field(label, control, hint) {
  return el("div", { class: "dofield" }, [el("label", { text: label }), control, ...(hint ? [el("div", { class: "muted sm", text: hint })] : [])]);
}

function select(id, options, value) {
  const node = el("select", { id }, options.map(([v, label]) => el("option", { value: v, text: label })));
  node.value = value;
  return node;
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const base = (id) => `/api/route-instances/${encodeURIComponent(id)}/sftp`;

/** The server's identity: kept, with Forget, or not yet confirmed. */
function identityLine(state, reload) {
  const key = state.settings.hostKey;
  if (!key) return el("div", { class: "warn sm", id: "sftp-identity", text: t("sftp.identity.none") });
  return el("div", { class: "sm sftpidentity", id: "sftp-identity" }, [
    el("span", { text: `${t("sftp.identity.kept")} ` }),
    el("code", { text: key }),
    actionLink("discard", {
      label: t("sftp.identity.forget"),
      onclick: async () => {
        await call(`${base(state.instance.id)}/forget-identity`, json("POST", {}));
        await reload();
      },
    }),
  ]);
}

/** What a test found, in words. */
function testResult(body, direction) {
  if (!body?.ok) {
    return el("div", { class: "warn", id: "sftp-tested" }, [
      el("div", { text: why(body) }),
      ...(body?.code === "host_key_changed" ? [el("div", { class: "sm", text: t("sftp.identity.changedhint") })] : []),
      ...(body?.message && why(body) !== body.message ? [el("div", { class: "muted sm", text: body.message })] : []),
    ]);
  }
  const lines = [t("sftp.tested.ok").replace("{folder}", body.folder).replace("{n}", String(body.files))];
  if (body.kept) lines.push(t("sftp.tested.kept").replace("{key}", body.hostKey));
  if (direction === "in") lines.push(t("sftp.tested.waiting").replace("{n}", String(body.waiting ?? 0)) + (body.sample?.length ? ` ${body.sample.join(", ")}` : ""));
  return el("div", { class: "ok", id: "sftp-tested" }, lines.map((text) => el("div", { text })));
}

/** What a Check now collected, file by file. */
function collectResult(body) {
  const rows = (body.collected ?? []).map((c) =>
    el("tr", {}, [
      el("td", { text: c.file }),
      el("td", {}, [el("span", { class: `rmpill ${c.status === "collected" ? "ok" : c.status === "skipped" ? "q" : "bad"}`, text: t(`sftp.collect.${c.status}`) })]),
      el("td", { class: "muted sm", text: c.status === "collected" ? t("sftp.collect.movedto").replace("{path}", c.movedTo ?? "") : (c.reason ?? "") }),
    ])
  );
  return el("div", { id: "sftp-collected" }, [
    el("div", { class: "sm", text: t("sftp.collect.summary").replace("{n}", String(body.collected?.length ?? 0)).replace("{matching}", String(body.matching ?? 0)) }),
    ...(rows.length ? [el("table", { class: "dotable" }, [el("tbody", {}, rows)])] : []),
    ...(body.left > 0 ? [el("div", { class: "muted sm", text: t("sftp.collect.left").replace("{n}", String(body.left)) })] : []),
  ]);
}

function settingsCard(state, reload, direction) {
  const s = state.settings;
  const host = el("input", { type: "text", id: "sftp-host", value: s.host, placeholder: "sftp.example.com" });
  const port = el("input", { type: "number", id: "sftp-port", value: String(s.port ?? 22), min: "1", max: "65535" });
  const username = el("input", { type: "text", id: "sftp-username", value: s.username ?? "" });
  const auth = select("sftp-auth", [["password", t("sftp.auth.password")], ["key", t("sftp.auth.key")]], s.auth ?? "password");
  const password = el("input", { type: "password", id: "sftp-password", autocomplete: "new-password" });
  const privateKey = el("textarea", { id: "sftp-key", rows: "4", placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----" });
  const folder = el("input", { type: "text", id: "sftp-folder", value: s.folder ?? "/", placeholder: "/to-erp" });
  const format = select("sftp-format", [["csv", t("httpsout.format.csv")], ["vf_json", t("httpsout.format.vf_json")]], s.format ?? "csv");
  const filename = el("input", { type: "text", id: "sftp-filename", value: s.filename ?? "{invoiceNumber}.{ext}" });
  const pattern = el("input", { type: "text", id: "sftp-pattern", value: s.pattern ?? "*", placeholder: "*.xml" });
  const doneFolder = el("input", { type: "text", id: "sftp-done", value: s.doneFolder ?? "processed" });
  const problem = el("div", { class: "warn", id: "sftp-problem" });
  const saved = el("div", { class: "muted sm", id: "sftp-saved" });

  const secretField = el("div");
  const drawSecret = () => {
    const name = auth.value === "key" ? "private_key" : "password";
    const setAt = state.secrets?.[name];
    const hint = setAt ? t("sftp.secretset").replace("{when}", when(setAt)) : t("sftp.secretnotset");
    secretField.replaceChildren(
      auth.value === "key" ? field(t("sftp.privatekey"), privateKey, `${hint} ${t("sftp.privatekeyhint")}`) : field(t("sftp.password"), password, hint)
    );
  };
  auth.onchange = drawSecret;
  drawSecret();

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      saved.textContent = "";
      const settings = {
        host: host.value,
        port: Number(port.value || 22),
        username: username.value,
        auth: auth.value,
        folder: folder.value,
        ...(direction === "out" ? { format: format.value, filename: filename.value } : { pattern: pattern.value, doneFolder: doneFolder.value }),
      };
      const secret = auth.value === "key" ? privateKey.value : password.value;
      const result = await call(base(state.instance.id), json("PUT", { settings, secret }));
      if (!result.ok) {
        problem.textContent = why(result.body);
        return;
      }
      await reload();
      const again = document.getElementById("sftp-saved");
      if (again) again.textContent = result.body.identityForgotten ? t("sftp.savedforgot") : t("sftp.saved");
    },
  });

  const tested = el("div", { id: "sftp-testresult" });
  const test = actionLink("release", {
    label: t("sftp.test"),
    onclick: async () => {
      tested.replaceChildren(el("div", { class: "muted sm", text: t("sftp.testing") }));
      const r = await call(`${base(state.instance.id)}/test`, json("POST", {}));
      if (r.body?.kept) await reload();
      const where = document.getElementById("sftp-testresult") ?? tested;
      where.replaceChildren(r.body ? testResult(r.body, direction) : el("div", { class: "warn", text: t("sftp.failed") }));
    },
  });

  return el("div", { class: "docard", id: "sftp-settings" }, [
    el("div", { class: "cardhead" }, [el("h4", { text: t("sftp.settings") }), el("div", { class: "dobuttons" }, [test, save])]),
    el("div", { class: "dotwo" }, [field(t("sftp.host"), host, t("sftp.hosthint")), field(t("sftp.port"), port)]),
    el("div", { class: "dotwo" }, [field(t("sftp.username"), username), field(t("sftp.authlabel"), auth)]),
    secretField,
    field(t(direction === "out" ? "sftp.folder.out" : "sftp.folder.in"), folder),
    ...(direction === "out"
      ? [el("div", { class: "dotwo" }, [field(t("httpsout.formatlabel"), format), field(t("sftp.filename"), filename, t("sftp.filenamehint"))])]
      : [el("div", { class: "dotwo" }, [field(t("sftp.pattern"), pattern, t("sftp.patternhint")), field(t("sftp.donefolder"), doneFolder, t("sftp.donefolderhint"))])]),
    identityLine(state, reload),
    problem,
    saved,
    tested,
  ]);
}

/**
 * The settings card alone, loaded for one SFTP route: for a Destination,
 * placed among HTTPS out's own cards (`destinations.js`); for a Source,
 * with *Check now* (`sftpInSection`).
 */
export function sftpSettingsCard(instanceId, direction) {
  const holder = el("div", { id: "sftp-card" }, [el("div", { class: "muted", text: t("sftp.loading") })]);
  const reload = async () => {
    const r = await call(base(instanceId));
    if (!r.ok) {
      holder.replaceChildren(el("div", { class: "warn", text: t("sftp.failed") }));
      return;
    }
    holder.replaceChildren(settingsCard(r.body, reload, direction));
  };
  reload();
  return holder;
}

/** An SFTP in Source's section: its settings, and Check now. */
export function sftpInSection(source) {
  const result = el("div", { id: "sftp-collect" });
  const check = actionLink("download", {
    primary: true,
    label: t("sftp.checknow"),
    onclick: async () => {
      result.replaceChildren(el("div", { class: "muted sm", text: t("sftp.checking") }));
      const r = await call(`${base(source.id)}/collect`, json("POST", {}));
      result.replaceChildren(r.ok ? collectResult(r.body) : el("div", { class: "warn", text: why(r.body) }));
    },
  });
  return el("div", { class: "httpsin", id: "sftpin" }, [
    el("div", { class: "cardhead httpshead" }, [el("h4", { text: t("sftp.in.heading") })]),
    el("p", { class: "muted sm", text: t("sftp.in.sub") }),
    sftpSettingsCard(source.id, "in"),
    el("div", { class: "docard", id: "sftp-checkcard" }, [
      el("div", { class: "cardhead" }, [el("h4", { text: t("sftp.collect.heading") }), el("div", { class: "dobuttons" }, [check])]),
      el("p", { class: "muted sm", text: t("sftp.collect.hint") }),
      result,
    ]),
  ]);
}

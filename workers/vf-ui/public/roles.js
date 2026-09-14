import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * Who can do what, where, and up to how much — decisions 0319, 0326.
 *
 * **Read-only half, decision 0319**: everything shown here already
 * existed only as raw database rows, reachable only by direct SQL —
 * this makes it visible.
 *
 * **Write half, decision 0326**: creating a role and editing what an
 * existing one grants, gated to `Admin.RoleManagement` — global-only,
 * on purpose, unlike assigning an existing role to a person, which
 * stays delegable (decision 0201) and has no UI here yet, deliberately
 * separate, later work. Permissions are offered as checkboxes drawn
 * from the real, closed vocabulary the backend itself returns, never
 * a free-text field — this session's own raw-SQL work caught a typo
 * (`AP.TaskManager` for `AP.TaskManage`) and a near-miss permission
 * name (`Admin.RoleManagement` for the existing `Admin.RuleManagement`)
 * by hand, more than once; a checkbox cannot be mistyped.
 */

let units = [];
let users = [];
let roles = [];
let assignments = [];
let authorityLimits = [];
let knownPermissions = [];

async function load() {
  try {
    const response = await fetch("/api/org/overview");
    if (!response.ok) {
      console.error(`/api/org/overview failed: ${response.status}`);
      return false;
    }

    const body = await response.json();
    units = body.units ?? [];
    users = body.users ?? [];
    roles = body.roles ?? [];
    assignments = body.assignments ?? [];
    authorityLimits = body.authorityLimits ?? [];
    knownPermissions = body.knownPermissions ?? [];
    return true;
  } catch (err) {
    console.error("/api/org/overview failed", err);
    return false;
  }
}

/**
 * **How deep a unit sits**, walking its own parent chain — the same
 * "indented list, not an invented tree widget" choice this app
 * already makes everywhere else a hierarchy needs showing.
 */
function unitDepth(unit) {
  let depth = 0;
  let current = unit;
  const seen = new Set();
  while (current?.parentUnitId && !seen.has(current.parentUnitId)) {
    seen.add(current.parentUnitId);
    current = units.find((u) => u.id === current.parentUnitId);
    depth++;
  }
  return depth;
}

function unitRow(unit) {
  return el("tr", {}, [
    el("td", {}, [el("span", { style: `padding-left: ${unitDepth(unit) * 20}px`, text: unit.name })]),
    el("td", { text: unit.kind }),
  ]);
}

/**
 * **Grouped by category, not a flat list of thirty** — the same
 * namespacing the permissions themselves already use (`AP.*`,
 * `Admin.*`, and so on), so a form offering all of them reads the
 * same way the vocabulary itself is organised, rather than inventing
 * a second grouping nobody asked for.
 */
function permissionCategory(permission) {
  return permission.split(".")[0];
}

/**
 * A block of checkboxes for the full, closed permission vocabulary,
 * grouped by category, with `selected` pre-checked. Returns the
 * container to render and a `getChecked()` function to read the
 * current selection back at submit time — never trusting DOM state
 * queried after the fact by anything other than the caller that built
 * it, the same discipline `openSupplier`'s own `fields` map already
 * follows for plain text inputs.
 */
function permissionCheckboxes(selected) {
  const selectedSet = new Set(selected);
  const boxes = new Map();

  const categories = [...new Set(knownPermissions.map(permissionCategory))];
  const groups = categories.map((category) => {
    const inCategory = knownPermissions.filter((p) => permissionCategory(p) === category);
    return el("div", { class: "permissiongroup" }, [
      el("h4", { text: category }),
      el(
        "div",
        { class: "permissionchecks" },
        inCategory.map((permission) => {
          const box = el("input", {
            type: "checkbox",
            id: `perm-${permission}`,
            ...(selectedSet.has(permission) ? { checked: "checked" } : {}),
          });
          boxes.set(permission, box);
          return el("label", { class: "permissioncheck" }, [
            box,
            el("span", { text: permission }),
          ]);
        })
      ),
    ]);
  });

  return {
    container: el("div", { class: "permissiongroups" }, groups),
    getChecked: () => [...boxes.entries()].filter(([, box]) => box.checked).map(([permission]) => permission),
  };
}

/**
 * **One form, create and edit both** — decision 0326. `existingRole`
 * is null to create, or a real role to edit; the two differ only in
 * whether the id field is editable, which endpoint the submit calls,
 * and the method (`POST` to create, `PUT` to replace) — everything
 * else, including the closed-vocabulary checkboxes, is identical.
 */
function openRoleForm(existingRole) {
  const problem = el("div", { class: "warn" });

  const idInput = existingRole
    ? el("input", { type: "text", value: existingRole.id, disabled: "disabled" })
    : el("input", { type: "text" });
  const nameInput = el("input", { type: "text", value: existingRole?.name ?? "" });
  const { container: permissionsContainer, getChecked } = permissionCheckboxes(existingRole?.permissions ?? []);

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.roleid") }),
    idInput,
    el("label", { text: t("roles.rolename") }),
    nameInput,
  ]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("h3", { text: existingRole ? t("roles.edit") : t("action.newrole") }),
      ...(existingRole ? [] : [el("p", { class: "muted", text: t("roles.roleidhelp") })]),
      form,
      permissionsContainer,
      problem,
      el("div", { class: "statebuttons" }, [
        el("button", {
          class: "primary",
          text: existingRole ? t("roles.save") : t("roles.create"),
          onclick: async () => {
            problem.textContent = "";
            const name = nameInput.value.trim();
            const permissions = getChecked();
            try {
              const response = existingRole
                ? await fetch(`/api/org/roles/${encodeURIComponent(existingRole.id)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, permissions }),
                  })
                : await fetch("/api/org/roles", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: idInput.value.trim(), name, permissions }),
                  });
              if (!response.ok) {
                problem.textContent = (await response.json()).error ?? t("roles.changefailed");
                return;
              }
              backdrop.remove();
              await load();
              render();
            } catch {
              problem.textContent = t("roles.changefailed");
            }
          },
        }),
        actionLink("close", { onclick: () => backdrop.remove() }),
      ]),
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  (existingRole ? nameInput : idInput).focus();
}

function roleRow(role) {
  const canManage = hasMyPermission("Admin.RoleManagement");
  const row = el("tr", canManage ? { class: "clickable" } : {}, [
    el("td", { text: role.name }),
    el(
      "td",
      { class: "sm muted" },
      role.permissions.length > 0
        ? [el("span", { text: role.permissions.join(", ") })]
        : [el("span", { text: t("roles.nopermissions") })]
    ),
  ]);
  if (canManage) row.onclick = () => openRoleForm(role);
  return row;
}

/**
 * **Creating a person — decision 0328.** Gated to `Admin.UserManagement`,
 * the same delegable permission already used for assigning a role;
 * a delegated administrator sees only the orgs they themselves
 * administer, since `units` here is already `/org/overview`'s own
 * pre-scoped list (decision 0321), the same reasoning
 * `openAssignmentsForm`'s own org picker already relies on.
 *
 * **The returned API key is shown exactly once.** Creating a person
 * generates a real credential that cannot be recovered after this —
 * only rotated. The form stays open on success, showing the key with
 * a clear warning, rather than the usual reload-and-close every other
 * form on this screen uses; closing early here would be the one
 * mistake that cannot be undone by opening the form again.
 */
function openNewPersonForm() {
  const problem = el("div", { class: "warn" });

  const nameInput = el("input", { type: "text" });
  const emailInput = el("input", { type: "email" });
  const orgPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.everywhere") }),
    ...units.map((u) => el("option", { value: u.id, text: u.name })),
  ]);
  const currencyInput = el("input", { type: "text", placeholder: "EUR" });
  const amountInput = el("input", { type: "number", min: "0" });

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.personname") }),
    nameInput,
    el("label", { text: t("roles.personemail") }),
    emailInput,
    el("label", { text: t("roles.personorg") }),
    orgPicker,
    el("label", { text: t("roles.limitcurrency") }),
    currencyInput,
    el("label", { text: t("roles.limitamount") }),
    amountInput,
  ]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("h3", { text: t("action.newperson") }),
      form,
      problem,
      el("div", { class: "statebuttons" }, [
        el("button", {
          class: "primary",
          text: t("roles.create"),
          onclick: async () => {
            problem.textContent = "";
            const name = nameInput.value.trim();
            const email = emailInput.value.trim();
            const unitId = orgPicker.value || null;
            try {
              const response = await fetch("/api/org/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: crypto.randomUUID(), name, email, unitId }),
              });
              if (!response.ok) {
                problem.textContent = (await response.json()).error ?? t("roles.createpersonfailed");
                return;
              }
              const created = await response.json();

              const amount = amountInput.value.trim();
              const currency = currencyInput.value.trim();
              if (amount && currency) {
                await fetch(`/api/org/users/${encodeURIComponent(created.id)}/authority-limits`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ currency, maxAmount: Number(amount) }),
                });
              }

              showApiKeyOnce(created.apiKey, backdrop);
            } catch {
              problem.textContent = t("roles.createpersonfailed");
            }
          },
        }),
        actionLink("close", { onclick: () => backdrop.remove() }),
      ]),
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  nameInput.focus();
}

/**
 * Replaces the form with the one-time key display — never both on
 * screen together, so there is no lingering "submit again" affordance
 * once the credential that matters has already been issued.
 */
function showApiKeyOnce(apiKey, backdrop) {
  const popout = backdrop.querySelector(".popout");
  popout.replaceChildren(
    el("h3", { text: t("roles.apikey") }),
    el("p", { class: "warn", text: t("roles.apikeywarning") }),
    el("input", { type: "text", value: apiKey, readonly: "readonly", class: "apikeydisplay" }),
    el("div", { class: "statebuttons" }, [
      el("button", {
        class: "primary",
        text: t("roles.done"),
        onclick: async () => {
          backdrop.remove();
          await load();
          render();
        },
      }),
    ])
  );
}

function personRow(user) {
  const own = assignments.filter((a) => a.userId === user.id);
  const limits = authorityLimits.filter((l) => l.userId === user.id);
  const canAssign = hasMyPermission("Admin.UserManagement");

  const assignmentText =
    own.length > 0
      ? own.map((a) => `${a.roleName} — ${a.unitName ?? t("roles.everywhere")}`).join("; ")
      : t("roles.noassignments");

  const limitText =
    limits.length > 0 ? limits.map((l) => `${l.currency} ${l.maxAmount}`).join("; ") : t("roles.nolimits");

  const row = el("tr", canAssign ? { class: "clickable" } : {}, [
    el("td", {}, [el("div", { text: user.name }), el("div", { class: "sm muted", text: user.email })]),
    el("td", { class: "sm", text: assignmentText }),
    el("td", { class: "sm", text: limitText }),
  ]);
  if (canAssign) row.onclick = () => openAssignmentsForm(user);
  return row;
}

/**
 * **Assigning and revoking a role for one person — decision 0327.**
 * Both actions in one popout rather than two, since a person looking
 * at what somebody holds is exactly the moment either action makes
 * sense. Gated to `Admin.UserManagement`, deliberately delegable
 * (decision 0201) — unlike `openRoleForm`'s own `Admin.RoleManagement`,
 * this never checks the caller's own scope client-side: `units` here
 * is already the caller's own administered scope, since `/org/overview`
 * itself returns a narrower list to a delegated administrator
 * (decision 0321). Offering exactly what is already visible, and
 * letting a refusal the backend still enforces — granting or revoking
 * "everywhere" — speak through the real error, is simpler and no less
 * safe than re-deriving the same boundary a second time here.
 */
function openAssignmentsForm(user) {
  const problem = el("div", { class: "warn" });
  const own = assignments.filter((a) => a.userId === user.id);

  const currentList = el(
    "div",
    { class: "assignmentlist" },
    own.length > 0
      ? own.map((a) => {
          const label = el("span", { text: `${a.roleName} — ${a.unitName ?? t("roles.everywhere")}` });
          const removeBtn = el("button", {
            text: t("roles.remove"),
            onclick: async () => {
              problem.textContent = "";
              try {
                const qs = a.unitId ? `?unitId=${encodeURIComponent(a.unitId)}` : "";
                const response = await fetch(
                  `/api/org/users/${encodeURIComponent(user.id)}/roles/${encodeURIComponent(a.roleId)}${qs}`,
                  { method: "DELETE" }
                );
                if (!response.ok) {
                  problem.textContent = (await response.json()).error ?? t("roles.revokefailed");
                  return;
                }
                backdrop.remove();
                await load();
                render();
              } catch {
                problem.textContent = t("roles.revokefailed");
              }
            },
          });
          return el("div", { class: "assignmentrow" }, [label, removeBtn]);
        })
      : [el("p", { class: "muted", text: t("roles.noassignments") })]
  );

  const rolePicker = el("select", {}, roles.map((r) => el("option", { value: r.id, text: r.name })));
  const orgPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.everywhere") }),
    ...units.map((u) => el("option", { value: u.id, text: u.name })),
  ]);

  const newAssignmentForm = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.role") }),
    rolePicker,
    el("label", { text: t("roles.org") }),
    orgPicker,
  ]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("h3", { text: user.name }),
      el("p", { class: "muted sm", text: t("roles.currentassignments") }),
      currentList,
      el("p", { class: "muted sm", text: t("roles.newassignment") }),
      newAssignmentForm,
      problem,
      el("div", { class: "statebuttons" }, [
        el("button", {
          class: "primary",
          text: t("roles.assign"),
          onclick: async () => {
            problem.textContent = "";
            try {
              const response = await fetch(`/api/org/users/${encodeURIComponent(user.id)}/roles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roleId: rolePicker.value, unitId: orgPicker.value || null }),
              });
              if (!response.ok) {
                problem.textContent = (await response.json()).error ?? t("roles.assignfailed");
                return;
              }
              backdrop.remove();
              await load();
              render();
            } catch {
              problem.textContent = t("roles.assignfailed");
            }
          },
        }),
        actionLink("close", { onclick: () => backdrop.remove() }),
      ]),
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
}

function section(titleKey, emptyKey, headers, rows, headerAction = null) {
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t(titleKey) }),
      ...(headerAction ? [headerAction] : []),
    ]),
    rows.length > 0
      ? el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: t(h) })))]),
            el("tbody", {}, rows),
          ]),
        ])
      : el("p", { class: "muted", text: t(emptyKey) }),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const canManage = hasMyPermission("Admin.RoleManagement");
  const canAssign = hasMyPermission("Admin.UserManagement");

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.roles"), t("roles.subtitle")),
        section("roles.units", "roles.nounits", ["column.unit", "roles.kind"], units.map(unitRow)),
        section(
          "roles.roles",
          "roles.norolesconfigured",
          ["column.role", "roles.permissions"],
          roles.map(roleRow),
          canManage ? actionLink("newrole", { onclick: () => openRoleForm(null) }) : null
        ),
        section(
          "roles.people",
          "roles.nopeople",
          ["column.person", "roles.assignments", "roles.limits"],
          users.map(personRow),
          canAssign ? actionLink("newperson", { onclick: () => openNewPersonForm() }) : null
        ),
      ])
    )
  );
}


/**
 * **A failed load says so, decision 0322** — reported live: "the
 * Roles menu option does not launch anything." `open()` used to
 * return silently when the request failed, leaving whatever was on
 * screen before untouched — a click that visibly did nothing,
 * indistinguishable from the nav item not working at all. The same
 * gap `documents.js` and `rules.js` have on a cold first load, since
 * neither has anywhere to put a message before their own first
 * `render()` has ever run.
 *
 * Wrapped in `frame()` regardless, so a failed load still leaves the
 * nav reachable rather than stranding somebody on a blank page with
 * no way off it.
 */
function renderLoadFailed() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.roles"), t("roles.subtitle")),
        el("p", { class: "problem", role: "status", text: t("roles.loadfailed") }),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("roles");
  if (!(await load())) {
    renderLoadFailed();
    return;
  }
  render();
}

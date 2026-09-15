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
let teams = [];
let activeTab = "units";
let costCentres = [];
let spendLimits = [];

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
    costCentres = body.costCentres ?? [];
    spendLimits = body.spendLimits ?? [];

    /**
     * **A separate fetch, deliberately — decision 0332.** `/org/teams`
     * is gated by `Admin.RoleManagement` or `Admin.UserManagement`,
     * not the same permission pair `/org/overview` itself checks — an
     * `Admin.Configure`-only holder could see everything else on this
     * screen and correctly not see teams. A failure here does not
     * break the rest of the screen; it only means this one section
     * has nothing to show.
     */
    try {
      const teamsResponse = await fetch("/api/org/teams");
      teams = teamsResponse.ok ? ((await teamsResponse.json()).teams ?? []) : [];
    } catch {
      teams = [];
    }

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

/**
 * **Creating and editing an org unit — decision 0335.** Reported
 * live: "a Create org and manage org button, available only to the
 * Administrator (Global) role" — `Admin.Configure`, the permission
 * that already means "unscoped, instance-wide standing" everywhere
 * else in this app, gating both the row's own click and the New org
 * action, matching how Org Units and Roles are themselves already
 * hidden from anyone else on this screen (decision 0333).
 */
function openUnitForm(existingUnit) {
  const problem = el("div", { class: "warn" });

  const idInput = existingUnit
    ? el("input", { type: "text", value: existingUnit.id, disabled: "disabled" })
    : el("input", { type: "text" });
  const nameInput = el("input", { type: "text", value: existingUnit?.name ?? "" });
  const kindPicker = el("select", {}, [
    el("option", { value: "operating_unit", text: t("roles.operatingunit"), ...(existingUnit?.kind === "operating_unit" || !existingUnit ? { selected: "selected" } : {}) }),
    el("option", { value: "legal_entity", text: t("roles.legalentity"), ...(existingUnit?.kind === "legal_entity" ? { selected: "selected" } : {}) }),
  ]);
  const parentPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...units
      .filter((u) => u.id !== existingUnit?.id)
      .map((u) => el("option", { value: u.id, text: u.name, ...(u.id === existingUnit?.parentUnitId ? { selected: "selected" } : {}) })),
  ]);
  const buyerEndpointInput = el("input", { type: "text", value: existingUnit?.buyerEndpoint ?? "" });
  const vatIdInput = el("input", { type: "text", value: existingUnit?.vatId ?? "" });
  const buyerReferenceInput = el("input", { type: "text", value: existingUnit?.buyerReference ?? "" });

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.orgid") }),
    idInput,
    el("label", { text: t("roles.orgname") }),
    nameInput,
    el("label", { text: t("roles.kind") }),
    kindPicker,
    el("label", { text: t("roles.parentorg") }),
    parentPicker,
    el("label", { text: t("roles.buyerendpoint") }),
    buyerEndpointInput,
    el("label", { text: t("roles.vatid") }),
    vatIdInput,
    el("label", { text: t("roles.buyerreference") }),
    buyerReferenceInput,
  ]);

  const close = () => backdrop.remove();
  const save = actionLink(existingUnit ? "save" : "create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const name = nameInput.value.trim();
      const body = {
        name,
        kind: kindPicker.value,
        parentUnitId: parentPicker.value || null,
        buyerEndpoint: buyerEndpointInput.value.trim() || null,
        vatId: vatIdInput.value.trim() || null,
        buyerReference: buyerReferenceInput.value.trim() || null,
      };
      try {
        const response = existingUnit
          ? await fetch(`/api/org/units/${encodeURIComponent(existingUnit.id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch("/api/org/units", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: idInput.value.trim(), ...body }),
            });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("roles.orgsavefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("roles.orgsavefailed");
      }
    },
  });
  const stateButtons = el("div", { class: "statebuttons" }, [save, actionLink("close", { onclick: close })]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: existingUnit ? existingUnit.name : t("action.neworg") }),
        stateButtons,
      ]),
      form,
      problem,
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  (existingUnit ? nameInput : idInput).focus();
}

function unitRow(unit) {
  const canManageOrgs = hasMyPermission("Admin.Configure");
  const row = el("tr", canManageOrgs ? { class: "clickable" } : {}, [
    el("td", {}, [el("span", { style: `padding-left: ${unitDepth(unit) * 20}px`, text: unit.name })]),
    el("td", { text: unit.kind }),
  ]);
  if (canManageOrgs) row.onclick = () => openUnitForm(unit);
  return row;
}

/**
 * **Grouped by category, not a flat list of thirty-one** — the same
 * namespacing the permissions themselves already use (`AP.*`,
 * `Admin.*`, and so on), so a form offering all of them reads the
 * same way the vocabulary itself is organised, rather than inventing
 * a second grouping nobody asked for.
 */
function permissionCategory(permissionName) {
  return permissionName.split(".")[0];
}

/**
 * **Name and description, two columns, one row per permission —
 * decision 0331.** Reported live: "the Permissions are sometimes a
 * little difficult to understand what capability is provisioned...
 * listing the Permission next to a short description... with two
 * columns, and each row with a check box." The description is real,
 * not invented here — `/org/overview` already returns it, sourced
 * from `PERMISSION_DESCRIPTIONS`, the backend's own single source of
 * truth for what each permission actually means.
 *
 * `selected` is a list of permission *names* (what a role's own
 * `permissions_json` and `getChecked()` both deal in); `knownPermissions`
 * itself is now `{ name, description }` objects.
 */
function permissionCheckboxes(selected) {
  const selectedSet = new Set(selected);
  const boxes = new Map();

  const categories = [...new Set(knownPermissions.map((p) => permissionCategory(p.name)))];
  const groups = categories.map((category) => {
    const inCategory = knownPermissions.filter((p) => permissionCategory(p.name) === category);
    return el("div", { class: "permissiongroup" }, [
      el("h4", { text: category }),
      el(
        "div",
        { class: "permissionrows" },
        inCategory.map((permission) => {
          const box = el("input", {
            type: "checkbox",
            id: `perm-${permission.name}`,
            ...(selectedSet.has(permission.name) ? { checked: "checked" } : {}),
          });
          boxes.set(permission.name, box);
          return el("div", { class: "permissionrow" }, [
            el("label", { class: "permissionname" }, [box, el("span", { text: permission.name })]),
            el("span", { class: "permissiondesc muted sm", text: permission.description }),
          ]);
        })
      ),
    ]);
  });

  return {
    // Scrollable — decision 0331's own asking: "a scroll bar on the
    // pop-out would be needed to work down the list." Thirty-one
    // permissions with a real description each does not fit a
    // popout otherwise.
    container: el("div", { class: "permissiongroups scrollable" }, groups),
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

  const close = () => backdrop.remove();
  const save = actionLink(existingRole ? "save" : "create", {
    primary: true,
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
  });

  /**
   * **Save and Close, top right — decision 0329, corrected.** The
   * operator's own follow-up after a first attempt put Close in the
   * header but left Save at the bottom: "I wanted the same as the
   * supplier pop-out." `.cardhead`'s own title-left, action-right
   * shape, the same `.statebuttons` row decision 0306 already gives
   * the supplier popout — reused rather than a second version of it.
   */
  const stateButtons = el("div", { class: "statebuttons" }, [save, actionLink("close", { onclick: close })]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: existingRole ? t("roles.edit") : t("action.newrole") }),
        stateButtons,
      ]),
      ...(existingRole ? [] : [el("p", { class: "muted", text: t("roles.roleidhelp") })]),
      form,
      permissionsContainer,
      problem,
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
 * `openPersonForm`'s own org picker already relies on.
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
  /**
   * **The new properties, at creation time — decision 0334.** Manager
   * and cost centre are pickers over real, existing people and cost
   * centres — never free text a name could be mistyped into. Both
   * carry a "none" option, since neither is required.
   */
  const managerPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...users.map((u) => el("option", { value: u.id, text: u.name })),
  ]);
  const costCentrePicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...costCentres.map((c) => el("option", { value: c.id, text: c.name })),
  ]);
  const addressLineInput = el("input", { type: "text" });
  const cityInput = el("input", { type: "text" });
  const postalCodeInput = el("input", { type: "text" });
  const countryInput = el("input", { type: "text" });
  const spendCurrencyInput = el("input", { type: "text", placeholder: "EUR" });
  const spendAmountInput = el("input", { type: "number", min: "0" });

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.personname") }),
    nameInput,
    el("label", { text: t("roles.personemail") }),
    emailInput,
    el("label", { text: t("roles.personorg") }),
    orgPicker,
    el("label", { text: t("roles.manager") }),
    managerPicker,
    el("label", { text: t("roles.costcentre") }),
    costCentrePicker,
    el("label", { text: t("roles.addressline") }),
    addressLineInput,
    el("label", { text: t("roles.city") }),
    cityInput,
    el("label", { text: t("roles.postalcode") }),
    postalCodeInput,
    el("label", { text: t("roles.country") }),
    countryInput,
    el("label", { text: t("roles.limitcurrency") }),
    currencyInput,
    el("label", { text: t("roles.limitamount") }),
    amountInput,
    el("label", { text: t("roles.spendlimitcurrency") }),
    spendCurrencyInput,
    el("label", { text: t("roles.spendlimitamount") }),
    spendAmountInput,
  ]);

  const close = () => backdrop.remove();
  const create = actionLink("create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const unitId = orgPicker.value || null;
      try {
        const response = await fetch("/api/org/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name,
            email,
            unitId,
            managerId: managerPicker.value || null,
            costCentreId: costCentrePicker.value || null,
            addressLine: addressLineInput.value.trim() || null,
            city: cityInput.value.trim() || null,
            postalCode: postalCodeInput.value.trim() || null,
            country: countryInput.value.trim() || null,
          }),
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

        const spendAmount = spendAmountInput.value.trim();
        const spendCurrency = spendCurrencyInput.value.trim();
        if (spendAmount && spendCurrency) {
          await fetch(`/api/org/users/${encodeURIComponent(created.id)}/spend-limit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currency: spendCurrency, maxAmount: Number(spendAmount) }),
          });
        }

        showApiKeyOnce(created.apiKey, backdrop);
      } catch {
        problem.textContent = t("roles.createpersonfailed");
      }
    },
  });
  const stateButtons = el("div", { class: "statebuttons" }, [create, actionLink("close", { onclick: close })]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("action.newperson") }), stateButtons]),
      form,
      problem,
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
  const done = actionLink("done", {
    primary: true,
    onclick: async () => {
      backdrop.remove();
      await load();
      render();
    },
  });
  popout.replaceChildren(
    el("div", { class: "cardhead" }, [el("h3", { text: t("roles.apikey") }), el("div", { class: "statebuttons" }, [done])]),
    el("p", { class: "warn", text: t("roles.apikeywarning") }),
    el("input", { type: "text", value: apiKey, readonly: "readonly", class: "apikeydisplay" })
  );
}

/**
 * **Teams — decision 0332.** Two different permissions can touch one
 * team, and the popout has to hold both possibilities at once: the
 * name is editable only holding `Admin.RoleManagement` (a team's own
 * definition is customer-wide, the same reasoning that permission
 * already gives a role); the member list — adding, removing — only
 * holding `Admin.UserManagement` (the same permission that already
 * assigns a role to a person). A person holding neither never sees
 * this row at all; the row is only ever shown once the section
 * itself is, which already checks for one of the two.
 */
function teamRow(team) {
  const canManage = hasMyPermission("Admin.RoleManagement");
  const canAssign = hasMyPermission("Admin.UserManagement");
  const memberText =
    team.members.length > 0 ? team.members.map((m) => m.userName).join(", ") : t("roles.noteammembers");

  const row = el("tr", canManage || canAssign ? { class: "clickable" } : {}, [
    el("td", { text: team.name }),
    el("td", { class: "sm muted", text: team.unitName }),
    el("td", { class: "sm muted", text: memberText }),
  ]);
  if (canManage || canAssign) row.onclick = () => openTeamForm(team);
  return row;
}

function openTeamForm(existingTeam) {
  const canManage = hasMyPermission("Admin.RoleManagement");
  const canAssign = hasMyPermission("Admin.UserManagement");
  const problem = el("div", { class: "warn" });

  const idInput = existingTeam
    ? el("input", { type: "text", value: existingTeam.id, disabled: "disabled" })
    : el("input", { type: "text" });
  const nameInput = el("input", {
    type: "text",
    value: existingTeam?.name ?? "",
    ...(existingTeam && !canManage ? { disabled: "disabled" } : {}),
  });
  /**
   * **Required, never "Everywhere" — decision 0333.** Unlike the org
   * picker on the assignments popout, this one offers no unscoped
   * option at all: "There should never be a null-org team."
   */
  const orgPicker = el(
    "select",
    { ...(existingTeam && !canManage ? { disabled: "disabled" } : {}) },
    units.map((u) => el("option", { value: u.id, text: u.name, ...(u.id === existingTeam?.unitId ? { selected: "selected" } : {}) }))
  );

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.teamid") }),
    idInput,
    el("label", { text: t("roles.teamname") }),
    nameInput,
    el("label", { text: t("roles.personorg") }),
    orgPicker,
  ]);

  const close = () => backdrop.remove();
  const save = actionLink(existingTeam ? "save" : "create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const name = nameInput.value.trim();
      const unitId = orgPicker.value;
      try {
        const response = existingTeam
          ? await fetch(`/api/org/teams/${encodeURIComponent(existingTeam.id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, unitId }),
            })
          : await fetch("/api/org/teams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: idInput.value.trim(), name, unitId }),
            });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("roles.teamsavefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("roles.teamsavefailed");
      }
    },
  });
  const stateButtons = el(
    "div",
    { class: "statebuttons" },
    canManage ? [save, actionLink("close", { onclick: close })] : [actionLink("close", { onclick: close })]
  );

  const memberSection = existingTeam
    ? [
        el("p", { class: "muted sm", text: t("roles.teammembers") }),
        el(
          "div",
          { class: "assignmentlist" },
          existingTeam.members.length > 0
            ? existingTeam.members.map((m) => {
                const label = el("span", { text: m.userName });
                if (!canAssign) return el("div", { class: "assignmentrow" }, [label]);
                const removeBtn = el("button", {
                  text: t("roles.remove"),
                  onclick: async () => {
                    problem.textContent = "";
                    try {
                      const response = await fetch(
                        `/api/org/teams/${encodeURIComponent(existingTeam.id)}/members/${encodeURIComponent(m.userId)}`,
                        { method: "DELETE" }
                      );
                      if (!response.ok) {
                        problem.textContent = (await response.json()).error ?? t("roles.removememberfailed");
                        return;
                      }
                      backdrop.remove();
                      await load();
                      render();
                    } catch {
                      problem.textContent = t("roles.removememberfailed");
                    }
                  },
                });
                return el("div", { class: "assignmentrow" }, [label, removeBtn]);
              })
            : [el("p", { class: "muted", text: t("roles.noteammembers") })]
        ),
      ]
    : [];

  const memberPicker = canAssign && existingTeam
    ? [
        el("div", { class: "editgrid" }, [
          el("label", { text: t("roles.member") }),
          (() => {
            const alreadyIn = new Set(existingTeam.members.map((m) => m.userId));
            const select = el(
              "select",
              {},
              users.filter((u) => !alreadyIn.has(u.id)).map((u) => el("option", { value: u.id, text: u.name }))
            );
            const addBtn = el("button", {
              text: t("roles.addmember"),
              onclick: async () => {
                problem.textContent = "";
                try {
                  const response = await fetch(`/api/org/teams/${encodeURIComponent(existingTeam.id)}/members`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: select.value }),
                  });
                  if (!response.ok) {
                    problem.textContent = (await response.json()).error ?? t("roles.addmemberfailed");
                    return;
                  }
                  backdrop.remove();
                  await load();
                  render();
                } catch {
                  problem.textContent = t("roles.addmemberfailed");
                }
              },
            });
            return el("div", { class: "memberpickerrow" }, [select, addBtn]);
          })(),
        ]),
      ]
    : [];

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: existingTeam ? existingTeam.name : t("action.newteam") }),
        stateButtons,
      ]),
      form,
      ...memberSection,
      ...memberPicker,
      problem,
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  (existingTeam ? nameInput : idInput).focus();
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
  if (canAssign) row.onclick = () => openPersonForm(user);
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
/**
 * **Properties, limits, and role assignment — one popout per person,
 * decision 0334.** Extends what was `openAssignmentsForm` (decision
 * 0327) rather than adding a second popout: a person looking at
 * somebody's own roles is exactly the moment editing their manager,
 * cost centre, or spend limit also makes sense, the same reasoning
 * decision 0327 already gave combining assign and revoke. Renamed to
 * match — this is no longer only about assignments.
 *
 * Properties save together, under their own "Save" — the same
 * "replace, not merge" shape the backend's own `handleUpdateUser`
 * takes. Approval Limit and Spend Limit each keep their own,
 * independent "Set" action, matching how role assignment already
 * works here: setting one is a complete action in itself, not a
 * field waiting on some other button. Budget Holder is shown, never
 * offered as a checkbox — derived from owning a cost centre
 * elsewhere, reported live as "one source of truth" rather than a
 * second flag that could disagree with it.
 */
function openPersonForm(user) {
  const problem = el("div", { class: "warn" });
  const own = assignments.filter((a) => a.userId === user.id);
  const canAssign = hasMyPermission("Admin.UserManagement");

  const nameInput = el("input", { type: "text", value: user.name });
  const orgPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.everywhere") }),
    ...units.map((u) => el("option", { value: u.id, text: u.name, ...(u.id === user.unitId ? { selected: "selected" } : {}) })),
  ]);
  const managerPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...users
      .filter((u) => u.id !== user.id)
      .map((u) => el("option", { value: u.id, text: u.name, ...(u.id === user.managerId ? { selected: "selected" } : {}) })),
  ]);
  const costCentrePicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...costCentres.map((c) => el("option", { value: c.id, text: c.name, ...(c.id === user.costCentreId ? { selected: "selected" } : {}) })),
  ]);
  const addressLineInput = el("input", { type: "text", value: user.addressLine ?? "" });
  const cityInput = el("input", { type: "text", value: user.city ?? "" });
  const postalCodeInput = el("input", { type: "text", value: user.postalCode ?? "" });
  const countryInput = el("input", { type: "text", value: user.country ?? "" });

  const propertiesForm = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.personname") }),
    nameInput,
    el("label", { text: t("roles.personorg") }),
    orgPicker,
    el("label", { text: t("roles.manager") }),
    managerPicker,
    el("label", { text: t("roles.costcentre") }),
    costCentrePicker,
    el("label", { text: t("roles.addressline") }),
    addressLineInput,
    el("label", { text: t("roles.city") }),
    cityInput,
    el("label", { text: t("roles.postalcode") }),
    postalCodeInput,
    el("label", { text: t("roles.country") }),
    countryInput,
    el("label", { text: t("roles.budgetholder") }),
    el("span", { class: "sm muted", text: user.isBudgetHolder ? t("roles.yes") : t("roles.no") }),
  ]);

  const close = () => backdrop.remove();
  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch(`/api/org/users/${encodeURIComponent(user.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nameInput.value.trim(),
            unitId: orgPicker.value || null,
            managerId: managerPicker.value || null,
            costCentreId: costCentrePicker.value || null,
            addressLine: addressLineInput.value.trim() || null,
            city: cityInput.value.trim() || null,
            postalCode: postalCodeInput.value.trim() || null,
            country: countryInput.value.trim() || null,
          }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("roles.propertiessavefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("roles.propertiessavefailed");
      }
    },
  });

  const limits = authorityLimits.filter((l) => l.userId === user.id);
  const limitText =
    limits.length > 0 ? limits.map((l) => `${l.currency} ${l.maxAmount}`).join("; ") : t("roles.nolimits");
  const approvalCurrencyInput = el("input", { type: "text", placeholder: "EUR" });
  const approvalAmountInput = el("input", { type: "number", min: "0" });
  const setApprovalLimit = el("button", {
    text: t("roles.set"),
    onclick: async () => {
      problem.textContent = "";
      const currency = approvalCurrencyInput.value.trim();
      const maxAmount = approvalAmountInput.value.trim();
      if (!currency || !maxAmount) return;
      try {
        const response = await fetch(`/api/org/users/${encodeURIComponent(user.id)}/authority-limits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency, maxAmount: Number(maxAmount) }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("roles.limitsavefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("roles.limitsavefailed");
      }
    },
  });

  const spend = spendLimits.filter((l) => l.userId === user.id);
  const spendText = spend.length > 0 ? spend.map((l) => `${l.currency} ${l.maxAmount}`).join("; ") : t("roles.nolimits");
  const spendCurrencyInput = el("input", { type: "text", placeholder: "EUR" });
  const spendAmountInput = el("input", { type: "number", min: "0" });
  const setSpendLimit = el("button", {
    text: t("roles.set"),
    onclick: async () => {
      problem.textContent = "";
      const currency = spendCurrencyInput.value.trim();
      const maxAmount = spendAmountInput.value.trim();
      if (!currency || !maxAmount) return;
      try {
        const response = await fetch(`/api/org/users/${encodeURIComponent(user.id)}/spend-limit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency, maxAmount: Number(maxAmount) }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("roles.limitsavefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("roles.limitsavefailed");
      }
    },
  });

  const limitsSection = el("div", {}, [
    el("p", { class: "muted sm", text: `${t("roles.limits")}: ${limitText}` }),
    el("div", { class: "memberpickerrow" }, [approvalCurrencyInput, approvalAmountInput, setApprovalLimit]),
    el("p", { class: "muted sm", text: `${t("roles.spendlimit")}: ${spendText}` }),
    el("div", { class: "memberpickerrow" }, [spendCurrencyInput, spendAmountInput, setSpendLimit]),
  ]);

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
  const assignOrgPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.everywhere") }),
    ...units.map((u) => el("option", { value: u.id, text: u.name })),
  ]);

  const newAssignmentForm = el("div", { class: "editgrid" }, [
    el("label", { text: t("roles.role") }),
    rolePicker,
    el("label", { text: t("roles.org") }),
    assignOrgPicker,
  ]);

  const assign = actionLink("assign", {
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch(`/api/org/users/${encodeURIComponent(user.id)}/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleId: rolePicker.value, unitId: assignOrgPicker.value || null }),
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
  });

  const stateButtons = el(
    "div",
    { class: "statebuttons" },
    canAssign ? [save, actionLink("close", { onclick: close })] : [actionLink("close", { onclick: close })]
  );

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: user.name }), stateButtons]),
      propertiesForm,
      limitsSection,
      el("p", { class: "muted sm", text: t("roles.assignments") }),
      currentList,
      newAssignmentForm,
      assign,
      problem,
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

/**
 * **Tabs, not a long scroll — decision 0333.** Reported live, after
 * seeing this screen's own real content: "I wondered if all of these
 * sections... should have their own configuration? ... I like the
 * idea of Tabs." Org units, Roles, and People are always offered —
 * reaching this screen at all already means holding one of the two
 * permissions `/org/overview` itself requires. Teams is the one
 * conditional tab, since its own gate (`Admin.RoleManagement` or
 * `Admin.UserManagement`) is a genuinely different pair from the
 * screen's own, and an `Admin.Configure`-only holder can correctly
 * reach every other tab and not this one.
 */
/**
 * **Org Units and Roles, visible only to a global administrator —
 * decision 0333.** Reported live: "One could argue that the Org unit
 * and roles tabs should only be visible to the Administrator (Global)
 * role." Checked against what the code actually does before building
 * this: both were already correctly scoped or non-sensitive for a
 * delegated administrator — hidden anyway, at the operator's own
 * confirmed choice, for a simpler delegated-admin view rather than
 * because either was unsafe. Gated on `Admin.Configure`, the
 * permission that already means "unscoped, instance-wide standing"
 * everywhere else in this app — never a literal check against the
 * role named "Administrator (Global)" itself, which is just one
 * bundle of permissions among others that could hold this same one.
 */
function tabBar(canShowTeams, canShowGlobalOnly) {
  const tabs = [
    ...(canShowGlobalOnly ? [["units", "roles.units"]] : []),
    ...(canShowGlobalOnly ? [["roles", "roles.roles"]] : []),
    ["people", "roles.people"],
    ...(canShowTeams ? [["teams", "roles.teams"]] : []),
  ];

  return el(
    "div",
    { class: "tabbar" },
    tabs.map(([key, labelKey]) =>
      el("button", {
        class: `tab${activeTab === key ? " active" : ""}`,
        text: t(labelKey),
        onclick: () => {
          activeTab = key;
          render();
        },
      })
    )
  );
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const canManage = hasMyPermission("Admin.RoleManagement");
  const canAssign = hasMyPermission("Admin.UserManagement");
  const canShowTeams = canManage || canAssign;
  const canShowGlobalOnly = hasMyPermission("Admin.Configure");

  /**
   * **Corrected before the active section is picked, not after —
   * decision 0333.** `tabBar` used to carry this same redirect, which
   * ran too late: `activeSection` below is computed in the same
   * function body, before `tabBar` is ever called, so a stale
   * `activeTab` locked in the wrong section's content even though the
   * tab bar itself correctly showed nothing active. Caught by the
   * simplest possible test — the screen not rendering its own
   * subtitle at all on a first, permission-less render.
   */
  if ((activeTab === "units" || activeTab === "roles") && !canShowGlobalOnly) activeTab = "people";
  if (activeTab === "teams" && !canShowTeams) activeTab = "people";

  const activeSection = {
    units: () =>
      section(
        "roles.units",
        "roles.nounits",
        ["column.unit", "roles.kind"],
        units.map(unitRow),
        hasMyPermission("Admin.Configure") ? actionLink("neworg", { onclick: () => openUnitForm(null) }) : null
      ),
    roles: () =>
      section(
        "roles.roles",
        "roles.norolesconfigured",
        ["column.role", "roles.permissions"],
        roles.map(roleRow),
        canManage ? actionLink("newrole", { onclick: () => openRoleForm(null) }) : null
      ),
    people: () =>
      section(
        "roles.people",
        "roles.nopeople",
        ["column.person", "roles.assignments", "roles.limits"],
        users.map(personRow),
        canAssign ? actionLink("newperson", { onclick: () => openNewPersonForm() }) : null
      ),
    teams: () =>
      section(
        "roles.teams",
        "roles.noteamsconfigured",
        ["column.team", "roles.personorg", "roles.teammembers"],
        teams.map(teamRow),
        canManage ? actionLink("newteam", { onclick: () => openTeamForm(null) }) : null
      ),
  }[activeTab]();

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.access"), t("roles.subtitle")),
        tabBar(canShowTeams, canShowGlobalOnly),
        activeSection,
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
        topbar(t("nav.access"), t("roles.subtitle")),
        el("p", { class: "problem", role: "status", text: t("roles.loadfailed") }),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("access");
  if (!(await load())) {
    renderLoadFailed();
    return;
  }
  render();
}

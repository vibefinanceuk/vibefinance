import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";

/**
 * Who can do what, where, and up to how much — decision 0319.
 *
 * **The first, read-only half of a role-management screen**, reported
 * live: "consider a UI for Role Management... Role permissions
 * (including approval limits) fall into this category as a sub
 * task." Everything shown here already existed only as raw database
 * rows, reachable only by direct SQL — this makes it visible; nothing
 * here can yet change it, which is deliberate, separate, later work.
 */

let units = [];
let users = [];
let roles = [];
let assignments = [];
let authorityLimits = [];

async function load() {
  const response = await fetch("/api/org/overview");
  if (!response.ok) return false;

  const body = await response.json();
  units = body.units ?? [];
  users = body.users ?? [];
  roles = body.roles ?? [];
  assignments = body.assignments ?? [];
  authorityLimits = body.authorityLimits ?? [];
  return true;
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

function roleRow(role) {
  return el("tr", {}, [
    el("td", { text: role.name }),
    el(
      "td",
      { class: "sm muted" },
      role.permissions.length > 0
        ? [el("span", { text: role.permissions.join(", ") })]
        : [el("span", { text: t("roles.nopermissions") })]
    ),
  ]);
}

function personRow(user) {
  const own = assignments.filter((a) => a.userId === user.id);
  const limits = authorityLimits.filter((l) => l.userId === user.id);

  const assignmentText =
    own.length > 0
      ? own.map((a) => `${a.roleName} — ${a.unitName ?? t("roles.everywhere")}`).join("; ")
      : t("roles.noassignments");

  const limitText =
    limits.length > 0 ? limits.map((l) => `${l.currency} ${l.maxAmount}`).join("; ") : t("roles.nolimits");

  return el("tr", {}, [
    el("td", {}, [el("div", { text: user.name }), el("div", { class: "sm muted", text: user.email })]),
    el("td", { class: "sm", text: assignmentText }),
    el("td", { class: "sm", text: limitText }),
  ]);
}

function section(titleKey, emptyKey, headers, rows) {
  return el("div", { class: "panel" }, [
    el("h3", { text: t(titleKey) }),
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

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.roles"), t("roles.subtitle")),
        section("roles.units", "roles.nounits", ["column.unit", "roles.kind"], units.map(unitRow)),
        section("roles.roles", "roles.norolesconfigured", ["column.role", "roles.permissions"], roles.map(roleRow)),
        section(
          "roles.people",
          "roles.nopeople",
          ["column.person", "roles.assignments", "roles.limits"],
          users.map(personRow)
        ),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("roles");
  if (!(await load())) return;
  render();
}

import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { currencyPicker } from "/access.js";
import { accountCodingTab, loadCodingListCsvFormats, loadAccountCodingTables } from "/coding-lists.js";

/**
 * AP Setup — decision 0440.
 *
 * *"Under a new side menu option, I would like to establish AP
 * Configuration options... Matching, Account Coding and Approval
 * Hierarchy setup screens in tabs."* The same `.tabbar`/`.tab`
 * component `ap-analytics.js` already reuses from `access.js`, and —
 * per the operator's own instruction — the Approval Hierarchy tab's
 * own forms follow `access.js`'s own conventions directly:
 * `.editgrid` layout, the shared `currencyPicker()` (now exported from
 * there), inline "Set"/"Remove" actions rather than a second pop-out
 * component, and the same `problem` div for inline errors.
 *
 * **Matching is live — decision 0472.** The org-wide default tolerance
 * and quantity-matching toggle `org_matching_config` has held since
 * migration `0078` (decisions 0465/0468/0469), reachable only by
 * direct SQL until now — this tab is `matching-config-route.ts`'s own
 * front end, one form, one Save, the same shape `modeForm` below
 * already established for Approval Hierarchy's own mode/Default
 * Approver pair. No supplier-specific override lives here; this is the
 * fallback every supplier without one of their own falls back to.
 *
 * **Standard matching rules — decision 0474.** A second panel on the
 * same tab, `standardMatchingRulesPanel`: checkboxes that only
 * enable/disable a rule that already exists, reusing the existing
 * `PUT /rules/:id/enabled` route (decision 0155) directly — no new
 * write path, and nothing here compiles or activates a rule. Creating
 * one of the four standard rules for the first time stays ordinary
 * rule authoring on whichever stage's own Rules screen the operator
 * picks; the "never auto-promote a generated rule" gate every rule in
 * this system has always had is untouched.
 *
 * **Approval Hierarchy is live**: the mode (Employee-Supervisor /
 * Cost-Object / Manual / API) and Default Approver decision 0439's own
 * resolver already reads, plus CRUD for the two override tables that
 * make a limit or a supervisor org-specific — `org_user_supervisor_
 * overrides` and `org_authority_limit_overrides`. Turning
 * `process_stages.uses_approval_hierarchy` on for a real stage stays
 * SQL-only here too, the same as `required_permission` (decision
 * 0439's own "What is not built") — no route exists anywhere in this
 * app to edit a stage's own properties, and inventing one for a single
 * flag was out of scope for this screen.
 *
 * **Account Coding is live too — decision 0444.** Company code, Cost
 * Centre, Project, Commodity Code, and General Ledger Code, all built
 * out in `coding-lists.js`; this file just loads what that tab needs
 * alongside everything else and hands it down.
 *
 * **Account Coding's four manageable tables own their own paginated,
 * searched state — decision 0446.** `coding-lists.js` now fetches its
 * own table data (`loadAccountCodingTables()`, a sibling call to its
 * own `loadCodingListCsvFormats()`, both awaited the same "ready by
 * the time render() runs" way) rather than this file eagerly fetching
 * `/api/org/cost-centres` and three `/api/coding-lists/:type` calls
 * and handing the full arrays down as props. This file keeps only the
 * one thing `coding-lists.js` can't get anywhere else — the lightweight
 * `{id, name}` Cost Centre list `/org/overview` already returns — and
 * passes that through as `costCentreNames`.
 */

const MODES = ["employee_supervisor", "cost_object", "manual", "api"];

const TABS = [
  { key: "matching", labelKey: "apsetup.matching" },
  { key: "coding", labelKey: "apsetup.coding" },
  { key: "approvalhierarchy", labelKey: "apsetup.approvalhierarchy" },
  { key: "stagerestrictions", labelKey: "apsetup.stagerestrictions" },
  { key: "returnreasons", labelKey: "apsetup.returnreasons" },
];

let units = [];
let users = [];
let config = null;
let matchingConfig = null;
let standardRules = [];
let activeTab = null;
let costCentreNames = [];
// Decision 0498's own tab — return reasons and the AP team's email
// address. Its own corner, loaded the same non-blocking way
// `loadStageRestrictions()` already is below: a failed fetch leaves
// this tab showing its own empty state rather than taking down every
// other tab on the screen.
let returnReasons = [];
let apTeamEmail = null;

/**
 * **Stage Restrictions — decision 0483.** Reported live: Account
 * Coding was showing up as editable on the Validation stage, when
 * nobody had asked for that — "Coding should only happen in the
 * Coding stage." Tracing it: `coding.project`/`coding.commodity_code`/
 * `coding.gl_code` are ordinary vocabulary fields, resolved through
 * the same customer/stage field-visibility system every other field
 * already uses (`field-visibility-route.ts`) — and a route to
 * restrict them per stage (`PUT /processes/stages/:id/field-visibility`)
 * has existed since decision 0143/0196, fully tested, with no screen
 * ever built on top of it. This tab is that screen — narrowly, for
 * Account Coding's own three fields, not a general "restrict any
 * field" picker, which is a bigger screen for a day something asks
 * for it.
 *
 * **A second, real business reason, not just tidiness** — the
 * operator's own follow-up: a company that outsources document
 * capture and data entry needs Validation done by people who must
 * never be able to code a line, since Account Coding is an AP-team
 * decision. A stage restriction is exactly the right shape for that:
 * it never touches what the Coding stage itself can do, only adds a
 * ceiling at Validation.
 */
let stageRestrictionsProcesses = [];
let stageRestrictionsProcessId = null;
let stageRestrictionsDetail = null;
/** stageId -> the 3 coding fields' own `ResolvedField`s at that stage. */
let stageFieldVisibility = {};

const CODING_RESTRICTION_FIELDS = ["coding.project", "coding.commodity_code", "coding.gl_code"];

/**
 * **Search over the two override lists, entirely client-side —
 * decision 0442.** Both lists arrive in one `load()` fetch already
 * (`/api/approval-config` returns every row, unlike Documents' own
 * server-side, `LIMIT`-capped search), so filtering and capping what's
 * *shown* happens in the browser rather than a second round trip. Kept
 * as plain module state, the same shape `activeTab` above already is
 * — reset per screen visit, not persisted.
 */
let supervisorSearchQuery = "";
let limitSearchQuery = "";

/**
 * **How many rows render before the list asks you to narrow it** — the
 * same default Documents' own `limit` query param falls back to
 * (`documents-route.ts`), reused here as a display cap rather than a
 * fetch cap since the whole list is already in memory.
 */
const OVERRIDE_DISPLAY_CAP = 50;

async function load() {
  try {
    // The CSV Template/Load help affordance (decision 0445) and the four
    // paginated Account Coding tables (decision 0446) are both fetched
    // alongside everything else, the same "in its final state by the
    // time render() runs" discipline `purchase-orders.js`'s own
    // loadFormat() already established — but kept out of the ok-check
    // just below, since neither one throws on its own failed fetch;
    // each degrades its own corner of the coding tab rather than this
    // whole screen (loadCodingListCsvFormats() leaves a null entry per
    // failed type, loadAccountCodingTables() leaves that one table's
    // `freshTableState()` defaults — empty rows, `total: 0` — in place).
    const [[overviewResponse, configResponse, matchingConfigResponse, standardRulesResponse]] = await Promise.all([
      Promise.all([
        fetch("/api/org/overview"),
        fetch("/api/approval-config"),
        fetch("/api/matching-config"),
        fetch("/api/matching-config/standard-rules"),
      ]),
      loadCodingListCsvFormats(),
      loadAccountCodingTables(),
      // Its own corner, same as the two calls above — a processes list
      // that fails to load leaves the Stage Restrictions tab showing
      // its own empty state rather than taking down every other tab.
      loadStageRestrictions(),
      loadReturnReasonsTab(),
    ]);
    if (!overviewResponse.ok || !configResponse.ok || !matchingConfigResponse.ok || !standardRulesResponse.ok) {
      console.error(
        `AP Setup load failed: overview ${overviewResponse.status}, config ${configResponse.status}, matching config ${matchingConfigResponse.status}, standard rules ${standardRulesResponse.status}`
      );
      return false;
    }
    const overview = await overviewResponse.json();
    units = overview.units ?? [];
    users = overview.users ?? [];
    costCentreNames = overview.costCentres ?? [];
    config = await configResponse.json();
    matchingConfig = await matchingConfigResponse.json();
    standardRules = (await standardRulesResponse.json()).standardRules ?? [];
    return true;
  } catch (err) {
    console.error("AP Setup load failed", err);
    return false;
  }
}

/**
 * **Which process's stages this tab is showing, and their field
 * restrictions** — loaded eagerly, the same "ready by the time
 * render() runs" discipline `loadCodingListCsvFormats()`/
 * `loadAccountCodingTables()` already established alongside it.
 *
 * Defaults to the first process in the list. Real tenants overwhelmingly
 * run one invoice process; `processes.js` already lets a person manage
 * several, so this tab offers the same picker rather than assuming
 * there is only one, without building a second copy of that screen.
 */
async function loadStageRestrictions(processId) {
  try {
    const listResponse = await fetch("/api/processes");
    if (!listResponse.ok) {
      stageRestrictionsProcesses = [];
      stageRestrictionsDetail = null;
      stageFieldVisibility = {};
      return;
    }
    stageRestrictionsProcesses = (await listResponse.json()).processes ?? [];

    stageRestrictionsProcessId =
      processId ?? (stageRestrictionsProcesses.some((p) => p.id === stageRestrictionsProcessId)
        ? stageRestrictionsProcessId
        : stageRestrictionsProcesses[0]?.id ?? null);

    if (!stageRestrictionsProcessId) {
      stageRestrictionsDetail = null;
      stageFieldVisibility = {};
      return;
    }

    const detailResponse = await fetch(`/api/processes/${encodeURIComponent(stageRestrictionsProcessId)}`);
    stageRestrictionsDetail = detailResponse.ok ? await detailResponse.json() : null;
    stageFieldVisibility = {};
    if (!stageRestrictionsDetail) return;

    await Promise.all(
      stageRestrictionsDetail.stages.map(async (stage) => {
        const response = await fetch(`/api/field-visibility?stage=${encodeURIComponent(stage.id)}&includeHidden=1`);
        const body = response.ok ? await response.json() : { fields: [] };
        stageFieldVisibility[stage.id] = (body.fields ?? []).filter((f) => CODING_RESTRICTION_FIELDS.includes(f.field));
      })
    );
  } catch (err) {
    console.error("Stage Restrictions load failed", err);
    stageRestrictionsDetail = null;
    stageFieldVisibility = {};
  }
}

/**
 * **Every stage-level restriction already on this stage, refetched
 * fresh — preserved, not overwritten.** The route replaces a stage's
 * own restrictions wholesale (`PUT /processes/stages/:id/field-
 * visibility`), so a save from this tab has to resend everything
 * already restricted there, not only the one checkbox somebody just
 * touched — otherwise ticking one Account Coding field back on would
 * silently un-restrict every other field a customer or a future
 * screen had restricted at that same stage.
 *
 * Read again here rather than trusted from the last render: two
 * people could have this tab open at once, and a save is not the
 * moment to act on a stale read.
 */
async function currentStageRestrictions(stageId) {
  const response = await fetch(`/api/field-visibility?stage=${encodeURIComponent(stageId)}&includeHidden=1`);
  if (!response.ok) throw new Error(`could not read the current restrictions for stage ${stageId}`);
  const fields = (await response.json()).fields ?? [];
  return fields.filter((f) => f.decidedBy === "stage").map((f) => ({ field: f.field, visibility: f.visibility }));
}

async function setCodingRestrictedAtStage(stageId, field, restrict) {
  const fields = (await currentStageRestrictions(stageId)).filter((f) => f.field !== field);
  if (restrict) fields.push({ field, visibility: "hidden" });

  return fetch(`/api/processes/stages/${encodeURIComponent(stageId)}/field-visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

/**
 * Whether this stage's panel even offers Account Coding checkboxes —
 * decision 0485. A property of the stage itself (`process_stages
 * .offer_field_restrictions`), set once by an operator for a stage
 * that can never have a person keying a line (Intake, Payment
 * Eligible) or, in the other direction, turned back on for a stage
 * that does.
 */
async function setStageOffersFieldRestrictions(stageId, offer) {
  return fetch(`/api/processes/stages/${encodeURIComponent(stageId)}/offer-field-restrictions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer }),
  });
}

/**
 * Whether Complete, at this stage, refuses until the rule that raised
 * the task no longer matches — decision 0487. The general per-(stage,
 * action) route (migrations/0082_stage_actions.sql); "complete" is the
 * only action this screen offers a toggle for today, the same way
 * this screen only ever configured Account Coding restrictions and
 * not every field decision 0114 knows about.
 */
async function setStageReverifiesRuleOnComplete(stageId, reverify) {
  return fetch(`/api/processes/stages/${encodeURIComponent(stageId)}/actions/complete`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reverifyRuleOnComplete: reverify }),
  });
}

/**
 * Where Return can send a document from this stage, and who receives
 * it — decision 0490. See migrations/0085_stage_return_targets.sql
 * for why this is its own small table (a list per stage) rather than
 * a flag alongside `reverifyRuleOnComplete` above.
 */
async function addStageReturnTarget(stageId, targetStageId, teamId) {
  return fetch(`/api/processes/stages/${encodeURIComponent(stageId)}/return-targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetStageId, teamId }),
  });
}

async function removeStageReturnTarget(id) {
  return fetch(`/api/processes/stages/return-targets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * **One panel per stage, three checkboxes each — decision 0483.**
 * `standardMatchingRulesPanel`'s own auto-save-on-toggle shape,
 * reused rather than a Save button: a restriction is a single fact,
 * not a form with several fields that need to land together.
 */
/**
 * Return reasons and the AP team's own email address — decision 0498,
 * points 1 and 4 of five. A flat list, not the Account Coding
 * framework's hierarchy (`coding-lists.js`) — that shape has no use
 * here, and `supplier_return_reasons` was deliberately built as its
 * own simple table (migration 0087) rather than a sixth coding-list
 * type.
 */
async function loadReturnReasonsTab() {
  try {
    const [reasonsResponse, emailResponse] = await Promise.all([
      fetch("/api/admin/return-reasons"),
      fetch("/api/admin/ap-team-email"),
    ]);
    returnReasons = reasonsResponse.ok ? ((await reasonsResponse.json()).reasons ?? []) : [];
    apTeamEmail = emailResponse.ok ? ((await emailResponse.json()).apTeamEmail ?? null) : null;
  } catch (err) {
    console.error("Return reasons tab load failed", err);
    returnReasons = [];
    apTeamEmail = null;
  }
}

function returnReasonsTab(problem) {
  const rows = returnReasons.map((reason) => {
    const labelInput = el("input", { type: "text", value: reason.label });
    const activeCheckbox = el("input", {
      type: "checkbox",
      id: `returnreasonactive-${reason.id}`,
      ...(reason.active ? { checked: "checked" } : {}),
    });
    const save = async () => {
      problem.textContent = "";
      const response = await fetch(`/api/admin/return-reasons/${encodeURIComponent(reason.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelInput.value.trim(), active: activeCheckbox.checked }),
      });
      if (!response.ok) {
        problem.textContent = (await response.json().catch(() => ({}))).error ?? t("apsetup.returnreasons.savefailed");
        return;
      }
      await loadReturnReasonsTab();
      render();
    };
    return el("div", { class: "editgrid" }, [
      labelInput,
      el("label", { for: `returnreasonactive-${reason.id}`, class: "sm muted", text: t("apsetup.returnreasons.active") }),
      activeCheckbox,
      actionLink("save", { onclick: save }),
    ]);
  });

  const newId = el("input", { type: "text", placeholder: t("apsetup.returnreasons.newid") });
  const newLabel = el("input", { type: "text", placeholder: t("apsetup.returnreasons.newlabel") });
  const addReason = async () => {
    problem.textContent = "";
    if (!newId.value.trim() || !newLabel.value.trim()) {
      problem.textContent = t("apsetup.returnreasons.idandlabelrequired");
      return;
    }
    const response = await fetch("/api/admin/return-reasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newId.value.trim(), label: newLabel.value.trim() }),
    });
    if (!response.ok) {
      problem.textContent = (await response.json().catch(() => ({}))).error ?? t("apsetup.returnreasons.savefailed");
      return;
    }
    await loadReturnReasonsTab();
    render();
  };

  const apTeamEmailInput = el("input", { type: "text", value: apTeamEmail ?? "", placeholder: t("apsetup.returnreasons.apteamemailplaceholder") });
  const saveApTeamEmail = async () => {
    problem.textContent = "";
    const response = await fetch("/api/admin/ap-team-email", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apTeamEmail: apTeamEmailInput.value.trim() || null }),
    });
    if (!response.ok) {
      problem.textContent = (await response.json().catch(() => ({}))).error ?? t("apsetup.returnreasons.savefailed");
      return;
    }
    await loadReturnReasonsTab();
    render();
  };

  return el("div", {}, [
    problem,
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.returnreasons") })]),
      el("p", { class: "muted sm", text: t("apsetup.returnreasons.sub") }),
      ...rows,
      el("div", { class: "editgrid" }, [
        newId,
        newLabel,
        actionLink("create", { label: t("apsetup.add"), onclick: addReason }),
      ]),
    ]),
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.returnreasons.apteamemail") })]),
      el("p", { class: "muted sm", text: t("apsetup.returnreasons.apteamemailsub") }),
      el("div", { class: "editgrid" }, [apTeamEmailInput, actionLink("save", { onclick: saveApTeamEmail })]),
    ]),
  ]);
}

function stageRestrictionsTab(problem) {
  const intro = el("p", { class: "muted sm", text: t("apsetup.stagerestrictions.sub") });

  const processPicker =
    stageRestrictionsProcesses.length > 1
      ? el("div", { class: "cardhead processpicker" }, [
          el("label", { text: t("apsetup.stagerestrictions.process") }),
          (() => {
            const select = el(
              "select",
              {},
              stageRestrictionsProcesses.map((p) =>
                el("option", {
                  value: p.id,
                  text: p.name,
                  ...(p.id === stageRestrictionsProcessId ? { selected: "selected" } : {}),
                })
              )
            );
            select.onchange = async () => {
              await loadStageRestrictions(select.value);
              render();
            };
            return select;
          })(),
        ])
      : null;

  if (!stageRestrictionsDetail) {
    return el("div", {}, [
      intro,
      ...(processPicker ? [processPicker] : []),
      el("p", { class: "muted", text: t("apsetup.stagerestrictions.noprocess") }),
    ]);
  }

  const stagePanels = stageRestrictionsDetail.stages.map((stage) => {
    // **Which stages this screen even offers a checkbox for —
    // decision 0485.** `undefined` reads as offered: an older cached
    // process read, or a stage row this field somehow missed, behaves
    // like the column's own default rather than silently disappearing.
    const offered = stage.offerFieldRestrictions !== false;

    const offerToggleId = `stageoffer-${stage.id}`;
    const offerToggle = el("input", {
      type: "checkbox",
      id: offerToggleId,
      ...(offered ? { checked: "checked" } : {}),
    });
    offerToggle.onchange = async () => {
      problem.textContent = "";
      const offer = offerToggle.checked;
      try {
        const response = await setStageOffersFieldRestrictions(stage.id, offer);
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.stagerestrictions.savefailed");
          offerToggle.checked = !offerToggle.checked;
          return;
        }
        await loadStageRestrictions(stageRestrictionsProcessId);
        render();
      } catch {
        problem.textContent = t("apsetup.stagerestrictions.savefailed");
        offerToggle.checked = !offerToggle.checked;
      }
    };
    const offerToggleRow = el("div", { class: "assignmentrow" }, [
      el("label", { for: offerToggleId, text: t("apsetup.stagerestrictions.offerhere") }),
      offerToggle,
    ]);

    /**
     * **What Complete does at this stage — decision 0487.** Independent
     * of the Account Coding checkboxes above: an Approval stage that
     * never offers field restrictions (it has no Account Coding fields
     * to restrict) can still reasonably want its own Complete gated on
     * the rule that raised it no longer matching, so this row is not
     * nested inside the `offered` branch below.
     */
    const reverifyToggleId = `stagereverify-${stage.id}`;
    const reverifyToggle = el("input", {
      type: "checkbox",
      id: reverifyToggleId,
      ...(stage.reverifyRuleOnComplete ? { checked: "checked" } : {}),
    });
    reverifyToggle.onchange = async () => {
      problem.textContent = "";
      const reverify = reverifyToggle.checked;
      try {
        const response = await setStageReverifiesRuleOnComplete(stage.id, reverify);
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.stagerestrictions.savefailed");
          reverifyToggle.checked = !reverifyToggle.checked;
          return;
        }
        await loadStageRestrictions(stageRestrictionsProcessId);
        render();
      } catch {
        problem.textContent = t("apsetup.stagerestrictions.savefailed");
        reverifyToggle.checked = !reverifyToggle.checked;
      }
    };
    const reverifyToggleRow = el("div", { class: "assignmentrow" }, [
      el("label", { for: reverifyToggleId, text: t("apsetup.stagerestrictions.reverifyoncomplete") }),
      reverifyToggle,
    ]);

    /**
     * **Where Return can send a document from this stage, and who
     * receives it — decision 0490.** Independent of the Account
     * Coding checkboxes above, the same reason `reverifyToggleRow`
     * already sits outside the `offered` branch: an Approval stage
     * with no Account Coding fields to restrict can still want a
     * curated list of where Return may send it back to.
     *
     * **The add-row form only appears once there is something to
     * choose** — another stage in this process to name, and a team to
     * hand it to. A single-stage process, or one with no teams yet,
     * shows the (empty) list and nothing to add to it, rather than two
     * pickers with nothing in either.
     */
    const otherStages = stageRestrictionsDetail.stages.filter((s) => s.id !== stage.id);
    const teams = stageRestrictionsDetail.teams ?? [];
    const hasAddOptions = otherStages.length > 0 && teams.length > 0;

    const targetStagePicker = el("select", {}, otherStages.map((s) => el("option", { value: s.id, text: s.name })));
    const teamPicker = el("select", {}, teams.map((tm) => el("option", { value: tm.id, text: tm.name })));

    const addTargetBtn = actionLink("create", {
      primary: true,
      label: t("apsetup.add"),
      onclick: async () => {
        problem.textContent = "";
        try {
          const response = await addStageReturnTarget(stage.id, targetStagePicker.value, teamPicker.value);
          if (!response.ok) {
            problem.textContent = (await response.json()).error ?? t("apsetup.stagerestrictions.savefailed");
            return;
          }
          await loadStageRestrictions(stageRestrictionsProcessId);
          render();
        } catch {
          problem.textContent = t("apsetup.stagerestrictions.savefailed");
        }
      },
    });

    const targetRows = (stage.returnTargets ?? []).map((target) =>
      el("div", { class: "assignmentrow" }, [
        el("span", { text: `${target.targetStageName} — ${target.teamName}` }),
        el("button", {
          text: t("roles.remove"),
          onclick: async () => {
            problem.textContent = "";
            try {
              const response = await removeStageReturnTarget(target.id);
              if (!response.ok) {
                problem.textContent = (await response.json()).error ?? t("apsetup.stagerestrictions.savefailed");
                return;
              }
              await loadStageRestrictions(stageRestrictionsProcessId);
              render();
            } catch {
              problem.textContent = t("apsetup.stagerestrictions.savefailed");
            }
          },
        }),
      ])
    );

    // A flat array, not a wrapping div — the same shape the Account
    // Coding fields section above returns, so `.sectionlabel`'s own
    // top margin does the only spacing job needed between sections.
    const returnTargetsSection = [
      el("div", { class: "sectionlabel", text: t("apsetup.stagerestrictions.returntargetsheading") }),
      el("p", { class: "muted sm", text: t("apsetup.stagerestrictions.returntargetshint") }),
      el(
        "div",
        { class: "assignmentlist" },
        targetRows.length > 0 ? targetRows : [el("p", { class: "muted sm", text: t("apsetup.stagerestrictions.notargetsyet") })]
      ),
      ...(hasAddOptions
        ? [
            el("div", { class: "editgrid" }, [
              el("label", { text: t("apsetup.stagerestrictions.targetstage") }),
              targetStagePicker,
              el("label", { text: t("apsetup.stagerestrictions.returnteam") }),
              teamPicker,
            ]),
            el("div", { class: "statebuttons" }, [addTargetBtn]),
          ]
        : []),
    ];

    const fields = stageFieldVisibility[stage.id] ?? [];

    const body = !offered
      ? [
          el("p", { class: "muted sm", text: t("apsetup.stagerestrictions.notoffered") }),
          offerToggleRow,
          reverifyToggleRow,
          ...returnTargetsSection,
        ]
      : (() => {
          const rows = CODING_RESTRICTION_FIELDS.map((field) => {
            const resolved = fields.find((f) => f.field === field);
            const label = t(`field.${field}`);
            const checkboxId = `stagerestrict-${stage.id}-${field}`;

            // Hidden for everyone already, and not because of this
            // stage — nothing here to restrict further, so the row
            // explains rather than offering a checkbox that could
            // never do anything.
            if (resolved?.visibility === "hidden" && resolved.decidedBy !== "stage") {
              return el("div", { class: "assignmentrow" }, [
                el("div", {}, [
                  el("span", { text: label }),
                  el("p", { class: "muted sm", text: `${t("apsetup.stagerestrictions.hiddeneverywhere")}` }),
                ]),
                el("input", { type: "checkbox", disabled: "disabled" }),
              ]);
            }

            const checked = resolved ? resolved.visibility !== "hidden" : true;
            const checkbox = el("input", { type: "checkbox", id: checkboxId, ...(checked ? { checked: "checked" } : {}) });
            checkbox.onchange = async () => {
              problem.textContent = "";
              const restrict = !checkbox.checked;
              try {
                const response = await setCodingRestrictedAtStage(stage.id, field, restrict);
                if (!response.ok) {
                  problem.textContent = (await response.json()).error ?? t("apsetup.stagerestrictions.savefailed");
                  checkbox.checked = !checkbox.checked;
                  return;
                }
                await loadStageRestrictions(stageRestrictionsProcessId);
                render();
              } catch {
                problem.textContent = t("apsetup.stagerestrictions.savefailed");
                checkbox.checked = !checkbox.checked;
              }
            };

            return el("div", { class: "assignmentrow" }, [
              el("label", { for: checkboxId, text: label }),
              checkbox,
            ]);
          });

          return [
            el("div", { class: "sectionlabel", text: t("apsetup.stagerestrictions.fieldsheading") }),
            el("div", { class: "assignmentlist" }, rows),
            el("p", { class: "muted sm", text: t("apsetup.stagerestrictions.fieldshint") }),
            offerToggleRow,
            reverifyToggleRow,
            ...returnTargetsSection,
          ];
        })();

    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: stage.name }),
        el("span", { class: "stagebadge", text: stage.ruleSetName ?? t("processes.automatic") }),
      ]),
      ...body,
    ]);
  });

  return el("div", {}, [intro, ...(processPicker ? [processPicker] : []), ...stagePanels, problem]);
}

/**
 * **The Matching tab — decision 0472.** One form, one Save, the exact
 * same "replace, not merge" shape `modeForm` below already uses: all
 * three fields submit together, so a save can never leave one field's
 * old value silently in place. Percentages are entered as plain
 * numbers (`5` means 5%), matching the units `org_matching_config`
 * itself is stored in and `po-matching.ts`'s own doc comments already
 * describe them by.
 *
 * **No supplier-specific override here** — `supplier.amountTolerancePct`/
 * `quantityTolerancePct` still supersede this org-wide default when a
 * supplier has its own, unchanged by this tab existing (decision 0468's
 * own scoping: this tab configures the fallback only).
 */
function matchingConfigTab(problem) {
  const amountInput = el("input", { type: "number", min: "0", step: "0.01" });
  amountInput.value = String(matchingConfig.amountTolerancePct);
  const quantityInput = el("input", { type: "number", min: "0", step: "0.01" });
  quantityInput.value = String(matchingConfig.quantityTolerancePct);
  const enabledCheckbox = el("input", {
    type: "checkbox",
    id: "quantitymatchingenabled",
    ...(matchingConfig.quantityMatchingEnabled ? { checked: "checked" } : {}),
  });

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("apsetup.amounttolerance") }),
    amountInput,
    el("label", { text: t("apsetup.quantitytolerance") }),
    quantityInput,
    el("label", { for: "quantitymatchingenabled", text: t("apsetup.quantitymatchingenabled") }),
    enabledCheckbox,
  ]);

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const amountTolerancePct = Number(amountInput.value);
      const quantityTolerancePct = Number(quantityInput.value);
      if (!Number.isFinite(amountTolerancePct) || amountTolerancePct < 0 || !Number.isFinite(quantityTolerancePct) || quantityTolerancePct < 0) {
        problem.textContent = t("apsetup.savematchingfailed");
        return;
      }
      try {
        const response = await fetch("/api/matching-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountTolerancePct,
            quantityTolerancePct,
            quantityMatchingEnabled: enabledCheckbox.checked,
          }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.savematchingfailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.savematchingfailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.matching") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.matchingsub") }),
    form,
    problem,
  ]);
}

/**
 * **Standard matching rules — decision 0474.** The operator's own
 * original suggestion, settled narrower than first read: a checkbox
 * here only enables/disables a rule that already exists — it never
 * compiles or activates one. Creating a standard rule for the first
 * time is unchanged, ordinary rule authoring on whichever stage's own
 * Rules screen the operator picks (write the suggested sentence,
 * compile, confirm every generated example, activate) — the same
 * "never auto-promote a generated rule" gate every rule here has
 * always had.
 *
 * **Each of the four canonical names can have zero, one, or more than
 * one match** — `matching-config-route.ts`'s own
 * `handleGetStandardMatchingRules` looks across every stage in the
 * org, since this tab has no single "the Matching stage" the way a
 * stage's own Rules screen does. Zero shows the suggested sentence as
 * a starting point; more than one shows a row per match, each toggled
 * independently, never one silently picked over the other.
 *
 * **Only `live`/`paused` are interactive.** A `draft`/
 * `awaiting_confirmation` rule has never been activated — flipping
 * `enabled` on one would change nothing a person could see, since
 * `stateOf` (`rules-list-route.ts`) only ever reads "live" once
 * `approved_at` is set. Shown disabled, with the reason, rather than a
 * checkbox that quietly does nothing when clicked.
 */
function standardMatchingRulesPanel(problem) {
  const rows = standardRules.flatMap((standard) => {
    if (standard.matches.length === 0) {
      return [
        el("div", { class: "assignmentrow" }, [
          el("div", {}, [
            el("span", { text: standard.name }),
            el("p", { class: "muted sm", text: t("apsetup.standardrulenotcreated") }),
            el("p", { class: "muted sm", text: `${t("apsetup.standardrulesuggested")} "${standard.suggestedSentence}"` }),
          ]),
        ]),
      ];
    }

    return standard.matches.map((match, index) => {
      const interactive = match.state === "live" || match.state === "paused";
      const checkboxId = `standardrule-${standard.key}-${index}`;
      const checkbox = el("input", {
        type: "checkbox",
        id: checkboxId,
        ...(match.enabled ? { checked: "checked" } : {}),
        ...(interactive ? {} : { disabled: "disabled" }),
      });
      if (interactive) {
        checkbox.onchange = async () => {
          problem.textContent = "";
          try {
            const response = await fetch(`/api/rules/${encodeURIComponent(match.ruleId)}/enabled`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: checkbox.checked }),
            });
            if (!response.ok) {
              problem.textContent = (await response.json()).error ?? t("apsetup.standardrulesavefailed");
              checkbox.checked = !checkbox.checked;
              return;
            }
            await load();
            render();
          } catch {
            problem.textContent = t("apsetup.standardrulesavefailed");
            checkbox.checked = !checkbox.checked;
          }
        };
      }

      return el("div", { class: "assignmentrow" }, [
        el("div", {}, [
          el("label", { for: checkboxId, text: `${standard.name} — ${match.stageName ?? "?"} (${match.processName ?? "?"})` }),
          ...(interactive
            ? []
            : [el("p", { class: "muted sm", text: t("apsetup.standardrulepending") })]),
        ]),
        checkbox,
      ]);
    });
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.standardrules") })]),
    el("p", { class: "muted sm", text: t("apsetup.standardrulessub") }),
    el("div", { class: "assignmentlist" }, rows),
    problem,
  ]);
}

/**
 * **Mode and Default Approver, one form, one Save — decision 0440.**
 * The same "replace, not merge" shape `openPersonPropertiesForm`'s own
 * properties form already takes: both fields submit together, since a
 * mode change with no default approver considered is exactly the
 * routing gap decision 0439's own operator conversation named.
 */
function modeForm(problem) {
  const modePicker = el(
    "select",
    {},
    MODES.map((mode) =>
      el("option", { value: mode, text: t(`apsetup.mode.${mode}`), ...(mode === config.mode ? { selected: "selected" } : {}) })
    )
  );
  const approverPicker = el("select", {}, [
    el("option", { value: "", text: t("apsetup.defaultapprovernone") }),
    ...users.map((u) =>
      el("option", { value: u.id, text: u.name, ...(u.id === config.defaultApproverUserId ? { selected: "selected" } : {}) })
    ),
  ]);

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("apsetup.mode") }),
    modePicker,
    el("label", { text: t("apsetup.defaultapprover") }),
    approverPicker,
  ]);

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch("/api/approval-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: modePicker.value, defaultApproverUserId: approverPicker.value || null }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.savemodefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.savemodefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.approvalhierarchy") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.modesub") }),
    form,
    problem,
  ]);
}

/**
 * **A search box plus a capped list, shared by both override
 * tables — decision 0442.** The operator's own request: the list
 * "build below the configuration boxes" (the add-row form, moved
 * above this in both sections below) and be "searchable and
 * paginated, as the Document search looks" — Documents' own search
 * turned out to mean a query box plus a capped, `LIMIT`-ed result set
 * with a "shown of total" note (`documents.js`'s own `searchedcount`),
 * not real page-number controls, which this app has nowhere at all;
 * matched here rather than inventing a first one.
 *
 * **`onchange`, not `oninput`, and a re-focus after re-rendering** —
 * the same discipline `documents.js`'s own search box already uses
 * and comments on: `render()` replaces the whole shell's children, so
 * filtering on every keystroke would rebuild the input out from under
 * itself mid-type.
 */
function searchableOverrideList({ query, onQueryChange, searchId, hint, items, matchText, rowsFor, emptyText, nomatchText }) {
  const needle = query.trim().toLowerCase();
  const matches = needle ? items.filter((item) => matchText(item).toLowerCase().includes(needle)) : items;
  const shown = matches.slice(0, OVERRIDE_DISPLAY_CAP);

  const search = el("input", { type: "search", id: searchId, placeholder: hint });
  search.value = query;
  search.onchange = () => {
    onQueryChange(search.value);
    render();
    document.getElementById(searchId)?.focus();
  };

  const rows = shown.length > 0 ? rowsFor(shown) : [el("p", { class: "muted", text: needle ? nomatchText : emptyText })];

  return [
    el("div", { class: "searchrow" }, [search]),
    el("div", { class: "assignmentlist" }, rows),
    ...(matches.length > shown.length
      ? [
          el("p", {
            class: "sm muted",
            text: t("apsetup.overridesearchedcount")
              .replace("{shown}", String(shown.length))
              .replace("{total}", String(matches.length)),
          }),
        ]
      : []),
  ];
}

/**
 * **One unit-scoped override at a time — decision 0440.** Same
 * "inline picker row plus its own Add button" shape `openTeamForm`'s
 * own member picker already uses, rather than a second pop-out
 * component for what is, per row, three fields.
 *
 * **The list moved below the add-row form, and gained search — decision
 * 0442**, at the operator's own request once these lists started to
 * grow: the add-row controls stay the first thing you see, the search
 * box and the (now potentially long) list of existing overrides follow.
 */
function supervisorOverridesSection(problem) {
  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const supervisorPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const addBtn = actionLink("create", {
    primary: true,
    label: t("apsetup.add"),
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch("/api/approval-config/supervisor-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userPicker.value, unitId: unitPicker.value, supervisorId: supervisorPicker.value }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.overridesavefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("apsetup.supervisoroverrides") }),
      el("div", { class: "statebuttons" }, [addBtn]),
    ]),
    el("p", { class: "muted sm", text: t("apsetup.supervisoroverridessub") }),
    el("div", { class: "editgrid" }, [
      el("label", { text: t("apsetup.person") }),
      userPicker,
      el("label", { text: t("roles.org") }),
      unitPicker,
      el("label", { text: t("apsetup.supervisor") }),
      supervisorPicker,
    ]),
    ...searchableOverrideList({
      query: supervisorSearchQuery,
      onQueryChange: (value) => {
        supervisorSearchQuery = value;
      },
      searchId: "supervisoroverridesearch",
      hint: t("apsetup.supervisoroverridesearchhint"),
      items: config.supervisorOverrides,
      matchText: (o) => `${o.userName} ${o.unitName} ${o.supervisorName}`,
      emptyText: t("apsetup.nosupervisoroverrides"),
      nomatchText: t("apsetup.supervisoroverridenomatch"),
      rowsFor: (shown) =>
        shown.map((o) =>
          el("div", { class: "assignmentrow" }, [
            el("span", { text: `${o.userName} — ${o.unitName} — ${t("apsetup.reportsto")} ${o.supervisorName}` }),
            el("button", {
              text: t("roles.remove"),
              onclick: async () => {
                problem.textContent = "";
                try {
                  const response = await fetch(
                    `/api/approval-config/supervisor-overrides/${encodeURIComponent(o.userId)}/${encodeURIComponent(o.unitId)}`,
                    { method: "DELETE" }
                  );
                  if (!response.ok) {
                    problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
                    return;
                  }
                  await load();
                  render();
                } catch {
                  problem.textContent = t("apsetup.overridesavefailed");
                }
              },
            }),
          ])
        ),
    }),
  ]);
}

/**
 * **The list moved below the add-row form, and gained search —
 * decision 0442.** Same reasoning as `supervisorOverridesSection`
 * above, and the same shared `searchableOverrideList()` helper.
 */
function limitOverridesSection(problem) {
  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const currencyInput = currencyPicker();
  const amountInput = el("input", { type: "number", min: "0" });
  const addBtn = actionLink("create", {
    primary: true,
    label: t("apsetup.add"),
    onclick: async () => {
      problem.textContent = "";
      const maxAmount = amountInput.value.trim();
      if (!maxAmount) return;
      try {
        const response = await fetch("/api/approval-config/limit-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: userPicker.value,
            unitId: unitPicker.value,
            currency: currencyInput.value.trim(),
            maxAmount: Number(maxAmount),
          }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.overridesavefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("apsetup.limitoverrides") }),
      el("div", { class: "statebuttons" }, [addBtn]),
    ]),
    el("p", { class: "muted sm", text: t("apsetup.limitoverridessub") }),
    el("div", { class: "editgrid" }, [
      el("label", { text: t("apsetup.person") }),
      userPicker,
      el("label", { text: t("roles.org") }),
      unitPicker,
      el("label", { text: t("apsetup.limitcurrency") }),
      currencyInput,
      el("label", { text: t("apsetup.limitamount") }),
      amountInput,
    ]),
    ...searchableOverrideList({
      query: limitSearchQuery,
      onQueryChange: (value) => {
        limitSearchQuery = value;
      },
      searchId: "limitoverridesearch",
      hint: t("apsetup.limitoverridesearchhint"),
      items: config.limitOverrides,
      matchText: (o) => `${o.userName} ${o.unitName} ${o.currency} ${o.maxAmount}`,
      emptyText: t("apsetup.nolimitoverrides"),
      nomatchText: t("apsetup.limitoverridenomatch"),
      rowsFor: (shown) =>
        shown.map((o) =>
          el("div", { class: "assignmentrow" }, [
            el("span", { text: `${o.userName} — ${o.unitName} — ${o.currency} ${o.maxAmount}` }),
            el("button", {
              text: t("roles.remove"),
              onclick: async () => {
                problem.textContent = "";
                try {
                  const response = await fetch(
                    `/api/approval-config/limit-overrides/${encodeURIComponent(o.userId)}/${encodeURIComponent(o.unitId)}/${encodeURIComponent(o.currency)}`,
                    { method: "DELETE" }
                  );
                  if (!response.ok) {
                    problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
                    return;
                  }
                  await load();
                  render();
                } catch {
                  problem.textContent = t("apsetup.overridesavefailed");
                }
              },
            }),
          ])
        ),
    }),
  ]);
}

// **Which dimension a drag started on — decision 0452, the same
// module-level-variable shape `processes.js`'s own `draggedStageId`
// already uses for stage reordering (decision 0352), for the same
// reason: jsdom's own DataTransfer support is incomplete, and drag
// source and drop target are always this one page.
let draggedDimensionId = null;

/**
 * **Cost-Object Priority — decision 0452.** Turns decision 0450's own
 * mock-up (`docs/design/mockups/cost-object-approval.html`) into the
 * real panel: a checkbox and drag-to-reorder per dimension, the same
 * `.assignmentrow` layout and direction-aware drop `processes.js`'s
 * own `stageChevrons()` already established for reordering process
 * stages (decision 0352) — reused rather than the mock-up's own
 * bespoke `.priorow`/`.switch` CSS, which nothing else in this app's
 * real screens has. Calls the new
 * `PUT /approval-config/cost-object-dimensions`
 * (`handleSetCostObjectDimensions`) with the full four-row array every
 * time, the same "replace, not merge" shape `modeForm`'s own doc
 * comment already establishes for this screen's other config forms.
 *
 * **Shown only when Mode is Cost-Object** — the mock-up's own
 * condition, kept: the panel is meaningless in any other mode, since
 * nothing reads `cost_object_dimensions` unless `resolveApprovalTargets`
 * is actually dispatching to `resolveCostObjects`.
 *
 * **"Priority" stays the panel's own name; the sub-copy is what
 * changed.** The mock-up's own wording ("the highest-priority
 * dimension... wins; the rest are not consulted") was written before
 * the operator settled the open question the design doc raised — the
 * real answer, confirmed directly: every enabled, coded dimension
 * raises its own task, in parallel. `sequence` is display order only,
 * exactly as migration 0077's own header comment states; there is
 * deliberately no "walk-through" example here the way the mock-up had
 * one, since a single ordered path is no longer the true story.
 *
 * **Each toggle or reorder saves immediately** — no separate Save
 * button, the same "acts the moment you click it" shape this tab's own
 * override rows already use for Add/Remove.
 */
function costObjectPriorityPanel(problem) {
  if (config.mode !== "cost_object") return null;

  const dimensions = config.costObjectDimensions ?? [];

  const save = async (next) => {
    problem.textContent = "";
    try {
      const response = await fetch("/api/approval-config/cost-object-dimensions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dimensions: next.map((d, i) => ({ listTypeId: d.listTypeId, enabled: d.enabled, sequence: i })),
        }),
      });
      if (!response.ok) {
        problem.textContent = (await response.json()).error ?? t("apsetup.costobjectsavefailed");
        return;
      }
      await load();
      render();
    } catch {
      problem.textContent = t("apsetup.costobjectsavefailed");
    }
  };

  const rows = dimensions.map((dimension, i) => {
    const enableCheckbox = el("input", {
      type: "checkbox",
      id: `costobjectenable-${dimension.listTypeId}`,
      ...(dimension.enabled ? { checked: "checked" } : {}),
    });
    enableCheckbox.onchange = () => {
      const next = dimensions.map((d) => ({ ...d }));
      next[i].enabled = enableCheckbox.checked;
      save(next);
    };

    return el(
      "div",
      {
        class: "assignmentrow",
        draggable: "true",
        ondragstart: () => {
          draggedDimensionId = dimension.listTypeId;
        },
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          if (!draggedDimensionId || draggedDimensionId === dimension.listTypeId) return;
          // Direction-aware, the same reasoning `processes.js`'s own
          // stage-reorder drop handler already gives: dropping onto a
          // target reads as "move it to about here."
          const sourceIndex = dimensions.findIndex((d) => d.listTypeId === draggedDimensionId);
          const targetIndex = dimensions.findIndex((d) => d.listTypeId === dimension.listTypeId);
          const dragged = dimensions[sourceIndex];
          const order = dimensions.filter((d) => d.listTypeId !== draggedDimensionId);
          const filteredTargetIndex = order.findIndex((d) => d.listTypeId === dimension.listTypeId);
          const insertAt = sourceIndex < targetIndex ? filteredTargetIndex + 1 : filteredTargetIndex;
          order.splice(insertAt, 0, dragged);
          draggedDimensionId = null;
          save(order);
        },
      },
      [
        el("span", { text: `${i + 1}. ${dimension.name}` }),
        el("label", { for: `costobjectenable-${dimension.listTypeId}`, class: "sm muted", text: t("apsetup.costobjectenable") }),
        enableCheckbox,
      ]
    );
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.costobjectpriority") })]),
    el("p", { class: "muted sm", text: t("apsetup.costobjectprioritysub") }),
    el("div", { class: "assignmentlist" }, rows),
  ]);
}

function approvalHierarchyTab() {
  const problem = el("div", { class: "warn" });
  const priorityPanel = costObjectPriorityPanel(problem);
  return el("div", {}, [
    modeForm(problem),
    ...(priorityPanel ? [priorityPanel] : []),
    supervisorOverridesSection(problem),
    limitOverridesSection(problem),
  ]);
}

function tabBar() {
  return el(
    "div",
    { class: "tabbar" },
    TABS.map((tab) =>
      el("button", {
        class: `tab${activeTab === tab.key ? " active" : ""}`,
        text: t(tab.labelKey),
        onclick: () => {
          activeTab = tab.key;
          render();
        },
      })
    )
  );
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  if (!activeTab) activeTab = TABS[0].key;

  const activeSection = {
    matching: () =>
      el("div", {}, [
        matchingConfigTab(el("div", { class: "warn" })),
        standardMatchingRulesPanel(el("div", { class: "warn" })),
      ]),
    coding: () =>
      accountCodingTab({
        units,
        users,
        costCentreNames,
        rerender: render,
      }),
    approvalhierarchy: () => approvalHierarchyTab(),
    stagerestrictions: () => stageRestrictionsTab(el("div", { class: "warn" })),
    returnreasons: () => returnReasonsTab(el("div", { class: "warn" })),
  }[activeTab]();

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.apsetup"), t("apsetup.subtitle")),
        tabBar(),
        activeSection,
      ])
    )
  );
}

function renderLoadFailed() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.apsetup"), t("apsetup.subtitle")),
        el("p", { class: "problem", role: "status", text: t("apsetup.loadfailed") }),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("apsetup");
  if (!hasMyPermission("Admin.Configure") || !(await load())) {
    renderLoadFailed();
    return;
  }
  render();
}

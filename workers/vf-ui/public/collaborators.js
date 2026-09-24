import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * "Add person to conversation" — decision 0468's own picture, built in
 * decision 0470.
 *
 * **A standing bar above the feed, not a timestamped event in it** —
 * the same reasoning `viewer.js`'s own unreadable-document banner
 * already uses for "who is here" versus "what happened." Sits above
 * `activity.js`'s own `content` node in the Timeline / Chat pane,
 * built and owned separately: `activity.js`'s own state-reset-per-
 * document discipline (decision 0269) applies here too, so this module
 * keeps the same shape rather than reach into that one.
 *
 * **`Procurement.Collaborate` holders see this bar too** — the roster
 * itself is part of what "view an invoice you've been added to"
 * (decision 0468) means, the same `GET /documents/:id/collaborators`
 * gate the activity feed and comment box already widened to. Only
 * "Add person" itself stays `AP.Review`-only, matching this
 * codebase's own habit of never hiding a control the caller cannot
 * use — the button is shown to everyone who can see this bar at all,
 * and a Business User who tries it simply sees the same `forbidden`
 * message any other route here would give.
 *
 * **The search box is a stable node, not rebuilt on every keystroke.**
 * Everything else here follows `activity.js`'s own "rebuild the whole
 * `content` node" discipline, but that would destroy and recreate the
 * `<input>` on every `oninput` — losing focus and cursor position
 * mid-word, the one thing a search-as-you-type box cannot do. The
 * input and its results container are created once, the moment the
 * panel opens, and reused for as long as it stays open; only the
 * results underneath it are swapped in and out as answers arrive.
 *
 * **Removing a collaborator — decision 0476.** A small "x" on every
 * chip, calling `DELETE /documents/:id/collaborators/:userId`, gated
 * server-side on the new `AP.Manager` permission — deliberately
 * narrower than the `AP.Review` that can add one, per the operator's
 * own instruction. Shown on every chip regardless of who is looking,
 * matching this file's own stated habit just above for the Add
 * button: never hide a control the caller cannot use, let the real
 * 403 answer for itself. No confirmation step — the same "acts the
 * moment you click it" discipline `ap-setup.js`'s own override rows
 * already use for their own Remove buttons, and reversible the same
 * way: the person can be added right back.
 */

let collaborators = null;
let loading = false;
let loadError = null;
let panelOpen = false;
let searchQuery = "";
let searchResults = [];
let searching = false;
let searchError = null;
let addError = null;
let removeError = null;
let searchGeneration = 0;
let searchInputNode = null;
let searchResultsNode = null;

function reset() {
  collaborators = null;
  loading = false;
  loadError = null;
  panelOpen = false;
  searchQuery = "";
  searchResults = [];
  searching = false;
  searchError = null;
  addError = null;
  removeError = null;
  searchGeneration = 0;
  searchInputNode = null;
  searchResultsNode = null;
}

async function load(invoiceId, content) {
  loading = true;
  loadError = null;
  renderContent(content, invoiceId);

  const response = await fetch(`/api/documents/${encodeURIComponent(invoiceId)}/collaborators`);
  if (!response.ok) {
    loading = false;
    // **Silent for a plain 403, out loud for anything else.** Whoever
    // can see this tab at all can already see the roster (the same
    // gate `GET /documents/:id/activity` uses) — a 403 here means the
    // widening hasn't reached this account yet, not a real failure
    // worth a warning banner every time the tab opens.
    if (response.status !== 403) loadError = t("activity.loadfailed");
    renderContent(content, invoiceId);
    return;
  }

  collaborators = (await response.json()).collaborators ?? [];
  loading = false;
  renderContent(content, invoiceId);
}

function initials(name) {
  return String(name)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function addPerson(invoiceId, userId, content) {
  addError = null;
  const response = await fetch(`/api/documents/${encodeURIComponent(invoiceId)}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    addError = t("activity.addpersonfailed");
    renderContent(content, invoiceId);
    return;
  }

  panelOpen = false;
  searchInputNode = null;
  searchResultsNode = null;
  searchResults = [];
  searchQuery = "";
  // **Reload rather than append locally** — the same read-after-write
  // discipline `activity.js`'s own `post()` already uses: the server's
  // own `addedBy`/`addedAt` are what render, not a client guess.
  await load(invoiceId, content);
}

/**
 * Removing a collaborator — decision 0476. Server-gated on
 * `AP.Manager`; a caller without it gets the same real `forbidden`
 * response this file already surfaces for a refused add.
 */
async function removePerson(invoiceId, userId, content) {
  removeError = null;
  const response = await fetch(
    `/api/documents/${encodeURIComponent(invoiceId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    removeError = t("activity.removepersonfailed");
    renderContent(content, invoiceId);
    return;
  }

  // Reload rather than filter locally — same discipline as addPerson().
  await load(invoiceId, content);
}

/**
 * Rebuilds only what the search results container holds — never the
 * input beside it, so typing never loses focus.
 */
function renderSearchResults(invoiceId, content) {
  if (!searchResultsNode) return;

  if (searchError) {
    searchResultsNode.replaceChildren(el("div", { class: "warn sm", text: searchError }));
    return;
  }

  if (searchResults.length > 0) {
    searchResultsNode.replaceChildren(
      el(
        "div",
        { class: "collabsearchresults" },
        searchResults.map((u) => {
          const row = el("button", { class: "collabsearchresult" }, [
            el("div", { text: u.name }),
            el("div", { class: "muted", text: u.email }),
          ]);
          row.onclick = () => addPerson(invoiceId, u.id, content);
          return row;
        })
      )
    );
    return;
  }

  if (!searching && searchQuery.trim().length >= 2) {
    searchResultsNode.replaceChildren(el("div", { class: "muted", text: t("activity.addpersonnomatches") }));
    return;
  }

  searchResultsNode.replaceChildren();
}

/**
 * **Only the newest answer counts** — the same `mine`/live-generation
 * guard `viewer.js`'s own `openSearch()` uses for supplier/buyer
 * search, reimplemented here rather than reached into: that helper
 * closes over `documentPanel()`'s own locals and isn't reachable from
 * this module.
 */
async function runSearch(invoiceId, content, query, mine) {
  searchQuery = query;
  if (query.trim().length < 2) {
    searchResults = [];
    searching = false;
    renderSearchResults(invoiceId, content);
    return;
  }

  try {
    const response = await fetch(`/api/org/users/search?q=${encodeURIComponent(query)}`);
    if (mine !== searchGeneration) return;
    if (!response.ok) {
      searching = false;
      searchError = t("activity.addpersonfailed");
      renderSearchResults(invoiceId, content);
      return;
    }
    searchResults = (await response.json()).users ?? [];
    searching = false;
    renderSearchResults(invoiceId, content);
  } catch {
    if (mine !== searchGeneration) return;
    searching = false;
    searchError = t("activity.addpersonfailed");
    renderSearchResults(invoiceId, content);
  }
}

function ensureSearchNodes(invoiceId, content) {
  if (searchInputNode) return;
  searchInputNode = el("input", {
    type: "text",
    placeholder: t("activity.addpersonsearch"),
    oninput: (e) => {
      searching = true;
      searchError = null;
      renderSearchResults(invoiceId, content);
      const mine = ++searchGeneration;
      runSearch(invoiceId, content, e.target.value, mine);
    },
  });
  searchResultsNode = el("div", { class: "collabsearchresultswrap" });
  renderSearchResults(invoiceId, content);
}

function renderContent(content, invoiceId) {
  const chips = el(
    "div",
    { class: "collabchips" },
    loading
      ? []
      : (collaborators ?? []).map((c) =>
          el("span", { class: "collabchip" }, [
            el("span", { class: "activityavatar", text: initials(c.userName) }),
            el("span", { text: c.userName }),
            el(
              "button",
              {
                class: "collabchipremove",
                title: t("activity.removeperson"),
                onclick: () => removePerson(invoiceId, c.userId, content),
              },
              [icon("close")]
            ),
          ])
        )
  );

  const addButton = el(
    "button",
    {
      class: "collabaddbtn",
      onclick: () => {
        panelOpen = !panelOpen;
        addError = null;
        if (!panelOpen) {
          searchInputNode = null;
          searchResultsNode = null;
          searchResults = [];
          searchQuery = "";
          searchError = null;
        }
        renderContent(content, invoiceId);
      },
    },
    [icon("newperson"), el("span", { text: t("activity.addperson") })]
  );

  let searchPanel = null;
  if (panelOpen) {
    ensureSearchNodes(invoiceId, content);
    searchPanel = el("div", { class: "collabsearch" }, [searchInputNode, searchResultsNode]);
  }

  content.replaceChildren(
    ...[
      loadError ? el("div", { class: "warn sm", text: loadError }) : null,
      addError ? el("div", { class: "warn sm", text: addError }) : null,
      removeError ? el("div", { class: "warn sm", text: removeError }) : null,
      el("div", { class: "collabbar" }, [chips, addButton, searchPanel].filter(Boolean)),
    ].filter(Boolean)
  );

  if (panelOpen) searchInputNode.focus();
}

/**
 * Build the roster bar for one document — called once per
 * `buildDocTabs()`, the same lifecycle `activity.js`'s own
 * `buildActivityTab()` already has.
 */
export function buildCollaboratorsControl(invoiceId) {
  reset();
  const content = el("div", { class: "collabtabcontent" });
  load(invoiceId, content);
  return { content };
}

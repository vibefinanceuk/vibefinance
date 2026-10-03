import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { stackedBarRows, chartLegend } from "/charts.js";

/**
 * Workload balance — decision 0428, the seventh of Workload's own
 * eight key metrics. One ranked member list per team, most imbalanced
 * team first, each labelled with its own name and standard deviation —
 * the same "one group, labelled, per top-level entity" shape decision
 * 0427's own discount-eligibility card already established for
 * currencies, applied here to teams instead (`.teamgroup`, not
 * `.spendcurrency` reused — see `app.css`'s own doc comment for why).
 */

let data = { teams: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/balance${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/**
 * **One bar per team, a section per member** — decision 0615. Dan, on
 * the first version: *"I'm not sure I like or understand the purpose of
 * the Workload balance chart … It takes up a lot of space and shows teams
 * with no items."* A list of members per team, each with a full-width
 * bar, read as one bar per person and said "±0 tasks" for every team of
 * one, where there is nothing to spread. Now each team with open work is
 * one bar, split by who has it, on one scale across teams; beneath it,
 * who is in the team and how many each has, including anyone with none,
 * which is the imbalance the card is for. Teams with nothing open are
 * left out and counted. Most uneven first, as the route orders them.
 *
 * A member's section, or their name in the key, opens their open tasks
 * in that team's queue in Documents; the team's name or total, the whole
 * queue.
 *
 * Colours follow a member's place in their team, busiest first; past
 * five members the fifth onwards are folded into "others" (decision
 * 0242's five colours).
 */
const OTHERS_COLOUR = "var(--text-muted)";

function membersWithColours(team) {
  const members = team.members.map((m, i) => ({ ...m, colour: `var(--chart-${i + 1})` }));
  if (members.length <= 5) return members;
  const others = members.slice(4);
  return [
    ...members.slice(0, 4),
    { userId: null, userName: t("workload.balanceothers"), openCount: others.reduce((n, m) => n + m.openCount, 0), colour: OTHERS_COLOUR, rest: true },
  ];
}

async function openMember(team, member) {
  const { openDocumentsOpenFor } = await import("/documents.js");
  openDocumentsOpenFor(member.userId, member.userName, null, { id: team.teamId, name: team.teamName });
}

async function openTeam(team) {
  const { openDocumentsForTeam } = await import("/documents.js");
  openDocumentsForTeam(team.teamId, team.teamName);
}

function teamSection(team, max) {
  const members = membersWithColours(team);
  const total = members.reduce((n, m) => n + m.openCount, 0);
  return el("div", { class: "teamgroup" }, [
    stackedBarRows(
      [
        {
          label: team.teamName,
          total,
          segments: members.map((m) => ({ value: m.openCount, colour: m.colour, label: m.userName, member: m, rest: m.rest })),
        },
      ],
      { max, onSelect: () => openTeam(team), onSegment: (_row, seg) => openMember(team, seg.member) }
    ),
    chartLegend(
      members.map((m) => ({ label: m.userName, value: m.openCount, colour: m.colour, member: m, rest: m.rest })),
      { onSelect: (item) => openMember(team, item.member) }
    ),
  ]);
}

const openIn = (team) => team.members.reduce((n, m) => n + m.openCount, 0);

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  const busy = data.teams.filter((tm) => openIn(tm) > 0);
  const quiet = data.teams.length - busy.length;
  const head = [el("div", { class: "cardhead" }, [el("h3", { text: t("workload.balance") })])];

  if (busy.length === 0) {
    return el("div", { class: "panel card-graphic" }, [...head, el("div", { class: "muted", text: t("workload.nobalance") })]);
  }

  const max = Math.max(...busy.map(openIn));
  return el("div", { class: "panel card-graphic" }, [
    ...head,
    el("div", { class: "sub", text: t("workload.balancesub") }),
    ...busy.map((tm) => teamSection(tm, max)),
    quiet > 0 ? el("div", { class: "muted balancequiet", text: t("workload.balancequiet").replace("{n}", String(quiet)) }) : null,
  ].filter(Boolean));
}

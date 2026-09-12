import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleDashboard,
  handleSaveDashboard,
  handleResetDashboard,
  handleCardCatalogue,
  CARD_TYPES,
  DEFAULT_CARDS,
} from "../src/dashboard-route.js";
import migrationSql from "../../../migrations/0056_dashboard_cards.sql?raw";
import { handleListMyTasks } from "../src/task-list-route.js";

/**
 * What a person should do next — decision 0240.
 *
 * **Every count is a disclosure.** Decision 0202 made the task list
 * unit-aware, and *"47 items in Approval"* tells somebody there are 47
 * invoices they may not see — which decision 0239 called the part most
 * likely to be got wrong, *"because a count feels like less than a
 * list."*
 */

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, id)
    .run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare(
    "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)"
  )
    .bind(id, `r-${id}`, unit)
    .run();
}

async function units() {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme DE', 'legal_entity')"
  ).run();
}

/** An invoice at a stage, with a task waiting on it. */
async function work(
  id: string,
  unit: string | null,
  opts: { owner?: string; claimed?: string; team?: string; days?: number; due?: string; value?: number } = {}
) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)"
  ).run();

  await env.DB.prepare(
    `INSERT INTO invoice_headers (id, facts_json, org_unit_id, org_assigned_by, total_with_vat)
     VALUES (?, json_object('BT-1', ?, 'BT-9', ?, 'BT-27', 'A Supplier'), ?, ?, ?)`
  )
    .bind(id, id, opts.due ?? null, unit, unit ? "source" : null, opts.value ?? 100)
    .run();

  /**
   * **`'in_progress'`, which is what the system writes** — migration
   * 0009's default. The first version of the seed said `'active'`, so
   * the two cards reading it agreed with the test and **both were
   * wrong** (decision 0241).
   */
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')`
  )
    .bind(`pi-${id}`, id)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'validation', 'matched')"
  )
    .bind(`v-${id}`, `pi-${id}`)
    .run();

  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, claimed_by,
                        required_permission, status, created_at)
     VALUES (?, 'validation', ?, ?, ?, ?, 'AP.Validate', 'open',
             datetime('now', ?))`
  )
    .bind(
      `t-${id}`,
      `v-${id}`,
      opts.owner ?? null,
      opts.team ?? null,
      opts.claimed ?? null,
      `-${opts.days ?? 0} days`
    )
    .run();
}

async function cardsFor(userId: string) {
  const result = await handleDashboard(env.DB, userId);
  const body = result.body as {
    cards: { cardType: string; data: unknown; settings: Record<string, unknown> }[];
    usingDefault: boolean;
  };
  return body;
}

function card<T>(body: { cards: { cardType: string; data: unknown }[] }, type: string): T {
  return body.cards.find((c) => c.cardType === type)?.data as T;
}

beforeEach(async () => {
  await applyTestSchema();
  await units();
});

describe("the closed set, in two places", () => {
  it("names the same card types as the migration", () => {
    /**
     * **A hand-copied list drifts** — decision 0200 found one wrong
     * twice in an hour, and decision 0236 found a key that existed in
     * neither place because the check and the value were removed
     * together.
     */
    const inSql = [...migrationSql.matchAll(/'([a-z_]+)'(?=[,\s)])/g)]
      .map((m) => m[1])
      .filter((v) => (CARD_TYPES as readonly string[]).includes(v) || v.includes("_"));

    for (const type of CARD_TYPES) {
      expect(inSql, `${type} is not in migration 0056`).toContain(type);
    }
  });

  it("gives a new person a dashboard without writing one", async () => {
    /**
     * **A default belongs in code.** Seeding one per user would freeze
     * today's idea of a good dashboard into every account before
     * anybody had seen it.
     */
    await person("alice", ["AP.Review"], null);
    const body = await cardsFor("alice");

    expect(body.usingDefault).toBe(true);
    expect(body.cards).toHaveLength(DEFAULT_CARDS.length);

    const written = await env.DB.prepare("SELECT count(*) AS n FROM dashboard_cards").first<{ n: number }>();
    expect(written?.n).toBe(0);
  });
});

describe("a count is a disclosure", () => {
  /**
   * **The part most likely to be got wrong.** Every query goes through
   * one filter, and these are what say so.
   */
  it("counts only what a person may see", async () => {
    await person("alice", ["AP.Review"], "acme-fr");
    await work("inv-fr", "acme-fr", { owner: "alice" });
    await work("inv-de", "acme-de", { owner: "alice" });

    const body = await cardsFor("alice");
    expect(card<{ count: number }>(body, "waiting_for_me").count).toBe(1);
  });

  it("counts everything for somebody unrestricted", async () => {
    // Which is every customer not using units (decision 0199).
    await person("alice", ["AP.Review"], null);
    await work("inv-fr", "acme-fr", { owner: "alice" });
    await work("inv-de", "acme-de", { owner: "alice" });

    const body = await cardsFor("alice");
    expect(card<{ count: number }>(body, "waiting_for_me").count).toBe(2);
  });

  it("counts nothing for somebody permitted nowhere", async () => {
    /**
     * **Empty is not the same as unrestricted**, and getting it the
     * wrong way round shows somebody everything. Decision 0199 insisted
     * on the distinction and this is where it would be lost.
     */
    await person("mo", ["AP.Validate"], null);
    await work("inv-fr", "acme-fr", { owner: "mo" });

    const body = await cardsFor("mo");
    expect(card<{ count: number }>(body, "waiting_for_me").count).toBe(0);
  });

  it("filters the stage counts too", async () => {
    await person("alice", ["AP.Review"], "acme-fr");
    await work("inv-fr", "acme-fr");
    await work("inv-de", "acme-de");

    const body = await cardsFor("alice");
    const stages = card<{ stages: { n: number }[] }>(body, "where_things_are").stages;
    expect(stages[0].n).toBe(1);
  });
});

describe("on my clock", () => {
  /**
   * **Assigned to me or claimed by me, and not a team queue** —
   * decision 0180 separated owner from claimer, and a team queue is
   * work nobody has taken.
   */
  it("includes what I was given and what I took", async () => {
    await person("alice", ["AP.Review"], null);
    await work("mine-assigned", null, { owner: "alice" });
    await work("mine-claimed", null, { claimed: "alice" });

    const body = await cardsFor("alice");
    expect(card<{ items: unknown[] }>(body, "on_my_clock").items).toHaveLength(2);
  });

  it("leaves out a team queue", async () => {
    // **Available, not mine.** Putting it on somebody's clock would
    // make every member responsible for all of it.
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO org_team_members (team_id, user_id) VALUES ('ap', 'alice')"
    ).run();
    await work("team-item", null, { team: "ap" });

    const body = await cardsFor("alice");
    expect(card<{ items: unknown[] }>(body, "on_my_clock").items).toHaveLength(0);

    // And it still counts as work waiting for her.
    expect(card<{ count: number }>(body, "waiting_for_me").count).toBe(1);
  });

  it("sorts by how long I have held it", async () => {
    await person("alice", ["AP.Review"], null);
    await work("old", null, { owner: "alice", days: 30 });
    await work("new", null, { owner: "alice", days: 1 });

    const body = await cardsFor("alice");
    const items = card<{ items: { invoice_id: string }[] }>(body, "on_my_clock").items;
    expect(items[0].invoice_id).toBe("old");
  });
});

describe("how long things have waited", () => {
  it("buckets rather than averages", async () => {
    /**
     * **An average of three days hides one item from August**, and the
     * one from August is the story.
     */
    await person("alice", ["AP.Review"], null);
    await work("fresh", null, { owner: "alice", days: 0 });
    await work("ancient", null, { owner: "alice", days: 40 });

    const body = await cardsFor("alice");
    const buckets = card<{ buckets: { label: string; n: number }[] }>(body, "ageing").buckets;

    expect(buckets.find((b) => b.label === "<1d")?.n).toBe(1);
    expect(buckets.find((b) => b.label === "30d+")?.n).toBe(1);
  });
});

describe("one card failing is not the dashboard failing", () => {
  it("leaves a broken card empty and the rest standing", async () => {
    /**
     * A stage removed mid-flight, a fact that will not parse — the
     * dashboard is the one screen where a single bad row could take
     * away everything a person came for.
     */
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c1', 'alice', 'items_at_stage', '{"stage":"does-not-exist"}', 0),
              ('c2', 'alice', 'ageing', '{}', 1)`
    ).run();

    const body = await cardsFor("alice");
    expect(body.cards).toHaveLength(2);
    expect(card<{ missing: boolean }>(body, "items_at_stage").missing).toBe(true);
    expect(card<{ buckets: unknown[] }>(body, "ageing").buckets).toHaveLength(5);
  });
});

describe("a card reading a status nothing writes (decision 0241)", () => {
  /**
   * **Reported by looking at the JSON.** Three tasks were open and
   * `where_things_are` returned an empty list, because it filtered on
   * `status = 'active'` — a value this system has never written.
   *
   * **A count of zero is indistinguishable from a quiet queue**, which
   * is what makes this class of fault survive: nothing fails, nothing
   * logs, and the card looks like good news.
   *
   * The tests agreed with it because the seed used the same wrong
   * value. **A fixture that shares a mistake with the code proves the
   * mistake.**
   */
  it("counts an instance the engine actually created", async () => {
    await person("alice", ["AP.Review"], null);
    await work("inv-1", null, { owner: "alice" });

    const body = await cardsFor("alice");
    const stages = card<{ stages: { stage_id: string; n: number }[] }>(body, "where_things_are").stages;

    expect(stages).toHaveLength(1);
    expect(stages[0].n).toBe(1);
  });

  it("agrees with the other cards about how much work there is", async () => {
    /**
     * **The assertion that would have caught it**, and the one the
     * first version did not make: two cards counting the same work
     * should not disagree.
     */
    await person("alice", ["AP.Review"], null);
    await work("inv-1", null, { owner: "alice" });
    await work("inv-2", null, { owner: "alice" });

    const body = await cardsFor("alice");
    const waiting = card<{ count: number }>(body, "waiting_for_me").count;
    const byStage = card<{ stages: { n: number }[] }>(body, "where_things_are").stages.reduce(
      (sum, s) => sum + s.n,
      0
    );

    expect(byStage).toBe(waiting);
  });

  it("counts one at a named stage", async () => {
    await person("alice", ["AP.Review"], null);
    await work("inv-1", null, { owner: "alice" });
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c1', 'alice', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const body = await cardsFor("alice");
    expect(card<{ count: number; missing: boolean }>(body, "items_at_stage").count).toBe(1);
  });
});

describe("arranging a dashboard (decision 0243)", () => {
  /**
   * **The whole set, not one card.** Adding, removing and reordering
   * are three verbs over one list, and three endpoints would each have
   * to renumber afterwards — which is where migration 0056's
   * one-position-per-person invariant would break.
   */
  async function save(cards: unknown[]) {
    return handleSaveDashboard(env.DB, "alice", { cards });
  }

  beforeEach(async () => {
    await person("alice", ["AP.Review"], null);
  });

  it("saves what was sent, in order", async () => {
    const result = await save([
      { cardType: "ageing", settings: {} },
      { cardType: "waiting_for_me", settings: {} },
    ]);
    expect(result.status).toBe(200);

    const body = await cardsFor("alice");
    expect(body.usingDefault).toBe(false);
    expect(body.cards.map((c) => c.cardType)).toEqual(["ageing", "waiting_for_me"]);
  });

  it("keeps one card per position", async () => {
    // Migration 0056's standing invariant, which two cards in the same
    // place would break — and then the order would depend on row order,
    // which is not a rule anybody could state.
    await save([
      { cardType: "ageing", settings: {} },
      { cardType: "done", settings: {} },
      { cardType: "received", settings: {} },
    ]);

    const clash = await env.DB.prepare(
      `SELECT count(*) AS n FROM (
         SELECT position FROM dashboard_cards WHERE user_id = 'alice'
         GROUP BY position HAVING count(*) > 1)`
    ).first<{ n: number }>();
    expect(clash?.n).toBe(0);
  });

  it("replaces rather than merges", async () => {
    /**
     * **A person who removed a card expects it gone.** Merging would
     * make removal the one act the interface could not perform —
     * decision 0211 made the same choice for the supplier load.
     */
    await save([{ cardType: "ageing", settings: {} }, { cardType: "done", settings: {} }]);
    await save([{ cardType: "done", settings: {} }]);

    const body = await cardsFor("alice");
    expect(body.cards.map((c) => c.cardType)).toEqual(["done"]);
  });

  it("takes the same type twice, with different settings", async () => {
    /**
     * **The point of the parameterised card** (decision 0239): six
     * stage cards are six instances of one type, and a customer's own
     * stages decide what they are.
     */
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      `INSERT INTO process_stages (id, process_id, name, sequence) VALUES
         ('validation', 'ap', 'Validation', 1), ('approval', 'ap', 'Approval', 2)`
    ).run();

    const result = await save([
      { cardType: "items_at_stage", settings: { stage: "validation" } },
      { cardType: "items_at_stage", settings: { stage: "approval" } },
    ]);
    expect(result.status).toBe(200);

    const body = await cardsFor("alice");
    expect(body.cards).toHaveLength(2);
    expect(body.cards.map((c) => c.settings.stage)).toEqual(["validation", "approval"]);
  });

  it("refuses a stage that does not exist", async () => {
    /**
     * **Refused here rather than reported missing on every load.** The
     * card copes with a stage that disappears *later* (decision 0240),
     * which is a different thing from one that never existed.
     */
    const result = await save([{ cardType: "items_at_stage", settings: { stage: "invented" } }]);
    expect(result.status).toBe(404);
  });

  it("refuses a type that is not in the closed set", async () => {
    const result = await save([{ cardType: "run_arbitrary_sql", settings: {} }]);
    expect(result.status).toBe(400);
  });

  it("refuses a wall of cards", async () => {
    // Decision 0239 asked how many before a dashboard stops helping.
    // This is a ceiling on the question rather than an answer to it.
    const result = await save(Array.from({ length: 21 }, () => ({ cardType: "done", settings: {} })));
    expect(result.status).toBe(400);
  });

  it("goes back to the default by deleting", async () => {
    /**
     * **Deleting is the reset.** A separate one that wrote the default
     * back would freeze today's into their account — the thing decision
     * 0240 avoided.
     */
    await save([{ cardType: "done", settings: {} }]);
    await handleResetDashboard(env.DB, "alice");

    const body = await cardsFor("alice");
    expect(body.usingDefault).toBe(true);

    const written = await env.DB.prepare(
      "SELECT count(*) AS n FROM dashboard_cards WHERE user_id = 'alice'"
    ).first<{ n: number }>();
    expect(written?.n).toBe(0);
  });

  it("does not touch anybody else's dashboard", async () => {
    await person("mo", ["AP.Review"], null);
    await handleSaveDashboard(env.DB, "mo", { cards: [{ cardType: "ageing", settings: {} }] });
    await save([{ cardType: "done", settings: {} }]);

    const theirs = await cardsFor("mo");
    expect(theirs.cards.map((c) => c.cardType)).toEqual(["ageing"]);
  });

  it("offers the customer's own stages, not a hardcoded six", async () => {
    /**
     * **Decision 0239's whole argument.** `process_stages` is customer
     * data, and a catalogue naming Validation and Approval by hand
     * would be wrong for the second customer.
     */
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('triage', 'ap', 'Triage', 1)"
    ).run();

    const result = await handleCardCatalogue(env.DB);
    const body = result.body as { stages: { id: string }[]; types: unknown[] };

    expect(body.stages.map((s) => s.id)).toEqual(["triage"]);
    expect(body.types.length).toBe(CARD_TYPES.length);
  });
});

describe("who holds the work at a stage (decision 0250)", () => {
  /**
   * **A count says how much, and this says whether it is anybody's.**
   *
   * Three states, genuinely different: mine is work I am responsible
   * for, taken is work somebody has and I need nothing from, and
   * **unclaimed is the one that grows quietly** — nobody holding it and
   * nobody neglecting it either.
   */
  async function stageCard(userId = "alice") {
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c1', ?, 'items_at_stage', '{"stage":"validation"}', 0)`
    )
      .bind(userId)
      .run();
    const body = await cardsFor(userId);
    return card<{ count: number; held: { mine: number; theirs: number; unclaimed: number } }>(
      body,
      "items_at_stage"
    );
  }

  it("splits mine, taken and unclaimed the way the task list does", async () => {
    /**
     * **The list's rules, not mine** — decision 0255. `handleListMyTasks`
     * shows what is assigned to me or owned by a team I am in, and
     * nothing else: a task owned by another person is not in my list
     * however the stage counts it.
     *
     * So *mine* is assigned to me, *unclaimed* is on my team with
     * nobody holding it, and *taken* is on my team with somebody else
     * holding it. **A task owned outright by somebody else is in none
     * of the three**, because it is not in the list the card opens.
     */
    await person("alice", ["AP.Review"], null);
    await person("mo", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO org_team_members (team_id, user_id) VALUES ('ap', 'alice')"
    ).run();

    await work("mine-1", null, { owner: "alice" });
    await work("mine-2", null, { owner: "alice" });
    await work("queued", null, { team: "ap" });
    await work("taken", null, { team: "ap", claimed: "mo" });
    await work("theirs", null, { owner: "mo" });

    const data = await stageCard();
    expect(data.held.mine).toBe(2);
    expect(data.held.unclaimed).toBe(1);
    expect(data.held.theirs).toBe(1);
    // And the one owned outright by mo is not counted at all.
    expect(data.count).toBe(4);
  });

  it("leaves an instance with no task out of the count", async () => {
    /**
     * **Decision 0253**: the card counts what its click can show, and a
     * task list cannot show an instance that has no task.
     */
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap','AP')").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation','ap','Validation',1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json) VALUES ('lonely', '{}')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES ('pi-lonely', 'ap', 'invoice', 'lonely', 'validation', 'in_progress')`
    ).run();

    const data = await stageCard();
    expect(data.held.unclaimed).toBe(0);
    expect(data.count).toBe(0);
  });

  it("never reports more held than there are", async () => {
    // The three must add to the count, or a ring of them lies about
    // the whole it divides.
    await person("alice", ["AP.Review"], null);
    await work("a", null, { owner: "alice" });
    await work("b", null, { claimed: "alice" });

    const data = await stageCard();
    expect(data.held.mine + data.held.theirs + data.held.unclaimed).toBe(data.count);
  });

  it("counts as mine only for me", async () => {
    // **The card is per person**, so the same stage says something
    // different to two people looking at it.
    await person("alice", ["AP.Review"], null);
    await person("mo", ["AP.Review"], null);
    await work("a", null, { owner: "alice" });

    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c2', 'mo', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const theirs = card<{ count: number; held: { mine: number; theirs: number } }>(
      await cardsFor("mo"),
      "items_at_stage"
    );
    // **Not mo's, and not in mo's list** — so not on mo's card either.
    expect(theirs.held.mine).toBe(0);
    expect(theirs.count).toBe(0);
  });

  it("names the stage it counted, so a card can link to it", async () => {
    // Decision 0250's click: the task list already filtered by stage
    // and nothing could tell it which.
    await person("alice", ["AP.Review"], null);
    await work("a", null, { owner: "alice" });

    const data = await stageCard();
    expect((data as unknown as { stageId: string }).stageId).toBe("validation");
  });
});

describe("an empty stage is not a deleted one (decision 0251)", () => {
  /**
   * **Reported by adding a card.** A stage card for a quiet queue said
   * *"this stage no longer exists"* about a stage the save had just
   * verified — because the query asked `process_instances` and read
   * **no rows** as **no stage**.
   *
   * Decision 0241 was the same shape: a zero and an absence sharing a
   * representation. **Second time.**
   */
  async function cardFor(stageId: string) {
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c1', 'alice', 'items_at_stage', ?, 0)`
    )
      .bind(JSON.stringify({ stage: stageId }))
      .run();

    return card<{ count: number; stageName: string | null; missing: boolean }>(
      await cardsFor("alice"),
      "items_at_stage"
    );
  }

  it("names a stage that exists and holds nothing", async () => {
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('quiet', 'ap', 'Quiet Stage', 1)"
    ).run();

    const data = await cardFor("quiet");

    expect(data.missing).toBe(false);
    expect(data.stageName).toBe("Quiet Stage");
    expect(data.count).toBe(0);
  });

  it("still says so for a stage that is genuinely gone", async () => {
    // The message is right; it was being shown for the wrong reason.
    await person("alice", ["AP.Review"], null);

    const data = await cardFor("never-existed");
    expect(data.missing).toBe(true);
    expect(data.stageName).toBeNull();
  });

  it("counts an empty stage as nobody's, not as a third of nothing", async () => {
    // Three zeroes, so the ring draws nothing rather than an even split
    // of an empty whole.
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('quiet', 'ap', 'Quiet', 1)"
    ).run();

    const data = (await cardFor("quiet")) as unknown as {
      held: { mine: number; theirs: number; unclaimed: number };
    };
    expect(data.held).toEqual({ mine: 0, theirs: 0, unclaimed: 0 });
  });
});

describe("the count agrees with the list it links to (decision 0252)", () => {
  /**
   * **Reported by clicking the card.** The stage card said one number
   * and the task list it opened showed more.
   *
   * The query counted rows after a `LEFT JOIN` to tasks, so an invoice
   * with three open tasks counted as three — **and per-line evaluation
   * makes that routine** (decision 0027). The count was neither
   * instances nor tasks but the product of them.
   */
  async function withTasks(count: number) {
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json) VALUES ('inv', '{}')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES ('pi', 'ap', 'invoice', 'inv', 'approval', 'in_progress')`
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('v', 'pi', 'approval', 'matched')"
    ).run();

    // **One invoice, several lines, several tasks** — decision 0027.
    for (let i = 0; i < count; i++) {
      await env.DB.prepare(
        `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, line_number)
         VALUES (?, 'approval', 'v', 'alice', 'AP.Approve', 'open', ?)`
      )
        .bind(`t${i}`, i + 1)
        .run();
    }

    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"approval"}', 0)`
    ).run();

    return card<{ count: number; held: { mine: number; theirs: number; unclaimed: number } }>(
      await cardsFor("alice"),
      "items_at_stage"
    );
  }

  it("counts three tasks on one invoice as three, not nine", async () => {
    const data = await withTasks(3);
    expect(data.count).toBe(3);
    expect(data.held.mine).toBe(3);
  });

  it("has its segments add to its count", async () => {
    /**
     * **By construction, not by subtraction.** A ring whose segments
     * are derived from a total it did not produce is a ring that can
     * lie about the whole it divides.
     */
    const data = await withTasks(3);
    expect(data.held.mine + data.held.theirs + data.held.unclaimed).toBe(data.count);
  });

  it("does not count an instance with no task", async () => {
    /**
     * **Decision 0253 reversed decision 0252 here**, a day after
     * writing it. Counting an idle instance as unclaimed was true about
     * the work and false about the card: it links to a task list, and
     * an instance with no task **can never appear in one**.
     *
     * The card said ten and the list showed nine, by construction —
     * which is exactly what decision 0252 was written to prevent.
     */
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1)"
    ).run();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv', '{}')").run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES ('pi', 'ap', 'invoice', 'inv', 'approval', 'in_progress')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"approval"}', 0)`
    ).run();

    const data = card<{ count: number; held: { unclaimed: number } }>(
      await cardsFor("alice"),
      "items_at_stage"
    );
    expect(data.count).toBe(0);
    expect(data.held.unclaimed).toBe(0);
  });
});

describe("the card and the list ask the same question (decision 0252)", () => {
  /**
   * **A task can sit at a stage its instance has left.**
   *
   * The task list filters on `t.stage_id` (decision 0202) and the card
   * asked `pi.current_stage_id`, so the two answered different
   * questions about the same queue — which is what the operator saw
   * when the card said one number and the list it opened showed more.
   */
  it("counts a task left behind at an earlier stage", async () => {
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      `INSERT INTO process_stages (id, process_id, name, sequence) VALUES
         ('validation', 'ap', 'Validation', 1), ('approval', 'ap', 'Approval', 2)`
    ).run();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv', '{}')").run();

    // **The instance has moved on; the task has not.**
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES ('pi', 'ap', 'invoice', 'inv', 'approval', 'in_progress')`
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('v', 'pi', 'validation', 'matched')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status)
       VALUES ('t', 'validation', 'v', 'alice', 'AP.Validate', 'open')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const data = card<{ count: number; held: { mine: number } }>(
      await cardsFor("alice"),
      "items_at_stage"
    );

    // The task list would show it under Validation; so does the card.
    expect(data.count).toBe(1);
    expect(data.held.mine).toBe(1);
  });
});

describe("the card counts what its click can show (decision 0253)", () => {
  /**
   * **The assertion decision 0252 needed and did not have.**
   *
   * That record was written to make the count agree with the list it
   * links to, and the same change added idle instances to the count —
   * which a task list cannot show. **The card said ten and the list
   * showed nine, by construction.**
   *
   * This compares the two directly, so a future card counting something
   * unclickable fails here rather than on somebody's screen.
   */
  it("agrees with the task list it opens", async () => {
    await person("alice", ["AP.Review"], null);
    await person("mo", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap', 'AP')").run();

    await work("mine", null, { owner: "alice" });
    await work("claimed", null, { claimed: "alice" });
    await work("theirs", null, { owner: "mo" });
    await work("queued", null, { team: "ap" });

    // And one idling with nothing raised, which no list can show.
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json) VALUES ('idle', '{}')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
       VALUES ('pi-idle', 'ap', 'invoice', 'idle', 'validation', 'in_progress')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const data = card<{ count: number; held: { mine: number } }>(
      await cardsFor("alice"),
      "items_at_stage"
    );

    /**
     * **The list itself, not a query about it** — decision 0255.
     * This test's first version wrote its own SQL as the oracle, which
     * is the mistake decisions 0252–0254 made four times over.
     */
    const listed = (await handleListMyTasks(env.DB, "alice", { stageId: "validation" })).body as {
      tasks: unknown[];
      counts: { mine: number };
    };

    expect(data.count).toBe(listed.tasks.length);
    expect(data.held.mine).toBe(listed.counts.mine);
  });
});

describe("a task without a stage visit still counts (decision 0254)", () => {
  /**
   * **Three on the card, seven in the list.**
   *
   * A task does not need a stage visit to exist, and some do not have
   * one. The card joined through `stage_visits` and the task list asks
   * only `t.stage_id` — so the card could not see them.
   *
   * **My own diagnostic query joined the same way**, which is why three
   * hypotheses in a row were wrong: the query I was checking with
   * shared the fault of the code I was checking.
   */
  it("counts a task whose stage visit is missing", async () => {
    await person("alice", ["AP.Review"], null);
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)"
    ).run();

    // **No stage visit, no instance, no invoice** — just a task.
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, owner_user_id, required_permission, status)
       VALUES ('orphan', 'validation', 'alice', 'AP.Validate', 'open')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const data = card<{ count: number; held: { mine: number } }>(
      await cardsFor("alice"),
      "items_at_stage"
    );

    expect(data.count).toBe(1);
    expect(data.held.mine).toBe(1);
  });

  it("shows it to somebody whose view is restricted, as the list does", async () => {
    /**
     * **Reversed by decision 0255.** This asserted the opposite: that a
     * task with no chain was hidden from a scoped reader. The task list
     * has shown it since decision 0202 — `if (!task.orgUnitId) return
     * true` — and a card that disagrees with the list it opens is the
     * fault, whichever policy is better.
     */
    // `units()` in beforeEach already created acme-fr.
    await person("alice", ["AP.Review"], "acme-fr");
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)"
    ).run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, owner_user_id, required_permission, status)
       VALUES ('orphan', 'validation', 'alice', 'AP.Validate', 'open')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES ('c', 'alice', 'items_at_stage', '{"stage":"validation"}', 0)`
    ).run();

    const data = card<{ count: number }>(await cardsFor("alice"), "items_at_stage");
    expect(data.count).toBe(1);
  });
});

describe("the card agrees with the real task list (decision 0255)", () => {
  /**
   * **Every previous test compared the card to a query I wrote**, and
   * four times running the query shared the fault of the code it was
   * checking (decisions 0252–0254).
   *
   * This one calls `handleListMyTasks` — **the route the click actually
   * opens** — and compares numbers. If the two ever disagree it does
   * not matter which of them is right; a card that links to a list must
   * say what the list says.
   */
  async function bothFor(userId: string, stage: string) {
    await env.DB.prepare(
      `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
       VALUES (?, ?, 'items_at_stage', ?, 0)`
    )
      .bind(`c-${userId}`, userId, JSON.stringify({ stage }))
      .run();

    const onCard = card<{ count: number; held: { mine: number } }>(
      await cardsFor(userId),
      "items_at_stage"
    );

    const listed = (await handleListMyTasks(env.DB, userId, { stageId: stage })).body as {
      tasks: unknown[];
      counts: { mine: number };
      total?: number;
    };

    return { onCard, listed };
  }

  it("says the same number as the list for an unplaced document", async () => {
    /**
     * **The operator's four.** Three were on units, one was on an
     * invoice with no unit at all — and the card dropped that one while
     * the list kept it.
     */
    await person("alice", ["AP.Validate"], "acme-fr");
    await work("placed-1", "acme-fr", { owner: "alice" });
    await work("placed-2", "acme-fr", { owner: "alice" });
    await work("placed-3", "acme-fr", { owner: "alice" });
    await work("unplaced", null, { owner: "alice" });

    const { onCard, listed } = await bothFor("alice", "validation");

    expect(listed.tasks).toHaveLength(4);
    expect(onCard.count).toBe(4);
    expect(onCard.held.mine).toBe(listed.counts.mine);
  });

  it("still hides another unit's document from both", async () => {
    /**
     * The policy that stays: a document in a unit you do not hold is
     * invisible to the card and to the list alike.
     *
     * **Scoped on the task's own permission** — `work()` raises tasks
     * needing `AP.Validate`, so that is what alice must hold at a unit
     * for the list to filter by it. Holding `AP.Review` there filters
     * nothing, which is exactly the difference that broke the card.
     */
    await person("alice", ["AP.Validate"], "acme-fr");
    await work("theirs", "acme-de", { owner: "alice" });
    await work("mine", "acme-fr", { owner: "alice" });

    const { onCard, listed } = await bothFor("alice", "validation");

    expect(listed.tasks).toHaveLength(1);
    expect(onCard.count).toBe(1);
  });

  it("shows everything to somebody unrestricted, in both", async () => {
    await person("alice", ["AP.Review"], null);
    await work("a", "acme-fr", { owner: "alice" });
    await work("b", "acme-de", { owner: "alice" });
    await work("c", null, { owner: "alice" });

    const { onCard, listed } = await bothFor("alice", "validation");

    expect(listed.tasks).toHaveLength(3);
    expect(onCard.count).toBe(3);
  });
});

describe("a real trend for done, and none for waiting (decision 0257)", () => {
  /**
   * **`completed_at` is a timestamp every finished task actually has**,
   * so a day-by-day count over the last week is genuine history — the
   * same bucketing `received()` already does for invoices in.
   *
   * Deliberately not attempted for `waiting_for_me`: that number is a
   * live queue depth, and nothing in this system has ever recorded what
   * it was on a past day. Decision 0242 already declined to draw a line
   * from no history, and this record does not reopen that.
   */
  async function completedOn(id: string, daysAgo: number) {
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')"
    )
      .bind(id)
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, stage_id, owner_user_id, required_permission, status, completed_by, completed_at)
       VALUES (?, 'validation', 'alice', 'AP.Validate', 'completed', 'alice',
               datetime('now', ?))`
    )
      .bind(id, `-${daysAgo} days`)
      .run();
  }

  it("carries a day-by-day count of completions", async () => {
    await person("alice", ["AP.Review"], null);
    await completedOn("a", 0);
    await completedOn("b", 0);
    await completedOn("c", 2);

    const data = card<{ trend: { day: string; n: number }[] }>(await cardsFor("alice"), "done");

    const today = new Date().toISOString().slice(0, 10);
    const todayRow = data.trend.find((r) => r.day === today);
    expect(todayRow?.n).toBe(2);

    // A day with nothing completed is simply absent, not a zero row —
    // gap-filling for display is the screen's job, not the query's.
    const yesterday = data.trend.find(
      (r) => r.day === new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    );
    expect(yesterday).toBeUndefined();
  });

  it("does not carry a trend for waiting_for_me", async () => {
    // The absence is the point: nothing here should be tempted to
    // invent one later without re-reading why it is missing.
    await person("alice", ["AP.Review"], null);
    await work("open", null, { owner: "alice" });

    const data = card<Record<string, unknown>>(await cardsFor("alice"), "waiting_for_me");
    expect(data.trend).toBeUndefined();
  });
});

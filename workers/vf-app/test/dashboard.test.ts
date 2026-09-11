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

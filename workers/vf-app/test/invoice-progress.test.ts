import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInvoiceProgress } from "../src/invoice-progress-route.js";

/**
 * Where an invoice has been — decision 0151.
 *
 * **Nothing had to be recorded for this.** `stage_visits` has held a
 * timestamp per visit since decision 0009; leaving is the next visit's
 * arrival and the duration is the gap. The data existed and nobody had
 * asked it this question.
 */

async function seedProcess() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  for (const [id, name, seq] of [
    ["intake", "Intake", 1],
    ["validation", "Validation", 2],
    ["approval", "Approval", 3],
    ["payment", "Payment", 4],
  ] as [string, string, number][]) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap', ?, ?)"
    )
      .bind(id, name, seq)
      .run();
  }
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
}

async function place(currentStage: string, visits: [string, string][]) {
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
     VALUES ('pi-1', 'ap', 'invoice', 'inv-1', ?)`
  )
    .bind(currentStage)
    .run();

  let n = 0;
  for (const [stage, at] of visits) {
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, 'pi-1', ?, 'automatic', ?)"
    )
      .bind(`v-${n++}`, stage, at)
      .run();
  }
}

async function progress() {
  return (await handleInvoiceProgress(env.DB, "inv-1")).body as {
    inProcess: boolean;
    currentStageId?: string;
    stages: {
      id: string;
      name: string;
      state: string;
      visitCount?: number;
      periods?: {
        enteredAt: string;
        leftAt: string | null;
        duration: string | null;
        outcome: string;
      }[];
    }[];
  };
}

beforeEach(async () => {
  await applyTestSchema();
  await seedProcess();
});

describe("the shape of the path", () => {
  it("names every stage, including ones ahead of the document", async () => {
    // **The sequence is the point.** Somebody needs to see what is
    // still to come, which an omitted stage cannot tell them.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:05:00"],
    ]);

    const body = await progress();
    expect(body.stages.map((s) => s.id)).toEqual([
      "intake",
      "validation",
      "approval",
      "payment",
    ]);
  });

  it("marks where the invoice is now", async () => {
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:05:00"],
    ]);

    const body = await progress();
    expect(body.stages.find((s) => s.id === "validation")?.state).toBe("here");
    expect(body.stages.find((s) => s.id === "intake")?.state).toBe("behind");
    expect(body.stages.find((s) => s.id === "approval")?.state).toBe("ahead");
  });
});

describe("enter, leave, and how long", () => {
  it("takes leaving from the next visit's arrival", async () => {
    // Nothing records a departure; the next arrival is the departure.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:40:00"],
    ]);

    const intake = (await progress()).stages.find((s) => s.id === "intake");
    expect(intake?.periods?.[0].enteredAt).toBe("2026-09-01 09:00:00");
    expect(intake?.periods?.[0].leftAt).toBe("2026-09-01 09:40:00");
    expect(intake?.periods?.[0].duration).toBe("40m");
  });

  it("has not left the stage it is still at", async () => {
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:40:00"],
    ]);

    const here = (await progress()).stages.find((s) => s.id === "validation");
    expect(here?.periods?.[0].leftAt).toBeNull();
    expect(here?.periods?.[0].duration).toBeNull();
  });

  it("says days when it took days", async () => {
    // **The unit a person would use.** Somebody scanning wants to know
    // whether a stage took a moment or a fortnight.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-05 14:00:00"],
    ]);

    expect((await progress()).stages.find((s) => s.id === "intake")?.periods?.[0].duration).toBe("4d 5h");
  });

  it("says so when it was almost instant", async () => {
    // An automatic stage passes through in seconds, and "0m" reads like
    // a missing value.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:00:20"],
    ]);

    expect((await progress()).stages.find((s) => s.id === "intake")?.periods?.[0].duration).toBe(
      "under a minute"
    );
  });
});

describe("an invoice that came back", () => {
  it("counts the visits, rather than losing one", async () => {
    // **Decision 0075 makes returning first-class**, so a stage can be
    // visited more than once — and a timeline showing one visit would
    // quietly lose the fact that somebody sent it back.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:10:00"],
      ["approval", "2026-09-02 11:00:00"],
      ["validation", "2026-09-03 08:00:00"],
    ]);

    const validation = (await progress()).stages.find((s) => s.id === "validation");
    expect(validation?.visitCount).toBe(2);
    // **Both periods, in the one box** — the operator's refinement. A
    // stage entered twice took time twice.
    expect(validation?.periods).toHaveLength(2);
  });

  it("keeps both periods in order, oldest first", async () => {
    // **The second time is often the interesting one**: it is what
    // happened after somebody sent the document back.
    await place("validation", [
      ["validation", "2026-09-01 09:10:00"],
      ["approval", "2026-09-02 11:00:00"],
      ["validation", "2026-09-03 08:00:00"],
    ]);

    const validation = (await progress()).stages.find((s) => s.id === "validation");
    expect(validation?.periods?.[0].enteredAt).toBe("2026-09-01 09:10:00");
    expect(validation?.periods?.[1].enteredAt).toBe("2026-09-03 08:00:00");
  });

  it("times each period against what followed it", async () => {
    // The first visit ended when Approval began; the second has not
    // ended at all.
    await place("validation", [
      ["validation", "2026-09-01 09:10:00"],
      ["approval", "2026-09-02 11:10:00"],
      ["validation", "2026-09-03 08:00:00"],
    ]);

    const validation = (await progress()).stages.find((s) => s.id === "validation");
    expect(validation?.periods?.[0].duration).toBe("1d 2h");
    expect(validation?.periods?.[1].duration).toBeNull();
  });

  it("carries one period for a stage visited once", async () => {
    await place("validation", [["validation", "2026-09-01 09:10:00"]]);
    const validation = (await progress()).stages.find((s) => s.id === "validation");
    expect(validation?.visitCount).toBe(1);
    expect(validation?.periods).toHaveLength(1);
  });
});

describe("an invoice in no process", () => {
  it("says so rather than showing an empty path", async () => {
    // **A real state, not a failure.** An empty row of chevrons would
    // imply it has not started.
    const body = await progress();
    expect(body.inProcess).toBe(false);
    expect(body.stages).toEqual([]);
  });
});

describe("straight-through processing (decision 0152)", () => {
  /**
   * **The case every earlier test missed.** They all used distinct
   * timestamps, which is not how an automatic path behaves.
   *
   * `created_at` defaults to `datetime('now')` — one-second resolution
   * — so an invoice passing Intake and Approval automatically records
   * both in the same second. Ordering by timestamp then falls back to
   * ordering by a UUID, at random.
   *
   * Found on a real invoice: Intake read *"here since"* and Approval
   * read *"under a minute"*, with Approval marked current.
   */
  async function placeSameSecond() {
    await env.DB.prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
       VALUES ('pi-1', 'ap', 'invoice', 'inv-1', 'approval')`
    ).run();

    // Inserted in order, with identical timestamps and ids whose
    // alphabetical order is the REVERSE of the visit order — which is
    // what a UUID gives you half the time.
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('zzz', 'pi-1', 'intake', 'automatic', '2026-09-02 16:22:06')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('aaa', 'pi-1', 'approval', 'matched', '2026-09-02 16:22:06')"
    ).run();
  }

  it("reads them in the order they happened, not by id", async () => {
    await placeSameSecond();
    const body = await progress();

    const intake = body.stages.find((s) => s.id === "intake");
    const approval = body.stages.find((s) => s.id === "approval");

    // Intake was left the moment Approval was entered.
    expect(intake?.periods?.[0].leftAt).toBe("2026-09-02 16:22:06");
    // And Approval is where the invoice still is.
    expect(approval?.periods?.[0].leftAt).toBeNull();
  });

  it("does not mark a stage the invoice has left as current", async () => {
    // **The visible symptom**: Intake said "here since" while the
    // invoice was at Approval.
    await placeSameSecond();
    const body = await progress();

    expect(body.stages.find((s) => s.id === "intake")?.state).toBe("behind");
    expect(body.stages.find((s) => s.id === "approval")?.state).toBe("here");
  });
});

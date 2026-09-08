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
      enteredAt?: string;
      leftAt?: string | null;
      duration?: string | null;
      visits?: number;
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
    expect(intake?.enteredAt).toBe("2026-09-01 09:00:00");
    expect(intake?.leftAt).toBe("2026-09-01 09:40:00");
    expect(intake?.duration).toBe("40m");
  });

  it("has not left the stage it is still at", async () => {
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:40:00"],
    ]);

    const here = (await progress()).stages.find((s) => s.id === "validation");
    expect(here?.leftAt).toBeNull();
    expect(here?.duration).toBeNull();
  });

  it("says days when it took days", async () => {
    // **The unit a person would use.** Somebody scanning wants to know
    // whether a stage took a moment or a fortnight.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-05 14:00:00"],
    ]);

    expect((await progress()).stages.find((s) => s.id === "intake")?.duration).toBe("4d 5h");
  });

  it("says so when it was almost instant", async () => {
    // An automatic stage passes through in seconds, and "0m" reads like
    // a missing value.
    await place("validation", [
      ["intake", "2026-09-01 09:00:00"],
      ["validation", "2026-09-01 09:00:20"],
    ]);

    expect((await progress()).stages.find((s) => s.id === "intake")?.duration).toBe(
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
    expect(validation?.visits).toBe(2);
  });

  it("describes the most recent visit, not the first", async () => {
    await place("validation", [
      ["validation", "2026-09-01 09:10:00"],
      ["approval", "2026-09-02 11:00:00"],
      ["validation", "2026-09-03 08:00:00"],
    ]);

    const validation = (await progress()).stages.find((s) => s.id === "validation");
    expect(validation?.enteredAt).toBe("2026-09-03 08:00:00");
  });

  it("says nothing about visits when there was only one", async () => {
    // A count of 1 on every row is noise.
    await place("validation", [["validation", "2026-09-01 09:10:00"]]);
    expect((await progress()).stages.find((s) => s.id === "validation")?.visits).toBeUndefined();
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

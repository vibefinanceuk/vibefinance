import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  resolveFieldVisibility,
  handleFieldVisibility,
  handleSetFieldVisibility,
  handleSetStageFieldVisibility,
  type ResolvedField,
} from "../src/field-visibility-route.js";

/**
 * Which fields a person sees — decision 0114.
 *
 * The operator's framing: *"if we put all of the fields on the screen
 * it would be very busy"*, and the reason it varies by stage:
 * **"approvers should approve data, not edit data."**
 */

async function seedStages() {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  for (const [id, name, seq] of [
    ["validation", "Validation", 1],
    ["approval", "Approval", 2],
  ] as [string, string, number][]) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap', ?, ?)"
    )
      .bind(id, name, seq)
      .run();
  }
}

const find = (fields: ResolvedField[], code: string) => fields.find((f) => f.field === code);

beforeEach(async () => {
  await applyTestSchema();
  await seedStages();
});

describe("an unconfigured customer gets a working screen", () => {
  it("makes the fields a person keys editable", async () => {
    // Nobody should have to seed forty rows before the screen works.
    const fields = await resolveFieldVisibility(env.DB, null);
    for (const code of ["BT-1", "BT-5", "BT-112", "BT-131", "BT-153"]) {
      expect(find(fields, code)?.visibility, code).toBe("edit");
    }
  });

  it("shows identifiers without offering them for typing", async () => {
    // The middle state, and why three are worth having: BT-126 is what
    // somebody refers to when talking to a colleague, never types.
    for (const code of ["BT-126", "BT-24", "BT-27"]) {
      const fields = await resolveFieldVisibility(env.DB, null);
      expect(find(fields, code)?.visibility, code).toBe("read");
    }
  });

  it("hides everything nobody chose to show", async () => {
    // The safer direction: a field nobody chose is one nobody has to
    // scan past.
    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-13")?.visibility).toBe("hidden");
  });

  it("says the default decided it", async () => {
    // "Why can I not edit this" deserves an answer, and "nobody has
    // configured it" differs from "the stage restricts it".
    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-1")?.decidedBy).toBe("default");
  });
});

describe("the customer's own baseline", () => {
  it("overrides a default", async () => {
    await handleSetFieldVisibility(env.DB, {
      fields: [{ field: "BT-13", visibility: "edit" }],
    });

    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-13")?.visibility).toBe("edit");
    expect(find(fields, "BT-13")?.decidedBy).toBe("customer");
  });

  it("takes order from the order the fields were listed", async () => {
    // A caller expresses order by listing fields in the order they
    // want, rather than counting positions.
    await handleSetFieldVisibility(env.DB, {
      fields: [
        { field: "BT-112", visibility: "edit" },
        { field: "BT-1", visibility: "edit" },
      ],
    });

    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-112")!.sortOrder).toBeLessThan(find(fields, "BT-1")!.sortOrder);
  });

  it("refuses a field the vocabulary does not declare", async () => {
    // Configuring one would produce a box nothing fills.
    const result = await handleSetFieldVisibility(env.DB, {
      fields: [{ field: "BT-9999", visibility: "edit" }],
    });
    expect(result.status).toBe(422);
  });

  it("refuses a visibility that is none of the three", async () => {
    const result = await handleSetFieldVisibility(env.DB, {
      fields: [{ field: "BT-1", visibility: "maybe" }],
    });
    expect(result.status).toBe(422);
  });
});

describe("a stage may restrict, never grant", () => {
  it("makes an editable field read-only at Approval", async () => {
    // "Approvers should approve data, not edit data." An approver who
    // can change the amount they are approving has defeated approval.
    await handleSetStageFieldVisibility(env.DB, "approval", {
      fields: [{ field: "BT-112", visibility: "read" }],
    });

    expect(find(await resolveFieldVisibility(env.DB, "validation"), "BT-112")?.visibility).toBe("edit");
    const atApproval = find(await resolveFieldVisibility(env.DB, "approval"), "BT-112");
    expect(atApproval?.visibility).toBe("read");
    expect(atApproval?.decidedBy).toBe("stage");
  });

  it("refuses a stage trying to grant editing", async () => {
    // The control this whole record exists to protect.
    const result = await handleSetStageFieldVisibility(env.DB, "approval", {
      fields: [{ field: "BT-112", visibility: "edit" }],
    });
    expect(result.status).toBe(422);
    expect(String((result.body as { detail: string }).detail)).toContain("undo a control");
  });

  it("does not make a hidden field visible by naming it read", async () => {
    // A restriction that widened would be a grant wearing another word.
    await handleSetFieldVisibility(env.DB, { fields: [{ field: "BT-13", visibility: "hidden" }] });
    await handleSetStageFieldVisibility(env.DB, "approval", {
      fields: [{ field: "BT-13", visibility: "read" }],
    });

    expect(find(await resolveFieldVisibility(env.DB, "approval"), "BT-13")?.visibility).toBe("hidden");
  });

  it("can hide at one stage what is editable at another", async () => {
    await handleSetStageFieldVisibility(env.DB, "approval", {
      fields: [{ field: "BT-1", visibility: "hidden" }],
    });

    expect(find(await resolveFieldVisibility(env.DB, "validation"), "BT-1")?.visibility).toBe("edit");
    expect(find(await resolveFieldVisibility(env.DB, "approval"), "BT-1")?.visibility).toBe("hidden");
  });

  it("removes a restriction by leaving it out", async () => {
    await handleSetStageFieldVisibility(env.DB, "approval", {
      fields: [{ field: "BT-112", visibility: "read" }],
    });
    await handleSetStageFieldVisibility(env.DB, "approval", { fields: [] });

    expect(find(await resolveFieldVisibility(env.DB, "approval"), "BT-112")?.visibility).toBe("edit");
  });

  it("404s a stage that does not exist", async () => {
    expect((await handleSetStageFieldVisibility(env.DB, "nope", { fields: [] })).status).toBe(404);
  });
});

describe("what a screen receives", () => {
  it("omits hidden fields rather than returning them as hidden", async () => {
    // A client that received them could render them by mistake, and
    // there is nothing a screen can do with a field it must not show.
    const result = await handleFieldVisibility(env.DB, null);
    const fields = (result.body as { fields: ResolvedField[] }).fields;

    expect(fields.every((f) => f.visibility !== "hidden")).toBe(true);
    expect(fields.some((f) => f.field === "BT-13")).toBe(false);
  });

  it("carries what each field is, so a label can be written", async () => {
    const result = await handleFieldVisibility(env.DB, null);
    const fields = (result.body as { fields: ResolvedField[] }).fields;
    expect(find(fields, "BT-5")?.description).toBeTruthy();
  });
});

describe("the parties are visible by default (decision 0115)", () => {
  /**
   * A seller and buyer panel showing two fields each would be a panel
   * not worth its heading.
   */
  it("shows both sides of the transaction", async () => {
    const fields = await resolveFieldVisibility(env.DB, null);
    for (const code of ["BT-27", "BT-31", "BT-34", "BT-40", "BT-44", "BT-48", "BT-49", "BT-55"]) {
      expect(find(fields, code)?.visibility, code).not.toBe("hidden");
    }
  });

  it("treats the seller's and buyer's identifiers alike", async () => {
    // The seller's VAT identifier being editable while the buyer's was
    // hidden was an inconsistency nobody chose.
    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-48")?.visibility).not.toBe("hidden");
    expect(find(fields, "BT-40")?.visibility).toBe(find(fields, "BT-55")?.visibility);
  });

  it("offers them for reading rather than typing", async () => {
    // These come from the document, and somebody keying an unreadable
    // one is far more likely to be correcting an amount than a
    // counterparty's country.
    const fields = await resolveFieldVisibility(env.DB, null);
    expect(find(fields, "BT-44")?.visibility).toBe("read");
    expect(find(fields, "BT-55")?.visibility).toBe("read");
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUiStrings } from "../src/ui-strings.js";

/**
 * Every key the interface asks for must exist — decision 0107.
 *
 * **Reported from the screen, not caught here.** The line table's
 * headers read `field.bt-129` and `field.bt-131`, because `t()` falls
 * back to the key when a string is missing and nothing had seeded those
 * two.
 *
 * The fallback is deliberate and worked. What was missing is this: a
 * check that the words a screen asks for are words somebody wrote.
 *
 * Modelled on `field-coverage.test.ts` in `shared`, which refuses any
 * declared vocabulary field the parser cannot produce. Same principle,
 * different pair of layers: **a key nothing defines is a label nobody
 * can read.**
 */

/**
 * Every key the interface uses, listed here rather than scraped from
 * the source.
 *
 * A scraper would have to parse `t(\`field.${code}\`)` and every other
 * computed key, and would quietly stop finding them the first time
 * somebody built a key a slightly different way. A list is maintained
 * by hand and fails loudly, which is the trade this project keeps
 * making.
 */
const KEYS_THE_INTERFACE_USES = [
  // Sign-in (index.html, via data-t)
  "product.name",
  "signin.title",
  "signin.email",
  "signin.password",
  "signin.environment",
  "signin.choose",
  "signin.continue",
  "signin.failed",
  "signin.unreachable",
  "signin.noaccess",
  "signin.first",
  // The frame and the task list
  "nav.tasks",
  "tasks.signout",
  "tasks.allstages",
  "tasks.everything",
  "tasks.mine",
  "tasks.available",
  "tasks.locked",
  "tasks.stage",
  "tasks.supplier",
  "tasks.amount",
  "tasks.waiting",
  "tasks.owner",
  "tasks.empty",
  "tasks.notkeyed",
  "tasks.nodocument",
  "tasks.loadfailed",
  // Every action a task can report (decisions 0103, 0104)
  "action.claim",
  "action.release",
  "action.key",
  "action.complete",
  "action.return",
  "action.return_to_supplier",
  "action.discard",
  // The viewer
  "viewer.title",
  "viewer.back",
  "viewer.open",
  "viewer.document",
  "viewer.save",
  "viewer.nodocument",
  "viewer.nothing",
  "viewer.saved",
  "viewer.savefailed",
  "viewer.status",
  "viewer.known",
  "viewer.fields",
  "viewer.actions",
  "viewer.lines",
  "viewer.description",
  "viewer.addline",
  "viewer.removeline",
  "viewer.linetotal",
  "viewer.matches",
  "viewer.differs",
  // Header fields the viewer offers
  "field.bt-1",
  "field.bt-2",
  "field.bt-31",
  "field.bt-5",
  "field.bt-106",
  "field.bt-110",
  "field.bt-112",
  "field.bt-115",
  // Line fields the line table offers (decisions 0109, 0110)
  "field.bt-126",
  "field.bt-129",
  "field.bt-130",
  "field.bt-131",
  "field.bt-146",
  "field.bt-153",
];

beforeEach(async () => {
  await applyTestSchema();
});

describe("every key the interface uses has a word behind it", () => {
  it("defines all of them in English", async () => {
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    const missing = KEYS_THE_INTERFACE_USES.filter((key) => !body.strings[key]);
    expect(
      missing,
      `Used by the interface and defined nowhere: ${missing.join(", ")}. ` +
        "Seed it in a migration, or stop asking for it. A key nothing " +
        "defines renders as itself, which is what `field.bt-129` did on " +
        "a live screen."
    ).toEqual([]);
  });

  it("defines none of them as a dotted key by accident", async () => {
    // A label that IS its own key would pass the check above while
    // reading exactly as broken.
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    const selfReferential = KEYS_THE_INTERFACE_USES.filter((key) => body.strings[key] === key);
    expect(selfReferential).toEqual([]);
  });

  it("gives a field label that a person would recognise", async () => {
    // The specification's own business term names, in the form somebody
    // keying an invoice would use.
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    expect(body.strings["field.bt-129"]).toBe("Quantity");
    expect(body.strings["field.bt-131"]).toBe("Line net amount");
    expect(body.strings["field.bt-153"]).toBe("Item name");
  });
});

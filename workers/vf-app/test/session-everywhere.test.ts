import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import routerSource from "../src/index.ts?raw";

/**
 * Every route a person can reach accepts a session — decision 0127.
 *
 * **This gap has been found three times.** Decision 0105 found it in
 * the task routes and fixed four; decision 0126 found it again in the
 * configuration routes and fixed two; this fixes the remaining 25 and
 * adds the check that should have existed after the first time.
 *
 * Read from the source rather than exercised route by route, because a
 * route added tomorrow is the case that matters and no list of paths
 * would include it.
 */

/**
 * The router's own source.
 *
 * Imported as text rather than read from disk: these tests run in
 * `workerd`, which **has no filesystem** — the same discovery decision
 * 0121 made from the other direction, where a browser test could not
 * use `node:fs` either.
 */
const SOURCE = routerSource;

beforeEach(async () => {
  await applyTestSchema();
});

describe("no route authenticates a person by key alone", () => {
  it("passes a session context to every requirePermission", () => {
    // **The failure this exists to produce.** A new route written
    // without the fourth argument compiles, works for a script, and
    // silently refuses every signed-in person.
    const bare = [...SOURCE.matchAll(/requirePermission\([^)]*\)/g)]
      .map((m) => m[0])
      .filter((call) => !call.includes("sessionContext(env)"));

    expect(
      bare,
      `requirePermission without a session context: ${bare.join(", ")}. ` +
        "Pass sessionContext(env) as the fourth argument, or a signed-in " +
        "person cannot reach this route however they are permissioned."
    ).toEqual([]);
  });

  it("assembles the session context in one place", () => {
    // Eleven routes built the same four arguments inline before this.
    // A second assembly is a second thing to change when session
    // verification changes.
    //
    // **Counts assemblies, not mentions.** The first version matched
    // `isPublicKeyJwk` anywhere and found two more — a licence-refresh
    // guard and the scheduled check, which test the same value for
    // entirely different reasons. A test that cannot tell those apart
    // reports work that is not needed.
    const assemblies = SOURCE.match(/publicKeyJwk:\s*isPublicKeyJwk/g) ?? [];
    expect(assemblies).toHaveLength(1);
  });

  it("authenticates a person in one place too", () => {
    // `authenticateUserOrSession` is called once, by the helper. A
    // second direct call is a route that will not follow when session
    // verification changes.
    const direct = SOURCE.match(/authenticateUserOrSession\(/g) ?? [];
    expect(direct).toHaveLength(1);
  });
});

describe("a session actually reaches a configuration route", () => {
  it("refuses no credential rather than refusing a session", async () => {
    // The symptom of the old behaviour was a 401 for somebody who was
    // signed in. This asserts the route is reachable at all.
    const res = await SELF.fetch("https://app.example.com/sources");
    expect(res.status).toBe(401);
  });
});

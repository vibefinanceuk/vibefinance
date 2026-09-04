import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import {
  setCredential,
  checkCredential,
  grantAccess,
  revokeAccess,
  hasAccess,
  listAccessibleEnvironments,
} from "../src/credentials.js";

const PASSWORD = "a-long-enough-passphrase";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme" });
  await handleCreateCustomer(env.CONTROL_DB, { id: "nw", name: "Northwind" });
  for (const [customerId, region] of [["acme", "eu"], ["acme", "us"], ["nw", "eu"]]) {
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId,
      kind: "production",
      region,
      instanceUrl: `https://${customerId}-${region}`,
    });
  }
});

describe("a credential is per person, per customer", () => {
  it("verifies the right password", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD)).ok).toBe(true);
  });

  it("refuses the wrong one", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", "wrong")).ok).toBe(false);
  });

  it("stores a hash, never the password", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    const row = await env.CONTROL_DB.prepare("SELECT password_hash FROM user_credentials").first<{
      password_hash: string;
    }>();
    expect(row?.password_hash).not.toContain(PASSWORD);
    expect(row?.password_hash.startsWith("argon2id$")).toBe(true);
  });

  it("is case-insensitive on the email", async () => {
    await setCredential(env.CONTROL_DB, "Dan@Acme.com", "acme", PASSWORD);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD)).ok).toBe(true);
  });

  it("replaces rather than duplicating when the password changes", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", "a-different-passphrase");

    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM user_credentials").first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD)).ok).toBe(false);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", "a-different-passphrase")).ok).toBe(true);
  });

  it("does not verify against another customer's credential", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "nw", PASSWORD)).ok).toBe(false);
  });

  it("requires a password of reasonable length", async () => {
    // Length over complexity, following NIST: a long passphrase beats a
    // short string with a symbol in it.
    expect((await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", "short")).status).toBe(422);
  });

  it("takes the same time whether or not an account exists", async () => {
    // Returning early on a missing credential makes it measurably
    // faster than a wrong password, which turns the login endpoint into
    // a way to enumerate who has an account.
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);

    const t0 = Date.now();
    await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", "wrong-password");
    const wrongPassword = Date.now() - t0;

    const t1 = Date.now();
    await checkCredential(env.CONTROL_DB, "nobody@acme.com", "acme", "wrong-password");
    const noAccount = Date.now() - t1;

    // Both perform a real Argon2id hash, so neither is trivially fast.
    expect(noAccount).toBeGreaterThan(wrongPassword / 4);
  });
});

describe("access grants decide which instances you may reach", () => {
  it("lists nothing before anything is granted", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    expect(await listAccessibleEnvironments(env.CONTROL_DB, "dan@acme.com")).toHaveLength(0);
  });

  it("lists exactly what was granted", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-us");

    const environments = await listAccessibleEnvironments(env.CONTROL_DB, "dan@acme.com");
    expect(environments.map((e) => e.id).sort()).toEqual(["acme-production-eu", "acme-production-us"]);
  });

  it("one password reaches both instances", async () => {
    // A person should not hold two secrets for what is, to them, one
    // organisation.
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-us");

    expect(await hasAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu")).toBe(true);
    expect(await hasAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-us")).toBe(true);
    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD)).ok).toBe(true);
  });

  it("refuses a grant for another customer's environment", async () => {
    // The one mistake that would matter: one row, and the isolation the
    // whole design rests on is gone.
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    const result = await grantAccess(env.CONTROL_DB, "dan@acme.com", "nw-production-eu");
    expect(result.status).toBe(422);
    expect(await hasAccess(env.CONTROL_DB, "dan@acme.com", "nw-production-eu")).toBe(false);
  });

  it("refuses a grant for an environment that does not exist", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    expect((await grantAccess(env.CONTROL_DB, "dan@acme.com", "no-such-env")).status).toBe(404);
  });

  it("is idempotent — granting twice is one row", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");

    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM user_environment_access").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("records who granted it", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu", "operator");

    const row = await env.CONTROL_DB.prepare("SELECT granted_by FROM user_environment_access").first<{
      granted_by: string;
    }>();
    expect(row?.granted_by).toBe("operator");
  });
});

describe("revoking", () => {
  it("removes the way in", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    await revokeAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");

    expect(await hasAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu")).toBe(false);
  });

  it("leaves the credential alone — one instance revoked is not all of them", async () => {
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-us");
    await revokeAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");

    expect((await checkCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD)).ok).toBe(true);
    expect(await hasAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-us")).toBe(true);
  });

  it("says the instance's own user record is untouched", async () => {
    // What somebody may DO in an instance is that instance's record,
    // and an administrator may want the row kept for the history
    // attached to it.
    await setCredential(env.CONTROL_DB, "dan@acme.com", "acme", PASSWORD);
    await grantAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    const result = await revokeAccess(env.CONTROL_DB, "dan@acme.com", "acme-production-eu");
    expect(String((result.body as { note: string }).note)).toContain("untouched");
  });
});

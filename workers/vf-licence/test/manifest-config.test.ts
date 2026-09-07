import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleEnvironmentConfig,
  customerIdFrom,
  usableCustomerId,
} from "../src/provision-route.js";

/**
 * The manifest is the config — decisions 0136 and 0137.
 *
 * The operator's question: *"is there any way this could be stored in
 * the licence server, without physically having to update files?"*
 *
 * **It already was.** `environments` has carried `worker_name`,
 * `d1_database_name` and `d1_database_id` since decision 0006, and was
 * treated as a file only because nothing had asked the manifest for it.
 */

/**
 * `??` would defeat this: passing `null` for a field would fall through
 * to the default and seed it anyway, so the "not deployable" test would
 * assert against a complete row. Uses `in` instead.
 */
async function seedEnvironment(fields: Record<string, string | null> = {}) {
  const field = (name: string, fallback: string) =>
    name in fields ? fields[name] : fallback;

  await env.CONTROL_DB.prepare(
    "INSERT OR IGNORE INTO customers (id, name) VALUES ('acme', 'Acme Ltd')"
  ).run();
  await env.CONTROL_DB.prepare(
    `INSERT INTO environments (id, customer_id, kind, region, instance_url,
                               worker_name, d1_database_name, d1_database_id, r2_bucket_name)
     VALUES ('acme-sandbox-eu', 'acme', 'sandbox', 'eu', 'https://not-yet-deployed.invalid/x', ?, ?, ?, ?)`
  )
    .bind(
      field("worker_name", "vf-app-acme-sandbox-eu"),
      field("d1_database_name", "acme-sandbox-eu"),
      field("d1_database_id", "11111111-2222-3333-4444-555555555555"),
      field("r2_bucket_name", "acme-sandbox-eu-documents")
    )
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("what a deploy reads", () => {
  it("returns every binding a Worker needs", async () => {
    await seedEnvironment();
    const body = (await handleEnvironmentConfig(env.CONTROL_DB, "acme-sandbox-eu")).body as Record<
      string,
      unknown
    >;

    expect(body.d1DatabaseId).toBe("11111111-2222-3333-4444-555555555555");
    expect(body.r2BucketName).toBe("acme-sandbox-eu-documents");
    expect(body.workerName).toBe("vf-app-acme-sandbox-eu");
    expect(body.customerId).toBe("acme");
    expect(body.deployable).toBe(true);
  });

  it("carries no secret", async () => {
    // **Decision 0009 is this project's own record** of a private
    // signing key sitting in a customer's wrangler.jsonc as a plain
    // var, caught only because a reviewer noticed key_ops read "sign"
    // where a public key should read "verify".
    await seedEnvironment();
    const body = (await handleEnvironmentConfig(env.CONTROL_DB, "acme-sandbox-eu")).body as Record<
      string,
      unknown
    >;

    const serialised = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "secret", "private", "hash", "password"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it("says it is not deployable, and names what is missing", async () => {
    // A caller reading a config with a null d1_database_id and
    // deploying anyway would produce a Worker bound to nothing.
    // "Incomplete" sends somebody looking; this says where.
    await seedEnvironment({ d1_database_id: null, r2_bucket_name: null });
    const body = (await handleEnvironmentConfig(env.CONTROL_DB, "acme-sandbox-eu")).body as {
      deployable: boolean;
      missing: string[];
    };

    expect(body.deployable).toBe(false);
    expect(body.missing).toContain("d1DatabaseId");
    expect(body.missing).toContain("r2BucketName");
  });

  it("404s an environment that does not exist", async () => {
    expect((await handleEnvironmentConfig(env.CONTROL_DB, "nope")).status).toBe(404);
  });
});

describe("deriving a customer id from a company name (decision 0137)", () => {
  it("slugs an ordinary name", () => {
    expect(customerIdFrom("Acme Ltd")).toBe("acme-ltd");
  });

  it("folds accents rather than stripping them", () => {
    // The interface is translated (0107) precisely so these customers
    // exist, and decision 0129 learned this on the email local part.
    expect(customerIdFrom("Großkunden GmbH")).toBe("grosskunden-gmbh");
    expect(customerIdFrom("Société Générale")).toBe("societe-generale");
  });
});

describe("the length guard runs at approval (decision 0137)", () => {
  /**
   * **Against the longest name a customer will ever need**, not the one
   * being created. An `acme-sandbox-eu` that fits while
   * `acme-production-eu` would not is a customer who cannot go live —
   * and they would find out on the day they tried.
   */
  it("accepts an ordinary company", () => {
    expect(usableCustomerId("acme-ltd").ok).toBe(true);
  });

  it("refuses one whose production name would be too long", () => {
    const long = customerIdFrom("International Business Machines Corporation Holdings");
    const result = usableCustomerId(long);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Names the environment that would fail, not just the limit.
      expect(result.reason).toContain("-production-eu");
    }
  });

  it("refuses a name with no letters or numbers", () => {
    expect(usableCustomerId(customerIdFrom("!!!")).ok).toBe(false);
  });

  it("refuses on the production name even when the sandbox one fits", () => {
    // The property that makes checking the longest worth doing: these
    // differ by six characters, and only one is checked today.
    const borderline = "a".repeat(45);
    expect(`${borderline}-sandbox-eu`.length).toBeLessThan(58);
    expect(usableCustomerId(borderline).ok).toBe(false);
  });
});

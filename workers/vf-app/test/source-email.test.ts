import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSetSourceEmail, ingestionAddress } from "../src/source-route.js";

/**
 * An address a supplier can send an invoice to — decision 0126.
 *
 * A source has carried `mechanism: 'email'` since decision 0060 and no
 * address, so *"this customer receives invoices by email"* has been a
 * statement about intent rather than a thing that works.
 */

async function seedSource(id: string, name: string, mechanism = "email") {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism) VALUES (?, 'ap', ?, ?)"
  )
    .bind(id, name, mechanism)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the address is derived from the customer, not the environment", () => {
  /**
   * **This is the point of the whole scheme.** Decision 0118 provisions
   * a second environment when a trial becomes production, and an
   * address naming the sandbox would have to be reissued to every
   * supplier on the day a customer goes live.
   */
  it("names the source and the customer", () => {
    expect(ingestionAddress("AP Mailbox", "acme")).toBe("ap-mailbox.acme@vibefinance.com");
  });

  it("gives the same address in sandbox and production", () => {
    // The customer id does not change when 0118 moves them.
    expect(ingestionAddress("AP", "acme")).toBe(ingestionAddress("AP", "acme"));
    expect(ingestionAddress("AP", "acme")).not.toContain("sandbox");
  });

  it("survives a name a mail system would reject", () => {
    // Somebody naming a source "AP Mailbox (UK)" should get a working
    // address, not a rejection.
    const address = ingestionAddress("AP Mailbox (UK)!", "Acme Ltd");
    expect(address).toBe("ap-mailbox-uk.acme-ltd@vibefinance.com");
    expect(address).toBe(address.toLowerCase());
  });

  it("cannot collide with another customer", () => {
    // A customer id is unique across the fleet, so the address is too,
    // without a registry.
    expect(ingestionAddress("AP", "acme")).not.toBe(ingestionAddress("AP", "globex"));
  });
});

describe("giving a source an address", () => {
  it("reserves one, and says mail is not arriving yet", async () => {
    // Creating the routing rule needs the Cloudflare API half of
    // decision 0039, which is not built. A screen implying mail was
    // arriving would be worse than one admitting it is not.
    await seedSource("s-ap", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-ap", "acme");

    expect(result.status).toBe(200);
    const body = result.body as { emailAddress: string; routing: string; detail: string };
    expect(body.emailAddress).toBe("ap-mailbox.acme@vibefinance.com");
    expect(body.routing).toBe("not_configured");
    expect(body.detail).toContain("mail will not arrive");
  });

  it("stores it, so the routing rule can name the same string", async () => {
    await seedSource("s-ap", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-ap", "acme");

    const row = await env.DB.prepare(
      "SELECT email_address, email_routing FROM sources WHERE id = 's-ap'"
    ).first<{ email_address: string; email_routing: string }>();

    expect(row?.email_address).toBe("ap-mailbox.acme@vibefinance.com");
    expect(row?.email_routing).toBe("not_configured");
  });

  it("never reissues one", async () => {
    // Suppliers write an address down, and changing it silently would
    // break every one of them.
    await seedSource("s-ap", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-ap", "acme");

    const again = await handleSetSourceEmail(env.DB, "s-ap", "acme");
    expect(again.status).toBe(409);
    expect(String((again.body as { detail: string }).detail)).toContain("written it down");
  });

  it("refuses a source that does not receive by email", async () => {
    // An SFTP source carrying a mailbox is a configuration nobody could
    // act on.
    await seedSource("s-sftp", "Nightly feed", "sftp");
    const result = await handleSetSourceEmail(env.DB, "s-sftp", "acme");
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("sftp");
  });

  it("refuses two sources whose names would produce one address", async () => {
    // Caught with a reason, rather than as a constraint error.
    await seedSource("s-1", "AP Mailbox");
    await seedSource("s-2", "ap mailbox");
    await handleSetSourceEmail(env.DB, "s-1", "acme");

    const result = await handleSetSourceEmail(env.DB, "s-2", "acme");
    expect(result.status).toBe(409);
    expect(String((result.body as { detail: string }).detail)).toContain("different name");
  });

  it("404s a source that does not exist", async () => {
    expect((await handleSetSourceEmail(env.DB, "nope", "acme")).status).toBe(404);
  });

  it("refuses when the instance does not know its own customer", async () => {
    // A provisioning fault rather than a caller's mistake, and saying
    // so is the difference between a fixable report and a puzzle.
    await seedSource("s-ap", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-ap", undefined);
    expect(result.status).toBe(500);
    expect(String((result.body as { error: string }).error)).toContain("CUSTOMER_ID");
  });
});

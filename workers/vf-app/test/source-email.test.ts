import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
/**
 * The domain is configuration — decision 0141. It was
 * `"vibefinance.com"` hardcoded, against a domain nobody owned.
 */
const ENV = { INGESTION_DOMAIN: "vibefinance.example" };

import {
  handlePreviewSourceEmail,
  mailboxName,
  handleSetSourceEmail,
  ingestionAddress,
  handleRetireSource,
  handleRenameSource,
} from "../src/source-route.js";

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
    expect(ingestionAddress("AP Mailbox", "acme", "vibefinance.example")).toBe("ap-mailbox.acme@vibefinance.example");
  });

  it("gives the same address in sandbox and production", () => {
    // The customer id does not change when 0118 moves them.
    expect(ingestionAddress("AP", "acme", "vibefinance.example")).toBe(ingestionAddress("AP", "acme", "vibefinance.example"));
    expect(ingestionAddress("AP", "acme", "vibefinance.example")).not.toContain("sandbox");
  });

  it("survives a name a mail system would reject", () => {
    // Somebody naming a source "AP Mailbox (UK)" should get a working
    // address, not a rejection.
    const address = ingestionAddress("AP Mailbox (UK)!", "Acme Ltd", "vibefinance.example");
    expect(address).toBe("ap-mailbox-uk.acme-ltd@vibefinance.example");
    expect(address).toBe(address.toLowerCase());
  });

  it("cannot collide with another customer", () => {
    // A customer id is unique across the fleet, so the address is too,
    // without a registry.
    expect(ingestionAddress("AP", "acme", "vibefinance.example")).not.toBe(ingestionAddress("AP", "globex", "vibefinance.example"));
  });
});

describe("giving a source an address", () => {
  it("reserves one, and says mail is not arriving yet", async () => {
    // Creating the routing rule needs the Cloudflare API half of
    // decision 0039, which is not built. A screen implying mail was
    // arriving would be worse than one admitting it is not.
    await seedSource("s-ap", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-ap", "acme", ENV);

    expect(result.status).toBe(200);
    const body = result.body as { emailAddress: string; routing: string; reason: string };
    expect(body.emailAddress).toBe("ap-mailbox.acme@vibefinance.example");
    expect(body.routing).toBe("not_configured");
    expect(body.reason).toBe("not_routed_yet");
  });

  it("stores it, so the routing rule can name the same string", async () => {
    await seedSource("s-ap", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-ap", "acme", ENV);

    const row = await env.DB.prepare(
      "SELECT email_address, email_routing FROM sources WHERE id = 's-ap'"
    ).first<{ email_address: string; email_routing: string }>();

    expect(row?.email_address).toBe("ap-mailbox.acme@vibefinance.example");
    expect(row?.email_routing).toBe("not_configured");
  });

  it("never reissues one", async () => {
    // Suppliers write an address down, and changing it silently would
    // break every one of them.
    await seedSource("s-ap", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-ap", "acme", ENV);

    const again = await handleSetSourceEmail(env.DB, "s-ap", "acme", ENV);
    expect(again.status).toBe(409);
    expect((again.body as { reason: string }).reason).toBe("address_issued");
  });

  it("refuses a source that does not receive by email", async () => {
    // An SFTP source carrying a mailbox is a configuration nobody could
    // act on.
    await seedSource("s-sftp", "Nightly feed", "sftp");
    const result = await handleSetSourceEmail(env.DB, "s-sftp", "acme", ENV);
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("sftp");
  });

  it("refuses two sources whose names would produce one address", async () => {
    // Caught with a reason, rather than as a constraint error.
    await seedSource("s-1", "AP Mailbox");
    await seedSource("s-2", "ap mailbox");
    await handleSetSourceEmail(env.DB, "s-1", "acme", ENV);

    const result = await handleSetSourceEmail(env.DB, "s-2", "acme", ENV);
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("address_taken");
  });

  it("404s a source that does not exist", async () => {
    expect((await handleSetSourceEmail(env.DB, "nope", "acme", ENV)).status).toBe(404);
  });

  it("refuses when the instance does not know its own customer", async () => {
    // A provisioning fault rather than a caller's mistake, and saying
    // so is the difference between a fixable report and a puzzle.
    await seedSource("s-ap", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-ap", undefined, ENV);
    expect(result.status).toBe(500);
    expect(String((result.body as { error: string }).error)).toContain("CUSTOMER_ID");
  });
});

describe("what the platform will accept (decision 0129)", () => {
  /**
   * **Found by a question**: *"do we not have to limit the user to a
   * naming convention that relates to the Cloudflare platform?"*
   *
   * Three real problems, and the characters were never one of them —
   * the slug already produced `[a-z0-9-]`.
   */
  it("refuses a name with no letters or numbers in it", async () => {
    // `!!!` slugs to nothing, and `.acme@vibefinance.example` has a leading
    // dot and is not an address at all.
    await seedSource("s-bang", "!!!");
    const result = await handleSetSourceEmail(env.DB, "s-bang", "acme", ENV);

    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("no letters or numbers");
  });

  it("refuses a name that would exceed RFC 5321's local part", async () => {
    // 64 characters, which Cloudflare enforces. An 80-character name
    // produced an 85-character local part.
    await seedSource("s-long", "A".repeat(80));
    const result = await handleSetSourceEmail(env.DB, "s-long", "acme", ENV);

    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("64");
  });

  it("says to rename it, rather than only that it failed", async () => {
    await seedSource("s-bang2", "###");
    const result = await handleSetSourceEmail(env.DB, "s-bang2", "acme", ENV);
    expect((result.body as { reason: string }).reason).toBe("name_unusable");
  });

  it("folds accents rather than stripping them", async () => {
    // **The interface is translated precisely so these customers
    // exist.** A German source named "Rechnungen für Köln" produced
    // `rechnungen-f-r-k-ln` before this — unreadable.
    expect(ingestionAddress("Rechnungen für Köln", "acme", "vibefinance.example")).toBe(
      "rechnungen-fur-koln.acme@vibefinance.example"
    );
  });

  it("handles the sharp s the way German does", () => {
    expect(ingestionAddress("Großkunden", "acme", "vibefinance.example")).toBe("grosskunden.acme@vibefinance.example");
  });

  it("still accepts an ordinary name at the boundary", async () => {
    // The limit must not refuse something reasonable.
    await seedSource("s-ok", "Accounts Payable Mailbox UK");
    expect((await handleSetSourceEmail(env.DB, "s-ok", "acme", ENV)).status).toBe(200);
  });
});

describe("retiring a source (decision 0130)", () => {
  /**
   * **A document records the source's NAME, not its id.**
   * `mandate.channel` is set from `source.name` at capture, it is in
   * the closed vocabulary, and customers write rules against it — so a
   * source is not a row that can simply be removed.
   */
  async function seedUser() {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
    ).run();
  }

  async function seedArrival(channel: string) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-a', ?)")
      .bind(JSON.stringify({ "mandate.channel": channel }))
      .run();
  }

  it("deletes one nothing ever used", async () => {
    // Somebody correcting a mistake, not changing history.
    await seedUser();
    await seedSource("s-oops", "Created by mistake");

    const result = await handleRetireSource(env.DB, "s-oops", "u-dan");
    expect((result.body as { outcome: string }).outcome).toBe("deleted");

    const row = await env.DB.prepare("SELECT id FROM sources WHERE id = 's-oops'").first();
    expect(row).toBeNull();
  });

  it("retires one that documents arrived through", async () => {
    // Removing the row would leave invoices citing a channel nothing
    // explains.
    await seedUser();
    await seedSource("s-live", "AP Mailbox");
    await seedArrival("AP Mailbox");

    const result = await handleRetireSource(env.DB, "s-live", "u-dan");
    expect((result.body as { outcome: string }).outcome).toBe("retired");
    expect((result.body as { reason: string }).reason).toBe("documents_arrived");

    const row = await env.DB.prepare(
      "SELECT status, retired_by FROM sources WHERE id = 's-live'"
    ).first<{ status: string; retired_by: string }>();
    expect(row?.status).toBe("retired");
    expect(row?.retired_by).toBe("u-dan");
  });

  it("retires one that was given an address, even if unused", async () => {
    // A supplier may have written the address into their ERP. Deleting
    // the source does not stop them sending.
    await seedUser();
    await seedSource("s-addr", "AR Mailbox");
    await handleSetSourceEmail(env.DB, "s-addr", "acme", ENV);

    // **Refused, not retired** -- decision 0133. Nothing arrived, so
    // this may be a mistake to correct, and only a person knows whether
    // the address was ever shared.
    const result = await handleRetireSource(env.DB, "s-addr", "u-dan");
    expect((result.body as { outcome: string }).outcome).toBe("confirm_required");
  });

  it("refuses to retire one twice", async () => {
    await seedUser();
    await seedSource("s-twice", "AP Mailbox");
    await seedArrival("AP Mailbox");
    await handleRetireSource(env.DB, "s-twice", "u-dan");

    expect((await handleRetireSource(env.DB, "s-twice", "u-dan")).status).toBe(409);
  });
});

describe("renaming a source (decision 0130)", () => {
  it("renames one nothing has touched", async () => {
    await seedSource("s-new", "Draft name");
    const result = await handleRenameSource(env.DB, "s-new", "AP Mailbox");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT name FROM sources WHERE id = 's-new'").first<{
      name: string;
    }>();
    expect(row?.name).toBe("AP Mailbox");
  });

  it("renames one with an address, and the address stays — decision 0582", async () => {
    // It was refused while the address was derived from the name; the
    // mailbox name is now chosen on its own, so the name is only read.
    await seedSource("s-addr2", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-addr2", "acme", ENV, "invoices");

    const result = await handleRenameSource(env.DB, "s-addr2", "UK supplier invoices");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT name, email_address FROM sources WHERE id = 's-addr2'").first();
    expect(row).toEqual({ name: "UK supplier invoices", email_address: "invoices.acme@vibefinance.example" });
  });

  it("renames one documents arrived through, and they keep the name they arrived under — decision 0583", async () => {
    // 0130 refused this. A rule naming the source is what a rename can
    // break, so that is what is checked now, not whether anything arrived.
    await seedSource("s-used", "AP Mailbox");
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-b', ?)")
      .bind(JSON.stringify({ "mandate.channel": "AP Mailbox" }))
      .run();

    const result = await handleRenameSource(env.DB, "s-used", "UK supplier invoices");
    expect(result.status).toBe(200);
    expect((await env.DB.prepare("SELECT name FROM sources WHERE id = 's-used'").first())?.name).toBe("UK supplier invoices");
    const facts = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-b'").first<{ facts_json: string }>();
    expect(JSON.parse(facts!.facts_json)["mandate.channel"]).toBe("AP Mailbox");
  });

  async function rule(id: string, name: string, compiled: unknown, effectiveTo: string | null = null) {
    await env.DB.prepare("INSERT OR IGNORE INTO rule_sets (id, name, mode, status) VALUES ('rs', 'AP', 'all_matches', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs', 1, 1, ?)").bind(id, name).run();
    await env.DB.prepare(
      "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, effective_to) VALUES (?, 1, 'x', ?, 'test', ?)"
    )
      .bind(id, JSON.stringify(compiled), effectiveTo)
      .run();
  }

  it("refuses while a current rule names the source as its channel, naming the rules — decision 0583", async () => {
    await seedSource("s-ruled", "AP Mailbox");
    await rule("r-1", "Mailbox invoices to Dan", { when: { all: [{ field: "mandate.channel", op: "equals", value: "ap mailbox" }] }, then: [{ action: "assign" }] });
    // Not a channel condition, an ended rule, and another channel: none of these stop it.
    await rule("r-2", "Tag AP Mailbox", { when: { all: [{ field: "BT-1", op: "equals", value: "AP Mailbox" }] } });
    await rule("r-3", "Old", { when: { field: "mandate.channel", op: "equals", value: "AP Mailbox" } }, "2026-01-01T00:00:00Z");
    await rule("r-4", "Other channel", { when: { field: "mandate.channel", op: "equals", value: "Structured XML" } });

    const refused = await handleRenameSource(env.DB, "s-ruled", "UK supplier invoices");
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "rule_names_source", rules: [{ id: "r-1", name: "Mailbox invoices to Dan" }] });

    await env.DB.prepare("UPDATE rule_versions SET effective_to = '2026-01-01T00:00:00Z' WHERE rule_id = 'r-1'").run();
    expect((await handleRenameSource(env.DB, "s-ruled", "UK supplier invoices")).status).toBe(200);
  });

  it("refuses a name another source in the process has", async () => {
    await seedSource("s-a", "AP Mailbox");
    await seedSource("s-b", "Second");
    const result = await handleRenameSource(env.DB, "s-b", "ap mailbox");
    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("name_taken");
  });

  it("refuses an empty name", async () => {
    await seedSource("s-blank", "AP Mailbox");
    expect((await handleRenameSource(env.DB, "s-blank", "  ")).status).toBe(400);
  });
});

describe("the API returns codes, not sentences (decision 0132)", () => {
  /**
   * Reported from the screen: *"nothing ever arrived through it and it
   * had no address, so it is simply gone"* — chatty, and **written in
   * English inside the API**, so a German customer read it in English.
   *
   * Exactly what decision 0107 exists to prevent, in an interface
   * translated since.
   */
  it("carries no English prose in any response", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
    ).run();
    await seedSource("s-prose", "AP Mailbox");

    const bodies = [
      (await handleSetSourceEmail(env.DB, "s-prose", "acme", ENV)).body,
      (await handleSetSourceEmail(env.DB, "s-prose", "acme", ENV)).body,
      // Renaming one with an address now succeeds (decision 0582), with nothing to explain.
      (await handleRetireSource(env.DB, "s-prose", "u-dan")).body,
    ] as Record<string, unknown>[];

    for (const body of bodies) {
      // `detail` was the field carrying the prose. Nothing should have
      // one, and a `reason` is a code a screen can translate.
      expect(body.detail, JSON.stringify(body)).toBeUndefined();
      expect(typeof body.reason).toBe("string");
      // A code, not a sentence: no spaces.
      expect(String(body.reason)).not.toContain(" ");
    }
  });
});

describe("releasing an issued address (decision 0133)", () => {
  /**
   * **Only a person can know whether an address was shared.** An
   * address reserved and never given to anybody is a mistake to
   * correct; one already in a supplier's ERP is not, and nothing
   * records which.
   *
   * So the default protects the second case, and a person can say *"I
   * know it was never shared."*
   */
  async function withAddress(id: string, name: string) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
    ).run();
    await seedSource(id, name);
    await handleSetSourceEmail(env.DB, id, "acme", ENV);
  }

  it("refuses, and names the address that would be released", async () => {
    // "An address will be released" is not something a person can
    // check. The address itself is.
    await withAddress("s-r1", "AP Mailbox");
    const result = await handleRetireSource(env.DB, "s-r1", "u-dan");

    expect(result.status).toBe(409);
    const body = result.body as { outcome: string; emailAddress: string };
    expect(body.outcome).toBe("confirm_required");
    expect(body.emailAddress).toBe("ap-mailbox.acme@vibefinance.example");
  });

  it("deletes when somebody confirms", async () => {
    await withAddress("s-r2", "AR Mailbox");
    const result = await handleRetireSource(env.DB, "s-r2", "u-dan", true);

    expect((result.body as { outcome: string }).outcome).toBe("deleted");
    expect((result.body as { reason: string }).reason).toBe("address_released");
    expect((result.body as { releasedAddress: string }).releasedAddress).toBe(
      "ar-mailbox.acme@vibefinance.example"
    );

    expect(await env.DB.prepare("SELECT id FROM sources WHERE id = 's-r2'").first()).toBeNull();
  });

  it("frees the address for reuse", async () => {
    // The point of releasing it. A name refused as taken should work
    // once the source holding it is gone.
    await withAddress("s-r3", "AP Mailbox");
    await handleRetireSource(env.DB, "s-r3", "u-dan", true);

    await seedSource("s-r4", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-r4", "acme", ENV);
    expect(result.status).toBe(200);
    expect((result.body as { emailAddress: string }).emailAddress).toBe(
      "ap-mailbox.acme@vibefinance.example"
    );
  });

  it("still retires one that documents arrived through, confirmed or not", async () => {
    // **Confirmation does not override history.** The address is the
    // only thing a person can vouch for; a document that already cites
    // this source's name is not.
    await withAddress("s-r5", "Live Mailbox");
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-r', ?)")
      .bind(JSON.stringify({ "mandate.channel": "Live Mailbox" }))
      .run();

    const result = await handleRetireSource(env.DB, "s-r5", "u-dan", true);
    expect((result.body as { outcome: string }).outcome).toBe("retired");
  });

  it("does not ask about a source with no address at all", async () => {
    // Nothing to release, so nothing to confirm.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
    ).run();
    await seedSource("s-r6", "Never used");

    const result = await handleRetireSource(env.DB, "s-r6", "u-dan");
    expect((result.body as { outcome: string }).outcome).toBe("deleted");
    expect((result.body as { reason: string }).reason).toBe("never_used");
  });
});

describe("no domain, no address (decision 0141)", () => {
  /**
   * **A domain nobody owned was hardcoded, and nothing objected.**
   * Every address minted against `vibefinance.com` was a string that
   * looked like an address and could never receive anything — and the
   * screen reported one reserved when nothing had been.
   *
   * The same discipline as `not-yet-deployed.invalid` (decision 0039):
   * a system that admits what it cannot do rather than producing
   * something plausible.
   */
  it("refuses to issue one when no domain is configured", async () => {
    await seedSource("s-nodomain", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-nodomain", "acme", {});

    expect(result.status).toBe(503);
    expect((result.body as { reason: string }).reason).toBe("no_ingestion_domain");
  });

  it("stores nothing when it refuses", async () => {
    // A refusal that half-wrote a row would be worse than the bug.
    await seedSource("s-nodomain2", "AP Mailbox");
    await handleSetSourceEmail(env.DB, "s-nodomain2", "acme", {});

    const row = await env.DB.prepare(
      "SELECT email_address FROM sources WHERE id = 's-nodomain2'"
    ).first<{ email_address: string | null }>();
    expect(row?.email_address).toBeNull();
  });

  it("treats an empty domain as no domain", async () => {
    // An env var set to "" is the shape a misconfiguration takes.
    await seedSource("s-blank", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-blank", "acme", {
      INGESTION_DOMAIN: "   ",
    });
    expect(result.status).toBe(503);
  });

  it("uses whichever domain is configured", async () => {
    // The point of making it configuration: a new domain changes every
    // future address without a code change.
    await seedSource("s-other", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-other", "acme", {
      INGESTION_DOMAIN: "invoices.example.net",
    });

    expect((result.body as { emailAddress: string }).emailAddress).toBe(
      "ap-mailbox.acme@invoices.example.net"
    );
  });
});

/**
 * **The mailbox name, chosen — decision 0582.** Dan, 1 October: the
 * source's name became the address, which made the name read like an
 * address. Now the name is for people, and the part before
 * `.<customer>` is chosen, previewed, then issued.
 */
describe("choosing the mailbox name — decision 0582", () => {
  it("issues the chosen mailbox name with the customer's own suffix", async () => {
    await seedSource("s-uk", "UK supplier invoices");
    const result = await handleSetSourceEmail(env.DB, "s-uk", "acme", ENV, "Invoices");
    expect((result.body as { emailAddress: string }).emailAddress).toBe("invoices.acme@vibefinance.example");
  });

  it("keeps single dots between words, and reduces the rest as a name is", () => {
    expect(mailboxName("Accounts.Payable")).toBe("accounts.payable");
    expect(mailboxName("AP  Invoices")).toBe("ap-invoices");
    expect(mailboxName(" .Rechnungen für Köln.. ")).toBe("rechnungen-fur-koln");
    expect(mailboxName("ap - . invoices")).toBe("ap.invoices");
    expect(mailboxName("Straße")).toBe("strasse");
    // With no dots, exactly as the source's name always gave.
    expect(mailboxName("AP Mailbox")).toBe("ap-mailbox");
  });

  it("without one, uses the source's name as before", async () => {
    await seedSource("s-ap", "AP Mailbox");
    const result = await handleSetSourceEmail(env.DB, "s-ap", "acme", ENV, "  ");
    expect((result.body as { emailAddress: string }).emailAddress).toBe("ap-mailbox.acme@vibefinance.example");
  });

  it("previews the address, or why not, before anything is issued", async () => {
    await seedSource("s-1", "AP Mailbox");
    await seedSource("s-2", "Second");
    await handleSetSourceEmail(env.DB, "s-1", "acme", ENV, "invoices");

    expect((await handlePreviewSourceEmail(env.DB, "s-2", "acme", ENV, "UK Invoices")).body).toEqual({
      ok: true,
      address: "uk-invoices.acme@vibefinance.example",
      mailbox: "uk-invoices",
    });
    const taken = (await handlePreviewSourceEmail(env.DB, "s-2", "acme", ENV, "invoices")).body as Record<string, unknown>;
    expect(taken).toMatchObject({ ok: false, address: null, reason: "address_taken" });
    const empty = (await handlePreviewSourceEmail(env.DB, "s-2", "acme", ENV, "!!!")).body as Record<string, unknown>;
    expect(empty).toMatchObject({ ok: false, address: null, reason: "name_unusable" });
    const long = (await handlePreviewSourceEmail(env.DB, "s-2", "acme", ENV, "x".repeat(70))).body as Record<string, unknown>;
    expect(long).toMatchObject({ ok: false, reason: "name_unusable" });
    // Nothing was issued by previewing.
    const row = await env.DB.prepare("SELECT email_address FROM sources WHERE id = 's-2'").first<{ email_address: string | null }>();
    expect(row?.email_address).toBeNull();
    // Already issued: says so.
    expect((await handlePreviewSourceEmail(env.DB, "s-1", "acme", ENV, "other")).body).toMatchObject({ ok: false, reason: "address_issued" });
    expect((await handlePreviewSourceEmail(env.DB, "nope", "acme", ENV, "x")).status).toBe(404);
  });
});

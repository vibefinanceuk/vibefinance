import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  assessDelay,
  recordAttempt,
  signInReport,
  sweepOldAttempts,
  LOGIN_ATTEMPT_RETENTION_DAYS,
} from "../src/login-attempts.js";

const EMAIL = "dan@acme.com";
const ENV_ID = "acme-production-eu";

/** Writes an attempt at a chosen moment, for testing the schedule. */
async function attemptAt(succeeded: boolean, at: string, email = EMAIL, environmentId = ENV_ID) {
  await env.CONTROL_DB.prepare(
    "INSERT INTO login_attempts (id, email, environment_id, succeeded, attempted_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), email.toLowerCase(), environmentId, succeeded ? 1 : 0, at)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the delay grows with consecutive failures", () => {
  it("does not delay the first two — a mistyped password is ordinary", async () => {
    const now = new Date("2026-09-04T12:00:00Z");
    expect((await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, now)).delaySeconds).toBe(0);

    await attemptAt(false, "2026-09-04 11:59:59");
    expect((await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, now)).delaySeconds).toBe(0);
  });

  it("climbs from the third failure", async () => {
    const now = new Date("2026-09-04T12:00:00Z");
    await attemptAt(false, "2026-09-04 11:58:00");
    await attemptAt(false, "2026-09-04 11:59:00");
    const verdict = await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, now);
    expect(verdict.consecutiveFailures).toBe(2);
    expect(verdict.delaySeconds).toBeGreaterThan(0);
  });

  it("reaches a cost that makes guessing pointless", async () => {
    // By the eighth failure an attacker manages roughly three attempts
    // an hour against one account.
    for (let i = 0; i < 8; i++) await attemptAt(false, `2026-09-04 10:0${i}:00`);
    const verdict = await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, new Date("2026-09-04T10:10:00Z"));
    expect(verdict.delaySeconds).toBeGreaterThanOrEqual(600);
  });

  it("stops growing rather than climbing forever", async () => {
    for (let i = 0; i < 30; i++) await attemptAt(false, `2026-09-04 10:00:${String(i).padStart(2, "0")}`);
    const verdict = await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, new Date("2026-09-04T12:00:00Z"));
    expect(verdict.delaySeconds).toBe(1800);
  });

  it("says whether this attempt is too soon", async () => {
    for (let i = 0; i < 4; i++) await attemptAt(false, `2026-09-04 11:5${i}:00`);
    const justAfter = new Date("2026-09-04T11:53:01Z");
    expect((await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, justAfter)).tooSoon).toBe(true);

    const wellAfter = new Date("2026-09-04T13:00:00Z");
    expect((await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, wellAfter)).tooSoon).toBe(false);
  });
});

describe("a success resets the count", () => {
  it("clears the delay", async () => {
    // Otherwise anyone who occasionally mistypes accumulates towards
    // inevitable lockout.
    for (let i = 0; i < 5; i++) await attemptAt(false, `2026-09-04 11:0${i}:00`);
    await attemptAt(true, "2026-09-04 11:30:00");

    const verdict = await assessDelay(env.CONTROL_DB, EMAIL, ENV_ID, new Date("2026-09-04T11:31:00Z"));
    expect(verdict.consecutiveFailures).toBe(0);
    expect(verdict.delaySeconds).toBe(0);
  });

  it("keeps the rows — the failures are still on record", async () => {
    // "Three failures on Tuesday, then a success" is exactly the
    // pattern worth seeing later. Deleting on success erases the
    // interesting case and keeps only the boring ones.
    for (let i = 0; i < 3; i++) await attemptAt(false, `2026-09-04 11:0${i}:00`);
    await attemptAt(true, "2026-09-04 11:30:00");

    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM login_attempts").first<{ n: number }>();
    expect(count?.n).toBe(4);
  });
});

describe("attempts are scoped", () => {
  it("does not slow a sign-in to another environment", async () => {
    // Separate instances, separate data. Decision 0086's tokens are
    // scoped this way already.
    for (let i = 0; i < 5; i++) await attemptAt(false, `2026-09-04 11:0${i}:00`, EMAIL, "acme-production-eu");
    const other = await assessDelay(env.CONTROL_DB, EMAIL, "acme-production-us", new Date("2026-09-04T11:06:00Z"));
    expect(other.delaySeconds).toBe(0);
  });

  it("does not slow a different person", async () => {
    for (let i = 0; i < 5; i++) await attemptAt(false, `2026-09-04 11:0${i}:00`);
    const other = await assessDelay(env.CONTROL_DB, "sarah@acme.com", ENV_ID, new Date("2026-09-04T11:06:00Z"));
    expect(other.delaySeconds).toBe(0);
  });

  it("treats an email case-insensitively — otherwise the delay is bypassable", async () => {
    // The bypass runs THIS way round: attempts accumulate against the
    // stored lowercase address, and an attacker retypes `Dan@Acme.com`
    // hoping the lookup misses. Testing the reverse — recording mixed
    // and reading lower — exercises nothing, because the write path
    // lowercases anyway.
    for (let i = 0; i < 5; i++) await recordAttempt(env.CONTROL_DB, "dan@acme.com", ENV_ID, false);

    const retyped = await assessDelay(env.CONTROL_DB, "Dan@Acme.COM", ENV_ID);
    expect(retyped.consecutiveFailures).toBe(5);
  });

  it("records mixed case as lowercase, so one address is one key", async () => {
    await recordAttempt(env.CONTROL_DB, "Dan@Acme.com", ENV_ID, false);
    const row = await env.CONTROL_DB.prepare("SELECT email FROM login_attempts").first<{ email: string }>();
    expect(row?.email).toBe("dan@acme.com");
  });

  it("records an attempt for an email with no account at all", async () => {
    // The attempt most worth seeing: somebody probing for addresses.
    await recordAttempt(env.CONTROL_DB, "stranger@nowhere.com", ENV_ID, false);
    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM login_attempts").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("what a person is told after signing in (ISO 27001 A.8.5)", () => {
  it("reports the previous success, not the one just made", async () => {
    await attemptAt(true, "2026-09-01 09:00:00");
    await attemptAt(true, "2026-09-04 09:00:00");

    const report = await signInReport(env.CONTROL_DB, EMAIL, ENV_ID);
    expect(report.lastSuccessAt).toBe("2026-09-01 09:00:00");
  });

  it("lists the failed attempts since then", async () => {
    // A person who sees attempts from an address they do not recognise
    // knows something an audit log read by nobody never would.
    await attemptAt(true, "2026-09-01 09:00:00");
    await attemptAt(false, "2026-09-02 03:00:00");
    await attemptAt(false, "2026-09-02 03:01:00");
    await attemptAt(true, "2026-09-04 09:00:00");

    const report = await signInReport(env.CONTROL_DB, EMAIL, ENV_ID);
    expect(report.attemptsSinceLastSuccess).toHaveLength(2);
  });

  it("excludes failures from before the previous success", async () => {
    await attemptAt(false, "2026-08-01 03:00:00");
    await attemptAt(true, "2026-09-01 09:00:00");
    await attemptAt(false, "2026-09-02 03:00:00");
    await attemptAt(true, "2026-09-04 09:00:00");

    const report = await signInReport(env.CONTROL_DB, EMAIL, ENV_ID);
    expect(report.attemptsSinceLastSuccess).toHaveLength(1);
  });

  it("handles a first-ever sign-in, with no previous success", async () => {
    await attemptAt(false, "2026-09-04 08:00:00");
    await attemptAt(true, "2026-09-04 09:00:00");

    const report = await signInReport(env.CONTROL_DB, EMAIL, ENV_ID);
    expect(report.lastSuccessAt).toBeNull();
    expect(report.attemptsSinceLastSuccess).toHaveLength(1);
  });
});

describe("retention", () => {
  it("keeps twelve months, which is what an auditor expects", async () => {
    expect(LOGIN_ATTEMPT_RETENTION_DAYS).toBe(365);
  });

  it("discards attempts past the period and keeps the rest", async () => {
    await attemptAt(false, "2024-01-01 09:00:00");
    await attemptAt(false, "2026-09-01 09:00:00");

    const result = await sweepOldAttempts(env.CONTROL_DB, new Date("2026-09-04T12:00:00Z"));
    expect((result.body as { deleted: number }).deleted).toBe(1);

    const left = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM login_attempts").first<{ n: number }>();
    expect(left?.n).toBe(1);
  });
});

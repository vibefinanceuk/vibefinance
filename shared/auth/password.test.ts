import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, needsRehash, ARGON2_PARAMS } from "./password.js";

describe("hashing and verifying a password", () => {
  it("round-trips", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("refuses the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
  });

  it("uses OWASP's recommended parameters", async () => {
    // Not arbitrary. The platform forced this choice: Workers cap
    // PBKDF2 at 100,000 iterations where OWASP's minimum is 600,000.
    expect(ARGON2_PARAMS.t).toBe(2);
    expect(ARGON2_PARAMS.m).toBe(19456);
    expect(ARGON2_PARAMS.p).toBe(1);
  });

  it("gives two people who chose the same password different hashes", async () => {
    // A unique salt per password, so a precomputed table is useless and
    // a breach does not reveal who shares a password with whom.
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter2", a)).toBe(true);
    expect(await verifyPassword("hunter2", b)).toBe(true);
  });

  it("stores the parameters with the hash, not in a constant", async () => {
    // What lets the cost be raised later without invalidating a single
    // existing password.
    const stored = await hashPassword("hunter2");
    expect(stored.startsWith("argon2id$2$19456$1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6);
  });

  it("stores nothing resembling the password itself", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored).not.toContain("hunter2");
  });

  it("refuses to hash an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });

  it("refuses an absurdly long password rather than hashing it", async () => {
    await expect(hashPassword("x".repeat(2000))).rejects.toThrow();
  });

  it("handles unicode passwords", async () => {
    const stored = await hashPassword("pässwörd–ünïcode✓");
    expect(await verifyPassword("pässwörd–ünïcode✓", stored)).toBe(true);
    expect(await verifyPassword("passwordunicode", stored)).toBe(false);
  });
});

describe("verifying is defensive about what it reads", () => {
  it("returns false for a malformed stored value rather than throwing", async () => {
    // A login endpoint that throws on bad input is a way to probe it.
    for (const bad of ["", "nonsense", "argon2id$2$19456", "$$$$$", "bcrypt$10$abc$def"]) {
      expect(await verifyPassword("hunter2", bad)).toBe(false);
    }
  });

  it("refuses a stored hash claiming absurd parameters", async () => {
    // Anybody who can write to the database could otherwise turn one
    // sign-in into an outage by demanding 4 GiB of memory.
    const stored = await hashPassword("hunter2");
    const [, , , , salt, hash] = stored.split("$");
    const absurd = `argon2id$2$99999999$1$${salt}$${hash}`;
    expect(await verifyPassword("hunter2", absurd)).toBe(false);
  });

  it("refuses non-numeric parameters", async () => {
    const stored = await hashPassword("hunter2");
    const [, , , , salt, hash] = stored.split("$");
    expect(await verifyPassword("hunter2", `argon2id$x$19456$1$${salt}$${hash}`)).toBe(false);
  });

  it("refuses an empty password at verification too", async () => {
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("", stored)).toBe(false);
  });
});

describe("raising the cost later", () => {
  it("still verifies a hash made with weaker parameters", async () => {
    // The property that makes an upgrade possible at all: an old hash
    // verifies under the parameters it was MADE with.
    const stored = await hashPassword("hunter2");
    const weaker = stored.replace("argon2id$2$19456$1$", "argon2id$1$8192$1$");
    // Re-derive under those weaker parameters so the fixture is honest.
    const { argon2id } = await import("@noble/hashes/argon2.js");
    const [, , , , saltRaw] = weaker.split("$");
    const salt = Uint8Array.from(
      atob(saltRaw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (saltRaw.length % 4)) % 4)),
      (c) => c.charCodeAt(0)
    );
    const hash = argon2id(new TextEncoder().encode("hunter2"), salt, { t: 1, m: 8192, p: 1, dkLen: 32 });
    const encoded = btoa(String.fromCharCode(...hash)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const oldStyle = `argon2id$1$8192$1$${saltRaw}$${encoded}`;

    expect(await verifyPassword("hunter2", oldStyle)).toBe(true);
    expect(needsRehash(oldStyle)).toBe(true);
  });

  it("does not flag a hash already at current strength", async () => {
    // A check that fired on every sign-in would rehash constantly.
    expect(needsRehash(await hashPassword("hunter2"))).toBe(false);
  });

  it("flags anything it cannot recognise", async () => {
    expect(needsRehash("bcrypt$10$whatever")).toBe(true);
  });
});

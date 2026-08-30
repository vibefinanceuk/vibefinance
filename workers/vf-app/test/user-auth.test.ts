import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { authenticateUser, generateApiKey, hashApiKey } from "../src/user-auth.js";

async function seedUser(id: string, email: string, apiKey: string | null, status = "active"): Promise<void> {
  const hash = apiKey ? await hashApiKey(apiKey) : null;
  await env.DB.prepare(
    "INSERT INTO org_users (id, email, name, status, api_key_hash) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, email, "Test User", status, hash)
    .run();
}

function requestWithBearer(token: string | null): Request {
  return new Request("https://x", token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("authenticateUser", () => {
  it("authenticates a user with a correct key", async () => {
    const key = generateApiKey();
    await seedUser("usr1", "alice@example.com", key);
    const user = await authenticateUser(env.DB, requestWithBearer(key));
    expect(user).toEqual({ id: "usr1", email: "alice@example.com", name: "Test User" });
  });

  it("rejects a wrong key", async () => {
    await seedUser("usr1", "alice@example.com", generateApiKey());
    const user = await authenticateUser(env.DB, requestWithBearer("totally-wrong-key"));
    expect(user).toBeNull();
  });

  it("rejects when no key is provided at all", async () => {
    await seedUser("usr1", "alice@example.com", generateApiKey());
    const user = await authenticateUser(env.DB, requestWithBearer(null));
    expect(user).toBeNull();
  });

  it("rejects a user with no key configured — NULL means cannot authenticate, not open access", async () => {
    await seedUser("usr1", "alice@example.com", null);
    // Even an empty-string bearer token should fail cleanly, not throw.
    const user = await authenticateUser(env.DB, requestWithBearer("anything-at-all"));
    expect(user).toBeNull();
  });

  it("rejects a disabled user even with their correct key", async () => {
    const key = generateApiKey();
    await seedUser("usr1", "alice@example.com", key, "disabled");
    const user = await authenticateUser(env.DB, requestWithBearer(key));
    expect(user).toBeNull();
  });

  it("the critical property: user A's key must never authenticate as user B", async () => {
    const keyA = generateApiKey();
    const keyB = generateApiKey();
    await seedUser("usr-a", "alice@example.com", keyA);
    await seedUser("usr-b", "bob@example.com", keyB);

    // Checking BOTH directions matters here: a broken implementation
    // that ignores the key entirely and just returns "the first active
    // user" would still pass a test that only checks keyA → usr-a,
    // since usr-a happens to be inserted first — confirmed live, this
    // exact false positive was caught by adding the keyB check below
    // before trusting this test.
    const authenticatedAsA = await authenticateUser(env.DB, requestWithBearer(keyA));
    expect(authenticatedAsA?.id).toBe("usr-a");

    const authenticatedAsB = await authenticateUser(env.DB, requestWithBearer(keyB));
    expect(authenticatedAsB?.id).toBe("usr-b");
    expect(authenticatedAsB?.email).not.toBe("alice@example.com");
  });

  it("distinguishes correctly among several real users", async () => {
    const keyA = generateApiKey();
    const keyB = generateApiKey();
    const keyC = generateApiKey();
    await seedUser("usr-a", "a@example.com", keyA);
    await seedUser("usr-b", "b@example.com", keyB);
    await seedUser("usr-c", "c@example.com", keyC);

    expect((await authenticateUser(env.DB, requestWithBearer(keyA)))?.id).toBe("usr-a");
    expect((await authenticateUser(env.DB, requestWithBearer(keyB)))?.id).toBe("usr-b");
    expect((await authenticateUser(env.DB, requestWithBearer(keyC)))?.id).toBe("usr-c");
  });
});

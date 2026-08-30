import { generateApiKey, hashApiKey } from "./user-auth.js";
import type { RouteResult } from "./org-route.js";

/**
 * Rotates a user's API key: generates a new one, stores only its
 * hash, returns the new plaintext once. Same purpose as
 * vf-licence's rotate-key-route.ts: the only way to recover from a
 * lost or leaked key, and how a user's key gets set for the first
 * time if it was ever cleared or the row predates key generation
 * entirely.
 */
export async function handleRotateUserKey(db: D1Database, userId: string): Promise<RouteResult> {
  const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
  if (!userExists) {
    return { status: 404, body: { error: `user ${userId} does not exist` } };
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(apiKeyHash, userId).run();

  return { status: 200, body: { userId, apiKey } };
}

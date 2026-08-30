import { generateApiKey, hashApiKey } from "./auth.js";
import type { RouteResult } from "./customers-route.js";

/**
 * Rotates a customer's API key: generates a new one, stores only its
 * hash, returns the new plaintext once. The only way to recover from
 * a lost or leaked key — there is no "show me the current key" path,
 * by design, since the plaintext is never stored anywhere to show.
 *
 * Also how Acme (created before this whole authentication mechanism
 * existed, so its api_key_hash is NULL) gets its first real key —
 * "rotating" a key that never existed is the same operation as
 * issuing one for the first time.
 */
export async function handleRotateKey(db: D1Database, customerId: string): Promise<RouteResult> {
  const customerExists = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customerExists) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db.prepare("UPDATE customers SET api_key_hash = ? WHERE id = ?").bind(apiKeyHash, customerId).run();

  return { status: 200, body: { customerId, apiKey } };
}

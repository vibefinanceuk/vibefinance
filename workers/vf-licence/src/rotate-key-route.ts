import { generateApiKey, hashApiKey } from "./auth.js";
import type { RouteResult } from "./customers-route.js";

/**
 * Rotates one environment's API key: generates a new one, stores only
 * its hash, returns the new plaintext once. The only way to recover
 * from a lost or leaked key — there is no "show me the current key"
 * path, by design, since the plaintext is never stored anywhere to
 * show.
 *
 * Re-keyed to environmentId (decision 0036) — the key being rotated
 * authenticates one specific environment's machine-to-machine calls
 * back to vf-licence, never a customer as a whole; a customer's
 * sandbox and production environments each have their own, separate
 * key.
 *
 * Also how Acme's own production environment (created before this
 * whole authentication mechanism existed, so its api_key_hash was
 * NULL) got its first real key — "rotating" a key that never existed
 * is the same operation as issuing one for the first time.
 */
export async function handleRotateKey(db: D1Database, environmentId: string): Promise<RouteResult> {
  const environmentExists = await db.prepare("SELECT id FROM environments WHERE id = ?").bind(environmentId).first();
  if (!environmentExists) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db.prepare("UPDATE environments SET api_key_hash = ? WHERE id = ?").bind(apiKeyHash, environmentId).run();

  return { status: 200, body: { environmentId, apiKey } };
}

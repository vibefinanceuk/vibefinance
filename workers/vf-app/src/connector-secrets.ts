/**
 * **A connector's secrets — decision 0585.** A token, a password, an
 * OAuth client secret: what a Destination needs to sign in to the
 * target, and the one thing about it that must never be shown again.
 *
 * Kept in D1 (`connector_secrets`) as AES-GCM ciphertext under one key,
 * the `CONNECTOR_SECRETS_KEY` Worker secret (32 random bytes, base64),
 * set with `wrangler secret put`. Not hashed, unlike keys people send
 * with (0578): the connector has to present the secret itself. With no
 * key configured, a secret is refused rather than stored in the clear.
 *
 * Each value is `base64(iv).base64(ciphertext)`, with a fresh 12-byte IV,
 * and the instance and secret name as additional data, so a value
 * copied to another instance or name does not decrypt.
 */

export class NoSecretsKeyError extends Error {
  constructor() {
    super("CONNECTOR_SECRETS_KEY is not set, so a secret cannot be kept: set it with wrangler secret put CONNECTOR_SECRETS_KEY");
  }
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (text: string) => {
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

async function keyFrom(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new NoSecretsKeyError();
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = unb64(secret.trim());
  } catch {
    throw new NoSecretsKeyError();
  }
  if (raw.length !== 32) throw new NoSecretsKeyError();
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const aad = (instanceId: string, name: string) => new TextEncoder().encode(`${instanceId}/${name}`);

export async function encryptSecret(keySecret: string | undefined, instanceId: string, name: string, value: string): Promise<string> {
  const key = await keyFrom(keySecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(instanceId, name) }, key, new TextEncoder().encode(value))
  );
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(keySecret: string | undefined, instanceId: string, name: string, stored: string): Promise<string> {
  const key = await keyFrom(keySecret);
  const [iv, ct] = stored.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: aad(instanceId, name) }, key, unb64(ct));
  return new TextDecoder().decode(plain);
}

export async function setSecret(
  db: D1Database,
  keySecret: string | undefined,
  instanceId: string,
  name: string,
  value: string,
  userId: string | null
): Promise<void> {
  const enc = await encryptSecret(keySecret, instanceId, name, value);
  await db
    .prepare(
      `INSERT INTO connector_secrets (instance_id, name, value_enc, set_at, set_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (instance_id, name) DO UPDATE SET value_enc = excluded.value_enc, set_at = excluded.set_at, set_by = excluded.set_by`
    )
    .bind(instanceId, name, enc, new Date().toISOString(), userId)
    .run();
}

/** Which secrets are set, and when — never their values. */
export async function secretsSet(db: D1Database, instanceId: string): Promise<Record<string, string>> {
  const rows = await db
    .prepare("SELECT name, set_at FROM connector_secrets WHERE instance_id = ?")
    .bind(instanceId)
    .all<{ name: string; set_at: string }>();
  return Object.fromEntries(rows.results.map((r) => [r.name, r.set_at]));
}

export async function readSecret(db: D1Database, keySecret: string | undefined, instanceId: string, name: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value_enc FROM connector_secrets WHERE instance_id = ? AND name = ?")
    .bind(instanceId, name)
    .first<{ value_enc: string }>();
  return row ? decryptSecret(keySecret, instanceId, name, row.value_enc) : null;
}

#!/usr/bin/env node
// Generates ADMIN_API_KEY — the single shared secret protecting
// vf-licence's provisioning endpoints (POST /customers, POST /licences,
// key rotation). See docs/decisions/0006-endpoint-authentication.md.
// Run this yourself, locally — the key it prints must never be pasted
// into a chat, committed to git, or passed as a plain CLI argument
// (visible in shell history).
//
// Usage:
//   node scripts/generate-admin-key.mjs | \
//     (cd workers/vf-licence && npx wrangler secret put ADMIN_API_KEY)
//
// `wrangler secret put` reads the value from stdin, not an argument —
// piping directly into it, rather than printing then re-typing, means
// the plaintext never sits in a terminal scrollback or shell history
// either.
//
// Uses the same generation approach as vf-licence's own per-customer
// keys (src/auth.ts's generateApiKey): 32 random bytes, base64url
// encoded. There's exactly one admin key for the whole control plane,
// unlike per-customer keys — this script exists as a separate,
// explicit step specifically so that fact is obvious, not implied.

const KEY_BYTE_LENGTH = 32;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const bytes = new Uint8Array(KEY_BYTE_LENGTH);
globalThis.crypto.getRandomValues(bytes);
process.stdout.write(base64UrlEncode(bytes));

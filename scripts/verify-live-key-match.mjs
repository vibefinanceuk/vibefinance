#!/usr/bin/env node
// Confirms, directly and locally, that the public key currently sitting
// in workers/vf-app/wrangler.jsonc can verify a token freshly issued by
// the live vf-licence instance -- the one thing not yet proven live
// after today's key rotation and storage-format fix. Never prints the
// key or the token; only whether verification succeeded, and the
// token's own non-sensitive claims (customerId, plan, status).
//
// Run from the repo root:
//   node scripts/verify-live-key-match.mjs

import { readFileSync } from "node:fs";

const WRANGLER_PATH = "workers/vf-app/wrangler.jsonc";
const TOKEN_URL = "https://vf-licence.vibefinance.workers.dev/licences/Acme/token";

// --- exact same verify logic as shared/licensing/token.ts, inlined so
// this script has no build step and no dependency on the rest of the
// repo being built -- deliberately a direct copy, not a reimplementation
// from memory, to avoid the two ever silently drifting apart in a way
// that would make this check misleading.
function base64UrlDecode(str) {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyLicenceToken(token, publicKeyJwk, now = new Date()) {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token: expected 3 parts" };
  const [encHeader, encPayload, encSignature] = parts;

  let header, claims;
  try {
    header = JSON.parse(Buffer.from(base64UrlDecode(encHeader)).toString("utf8"));
    claims = JSON.parse(Buffer.from(base64UrlDecode(encPayload)).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed token: header/payload not valid base64url JSON" };
  }

  if (header.alg !== "ES256") return { ok: false, reason: `unsupported alg: ${header.alg}` };

  const key = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const signatureBytes = base64UrlDecode(encSignature);
  const signingInput = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const validSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signatureBytes,
    signingInput
  );
  if (!validSignature) return { ok: false, reason: "signature verification failed" };

  if (new Date(claims.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: `token expired at ${claims.expiresAt}` };
  }

  return { ok: true, claims };
}

function stripJsonComments(text) {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

async function main() {
  let wranglerText;
  try {
    wranglerText = readFileSync(WRANGLER_PATH, "utf8");
  } catch (err) {
    console.error(`Could not read ${WRANGLER_PATH}: ${err.message}`);
    console.error("Run this from the repo root.");
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(stripJsonComments(wranglerText));
  } catch (err) {
    console.error(`Could not parse ${WRANGLER_PATH} as JSON(C): ${err.message}`);
    process.exit(1);
  }

  const publicKeyJwk = config.vars?.LICENCE_SIGNING_PUBLIC_KEY;
  if (!publicKeyJwk || publicKeyJwk.REPLACE_WITH_REAL_PUBLIC_KEY_JWK) {
    console.error("LICENCE_SIGNING_PUBLIC_KEY in wrangler.jsonc is missing or still the placeholder.");
    process.exit(1);
  }
  if (publicKeyJwk.d) {
    console.error(
      "STOP: the configured key has a 'd' field, which only PRIVATE keys have. " +
        "This should never happen for LICENCE_SIGNING_PUBLIC_KEY -- do not proceed " +
        "until this is corrected."
    );
    process.exit(1);
  }

  console.log(`Fetching a fresh token from ${TOKEN_URL} ...`);
  let token;
  try {
    const res = await fetch(TOKEN_URL);
    if (!res.ok) {
      console.error(`Token fetch failed: HTTP ${res.status}`);
      process.exit(1);
    }
    const body = await res.json();
    token = body.token;
    if (typeof token !== "string") {
      console.error("Response had no token field.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Token fetch failed: ${err.message}`);
    process.exit(1);
  }

  const result = await verifyLicenceToken(token, publicKeyJwk);

  console.log("");
  if (result.ok) {
    console.log("✅ VERIFIED — vf-app's configured public key correctly verifies");
    console.log("   a token freshly signed by vf-licence's live private key.");
    console.log("");
    console.log("Non-sensitive claims from the verified token:");
    console.log(`  customerId: ${result.claims.customerId}`);
    console.log(`  plan:       ${result.claims.plan}`);
    console.log(`  status:     ${result.claims.status}`);
    console.log(`  expiresAt:  ${result.claims.expiresAt}`);
  } else {
    console.log("❌ VERIFICATION FAILED:", result.reason);
    console.log("");
    console.log("This means vf-app's configured public key and vf-licence's");
    console.log("current signing private key do not match -- most likely one");
    console.log("was rotated without the other. The real, deployed scheduled()");
    console.log("refresh would also fail to verify, silently, and vf-app would");
    console.log("stay on whatever licence state it already had cached (or stay");
    console.log("blocked, if it never had one) -- this script exists precisely");
    console.log("so that mismatch is caught now, deliberately, rather than only");
    console.log("showing up later as an unexplained 'why hasn't my licence");
    console.log("state ever updated' question.");
  }
}

main();

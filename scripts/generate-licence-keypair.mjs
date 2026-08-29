#!/usr/bin/env node
// Generates the ECDSA P-256 keypair that signs and verifies licence
// tokens (Blueprint, "Subsystem three": "signed with a key whose public
// half is baked into the build"). Run this yourself, locally — the
// private key it prints must never be pasted into a chat, committed to
// git, or passed as a plain CLI argument (visible in shell history).
//
// Usage:
//   node scripts/generate-licence-keypair.mjs
//
// It prints two things:
//   1. The private key JWK — pipe it directly into `wrangler secret put`
//      for vf-licence, which reads from stdin rather than an argument:
//        node scripts/generate-licence-keypair.mjs --private-only | \
//          (cd workers/vf-licence && npx wrangler secret put LICENCE_SIGNING_PRIVATE_KEY)
//   2. The public key JWK — not sensitive; paste it into
//      workers/vf-app/wrangler.jsonc's LICENCE_SIGNING_PUBLIC_KEY var
//      (replacing the REPLACE_WITH_REAL_PUBLIC_KEY_JWK placeholder),
//      commit it normally, and repeat for every other customer's
//      vf-app instance that needs to verify tokens from this same
//      vf-licence.
//
// The algorithm parameters (ECDSA, P-256, SHA-256) match exactly what
// shared/licensing/token.ts signs and verifies with — confirmed by a
// round-trip sign/verify against Node's own webcrypto before this
// script was written, not assumed.

const { subtle } = globalThis.crypto;

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

async function main() {
  const privateOnly = process.argv.includes("--private-only");
  const publicOnly = process.argv.includes("--public-only");

  const keyPair = await subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
  const privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);
  const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);

  // Confirm the pair actually works together before printing anything —
  // if this ever failed, printing a broken keypair would be far worse
  // than refusing to print one at all.
  const testData = new TextEncoder().encode("vibefinance-licence-keypair-selftest");
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, testData);
  const verified = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.publicKey,
    signature,
    testData
  );
  if (!verified) {
    console.error("Self-test failed: the generated keypair did not verify its own signature.");
    console.error("Refusing to print a keypair that doesn't work. Please report this.");
    process.exit(1);
  }

  if (privateOnly) {
    process.stdout.write(JSON.stringify(privateKeyJwk));
    return;
  }
  if (publicOnly) {
    process.stdout.write(JSON.stringify(publicKeyJwk));
    return;
  }

  console.log("Self-test passed — this keypair signs and verifies correctly.\n");
  console.log("PRIVATE KEY — set this as a secret, never commit it:");
  console.log("  cd workers/vf-licence && npx wrangler secret put LICENCE_SIGNING_PRIVATE_KEY");
  console.log("  (when prompted, paste the JSON below)\n");
  console.log(JSON.stringify(privateKeyJwk));
  console.log("\n---\n");
  console.log("PUBLIC KEY — not sensitive, paste into workers/vf-app/wrangler.jsonc's");
  console.log("LICENCE_SIGNING_PUBLIC_KEY var (and any other customer's vf-app instance");
  console.log("that verifies tokens from this vf-licence), then commit normally:\n");
  console.log(JSON.stringify(publicKeyJwk));
}

main().catch((err) => {
  console.error("Key generation failed:", err);
  process.exit(1);
});

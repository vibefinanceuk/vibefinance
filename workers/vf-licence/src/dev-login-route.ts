import type { RouteResult } from "./customers-route.js";
import { signSessionToken, SESSION_TTL_SECONDS, type SessionClaims } from "@vibefinance/shared";

/**
 * A stand-in for single sign-on — decision 0087.
 *
 * **This is a stub and is named like one.** Decision 0083 section 7
 * parked the choice between SAML and OIDC because almost nothing
 * depends on it: everything downstream consumes a verified identity via
 * the session token and does not care how it was minted. Exactly one
 * endpoint cares, and this is the placeholder standing where it will
 * be.
 *
 * Without it there is no way to sign in and therefore no way to build
 * or test a screen. With it, there is a route that hands out a session
 * for anybody who asks — which is why it carries two independent
 * guards rather than one.
 *
 * > **"Temporary authentication bypass in the control plane" is
 * > precisely the kind of thing that outlives its intent.** So it
 * > refuses rather than relying on anybody remembering to remove it.
 */

/** Both must hold. Neither is sufficient alone, deliberately. */
export interface DevLoginGuards {
  /**
   * Set explicitly per deployment. Absent means the route does not
   * exist — enabling is a deliberate act rather than a default somebody
   * forgot to change.
   */
  allowDevLogin: boolean;
}

export interface DevLoginBody {
  email?: unknown;
  name?: unknown;
  environmentId?: unknown;
}

export async function handleDevLogin(
  db: D1Database,
  body: DevLoginBody,
  privateKeyJwk: JsonWebKey,
  guards: DevLoginGuards,
  now: Date = new Date()
): Promise<RouteResult> {
  if (!guards.allowDevLogin) {
    // 404, not 403. A deployment without dev login should not admit
    // that such a route could exist — a 403 tells somebody probing
    // that there is something here to enable.
    return { status: 404, body: { error: "not found" } };
  }

  const { email, name, environmentId } = body;
  if (typeof email !== "string" || email.trim() === "") {
    return { status: 400, body: { error: "email is required" } };
  }
  if (typeof environmentId !== "string" || environmentId.trim() === "") {
    return { status: 400, body: { error: "environmentId is required" } };
  }

  const environment = await db
    .prepare("SELECT id, kind FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ id: string; kind: string }>();
  if (!environment) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  // The second guard, and the one that cannot be forgotten. Even with
  // dev login switched on — left on by accident, enabled for a
  // debugging session and never turned off — this route can never mint
  // a token for production.
  //
  // The cost is real and deliberate: building screens means having a
  // sandbox to build them against, rather than developing against a
  // customer's live invoices.
  if (environment.kind === "production") {
    return {
      status: 403,
      body: {
        error: "dev login cannot issue a token for a production environment",
        detail: "use a sandbox — this route exists to stand in for SSO, not to bypass it",
      },
    };
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const claims: SessionClaims = {
    email: email.trim(),
    name: typeof name === "string" && name.trim() !== "" ? name.trim() : email.trim(),
    // Named in the token, so the instance can refuse one addressed
    // elsewhere (decision 0086). A single signing key serves the whole
    // fleet; without this claim every instance would accept it.
    environmentId: environment.id,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return {
    status: 200,
    body: {
      token: await signSessionToken(claims, privateKeyJwk),
      expiresAt: claims.expiresAt,
      environmentId: claims.environmentId,
      email: claims.email,
      // Said in the payload, not just in a comment. Anybody holding one
      // of these should know what it is.
      warning: "issued by the development login stub — this is not single sign-on",
    },
  };
}

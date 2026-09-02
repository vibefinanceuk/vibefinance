/**
 * The one place a Worker is allowed to touch a tenant-scoped binding.
 *
 * See docs/decisions/0001-worker-split-and-tenant-resolution.md.
 *
 * D1 bindings are static in Worker configuration today, with no runtime
 * way to select a database by id. That means "one codebase, per-customer
 * database" cannot yet be a single ordinary deployment — it will end up
 * as one of: a Worker deployment per customer, the D1 REST API resolved
 * per request, or Workers for Platforms with per-tenant user Workers.
 *
 * Which of those three is live is an implementation detail of this
 * function and this function only. Every other line of application code
 * calls resolveTenant() and never reads env.DB (or any other
 * tenant-scoped binding) itself — enforced by the no-restricted-properties
 * ESLint rule in eslint.config.js, not left as a convention.
 *
 * Today's implementation is route 1 (static binding, one deployment per
 * customer) because it's the only one that works with zero platform
 * setup, and it's what lets everything above this function be written
 * and tested now. Swapping the body of this function for route 2 or 3
 * later should not require touching anything that calls it.
 */

export interface TenantEnv {
  // The static binding, present only in the single-tenant-per-deploy
  // shape. Nothing outside this file should reference it by name.
  DB?: D1Database;
  // R2 document retention (decision 0013, 0035) — genuinely optional,
  // unlike DB. A customer's R2 bucket is new, additive infrastructure;
  // an existing customer's Worker may not have it configured yet,
  // which is a real, ordinary state, not a misconfiguration the way a
  // missing DB binding is.
  DOCUMENTS?: R2Bucket;
}

export interface TenantContext {
  db: D1Database;
  tenantId: string;
  // undefined when this customer's Worker has no DOCUMENTS binding
  // configured yet — callers that need document storage must check
  // for this themselves, the same way any genuinely optional
  // capability is checked, rather than this function inventing a
  // fallback or throwing for something that isn't actually required.
  documents?: R2Bucket;
}

export class TenantResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/**
 * Resolve the database handle (and any other tenant-scoped resources)
 * for the tenant this request belongs to.
 *
 * @param request - used by future implementations (routes 2/3) to derive
 *   which tenant is being addressed, e.g. from a header, subdomain, or
 *   dispatch namespace. Unused by today's static-binding implementation,
 *   which is deliberate: the signature must not change when the body
 *   does.
 */
export function resolveTenant(request: Request, env: TenantEnv): TenantContext {
  void request; // reserved for routes 2/3 — see module doc comment

  if (!env.DB) {
    throw new TenantResolutionError(
      "No DB binding present. In today's static-binding deployment shape, " +
        "each customer's Worker must declare a d1_databases binding named DB " +
        "in its wrangler config."
    );
  }

  return {
    db: env.DB,
    // Static-binding deployments are one Worker per customer, so the
    // tenant id is a deploy-time fact, not something to derive from the
    // request. Wired up properly once a customer identity concept exists;
    // placeholder kept honest rather than invented.
    tenantId: "unresolved",
    documents: env.DOCUMENTS,
  };
}

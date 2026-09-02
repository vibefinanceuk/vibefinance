import type { RouteResult } from "./customers-route.js";

export interface SubmitSignupRequestBody {
  companyName?: unknown;
  contactName?: unknown;
  contactEmail?: unknown;
  notes?: unknown;
}

/**
 * The public, unauthenticated end of the trial flow — decision 0038.
 * Deliberately the only unauthenticated write endpoint on vf-licence:
 * a prospective customer filling in the website's "Request a 30-day
 * free trial" form is by definition someone with no credential yet.
 *
 * Nothing is provisioned here, and nothing is promised. The response
 * mirrors what the website says: a member of the provisioning team
 * will be in contact. A real person reviews every request.
 */
export async function handleSubmitSignupRequest(
  db: D1Database,
  body: SubmitSignupRequestBody
): Promise<RouteResult> {
  const { companyName, contactName, contactEmail } = body;
  if (
    typeof companyName !== "string" ||
    !companyName.trim() ||
    typeof contactName !== "string" ||
    !contactName.trim() ||
    typeof contactEmail !== "string" ||
    !contactEmail.trim()
  ) {
    return {
      status: 400,
      body: { error: "companyName, contactName and contactEmail (all non-empty strings) are required" },
    };
  }
  // Deliberately shallow: a single "@" with something either side.
  // Real address validity is proven by successfully emailing the
  // person during review, not by a regex here — the only thing worth
  // catching at this boundary is an obviously malformed entry.
  if (!/^[^@\s]+@[^@\s]+$/.test(contactEmail.trim())) {
    return { status: 400, body: { error: "contactEmail must be a valid email address" } };
  }

  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const id = crypto.randomUUID();

  await db
    .prepare(
      "INSERT INTO signup_requests (id, company_name, contact_name, contact_email, notes) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, companyName.trim(), contactName.trim(), contactEmail.trim(), notes)
    .run();

  // Deliberately returns only the id and a neutral acknowledgement —
  // never anything that implies a decision has been or will be made.
  return {
    status: 201,
    body: { id, status: "pending", message: "Request received. A member of our provisioning team will be in contact." },
  };
}

interface SignupRequestRow {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  notes: string | null;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  customer_id: string | null;
  environment_id: string | null;
}

function toRequestView(row: SignupRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    notes: row.notes,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    customerId: row.customer_id,
    environmentId: row.environment_id,
  };
}

/**
 * The operator's review queue — admin-only. Optionally filtered by
 * status, since "what's waiting for me" (?status=pending) is the
 * question this endpoint mostly exists to answer.
 */
export async function handleListSignupRequests(db: D1Database, status: string | null): Promise<RouteResult> {
  const VALID = ["pending", "approved", "rejected"];
  if (status !== null && !VALID.includes(status)) {
    return { status: 400, body: { error: `status, if provided, must be one of ${VALID.join(", ")}` } };
  }

  const rows = status
    ? await db
        .prepare("SELECT * FROM signup_requests WHERE status = ? ORDER BY requested_at DESC")
        .bind(status)
        .all<SignupRequestRow>()
    : await db.prepare("SELECT * FROM signup_requests ORDER BY requested_at DESC").all<SignupRequestRow>();

  return { status: 200, body: { requests: rows.results.map(toRequestView) } };
}

export interface DecideSignupRequestBody {
  decidedBy?: unknown;
}

/**
 * Rejection — admin-only. Deliberately silent: this records the
 * decision for the operator's own records and sends the requester
 * nothing at all (the operator's own requirement). A rejected request
 * never blocks a future one from the same person or company; the
 * schema deliberately has no uniqueness constraint on email that
 * would prevent it.
 *
 * decidedBy is a required field rather than a derived identity,
 * unlike rule approval in vf-app (decision 0010). Stated plainly
 * rather than faked: ADMIN_API_KEY is a single shared secret, so
 * vf-licence genuinely cannot tell which individual is acting. If
 * per-operator identity ever matters here, it needs real per-operator
 * admin credentials first — recording an invented value in the
 * meantime would be worse than requiring the caller to say who they
 * are.
 */
export async function handleRejectSignupRequest(
  db: D1Database,
  requestId: string,
  body: DecideSignupRequestBody
): Promise<RouteResult> {
  const { decidedBy } = body;
  if (typeof decidedBy !== "string" || !decidedBy.trim()) {
    return { status: 400, body: { error: "decidedBy (a non-empty string) is required" } };
  }

  const existing = await db
    .prepare("SELECT id, status FROM signup_requests WHERE id = ?")
    .bind(requestId)
    .first<{ id: string; status: string }>();
  if (!existing) {
    return { status: 404, body: { error: `signup request ${requestId} does not exist` } };
  }
  if (existing.status !== "pending") {
    return { status: 409, body: { error: `signup request ${requestId} is already ${existing.status}` } };
  }

  await db
    .prepare(
      "UPDATE signup_requests SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ?"
    )
    .bind(decidedBy.trim(), requestId)
    .run();

  return { status: 200, body: { id: requestId, status: "rejected", decidedBy: decidedBy.trim() } };
}

/**
 * Approval — admin-only, and deliberately NOT provisioning.
 *
 * Approval marks the request approved and nothing more; the real
 * provisioning (creating the Cloudflare D1 database, R2 bucket and
 * Worker, then the customers/environments/licences rows) is a
 * separate step that reads approved requests and acts on them. The
 * operator's own framing, and the reason this is decoupled: the two
 * can fail, be retried, and evolve independently, and an
 * approved-but-not-yet-provisioned request is a real, legible state
 * rather than an all-or-nothing action that either fully succeeds or
 * leaves no trace.
 *
 * handleRecordProvisioning below is what closes the loop afterwards.
 */
export async function handleApproveSignupRequest(
  db: D1Database,
  requestId: string,
  body: DecideSignupRequestBody
): Promise<RouteResult> {
  const { decidedBy } = body;
  if (typeof decidedBy !== "string" || !decidedBy.trim()) {
    return { status: 400, body: { error: "decidedBy (a non-empty string) is required" } };
  }

  const existing = await db
    .prepare("SELECT id, status FROM signup_requests WHERE id = ?")
    .bind(requestId)
    .first<{ id: string; status: string }>();
  if (!existing) {
    return { status: 404, body: { error: `signup request ${requestId} does not exist` } };
  }
  if (existing.status !== "pending") {
    return { status: 409, body: { error: `signup request ${requestId} is already ${existing.status}` } };
  }

  await db
    .prepare(
      "UPDATE signup_requests SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?"
    )
    .bind(decidedBy.trim(), requestId)
    .run();

  return {
    status: 200,
    body: {
      id: requestId,
      status: "approved",
      decidedBy: decidedBy.trim(),
      provisioned: false,
      message: "Approved. Provisioning is a separate step — record its result via POST /signup-requests/:id/provisioned.",
    },
  };
}

export interface RecordProvisioningBody {
  customerId?: unknown;
  environmentId?: unknown;
}

/**
 * Closes the loop after provisioning actually ran — admin-only.
 * Links an approved request to the real customer and environment it
 * produced.
 *
 * Both links are set together or not at all (a schema invariant, not
 * just a convention here), and only an approved request may carry
 * them — a rejected or still-pending request pointing at real
 * infrastructure would mean approval and provisioning got out of step
 * in a way worth catching.
 */
export async function handleRecordProvisioning(
  db: D1Database,
  requestId: string,
  body: RecordProvisioningBody
): Promise<RouteResult> {
  const { customerId, environmentId } = body;
  if (
    typeof customerId !== "string" ||
    !customerId ||
    typeof environmentId !== "string" ||
    !environmentId
  ) {
    return { status: 400, body: { error: "customerId and environmentId (both strings) are required" } };
  }

  const existing = await db
    .prepare("SELECT id, status, customer_id FROM signup_requests WHERE id = ?")
    .bind(requestId)
    .first<{ id: string; status: string; customer_id: string | null }>();
  if (!existing) {
    return { status: 404, body: { error: `signup request ${requestId} does not exist` } };
  }
  if (existing.status !== "approved") {
    return {
      status: 409,
      body: { error: `signup request ${requestId} is ${existing.status}, not approved — only an approved request can be provisioned` },
    };
  }
  if (existing.customer_id !== null) {
    return { status: 409, body: { error: `signup request ${requestId} is already recorded as provisioned` } };
  }

  const environment = await db
    .prepare("SELECT id, customer_id FROM environments WHERE id = ?")
    .bind(environmentId)
    .first<{ id: string; customer_id: string }>();
  if (!environment) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }
  // Checked rather than assumed: recording an environment against a
  // customer it doesn't actually belong to would be a real, silent
  // data error the FK constraints alone can't catch, since both ids
  // exist independently.
  if (environment.customer_id !== customerId) {
    return {
      status: 400,
      body: { error: `environment ${environmentId} belongs to customer ${environment.customer_id}, not ${customerId}` },
    };
  }

  await db
    .prepare("UPDATE signup_requests SET customer_id = ?, environment_id = ? WHERE id = ?")
    .bind(customerId, environmentId, requestId)
    .run();

  return { status: 200, body: { id: requestId, status: "approved", provisioned: true, customerId, environmentId } };
}

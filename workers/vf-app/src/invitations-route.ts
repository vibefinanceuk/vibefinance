import type { RouteResult } from "./org-route.js";

/**
 * **Inviting a person from the Access screen — decision 0593.**
 *
 * A customer's administrator sends a person they have added an
 * invitation: the control plane (`vf-licence`) emails a link and a
 * 6-digit code, and the person chooses their own password there. Asked
 * through the licence service binding with this environment's own key,
 * so an instance can invite only to itself.
 */

export interface LicenceLink {
  service: Fetcher;
  environmentId: string;
  apiKey: string;
}

/** Asks the control plane about this environment, with its own key: `/environments/:id<path>`. */
export async function askLicence(link: LicenceLink, method: "GET" | "POST", path: string, body?: unknown): Promise<RouteResult> {
  try {
    const res = await link.service.fetch(`https://vf-licence.internal/environments/${encodeURIComponent(link.environmentId)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${link.apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json };
  } catch (err) {
    return { status: 502, body: { error: `the control plane could not be reached: ${(err as Error).message}`, reason: "unreachable" } };
  }
}

/** `POST /org/users/:id/invite` — invite that person, by their email here. */
export async function handleInviteUser(db: D1Database, link: LicenceLink, userId: string, invitedBy: string | null): Promise<RouteResult> {
  const user = await db.prepare("SELECT id, email FROM org_users WHERE id = ?").bind(userId).first<{ id: string; email: string }>();
  if (!user) return { status: 404, body: { error: `user ${userId} does not exist` } };
  const r = await askLicence(link, "POST", "/invitations", { email: user.email, invitedBy });
  const invitation = (r.body.invitation ?? null) as Record<string, unknown> | null;
  return {
    status: r.status,
    body: {
      ...(invitation ? { invitation: { email: invitation.email, status: invitation.status, expiresAt: invitation.expiresAt, sentAt: invitation.sentAt, sendError: invitation.sendError } } : {}),
      ...(r.status >= 400 ? { error: r.body.error ?? "the invitation could not be made", reason: r.body.reason ?? "failed" } : {}),
    },
  };
}

/** `GET /org/users/invitations` — the latest invitation for each person, by email. */
export async function handleListUserInvitations(link: LicenceLink): Promise<RouteResult> {
  return askLicence(link, "GET", "/invitations");
}

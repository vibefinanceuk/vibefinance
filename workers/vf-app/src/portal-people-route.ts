import type { RouteResult } from "./org-route.js";
import { askLicence, type LicenceLink } from "./invitations-route.js";
import { readLicenceState } from "./licence-cache.js";
import { PORTAL_FEATURE } from "./portal-route.js";

/**
 * **Inviting a supplier's people to the portal, from the supplier's page —
 * decision 0715.** Step 3 of docs/design/supplier-portal.md.
 *
 * The directory lives in vf-licence (0713); this instance asks it, with its
 * own environment key, so it can only ever act for itself. Here it adds
 * what only this instance knows: that the supplier exists, which companies
 * there are, their names, and which of them the person inviting may act
 * for.
 */

export interface Company {
  id: string;
  name: string;
}

export async function portalLicensed(db: D1Database): Promise<boolean> {
  const licence = await readLicenceState(db);
  return licence.known && (licence.claims.features ?? []).includes(PORTAL_FEATURE);
}

/** The companies a person may invite for: the units they hold the permission in and beneath, or all (`null`). */
export async function companiesFor(db: D1Database, permittedUnits: string[] | null): Promise<Company[]> {
  const all = (await db.prepare("SELECT id, name FROM org_units ORDER BY name").all<Company>()).results;
  return permittedUnits === null ? all : all.filter((u) => permittedUnits.includes(u.id));
}

interface People {
  links: { id: string; email: string; supplierId: string; orgUnits: Company[]; status: string; createdAt: string; endedAt: string | null }[];
  invitations: { id: string; email: string; supplierId: string; orgUnits: Company[]; status: string; expiresAt: string; sentAt: string | null; sendError: string | null }[];
}

async function peopleOf(link: LicenceLink, supplierId: string): Promise<{ ok: true; people: People } | { ok: false; result: RouteResult }> {
  const r = await askLicence(link, "GET", `/portal-people?supplierId=${encodeURIComponent(supplierId)}`);
  if (r.status !== 200) return { ok: false, result: r };
  return { ok: true, people: r.body as unknown as People };
}

/**
 * `GET /suppliers/:id/portal` — the supplier's portal people: who is linked
 * and for which companies, and invitations not yet accepted; with the
 * companies this person may invite for. `licensed: false` when the
 * customer's licence does not include the portal, and nothing else.
 */
export async function handleGetSupplierPortal(db: D1Database, link: LicenceLink, supplierId: string, companies: Company[], canManage: boolean): Promise<RouteResult> {
  const supplier = await db.prepare("SELECT id FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };
  if (!(await portalLicensed(db))) return { status: 200, body: { licensed: false } };
  const people = await peopleOf(link, supplierId);
  if (!people.ok) return people.result;
  return {
    status: 200,
    body: {
      licensed: true,
      canManage,
      companies: canManage ? companies : [],
      links: people.people.links.filter((l) => l.status === "active"),
      invitations: people.people.invitations.filter((i) => i.status === "pending" || i.status === "expired" || i.status === "spent"),
    },
  };
}

/** The chosen companies, each one this person may invite for, with its name from here. */
function chosenCompanies(value: unknown, allowed: Company[]): Company[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const chosen: Company[] = [];
  for (const id of value) {
    const company = allowed.find((c) => c.id === id);
    if (!company) return null;
    if (!chosen.some((c) => c.id === company.id)) chosen.push(company);
  }
  return chosen;
}

/** `POST /suppliers/:id/portal/invitations` `{ email, orgUnitIds }`. */
export async function handleInviteSupplierPerson(
  db: D1Database,
  link: LicenceLink,
  supplierId: string,
  body: Record<string, unknown>,
  allowed: Company[],
  invitedBy: string | null
): Promise<RouteResult> {
  const supplier = await db.prepare("SELECT id, name FROM suppliers WHERE id = ?").bind(supplierId).first<{ id: string; name: string }>();
  if (!supplier) return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };
  if (!(await portalLicensed(db))) return { status: 403, body: { error: "the supplier portal is not part of this licence", reason: "portal_not_licensed" } };
  const orgUnits = chosenCompanies(body.orgUnitIds, allowed);
  if (!orgUnits) return { status: 400, body: { error: "choose at least one company you may invite for", reason: "no_companies" } };
  const r = await askLicence(link, "POST", "/portal-invitations", { email: body.email, supplierId: supplier.id, supplierName: supplier.name, orgUnits, invitedBy });
  return { status: r.status, body: r.body };
}

/** Something of this supplier's: an invitation or a link, by id — so a URL for one supplier cannot act on another's. */
async function belongs(link: LicenceLink, supplierId: string, kind: "links" | "invitations", id: string): Promise<RouteResult | null> {
  const people = await peopleOf(link, supplierId);
  if (!people.ok) return people.result;
  return (people.people[kind] as { id: string }[]).some((x) => x.id === id) ? null : { status: 404, body: { error: "not found" } };
}

/** `POST /suppliers/:id/portal/invitations/:invitationId/cancel`. */
export async function handleCancelSupplierInvitation(link: LicenceLink, supplierId: string, invitationId: string): Promise<RouteResult> {
  const refused = await belongs(link, supplierId, "invitations", invitationId);
  if (refused) return refused;
  return askLicence(link, "POST", `/portal-invitations/${encodeURIComponent(invitationId)}/cancel`, {});
}

/** `POST /suppliers/:id/portal/links/:linkId/end`. */
export async function handleEndSupplierLink(link: LicenceLink, supplierId: string, linkId: string, endedBy: string | null): Promise<RouteResult> {
  const refused = await belongs(link, supplierId, "links", linkId);
  if (refused) return refused;
  return askLicence(link, "POST", `/portal-links/${encodeURIComponent(linkId)}/end`, { endedBy });
}

/** `POST /suppliers/:id/portal/links/:linkId/companies` `{ orgUnitIds }`. */
export async function handleChangeSupplierLinkCompanies(link: LicenceLink, supplierId: string, linkId: string, body: Record<string, unknown>, allowed: Company[]): Promise<RouteResult> {
  const orgUnits = chosenCompanies(body.orgUnitIds, allowed);
  if (!orgUnits) return { status: 400, body: { error: "choose at least one company you may invite for", reason: "no_companies" } };
  const people = await peopleOf(link, supplierId);
  if (!people.ok) return people.result;
  const current = people.people.links.find((l) => l.id === linkId);
  if (!current) return { status: 404, body: { error: "not found" } };
  // A person may not take away a company they could not have given.
  if (!current.orgUnits.every((u) => allowed.some((a) => a.id === u.id))) {
    return { status: 403, body: { error: "this link covers a company you may not invite for", reason: "outside_your_companies" } };
  }
  return askLicence(link, "POST", `/portal-links/${encodeURIComponent(linkId)}/companies`, { orgUnits });
}

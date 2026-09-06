import type { RouteResult } from "./org-route.js";

/**
 * Sources — decision 0060.
 *
 * A source is a configured connection through which documents arrive:
 * a mailbox, an HTTPS endpoint, an SFTP drop. It records HOW a document
 * arrived and makes no claim about WHAT it is — structure is determined
 * at intake, from the document itself (decision 0055 section 6).
 *
 * Each mechanism type can be instantiated more than once: two
 * mailboxes, or two tax authority APIs for two jurisdictions, are two
 * source instances of one mechanism. The name is the instance's, not
 * the mechanism's, because a report collapsing "AP mailbox" and "AR
 * mailbox" to "email" answers nothing useful.
 *
 * Not a stage. A source runs before any process instance exists, so
 * there are no facts to evaluate and no rule could fire on it —
 * modelling it as a stage would mean the workflow engine growing a
 * special case that skips evaluation entirely (decision 0055
 * section 3).
 */

export const SOURCE_MECHANISMS = ["email", "https", "sftp", "file_import", "edi"] as const;
export type SourceMechanism = (typeof SOURCE_MECHANISMS)[number];

export function isKnownSourceMechanism(value: unknown): value is SourceMechanism {
  return typeof value === "string" && (SOURCE_MECHANISMS as readonly string[]).includes(value);
}

interface SourceRow {
  status?: string | null;
  retired_at?: string | null;
  email_address?: string | null;
  email_routing?: string | null;
  id: string;
  process_id: string;
  name: string;
  mechanism: string;
  legacy_channel_id: string | null;
  created_at: string;
}

function toBody(row: SourceRow) {
  return {
    id: row.id,
    processId: row.process_id,
    name: row.name,
    mechanism: row.mechanism,
    // Present only on a source backfilled from an intake channel.
    // Surfaced rather than hidden so an operator can see which arrival
    // points predate the split, and so historical mandate.channel
    // values remain traceable.
    ...(row.legacy_channel_id === null ? {} : { legacyChannelId: row.legacy_channel_id }),
    // Where invoices arrive, and **whether they actually do** —
    // decision 0126. An address without its routing state would let a
    // configuration screen imply mail was coming when nothing yet
    // delivers to it.
    emailAddress: row.email_address ?? null,
    // Retired sources are listed, not hidden: a customer looking at
    // where invoices arrive should see what stopped as well as what
    // runs (decision 0130).
    status: row.status ?? "active",
    retiredAt: row.retired_at ?? null,
    emailRouting: row.email_routing ?? "not_configured",
    createdAt: row.created_at,
  };
}

export async function handleCreateSource(
  db: D1Database,
  processId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const { id, name, mechanism } = body;
  if (typeof id !== "string" || id.trim() === "") {
    return { status: 400, body: { error: "id (non-empty string) is required" } };
  }
  if (typeof name !== "string" || name.trim() === "") {
    // An unnamed arrival point cannot be reported on, which is most of
    // what a source is for.
    return { status: 400, body: { error: "name (non-empty string) is required" } };
  }
  if (!isKnownSourceMechanism(mechanism)) {
    return {
      status: 400,
      body: { error: `mechanism must be one of ${SOURCE_MECHANISMS.join(", ")}` },
    };
  }

  const existing = await db.prepare("SELECT id FROM sources WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `source ${id} already exists` } };
  }
  const duplicateName = await db
    .prepare("SELECT id FROM sources WHERE process_id = ? AND name = ?")
    .bind(processId, name)
    .first();
  if (duplicateName) {
    // The UNIQUE constraint would catch this, but a 409 naming the real
    // problem beats a raw constraint error reaching the caller.
    return { status: 409, body: { error: `process ${processId} already has a source named "${name}"` } };
  }

  await db
    .prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES (?, ?, ?, ?)")
    .bind(id, processId, name, mechanism)
    .run();

  const row = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
  return { status: 201, body: toBody(row as SourceRow) };
}

export async function handleListSources(db: D1Database, processId: string): Promise<RouteResult> {
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const rows = await db
    .prepare("SELECT * FROM sources WHERE process_id = ? ORDER BY name")
    .bind(processId)
    .all<SourceRow>();

  return {
    status: 200,
    body: {
      processId,
      sources: rows.results.map(toBody),
      // A process with no sources is inert rather than broken: nothing
      // can arrive. Said plainly here rather than leaving someone to
      // wonder why (decision 0055 section 4).
      ...(rows.results.length === 0
        ? { note: "this process has no sources, so no document can reach it" }
        : {}),
    },
  };
}

/**
 * The domain every ingestion address lives on — decision 0125.
 *
 * A VibeFinance domain rather than a customer's own: no customer DNS to
 * arrange, and an address that works the moment a source is created.
 * Reversible later, because the source owns the address either way.
 */
const INGESTION_DOMAIN = "vibefinance.com";

/**
 * RFC 5321's limit on a local part, which Cloudflare enforces —
 * decision 0129.
 */
const MAX_LOCAL_PART = 64;

/**
 * A name reduced to what a mail system and a URL will both carry.
 *
 * **Accented letters are folded rather than stripped.** A German
 * customer naming a source *"Rechnungen für Köln"* got
 * `rechnungen-f-r-k-ln` before decision 0129 — unreadable, and the
 * interface is translated precisely so those customers exist.
 */
function slug(value: string): string {
  return value
    .normalize("NFD")
    // Strip the combining marks NFD just separated, so "ü" becomes "u"
    // rather than disappearing.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether a name can become an address at all — decision 0129.
 *
 * **Checked before anything is created**, so a person is told while
 * they are still typing rather than after a source exists that can
 * never receive.
 */
export function addressableName(
  sourceName: string,
  customerId: string
): { ok: true } | { ok: false; reason: string } {
  const name = slug(sourceName);
  if (name === "") {
    // `!!!` slugs to nothing, and `.acme@vibefinance.com` has a leading
    // dot and is not an address.
    return { ok: false, reason: "the name has no letters or numbers in it" };
  }

  const localPart = `${name}.${slug(customerId)}`;
  if (localPart.length > MAX_LOCAL_PART) {
    return {
      ok: false,
      reason: `the name is too long: it would make an address of ${localPart.length} characters and the limit is ${MAX_LOCAL_PART}`,
    };
  }

  return { ok: true };
}

/**
 * The local part of an ingestion address.
 *
 * **`<name>.<customer>`**, and the *customer* rather than the
 * environment is the whole point: decision 0118 provisions a second
 * environment when a trial becomes production, and an address naming
 * the sandbox would have to be reissued to every supplier on the day a
 * customer goes live. A customer id is stable across both, and unique
 * across the fleet — so the address is too, without a registry.
 *
 * Call `addressableName` first: this assumes a name that can become
 * one.
 */
export function ingestionAddress(sourceName: string, customerId: string): string {
  return `${slug(sourceName)}.${slug(customerId)}@${INGESTION_DOMAIN}`;
}

/**
 * Give an email source an address — decision 0126.
 *
 * **Generated, not chosen.** A customer picking a local part would
 * collide with another customer they have never heard of, and *"that
 * address is taken"* is an answer nobody can act on. Deriving it from
 * their own id cannot collide.
 *
 * **Reported as `not_configured`.** Creating the Cloudflare Email
 * Routing rule needs the API half of decision 0039, which is not built
 * — so the address is reserved and nothing yet delivers to it. Saying
 * so is the same discipline as `infrastructureProvisioned: false`: a
 * screen implying mail was arriving would be worse than one admitting
 * it is not.
 */
export async function handleSetSourceEmail(
  db: D1Database,
  sourceId: string,
  customerId: string | undefined
): Promise<RouteResult> {
  if (!customerId) {
    // The instance does not know who it is, which is a provisioning
    // fault rather than a caller's mistake.
    return {
      status: 500,
      body: { error: "this instance has no CUSTOMER_ID, so an address cannot be generated" },
    };
  }

  const source = await db
    .prepare("SELECT id, name, mechanism, email_address FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ id: string; name: string; mechanism: string; email_address: string | null }>();

  if (!source) {
    return { status: 404, body: { error: `source ${sourceId} does not exist` } };
  }
  if (source.mechanism !== "email") {
    return {
      status: 422,
      body: { error: `source ${sourceId} receives by ${source.mechanism}, so an address means nothing to it` },
    };
  }
  if (source.email_address) {
    // **Never reissued.** Suppliers write an address down, and changing
    // it silently would break every one of them.
    return {
      status: 409,
      body: {
        error: `source ${sourceId} already receives at ${source.email_address}`,
        reason: "address_issued",
      },
    };
  }

  const addressable = addressableName(source.name, customerId);
  if (!addressable.ok) {
    return {
      status: 422,
      body: {
        error: `source ${sourceId} cannot have an address: ${addressable.reason}`,
        reason: "name_unusable",
      },
    };
  }

  const address = ingestionAddress(source.name, customerId);

  const taken = await db
    .prepare("SELECT id FROM sources WHERE email_address = ?")
    .bind(address)
    .first<{ id: string }>();
  if (taken) {
    // Two sources named the same thing within one customer. Caught here
    // so the person gets a reason rather than a constraint error.
    return {
      status: 409,
      body: {
        error: `${address} is already used by source ${taken.id}`,
        reason: "address_taken",
      },
    };
  }

  await db
    .prepare("UPDATE sources SET email_address = ? WHERE id = ?")
    .bind(address, sourceId)
    .run();

  return {
    status: 200,
    body: {
      sourceId,
      emailAddress: address,
      routing: "not_configured",
      reason: "not_routed_yet",
    },
  };
}

/**
 * Every source in this instance — decision 0126.
 *
 * The existing list is **per process**, which suits a caller that knows
 * which process it means. A configuration screen does not: it is
 * answering *"where can invoices arrive for us"*, and that question
 * spans processes.
 */
export async function handleListAllSources(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare("SELECT * FROM sources ORDER BY process_id, name")
    .all<SourceRow>();

  return { status: 200, body: { sources: rows.results.map(toBody) } };
}

/**
 * Every process in this instance — decision 0128.
 *
 * Processes could be **created and never listed**, which was fine while
 * a person creating one already knew its id. A screen attaching a
 * source to a process does not, and offering a free-text box for an id
 * somebody has to remember is not a configuration screen.
 */
export async function handleListProcesses(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.name, count(s.id) AS stage_count
       FROM processes p
       LEFT JOIN process_stages s ON s.process_id = p.id
       GROUP BY p.id, p.name
       ORDER BY p.name`
    )
    .all<{ id: string; name: string; stage_count: number }>();

  return {
    status: 200,
    body: {
      processes: rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        // **A process with no stages accepts documents and does nothing
        // with them.** Worth showing where somebody is about to point a
        // source at one.
        stageCount: r.stage_count,
      })),
    },
  };
}

/**
 * Whether anything has ever arrived through a source — decision 0130.
 *
 * **Nothing references a source by id**, so this asks the question the
 * data can actually answer: does any invoice carry this source's name
 * as its `mandate.channel`? That is what capture writes (decision
 * 0060), and it is the thing that makes a name permanent.
 */
async function hasReceivedDocuments(db: D1Database, sourceName: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM invoice_headers WHERE json_extract(facts_json, '$.\"mandate.channel\"') = ? LIMIT 1"
    )
    .bind(sourceName)
    .first<{ id: string }>();

  return row !== null;
}

/**
 * Stop a source receiving — decision 0130.
 *
 * **Retires rather than deletes**, except where deleting is genuinely
 * harmless: a source through which nothing has ever arrived and which
 * was never given an address. That case is somebody correcting a
 * mistake, not changing history.
 *
 * Everywhere else, a document that arrived through this source carries
 * its **name** in `mandate.channel`, and rules reference that name.
 * Removing the row would leave invoices citing a channel nothing
 * explains, and rules matching a name no source has — silently never
 * firing, which decision 0113 records as the worst kind of rule failure
 * because it looks correct in every listing.
 */
export async function handleRetireSource(
  db: D1Database,
  sourceId: string,
  retiredBy: string,
  /**
   * Delete a source whose address was issued but never used —
   * decision 0133.
   *
   * **Only a person can know this.** An address that was reserved and
   * never given to anybody is a mistake to correct; one already in a
   * supplier's ERP is not, and nothing records which. So the default
   * protects the second case and this says *"I know it was never
   * shared."*
   */
  releaseAddress = false
): Promise<RouteResult> {
  const source = await db
    .prepare("SELECT id, name, status, email_address FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ id: string; name: string; status: string; email_address: string | null }>();

  if (!source) {
    return { status: 404, body: { error: `source ${sourceId} does not exist` } };
  }
  if (source.status === "retired") {
    return { status: 409, body: { error: `source ${sourceId} is already retired` } };
  }

  const used = await hasReceivedDocuments(db, source.name);

  /**
   * An issued address is refused **unless somebody says otherwise** —
   * decision 0133.
   *
   * Returned as a refusal a caller can act on rather than a flat no:
   * the response names what deleting would release, so a person is
   * deciding about a specific address rather than agreeing to
   * something abstract.
   */
  if (!used && source.email_address && !releaseAddress) {
    return {
      status: 409,
      body: {
        sourceId,
        outcome: "confirm_required",
        reason: "address_would_be_released",
        // The address itself, because "an address will be released" is
        // not something a person can check and this is.
        emailAddress: source.email_address,
      },
    };
  }

  if (!used && (!source.email_address || releaseAddress)) {
    await db.prepare("DELETE FROM sources WHERE id = ?").bind(sourceId).run();
    return {
      status: 200,
      body: {
        sourceId,
        outcome: "deleted",
        ...(source.email_address ? { releasedAddress: source.email_address } : {}),
        /**
         * A code, not a sentence — decision 0132.
         *
         * These were English strings written in the API and shown
         * verbatim, so a German customer read them in English: exactly
         * what decision 0107 exists to prevent, in an interface that
         * has been translated since.
         */
        reason: source.email_address ? "address_released" : "never_used",
      },
    };
  }

  await db
    .prepare("UPDATE sources SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?")
    .bind(new Date().toISOString(), retiredBy, sourceId)
    .run();

  return {
    status: 200,
    body: {
      sourceId,
      outcome: "retired",
      // **Said, not implied.** A person expecting deletion should know
      // why they got something else — and reads it in their own
      // language (decision 0132).
      reason: used ? "documents_arrived" : "address_issued",
    },
  };
}

/**
 * Rename a source — decision 0130.
 *
 * **Refused once a document has arrived.** `mandate.channel` is a copy
 * of the name taken at capture, so renaming would leave every past
 * invoice citing the old name while the source claims the new one —
 * and a rule written against either would be right about half the
 * documents.
 *
 * Refused once an address exists, too: the address is derived from the
 * name and **never reissued** (decision 0126), so a rename would make
 * the two disagree permanently.
 */
export async function handleRenameSource(
  db: D1Database,
  sourceId: string,
  newName: unknown
): Promise<RouteResult> {
  if (typeof newName !== "string" || newName.trim() === "") {
    return { status: 400, body: { error: "name (a non-empty string) is required" } };
  }

  const source = await db
    .prepare("SELECT id, name, email_address FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ id: string; name: string; email_address: string | null }>();

  if (!source) {
    return { status: 404, body: { error: `source ${sourceId} does not exist` } };
  }

  if (source.email_address) {
    return {
      status: 409,
      body: {
        error: `source ${sourceId} receives at ${source.email_address}`,
        reason: "address_issued",
      },
    };
  }

  if (await hasReceivedDocuments(db, source.name)) {
    return {
      status: 409,
      body: {
        error: `documents have arrived through ${sourceId}`,
        reason: "documents_arrived",
      },
    };
  }

  await db.prepare("UPDATE sources SET name = ? WHERE id = ?").bind(newName.trim(), sourceId).run();
  return { status: 200, body: { sourceId, name: newName.trim() } };
}

# Design: Routes, phase 1 — the data model

**Status: design only. Nothing here is built.** Written 29 September
2026, after the operator agreed the Routes design (the Claude Doc
*"VibeFinance — E-invoicing, Peppol, AR and Integration: Design"*) and the
three phase 1 mock-ups (Routes, Process routes, Route monitor).

This note settles the tables before any code, so the screens and the
database agree. It covers phase 1 only: definitions, versions, instances,
entry and exit stages, messages with their stored originals, and
monitoring. The mapping editor, structured formats, Peppol and AR come
later and are mentioned only where phase 1 has to leave room for them.

---

## 1. What exists today

| Table | Since | What it holds | What happens to it |
| --- | --- | --- | --- |
| `sources` | 0027 (decision 0060) | A process's named arrival point: `mechanism`, `email_address`, `email_routing`, `status`, `retired_at`, `default_org_unit_id` | **Kept.** Each row becomes a Source instance with the same id (section 4) |
| `intake_channels` | 0011 | The older arrival point, per process | Untouched, as 0060 left it |
| `intake_capture_events` | 0015 | One row per capture attempt: outcome, reason, process instance | Kept; a capture now also belongs to a message |
| `inbound_email_events` | 0042 | One row per email: sender, outcome, reason, attachment counts | Kept for history; new mail is recorded as a message instead |
| `invoice_documents` | 0018, 0070 | The document behind an invoice in R2, `UNIQUE (invoice_id, document_type)` | Kept; the original points at the message part rather than a second copy |
| `erp_exports`, `erp_export_invoices`, `erp_export_rows` | 0104 (decision 0552) | Each export, the invoices it took (each once), the rows it wrote | Kept; each export also becomes an outbound message |
| `process_stages` | 0008 | A process's stages, by `sequence` | Gains a `route_role` (section 3.4) |

Three facts shape everything below:

- **One `vf-app` Worker, D1 database and R2 bucket per customer**
  (decisions 0091, 0125). Nothing here needs a customer id column.
- **Today a document is stored only once an invoice exists** (0068):
  `invoice_documents.invoice_id` is a real foreign key. A message that
  fails before an invoice is created leaves no original behind. Phase 1
  reverses this.
- **Payment-eligible is inferred, not declared** (0417, 0552): an
  instance that has completed, or sits at its process's highest
  `sequence`. Phase 1 makes the exit stage explicit.

---

## 2. The shape

```
routes ─┬─ route_versions                 (the five parts, versioned)
        └─ route_instances ── process_stages (route_role = entry | exit)
                 │
                 └─ route_messages ─┬─ route_message_parts   (originals in R2)
                                    ├─ route_message_events  (history)
                                    └─ route_message_items   (invoices it made or sent)
```

A **route** is defined once. A **version** holds its five parts. An
**instance** places a route in a process, at that process's entry stage
(a Source) or exit stage (a Destination). Everything that passes through
an instance is a **message**, and every message keeps its original.

---

## 3. New tables and columns

### 3.1 `routes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `direction` | TEXT | `source` or `destination`, `CHECK` |
| `name` | TEXT UNIQUE | "Email in", "ERP CSV file" |
| `origin` | TEXT | `standard` (supplied by VibeFinance) or `copied`, `CHECK` |
| `copied_from` | TEXT NULL → `routes.id` | Set on a copy (decision 2: standard routes, copied per organisation) |
| `status` | TEXT | `active` or `retired` |
| `created_at`, `created_by` | | |

A standard route is not edited in place by a customer: they copy it. A
later VibeFinance release can then publish a new version of a standard
route without overwriting anyone's changes.

### 3.2 `route_versions`

| Column | Type | Notes |
| --- | --- | --- |
| `route_id`, `version` | PK | |
| `status` | TEXT | `draft`, `live`, `superseded`. **At most one `live` per route**: a partial unique index on `(route_id) WHERE status = 'live'` |
| `receiving_gateway` | TEXT | Closed set, `CHECK`: `email`, `https`, `sftp`, `file_import`, `edi`, `peppol`, `process` |
| `receiving_format` | TEXT | Closed set: `detected` (PDF, image or XML, decided per document as 0062 does), `ubl`, `cii`, `factur_x`, `supplier_xml`, `en16931` |
| `translation` | TEXT | Phase 1: the name of a built-in translator (`standard_intake`, `erp_csv_v1`). Phase 2 adds `translation_json` for mappings built in the editor |
| `delivery_format` | TEXT | Same closed set as receiving, plus `csv`, `idoc` |
| `delivery_gateway` | TEXT | Same closed set as receiving, plus `file_download` |
| `semantic_model` | TEXT | `en16931` for now. Leaves room for the non-EN 16931 authorities in `multi-authority-intake.md` |
| `published_at`, `published_by`, `note` | | |

The gateway and format lists are closed sets for the reason 0060 gave for
`mechanism`: the system has to know how to talk to each one. A Source's
delivery gateway is always `process`, and a Destination's receiving
gateway is always `process` (checked in code, restated as an invariant).

### 3.3 `route_instances`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | For a backfilled Source, **the existing `sources.id`** (section 4) |
| `route_id` | TEXT → `routes.id` | |
| `process_id` | TEXT → `processes.id` | |
| `stage_id` | TEXT → `process_stages.id` | Must be the process's `entry` stage for a Source, its `exit` stage for a Destination |
| `name` | TEXT | "AP mailbox", "ERP, Acme UK Ltd". `UNIQUE (process_id, name)`, as sources are |
| `settings_json` | TEXT | Non-secret gateway settings: an SFTP path, a Peppol participant id. Email keeps its address on `sources` in phase 1 |
| `secret_ref` | TEXT NULL | The name of a Worker secret holding credentials. **Never the credential itself** |
| `condition` | TEXT NULL | Plain-language "only items where", compiled as rules are. Destinations only in phase 1 |
| `status` | TEXT | `active`, `paused`, `retired`, with `retired_at`, `retired_by` (as 0130) |
| `created_at`, `created_by` | | |

**An instance follows its route's live version.** It does not pin one:
publishing a fix to a mapping should reach every process that uses it,
which is what an IT team fixing a failure expects. Every message records
the version that actually handled it, so nothing is lost by not pinning.

### 3.4 `process_stages.route_role`

`route_role TEXT NULL CHECK (route_role IN ('entry', 'exit'))`, with a
partial unique index so a process has **at most one entry and one exit
stage**.

Backfill for the Standard AP Process: **Intake** is `entry`, **Payment
Eligible** (the highest `sequence`, which is what payment-eligible means
today) is `exit`. The ERP export's eligibility query then reads
`route_role = 'exit'` instead of `max(sequence)`: the same invoices today,
and no longer wrong if someone adds a stage after Payment Eligible. The
Standard AR and Expense processes declare their own when they are built.

### 3.5 `route_messages`

One row for everything that passes through an instance, in or out.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | Shown to people as a short reference, e.g. `MSG-7F3A-2291` |
| `instance_id` | TEXT → `route_instances.id` | |
| `route_id`, `route_version` | | The version that last handled it |
| `direction` | TEXT | `in` or `out` |
| `status` | TEXT | `received`, `delivered`, `partial` (some attachments captured, some not: added in 0555), `failed`, `dismissed`; out adds `sent`, `acknowledged`, `undone` |
| `failed_part` | TEXT NULL | `gateway`, `format`, `translation`, `delivery` |
| `error_code` | TEXT NULL | Stable, for grouping ("the same problem stopped 1 other message") |
| `error_text` | TEXT NULL | Plain language: what went wrong and how to fix it |
| `error_detail_json` | TEXT NULL | The technical detail: element, value, expected, rule |
| `counterparty` | TEXT NULL | Sender (in) or recipient (out) |
| `subject` | TEXT NULL | Email subject, file name, "Export of 12 invoices" |
| `received_at`, `completed_at` | TEXT | ISO, so the monitor and the Timeline sort alike (the 0552 lesson) |
| `attempts` | INTEGER | 1, plus one for each reprocess |

Indexes: `(instance_id, received_at DESC)`, `(status, received_at DESC)`,
`(error_code)`.

### 3.6 `route_message_parts` — the originals

| Column | Type | Notes |
| --- | --- | --- |
| `message_id`, `seq` | PK | |
| `role` | TEXT | `original` (the whole email, or the file as received), `attachment`, `translated`, `sent`, `reply` |
| `filename`, `content_type`, `bytes`, `sha256` | | `sha256` lets a later duplicate check compare files without reading them |
| `r2_key` | TEXT | `routes/{instance}/{yyyy}/{mm}/{message}/{seq}-{filename}`, under the jurisdiction rules of 0033 |
| `stored_at` | TEXT | |

Retention follows 0077, from the message's date, whether or not it ever
became an invoice.

### 3.7 `route_message_events` — the history

`(message_id, seq, at, event, part, detail, actor)`. Received, format
detected, translated, delivered, failed, reprocessed, dismissed (with a
reason), alert sent. The monitor's History line, and the audit of who
reprocessed or dismissed what.

### 3.8 `route_message_items` — what a message made or sent

| Column | Type | Notes |
| --- | --- | --- |
| `message_id`, `item_type`, `item_id` | PK | `item_type` is `invoice` in phase 1 |
| `part_seq` | INTEGER NULL | Which attachment it came from (in) |
| `instance_id` | TEXT | Denormalised, for the rule below |

**Each item once per Destination instance.** A partial unique index on
`(instance_id, item_type, item_id)` for outbound messages that are not
`undone`. That is the rule `erp_export_invoices` enforces today, moved to
where every Destination gets it.

### 3.9 Linking an invoice to its original

`invoice_documents` gains `route_message_id` and `part_seq`. The
`original` row points at the **same R2 object** as the message part: no
second copy. Supporting attachments (a timesheet, a delivery note) are
the message's other parts, shown with the invoice through the message
rather than squeezed into `invoice_documents`, whose `UNIQUE (invoice_id,
document_type)` allows one of each.

### 3.10 Alerts and permissions

`route_alerts`: `(id, instance_id NULL, on_failure, silent_hours,
failure_threshold, emails, webhook_url, webhook_secret_ref, created_by)`.
`instance_id NULL` means every route.

Two new permissions:

- **`Integration.Monitor`**: the Route monitor, message detail and
  originals, reprocess and dismiss. For a customer's IT team, without
  approving or coding anything.
- **`Integration.Configure`**: routes, versions, instances and alerts.

`AP.Export` stays the permission for taking and undoing an ERP export.

---

## 4. Moving what exists across

All additive, in the style of 0027.

1. **Seed two standard routes**, each with a live version 1:
   - *Email in* (source): `email` → `detected` → `standard_intake` →
     `en16931` → `process`.
   - *ERP CSV file* (destination): `process` → `en16931` → `erp_csv_v1` →
     `csv` → `file_download`.
2. **Mark the stages**: Intake `entry`, Payment Eligible `exit`, in every
   process that has them.
3. **Every row in `sources` becomes a route instance with the same id**,
   of *Email in* for `mechanism = 'email'`, at its process's entry stage.
   Same id, so `inbound_email_events.source_id` and everything else that
   names a source keeps working. Other mechanisms have no working
   gateway today; they are backfilled too, marked `paused`.
4. **One ERP Destination instance per process that has exports**, reading
   from its exit stage, named "ERP".
5. **Each `erp_exports` row gains `route_message_id`**, and a message is
   created for it (`out`, `delivered` or `undone`), with its invoices as
   message items. The CSV already stored as rows remains the file.
6. **Email history is not backfilled into messages.** No originals exist
   for it, and inventing message rows with no files would make the
   monitor claim something it cannot show. `inbound_email_events` stays
   readable for the period before go-live.

---

## 5. The email Source, stored first

What changes in `handleInboundEmail` (0146):

1. Find the instance by address, as `sourceFor` does now.
2. **Create the message and store the raw email and each attachment in
   R2, before reading any of them.** The raw stream can be read only once,
   so it is buffered (it is at most 25MB) and the parts are cut from the
   buffer.
3. Detect, translate and capture each attachment as now, through
   `handleCaptureFromSource`, and record each invoice as a message item
   and link its `invoice_documents` original.
4. Record the outcome on the message: `delivered`, or `failed` with the
   part, code, plain-language text and technical detail.
5. **Bounce as today.** A supplier whose invoice could not be read still
   hears so at once (0125). The difference is that the customer now has
   the message and its original, and can fix and reprocess it.

If R2 itself cannot store the message, it is rejected with a temporary
failure so the sender's mail server tries again. That is the only case
where nothing is kept, and it is not silent.

**Reprocess** runs steps 3 and 4 again from the stored parts, with the
route's live version, adds an event, and increments `attempts`. An
attachment that already produced an invoice is not captured twice: its
message item is checked first.

---

## 6. Routes the API needs

All in `vf-app`, each added to the `vf-ui` proxy allowlist and its test.

| Route | Permission |
| --- | --- |
| `GET /routes`, `GET /routes/:id` (with versions) | `Integration.Configure` |
| `POST /routes/:id/copy`, `POST /routes/:id/versions`, `POST /routes/:id/versions/:v/publish` | `Integration.Configure` |
| `GET /route-instances?process=`, `POST /route-instances`, `PATCH /route-instances/:id` | `Integration.Configure` |
| `GET /route-messages?instance=&status=&since=` | `Integration.Monitor` |
| `GET /route-messages/:id` (parts, events, items) | `Integration.Monitor` |
| `GET /route-messages/:id/parts/:seq` (signed URL, as 0073) | `Integration.Monitor` |
| `POST /route-messages/:id/reprocess`, `POST /route-messages/:id/dismiss` | `Integration.Monitor` |
| `GET /route-summary` (the four counts) | `Integration.Monitor` |
| `GET/POST /route-alerts` | `Integration.Configure` |

---

## 7. Build order

Each slice is a decision on its own, delivered and tested live as now.

| Slice | What | Visible to the customer |
| --- | --- | --- |
| **1. Store first** (built, 0555) | `route_messages`, parts, events, items; the email Source stores every message and attachment before reading it; `invoice_documents` points at the part | Nothing changes on screen; nothing that arrives is lost any more |
| **2. Route monitor** | The monitor screen, message detail, originals, `Integration.Monitor`; the four counts | IT can see every email and why one failed |
| **3. Routes and instances** | `routes`, versions, instances, `route_role`; the backfill in section 4; the Routes screen (standard routes, read-only) and Process routes replacing Sources | Sources become Process routes; the menu changes once |
| **4. ERP as a Destination** | The export's eligibility from the exit stage; each export an outbound message; once-only per instance; the Destination panel | The ERP export appears as a Destination, with its failures in the monitor |
| **5. Fix and tell** | Plain-language errors with codes, reprocess and dismiss, alerts by email and webhook | IT fixes and reprocesses without VibeFinance |

Slice 1 comes first because it is useful on its own and everything else
reads its tables. Slice 2 needs only slice 1.

---

## 8. Still open

- **Menu colours.** Moving Sources into Integration changes colours
  (0527). Accept once in slice 3, or keep the Sources entry until then.
- **Bouncing a stored message.** Recommended above: keep bouncing, as
  today. The alternative, holding it silently for IT to fix, would leave a
  supplier believing an invoice was received and being processed.
- **Credentials.** `secret_ref` names a Worker secret, which means a
  deployment step for each new credential. A customer-managed secret
  store may be needed once customers add ERP API Destinations in phase 3.
- **Retention of failed messages that never became invoices.** Assumed
  to be the same period as invoices (0077). Worth confirming for the
  customer's own policy.

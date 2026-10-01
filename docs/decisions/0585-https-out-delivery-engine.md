# 0585: HTTPS out and the delivery engine (connector framework, slice 1)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs:

- **`vf-app` migration `0118`**;
- **`vf-licence` migration `0232`**;
- **a new Worker secret**, `CONNECTOR_SECRETS_KEY`:
  ```
  openssl rand -base64 32 | npx wrangler secret put CONNECTOR_SECRETS_KEY
  ```
  run in `workers/vf-app`;
- **a new cron**, `*/5 * * * *`, in `wrangler.jsonc`. It deploys with the
  Worker.

## What was asked

On 1 October Dan asked for a framework for Destination connectors: a
library of Sources and Destinations, such as Oracle, SAP and Sage, *"that
help a system integrator to mobilise quickly"*. I proposed it in
`claude/connector-framework-design.md`, with two mock-ups. Dan agreed and
answered the questions:

- the first ERP connector is decided later;
- partners author and publish early;
- the ERP CSV export is folded into the engine.

Then: *"lets start on Slice 1"*.

Slice 1 is HTTPS out, built as the engine every API connector will use.
**The ERP CSV fold-in is the next decision (0586)**, kept apart so this
one stays reviewable.

## What was decided

### The route

`https-out` is a standard Destination route, version 1 live (migration
`0118`):

- process → EN 16931;
- translation `vf_invoice_json_v1`;
- delivered over HTTPS.

On Process routes, **Add a destination** makes an instance of it, named,
in this process, **paused and not started**.

### Settings and secrets

The settings are kept in `route_instances.settings_json` and checked by
`checkSettings`:

- **Send to**: a full `https://` address only;
- **Method**: POST or PUT;
- **Format**:
  - **VibeFinance invoice JSON v1**: the ERP export's own rows regrouped
    into the invoice, its lines and each line's distributions, with
    Account Coding and the supplier's ERP id and site
    (`schema: "vibefinance.invoice.v1"`);
  - **the ERP CSV layout**, one invoice per request;
- **Sign in with**:
  - nothing;
  - a key in a named header;
  - a bearer token;
  - user name and password;
  - **OAuth 2.0 client credentials**, where a token is fetched from the
    token address with the client id, secret and optional scope before
    each send;
- **Its reference back**: a path such as `$.data.documentId`, read from
  the reply and kept with the delivery.

**Secrets** (key, token, password, client secret) are held in
`connector_secrets`:

- encrypted with AES-GCM under `CONNECTOR_SECRETS_KEY`;
- bound to their instance and name as additional data, so a value copied
  elsewhere does not decrypt;
- **never returned**. The screen shows only when one was set.

With no key configured, a secret is refused (503 `no_secrets_key`), never
kept in the clear.

### Delivering

`destination_deliveries` holds **one row per invoice per Destination**.

**Started explicitly.** Start sending asks what to do with what is
already payment-eligible:

- only invoices from now on, with those waiting **set aside**
  (`skipped`);
- or send those too.

A Destination never sends history by itself. Resuming one that never
started is refused (`not_started`).

**The sweep** (`runDeliveries`) runs on the new five-minute cron. For
each started, active HTTPS out Destination:

1. its process's payment-eligible invoices it has not taken become
   deliveries (`payableInvoiceIds`). This is 0558's definition, without
   the ERP CSV file's own pause and export record;
2. up to 20 due deliveries are attempted.

The six-hourly cron's licence and usage jobs are unchanged.

**Each attempt** (`deliverOne`):

1. builds the request;
2. signs in;
3. posts with an `Idempotency-Key` of `instance:invoice`, so a target that
   honours it never makes the invoice twice;
4. keeps the request and the reply as parts of one outbound route message
   per delivery;
5. records an `attempt` event, then `reference` when one came back.

**What the reply means:**

| Reply | Result |
|---|---|
| **2xx** | Delivered, with the reference read back. |
| **408, 429, 5xx**, unreachable, or sign-in failing | Retried after 5, 15, 60, 180, 360 and 720 minutes, about 22 hours. Then failed, and alerts as any failed message does (0559). |
| **Other 4xx** | The target refusing the invoice. **Failed at once, with what it said**, and not retried. |

**Send** (a real test) and **Send again** deliver one invoice at once:

- a failed or retrying delivery starts a fresh round, in the same
  message;
- a delivered invoice is **never sent twice** (`already_delivered`).

The invoice's own process is never held up.

### On screen

**The Destination's card** shows:

- Not sending yet, Sending, or Paused;
- N failed;
- N waiting.

**The Destination panel**, for HTTPS out, has the HTTPS out section
(`destinations.js`):

- **Where and how it sends**: the settings, with the sign-in fields for
  the way chosen and the secret's own field ("Set … Type to replace it");
- **Try it with an invoice**: choose a payment-eligible invoice, **Show
  what would be sent** (method, address, headers with secrets as •••,
  the body, and checks such as a supplier with no ERP id; nothing is
  sent), then **Send**;
- **Recent deliveries**: invoice, supplier, status, the detail (HTTP
  status and what the target said, next try, or the reference), and
  **Send again**;
- **Start sending**, with the choice above, until it has started.

**The Route monitor** shows each delivery as an outbound message on the
Destination:

- the invoice;
- who sent it;
- every request and reply;
- each attempt.

**The Routes screen** describes a Destination's HTTPS gateway as going
out ("Posted to an address you give…"), not as the capture API.

`vf-licence` `0232` adds the strings.

## Not built

- **Signing requests** (HMAC-SHA256 with a shared secret), in the agreed
  HTTPS out mock-up. It comes when a target asks for it.
- **Batches** (hourly, daily). Each invoice is sent as it becomes
  payment-eligible, within five minutes.
- **Mutual TLS**, and sending only from fixed IP addresses.
- **The reference on the invoice itself** (its Timeline or a fact). It is
  on the delivery and in the monitor for now.
- **ERP CSV as a connector**: 0586.

## Verification

- **`vf-app`**, `https-out.test.ts`, 13 tests:
  - settings checks;
  - secrets: encrypted, bound to instance and name, never returned, and
    refused with no key;
  - JSON posted with a bearer token and idempotency key, the reference
    read back, request and reply kept, the monitor's message, events
    and parts, and never sent twice;
  - the CSV layout with a header key, and basic sign-in;
  - OAuth: the token fetched with client id, secret and scope, then used;
  - a 503 and an unreachable target retried on the schedule by the sweep
    (not before due), failed after 7 attempts, the message failed at
    delivery with `http_503`;
  - a 422 failed at once with the target's words, then Send again
    delivered in the same message, with four parts;
  - preview with the key hidden, and nothing recorded;
  - starting sets aside what waits unless asked, then takes each newly
    eligible invoice; already started; pause and resume;
  - a missing secret stops a start;
  - Process routes counts;
  - the router's permissions: Admin.Configure sets up; Integration.Monitor
    looks and sends again only;
  - `readPath`.
- **`vf-ui`**, `routes.test.ts`, 5 new tests with the real strings:
  - the card pills;
  - Add a destination;
  - settings, with the OAuth fields appearing and Save sending them;
  - preview shown before anything is sent, then Send's outcome;
  - deliveries with Send again;
  - Start's choice.

  All 5 fail against the interface before this change. Worker allowlist:
  the five paths.
- **Migrations** replay: `vf-app` 118, `vf-licence` 232.
- **Full runs**:
  - `vf-app`: 3386 tests, of which 3381 pass:
    - the two known failures (0511);
    - the known router timeout beside other suites;
    - two tests counting the seeded routes (`routes.test.ts`,
      `index.test.ts`), updated for `https-out`. With both files: 241 of
      241.
  - `vf-ui`: browser 1409 of 1410 (the known `typography.test.ts` 10px
    gap); worker 94 of 94.
  - `vf-licence`: 322 of 322.

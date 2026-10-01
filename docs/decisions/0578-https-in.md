# 0578: HTTPS in — a source's own address and keys

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0115`** and **`vf-licence` migration `0226`**.

## What was asked

On 1 October Dan asked me to *"consider More routes - specifically HTTPS
and SFTP"*, then *"how would those configurations look"*. I drew HTTPS
in and out and SFTP in and out, and suggested an order: HTTPS in, HTTPS
out, an SFTP proof of concept on Cloudflare Containers, then SFTP in and
out. Dan: *"Looks good, and yes that order is great"*. This is the first.

The HTTPS in route has been live since 0107, but an HTTPS source had no
address of its own and no way for a sender's system to authenticate
except a person's API key, through `/sources/:id/capture`.

## What was decided

### Each HTTPS source has its own address

`POST {vf-app}/v1/sources/{source id}/invoices`. The `/v1/` marks it as
the stable, outside-facing contract, which the app's own routes are not.

### Keys, per source, per sender

`source_keys` (migration `0115`):

- **named after who sends with it** ("Lager Nord ERP", "Coupa portal").
  That name is the message's sender in the Route monitor, so a supplier
  mapping can name it, as it names an email sender;
- **shown once**, when made, as `vf_in_` and 32 random bytes in base64url. Only
  its SHA-256 hash is kept, as user API keys are (0006), with its first
  10 characters to tell keys apart;
- **revoked**, never deleted, with who and when. A revoked key stops at
  once; what it sent stays. A second live key with the same name is
  refused;
- **last used** is recorded on each request.

A key sends only to its own source. A person's API key, or another
source's key, is refused with 401. Keys are made, listed and revoked
under **Admin.Configure** (`/sources/:id/keys`,
`/sources/:id/keys/:keyId/revoke`), for HTTPS sources only.

### A request is a route message, read as email is

One file per request, either:

- the raw file as the body, named by `X-Filename` (or `?name=`), with
  an optional `X-Reference`; or
- JSON: `{ filename, content (base64), contentType?, reference? }`.

It is checked like Upload documents (0573): a type an invoice arrives
as (PDF, image, XML, CSV), at most 15 MB, not empty, the source not
retired (410). It then becomes a route message:

- counterparty the key's name, recipient the source's name, subject the
  reference or the file name;
- an `https_received` event ("Received over HTTPS");
- the file stored as part 1 and read by `captureAttachmentPart`, the
  same path email takes, so mappings, CSV splitting (0577), the EN 16931
  checks and the process all apply.

### The reply says what became of it

`202` (or `422` when nothing was made) with:

`{ message, status, reference, receivedAt, completedAt, error?, files:
[{ filename, outcome, reason? }], invoices: [numbers], check }`

`check` is `GET /v1/sources/{id}/messages/{message}`, which answers the
same again, with the same key. A key never sees another source's
messages (404).

### On Process routes

An HTTPS source's panel gains an **HTTPS in** section, as in the
approved mock-up:

- the address, with Copy;
- the keys: name, start, made by and when, last used, Revoke. Revoked
  keys stay listed, struck through;
- **Make a key**: a name, then the key with Copy and a warning that it is
  not shown again;
- **Revoke** asks first, and says what it does;
- **How to send**: a `curl` example with the address and a key's start.

`vf-licence` `0226` adds the strings, the Route monitor event, and a
sentence to the screen's help.

## Not built

- **Signing (HMAC).** A shared secret to sign each body needs secrets
  kept encrypted, not hashed, and a key is enough for the senders in
  view. It can be added per key later.
- **Several files in one request.** Send one per request; a supplier's
  CSV of several invoices is still split (0577).
- **The older `/sources/:id/capture`** stays as it was, for a person's
  API key.

## Verification

- **`vf-app`**, `https-in.test.ts`, 5 tests:
  - keys made with a name, shown once, listed by their start only, a
    duplicate name refused, revoked, and revoking twice refused;
  - HTTPS sources only (404 for email), Admin.Configure (403), signed in
    (401);
  - a UBL invoice with `X-Filename` and `X-Reference`: 202, delivered,
    invoice 88240, the message's sender and subject, last used set, and
    the check address answering the same;
  - JSON with base64;
  - refused: no key, another source's key, a person's key, a `.docx`
    (415), no name or empty (400), another source's message (404), a
    revoked key (401).
- **`vf-ui`**, `routes.test.ts`, 4 new tests with the real strings: the
  section with its address, keys and example, and the panel's own
  buttons unchanged; not shown for email; making a key and seeing it
  once; revoking only once confirmed. 3 fail against the interface
  before this change (the email one passes either way, as it should).
  Worker allowlist: both paths.
- **`vf-licence`**: 322 of 322, and migrations replay 226. `vf-app`
  migrations replay 115.
- **Full runs**: `vf-app` 145 files and 3353 tests, of which 3351 pass
  (the two known failures, 0511). `vf-ui` browser 1398 of 1399 (the known
  `typography.test.ts` 10px gap), worker 88 of 88.

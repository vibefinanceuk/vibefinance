# 0620: SFTP, the proof of concept: SFTP out and SFTP in (collecting), on Cloudflare Containers

**Status: built and tested locally, not yet pushed or deployed.** It
adds a new Worker, **`vf-sftp`** (with a container), and touches
`shared`, `vf-app`, `vf-ui` and `vf-licence`. It needs **`vf-app`
migration `0126`** and **`vf-licence` migration `0263`** (strings).
Deploy order: **vf-sftp first** (it needs Docker running where it is
deployed from, and the Workers Paid plan), then vf-licence, vf-app and
vf-ui.

## What was asked

Dan, 3 October 2026: *"lets tackle the SFTP PoC. Can you investigate. Is
this Source and Destination Routes?"*, the next step of the order agreed
on 1 October (HTTPS in, HTTPS out, an SFTP proof of concept on Cloudflare
Containers, then SFTP in and out).

## What was found

SFTP is both, but its receiving side is two different things:

| | Who connects | On Cloudflare today |
|---|---|---|
| **SFTP out**, a Destination | VibeFinance signs in to the customer's server and writes a file | Yes: a container may connect out to port 22 |
| **SFTP in, collecting**, a Source | VibeFinance signs in to someone else's server and takes files | Yes: the same connection |
| **SFTP in, hosted**, a Source | Suppliers sign in to *our* server | Not yet: inbound TCP to Workers and Containers is a private beta (announced August 2026); otherwise Spectrum (Enterprise) or a hosted SFTP service |

A Worker can open a TCP connection to port 22 (`connect()`), but SFTP
needs a whole SSH implementation, and none that is maintained runs in a
Worker. So the SFTP runs in a small **container**, which vf-app asks over
HTTP. Sources: Cloudflare's Containers documentation (overview, outbound
traffic, pricing, limits), the Workers TCP sockets page, and the
announcement of inbound TCP's private beta.

Dan chose **out and collecting** for the proof of concept, against a test
server (he has no SFTP server of his own to try yet).

## What was decided

### vf-sftp: one Worker and container for the fleet

`workers/vf-sftp`: a Worker whose `SftpRunner` class is a Cloudflare
Container (`@cloudflare/containers`), reached **only by service binding**
(`workers_dev: false`, no route). It passes `POST /run` to the container,
where `container/runner.mjs` (Node 22 and the `ssh2` library) signs in and
does a list of operations on one connection: `list`, `put`, `get`, `move`,
`ensureDir`. It keeps nothing: the server, user and password or key come
with each request. The smallest size (`lite`, 1/16 vCPU, 256 MiB) is
enough; it sleeps five minutes after the last request.

- **A file is written whole**, to `name.part` and then renamed, so an ERP
  reading the folder never takes half a file; and **never over another**
  (`exists`).
- **The server's identity.** Every answer says the host key's fingerprint
  as OpenSSH shows it (`SHA256:…`). Where vf-app names the one it trusts,
  another is refused before signing in (`host_key_changed`), so no
  password or invoice goes to someone pretending to be the server.
- Errors are codes with words: `auth_failed`, `connect_failed`,
  `timeout`, `host_key_changed`, `not_found`, `permission_denied`,
  `exists`, `bad_key`, `too_large` (over 20 MB), and a step after a failed
  one is `skipped`.

### In vf-app

- **Settings** in the route instance's `settings_json`: server, port,
  user, sign-in (password or private key, kept in the connector secrets,
  AES-GCM as HTTPS out's are), folder; for **SFTP out** the format (CSV
  or the VibeFinance invoice JSON) and the file name
  (`{invoiceNumber}.{ext}` by default, from `{invoiceNumber}`,
  `{invoiceId}`, `{date}`, `{ext}`, and needing one of the first two);
  for **SFTP in** which files (`*.xml`) and where collected files go
  (`processed`, within the folder, made where missing).
- **Trusted on first test.** *Test connection* signs in and lists the
  folder; the first success keeps the server's identity, shown with
  *Forget*. **Nothing is sent or collected until one is kept.** Changing
  the server or port forgets it.
- **SFTP out** runs on HTTPS out's delivery engine: the same Start, Try
  with a real invoice (Preview shows `sftp://user@host/folder/file`),
  deliveries, retries and Route monitor messages, and the five-minute
  sweep. The file's path is the reference back. A server out of reach is
  tried again; a file already there, a refused folder or another identity
  fails for a person to look at.
- **SFTP in**: *Check now* takes up to ten matching files, each **moved to
  the done folder first and then read from there**, so it is never taken
  twice even if reading it fails; each becomes a route message on the
  Source (*Collected over SFTP*), read as any arriving file is
  (`captureAttachmentPart`, as HTTPS in). A file of a name collected
  before is kept beside it with the time in front. Files too large or of
  a type an invoice does not arrive as are left where they are, said.
- Routes: `GET/PUT /route-instances/:id/sftp`, `POST …/sftp/test`,
  `…/sftp/forget-identity` (Admin.Configure), `…/sftp/collect` (also the
  Route monitor's). Without vf-sftp bound, each says SFTP is not set up.
- **The library**: SFTP out (*SFTP file drop*) and SFTP in are available,
  as **first versions**. Migration `0126` adds the `sftp-out` route and
  makes `sftp-in`'s version live.

## Not built

- **Collecting on a schedule**: *Check now* only, for the proof of
  concept.
- **A hosted SFTP server** for suppliers to upload to (above).
- A private key with a passphrase; a Destination's own outbound mapping
  over SFTP (CSV and the invoice JSON only); several invoices in one
  file.
- **The container image was not built here**: the build needs Docker Hub,
  which this session cannot reach. The Worker bundles (`wrangler deploy
  --dry-run --containers-rollout=none`), and the runner is proved in Node;
  the first real build is Dan's `wrangler deploy` of vf-sftp.

## Verification

- **`vf-sftp`**, `runner.test.ts`, 15 tests against an SFTP server of the
  tests' own (ssh2's server, files in memory: a real SSH handshake and the
  real SFTP protocol): signing in by password and by key; the host key as
  OpenSSH shows it; a refused password; another identity refused before
  anything is sent; a server out of reach; requests missing what sign-in
  needs; an unreadable key; a file written whole with nothing half-written
  left; never over another; a folder not writable and one not there; a
  folder made, a file moved and read on one connection; a failed step
  stopping the rest; the container's HTTP face. Breaking the identity
  check, or writing straight to the final name, fails 3 of them.
- **`vf-app`** `sftp.test.ts`, 15 tests against a server held in memory
  answering as vf-sftp does: settings in words; the identity kept while
  the server stays and forgotten when it changes; matching and file names;
  added from the library, paused, the password encrypted; identity kept on
  first test and an impostor refused, then Forget; a refused password, a
  server out of reach, SFTP not set up; preview, and nothing sent or
  started before a test; the file written, its path the reference, the
  file kept with the message; never over another (failed, not retried);
  retried when out of reach and sent by the sweep once started; SFTP in's
  test counting what waits; collecting, moved first and read as an
  invoice, and nothing taken twice; a name collected before kept beside
  it; nothing collected before a test; the routes' permissions. Three
  tests that expected SFTP to be planned (the library, the routes, the
  router's count of routes) now expect it available. Full run 3486, of
  which 3484 pass (the two known failures).
- **`vf-ui`** browser `routes.test.ts`, 7 new tests: SFTP out's settings,
  CSV or JSON, saving; a private key instead of a password; the test and
  the identity kept; another identity said with what to decide; the
  preview; SFTP in's settings and Check now; Forget. 7 fail against the
  interface before this change. Worker: the five new paths proxied.
- **`vf-licence`** 358 of 358; **`shared`** 436, of which 432 pass and 1
  is skipped (the three known failures). **Migrations** replay: vf-app
  126, vf-licence 263.

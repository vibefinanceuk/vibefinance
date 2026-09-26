# 0498 — Return To Supplier: reasons, a comment, and a real email

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Reported live:

> Can you take a look at the Return To Supplier button. This is quite a
> complex activity. 1) Need a set of return reasons, so that they can
> be audited, and available via drop-down in the button. 2) Provide a
> comment box for the user to enter comments for the supplier. 3) Show
> the communication path to the supplier (email address on the supplier
> record, or contact email address from the invoice). 4) Perhaps a
> check box to copy email to senders AP team email address. 5) Routing
> on the task to a terminal stage in the workflow process. I need to
> consider this, because it does not make sense for the item to reside
> in Payment-eligible. I might need to add an additional Archive stage
> within which an item will reside. Appreciate your thoughts and
> consideration on this.

Framed explicitly as analysis first: five points to think through, not
a ready-made spec.

## What was found

**Point 5 was already answered, in decision 0055 section 7.** An
instance that has been returned to the supplier does not sit in
Payment-eligible or any other stage — it moves to a `process_instances`
status of `returned_manually` (with `archived` as its own separate
terminal state once nothing further is needed), deliberately kept at
instance-status level rather than a new workflow stage, since "not
`in_progress`" already means an instance is simply never visited by
the engine again. No Archive stage was needed; this was communicated
back and confirmed as a non-issue.

**Point 3, half of it, needed nothing new.** `loadInvoice()` already
resolves the matched supplier onto every open document (decision 0219)
and keeps it in `stored.supplier`, including `.email` — the picker
could read it directly. The invoice's own contact email (the other
half of point 3 — "or contact email address from the invoice") would
need new plumbing nothing in the codebase currently carries, and was
explicitly deferred to a later pass rather than built speculatively.

**Point 4 turned point 1+2 into a real send, not just a record.** A
checkbox to CC the AP team only makes sense if an email is actually
going out — which meant deciding, for the first time on this button,
whether the system sends anything at all. **Decision 0055 section 7
had already settled that question the other way**: "The system does
not send anything back to the sender," reasoned from an email arrival
having a sender while an SFTP drop might not. Building real outbound
sending here supersedes that one sentence (see SUPERSEDED.md) — the
rest of section 7, the terminal-state answer to point 5 above, is
untouched.

**Cloudflare's own native Email Service was checked and rejected.**
`env.EMAIL.send()` is Beta, Workers-Paid-plan-only, and its free
sending path is scoped to pre-verified destination addresses —
unusable for a button whose entire point is emailing real suppliers
nobody pre-verified. Resend is GA, needs only `fetch()` (no SMTP, no
extra binding) against a documented Cloudflare Workers integration
path, and was confirmed directly before choosing.

**The webhook has to bypass `vf-ui`'s proxy entirely.** `vf-ui` has a
Service Binding only to `vf-licence`, not to `vf-app`; `handleProxy`
reaches `vf-app` via a signed-in session's own cookie and forwards only
a `Content-Type` header, neither of which an unauthenticated,
`svix-id`/`svix-timestamp`/`svix-signature`-carrying webhook from
Resend can supply. `vf-app` is still on `workers.dev` (decision 0189)
at a real, public address, so Resend — a genuine external HTTP client,
not another Worker — can POST to it directly; Cloudflare's
Worker-to-Worker anti-loop restriction on plain-fetching another
Worker's `workers.dev` URL does not apply to it. `/webhooks/resend`
was deliberately **not** added to `vf-ui`'s `PROXIED_TO_INSTANCE` list.

## What was decided

**The terminal transition always succeeds; the email is best-effort
and tracked separately.** Ending the task and moving the instance to
`returned_manually` never waits on, or fails because of, the email —
consistent with 0055's own "a refusal is not an absence of facts"
discipline: a supplier with no email on file, or a deployment with no
Resend key configured, still returns the invoice cleanly, and exactly
what happened to the email (or why nothing was sent) is its own
auditable row, not folded into or blocking the workflow action.

**Reasons are data, not a hardcoded list — audited by being a foreign
key, not by being logged separately.** `supplier_return_reasons`
follows the same "never delete, only deactivate" convention `suppliers`
and Discard already use: an `active` flag, no DELETE route, editable
from a new tab on the AP Setup screen.

**Resend, full delivery/bounce tracking, chosen over the minimal
option.** Asked directly and confirmed: build real sending (not a
record-only stub), through Resend (not Cloudflare's own Email Service),
with a webhook wired up so `sent`/`delivered`/`bounced`/`complained`/
`delayed`/`send_failed` are all real, current states on the email row —
not just "we attempted a send and never found out what happened."

**Scope held at Return To Supplier only, and at the supplier's own
record only.** Discard's own reason handling is untouched. The
invoice's own contact email (point 3's second half) ships as a later
pass, once there is a concrete field to read it from.

## What was built

- **Migrations (`vf-app`'s DB)**: `0087_supplier_return_reasons.sql`
  (a new table, seeded with six reasons: duplicate invoice,
  misdirected, incorrect PO/pricing, goods not received, missing
  information, other); `0088_return_to_supplier_reason_and_comment.sql`
  (`process_instances.return_reason_id`/`supplier_comment`);
  `0089_org_settings_ap_team_email.sql` (one more column on the
  existing singleton row); `0090_supplier_return_emails.sql` (one row
  per send attempt, `status` tracking the six states above, a unique
  partial index on `provider_message_id` for the webhook to find its
  own row).
- **`workers/vf-app/src/resend-client.ts`** (new): `sendEmailViaResend`
  (one POST, no SDK) and `verifyResendWebhookSignature` (Svix's HMAC
  scheme, constant-time compared, supports secret rotation).
- **`workers/vf-app/src/return-reasons-route.ts`**,
  **`ap-team-email-route.ts`**, **`resend-webhook-route.ts`** (new):
  list/create/update reasons; read/set the AP team address (and a
  configured-or-not check the picker uses, never the address itself,
  which stays behind `Admin.Configure`); the webhook handler itself —
  signature-checked, forward-only status transitions so a late
  out-of-order event can never regress `delivered` back to `sent`.
- **`workers/vf-app/src/return-route.ts`**: validates the reason
  against active reasons, stores the comment, always completes the
  terminal transition, then attempts the email as a separate,
  non-blocking step and records exactly one outcome row every time.
- **`workers/vf-app/src/index.ts`**: new routes for all of the above,
  `RESEND_API_KEY`/`RESEND_FROM_ADDRESS`/`RESEND_WEBHOOK_SECRET` on
  `Env`, `/webhooks/resend` reading the raw body and Svix headers
  itself.
- **`workers/vf-app/src/activity-route.ts`**: the Timeline's own
  return-to-supplier entry gained `supplierComment`/`emailStatus`/
  `emailToAddress`, populated only on a genuine return-to-supplier row.
- **`workers/vf-licence/migrations/0176_...sql`**: en/de strings for
  the picker, the AP Setup tab, and the Timeline's email-status lines.
- **`workers/vf-ui/src/index.ts`**: the five new `vf-app` routes added
  to `PROXIED_TO_INSTANCE` — `/webhooks/resend` deliberately excluded.
- **`workers/vf-ui/public/viewer.js`**: `openReturnToSupplierPicker` —
  reasons in a `<select>`, a comment `<textarea>`, the supplier's own
  email shown as "will be emailed to" or "no email on file," and (only
  when the AP team address is configured at all) a checkbox to CC it —
  the same `.backdrop`/`.popout` shape Reassign, Return and Route To
  Approver already use.
- **`workers/vf-ui/public/activity.js`**: the supplier comment and an
  email-status line render on the Timeline entry, only ever present on
  a `return_to_supplier` item.
- **`workers/vf-ui/public/ap-setup.js`**: a new "Return reasons" tab —
  editable rows, an add-new row, and the AP team email panel.
- **Tests**: four new files (`resend-client`, `return-reasons-route`,
  `ap-team-email-route`, `resend-webhook-route`), plus `return-route`,
  `activity-route`, `index.test.ts` (`vf-app`) extended;
  `string-coverage.test.ts` (`vf-licence`) extended; `viewer.test.ts`
  (`vf-ui`, browser suite) gained a full new describe block for the
  picker and had two pre-existing tests updated off the old
  `prompt()`-based flow this decision retired.

## What was not built

The invoice's own contact email (point 3's second half) — no field
currently carries it. No new Archive stage (point 5 — see "what was
found" above; 0055's own terminal-state design already covers it). No
retry of a failed send: a `send_failed` row is a fact, not a queued
job: whoever owns "should this be retried" is a later decision, the
same way 0055 left "what does sending back mean" for a person to act
on, not a scheduler.

## Verification

- `workers/vf-app`: full suite, batched, **2962/2964**. The two
  failures are both confirmed pre-existing and unrelated, reproduced
  identically on an unmodified checkout via `git stash`: `capture-pdf.
  test.ts`'s "writes the corrected value back" test (an unrelated
  numeric assertion) and `stage-permissions.test.ts`'s "names exactly
  the permissions the code defines" test (missing `AP.Manager`, a gap
  that predates this work). All decision-0498-specific files —
  `resend-client`, `return-reasons-route`, `ap-team-email-route`,
  `resend-webhook-route`, `return-route`, `activity-route`,
  `index.test.ts` — **294/294**. `npx eslint` and `npx tsc --noEmit`
  clean on every touched/new file (one real typecheck gap found and
  fixed in `resend-client.ts`: a bare `Uint8Array` return type widened
  to `ArrayBufferLike` under TypeScript 5.7's stricter `BufferSource`,
  rejected by `crypto.subtle.importKey`; pinned to
  `Uint8Array<ArrayBuffer>`).
- `workers/vf-licence`: `string-coverage.test.ts` **32/32** (22 new
  keys). Full suite **320/320**, unchanged.
- `workers/vf-ui`: plain suite **75/75**, unchanged. Browser suite
  **1165/1166** — the one failure (`typography.test.ts`, a hardcoded
  `font-size: 10px` in `app.css`) is confirmed pre-existing and
  untouched by this work (`git diff origin/main` shows zero changes to
  that file). `viewer.test.ts` itself: **238/238**, including a new
  describe block covering the picker's reason list, its empty-reasons
  alert, the supplier-email line (present and absent), the AP-team
  checkbox (configured and not), a successful post with all three
  fields, the "no comment/no CC sent when blank" case, and the
  server-error-keeps-picker-open case. Two pre-existing tests that
  still drove Return To Supplier through the retired `prompt()` flow
  were updated: one to exercise the new picker instead (the
  underscore-to-hyphen route-naming test), one switched to `discard`
  (the one action still left on `ACTIONS_NEEDING_A_REASON`) since
  Return To Supplier no longer prompts at all. Its own remaining
  ~312 "Unhandled Rejection" warnings are the same pre-existing
  `/api/documents/:id/collaborators` stub-gap noted in decision 0497's
  own verification, confirmed scaling by exactly the +9 tests this
  segment added (not caused by them) via a `git stash` comparison.

## Still to do, operator side

1. **Create a Resend account and verify a sending domain** (SPF/DKIM/
   DMARC), most likely a subdomain of `vibefinance-ai.com` alongside
   the existing zone. `wrangler.jsonc` already carries
   `RESEND_FROM_ADDRESS: "ap-noreply@vibefinance-ai.com"` as a plain
   var — change it there first if a different address is wanted.
2. **Set two secrets on `vf-app`**, after pushing and deploying:
   ```
   wrangler secret put RESEND_API_KEY
   wrangler secret put RESEND_WEBHOOK_SECRET
   ```
   (the webhook secret comes from Resend's own dashboard once the
   endpoint below is configured).
3. **Point Resend's webhook at `vf-app` directly**, not through
   `vf-ui`: `https://vf-app.vibefinance.workers.dev/webhooks/resend`
   — subscribed to `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`, `email.delayed`.
4. **Apply the migrations**, after confirming the deploy:
   ```
   wrangler d1 execute vf-app-poc --remote --file=migrations/0087_supplier_return_reasons.sql
   wrangler d1 execute vf-app-poc --remote --file=migrations/0088_return_to_supplier_reason_and_comment.sql
   wrangler d1 execute vf-app-poc --remote --file=migrations/0089_org_settings_ap_team_email.sql
   wrangler d1 execute vf-app-poc --remote --file=migrations/0090_supplier_return_emails.sql
   ```
   and, for `vf-licence`:
   ```
   wrangler d1 execute vf-licence-poc --remote --file=workers/vf-licence/migrations/0176_return_to_supplier_picker_strings.sql
   ```
   (database names above are illustrative — use whatever this
   deployment's own `wrangler.jsonc` names.)
5. Optionally set an AP team email address from the new "Return
   reasons" tab on AP Setup, to see the CC checkbox appear on the
   picker.

Once all of that is done, report back "pushed"/"deployed" (and confirm
the migrations ran) and the standing two-step confirmation pattern
picks up from there.

# 0559 — Routes, slice 5: reprocess, dismiss and alerts

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app` migration
`0109` (apply before deploying `vf-app`) and `vf-licence` migration
`0210`**. This completes phase 1 of the Routes design.

## What was asked

Slice 5 of the Routes design (`docs/design/routes-phase1-data-model.md`
section 7), "fix and tell": let a customer's IT team reprocess a failed
message from its kept original, dismiss one with a reason, and be alerted
by email or webhook, without asking VibeFinance.

## What was decided

- **Reprocess** (`POST /route-messages/:id/reprocess`, or several at once
  with `POST /route-messages/reprocess`):
  - runs a failed, partly delivered or stuck inbound message through
    capture again, from the attachments kept in R2 (0555), with the
    route as it is now. A fix made since (a supplier set up, an org
    chosen, a process given stages) applies, and nobody asks the
    supplier to send it again;
  - **never makes an invoice twice**: only attachments that did not
    become one run again;
  - a message kept as its email alone (it failed before its attachments
    were read) has them read from the kept email now, and each is kept
    as receiving would have;
  - receiving and reprocessing share one function for an attachment
    (`captureAttachmentPart`), so a message run again takes exactly the
    path it first took;
  - the message's outcome is worked out again from its attachments
    (delivered, partly delivered, or failed with each file's reason), its
    attempts go up, and its history records who ran it;
  - **refused with a code where it cannot run**: `outbound` (an export is
    sent again by exporting), `no_original` (mail to an unclaimed address
    was never kept), `source_retired`, `not_failed`;
  - the monitor offers "Reprocess" and, where other open failures on the
    same route share the same error code, "Reprocess n like it", since
    one fix usually fixes them all.
- **Dismiss** (`POST /route-messages/:id/dismiss`, with a reason): closes
  a failure that needs no fixing (a portal notification, a duplicate
  already re-sent). What failed, where and why stays on the record; it
  stops counting in *Failed, not yet fixed*. Asked for in the app's own
  pop-out, like Undo (0554), and the reason is shown under the event in
  the history, as an undone export's now is.
- **Alerts** (migration `0109`: `route_alerts`, `route_alert_log`):
  - for one route, or every route;
  - **when**: each message that fails or is only partly delivered; when a
    day's failures on the route (or all routes) reach a number, once
    that day; when a Source that has received before has received
    nothing for some hours, once for each silence. Silence is checked
    on the Worker's existing six-hourly schedule;
  - **how**: email through Resend, the provider Return To Supplier
    already uses (0498), with its existing `RESEND_API_KEY` and
    `RESEND_FROM_ADDRESS`, so no new provider or decision was needed;
    and/or a webhook to the customer's own monitoring, as JSON, signed
    with the alert's own secret (`X-VibeFinance-Signature: sha256=` an
    HMAC of the body). The secret is made when a webhook is added, kept
    when the alert is changed, and shown to those who manage alerts so
    they can check the signature;
  - **once each**: what was sent is logged per alert, kind and key (the
    message, the day, or the route's last message for a silence), so a
    message reprocessed and failing again is not alerted twice;
  - **never affects a message**: a failed send is logged with its
    outcome, and changes nothing else;
  - managed in the monitor's **Alerts** pop-out: each alert with what it
    last sent, **Test** (sends now and says what happened, including
    "email: not configured" where Resend is not set up), Change and
    Delete, and a form for a new one, with each refusal in plain words.
- **Who**: all of it is `Integration.Monitor`, the IT team who watch the
  routes. The design note had alerts under `Integration.Configure`,
  which does not exist yet, and setting their own alerts is the IT
  team's own business.
- **Also fixed**: three `env.DOCUMENTS` reads from 0556 and 0558 now go
  through `resolveTenant`, as 0001's lint rule requires. They were missed
  because those slices ran eslint on the new modules rather than on
  `index.ts`.
- Strings in English and German (`vf-licence` `0210`), including a reason
  for each refusal.

## Not built / worth knowing

- **Plain-language errors**: every error code the routes produce
  (`no_such_address`, `source_retired`, `no_attachment`, `unreadable`,
  `undone`) already had words and a fix (0556, 0558). The raw reason for
  each file remains the capture's own, shown as technical detail.
- A silence is noticed within six hours of passing its limit, the
  schedule the Worker already has. A shorter schedule is a deployment
  setting.
- Alerts are for inbound failures and silence. An ERP export is closed by
  Undo, not alerted; an ERP confirming an import comes with an API
  Destination.
- Reprocess runs synchronously, up to 50 messages at once.

## Verification

- **`vf-app`** `route-fix.test.ts` (14):
  - reprocess: a failed message delivered once fixed, the invoice pointing
    at the kept attachment, the history with who; a partly delivered
    message runs only what failed; attachments read from a kept email;
    still failing, it stays failed; each refusal with its code; similar
    open failures offered;
  - dismiss: needs a reason, closes it, keeps the error, is no longer
    counted, and cannot be done twice;
  - alerts: refusals; saved with a webhook secret that survives a change,
    listed and deleted; email and signed webhook on a failure, once, and
    not for another route; nothing for a delivered message; a daily
    threshold once; a silence once until it receives again, and not for
    a Source that has never received; a test, and "email: not configured".
- **`vf-app`** `index.test.ts`: through the real router, all need
  `Integration.Monitor` (403 even with `Admin.Configure`).
- **`vf-ui`** `route-monitor.test.ts` (browser, 14), with the real
  strings: Reprocess and "Reprocess 3 like it" and what they report; why
  one cannot run; Dismiss's pop-out and its reason; a dismissed message's
  reason in the history; the Alerts pop-out listing, testing, adding and
  refusing. `index.test.ts`: every new path proxied.
- Migrations: `vf-app` replay 109; `vf-licence` replay 210.
- **`vf-app`**, a full, unfiltered run: 139 files and 3271 tests, of which
  **3269 passed**; the two failures are the ones already known (0511).
- **`vf-ui`**: worker 75/75; browser 1332/1333 (the known
  `typography.test.ts` 10px gap). **`vf-licence`**: 322/322.
- Day and Night screenshots of a failed message with its actions, and the
  Alerts pop-out, checked by eye.

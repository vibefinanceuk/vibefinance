# 0581: Replace an HTTPS key

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0116`** and **`vf-licence` migration `0229`**.

## What was asked

On 1 October Dan asked: *"I know that a key can only be viewed once.
Would it be possible to regenerate a key, or is that not really worth
it?"*

A key cannot be shown again: only its hash is kept (0578). Replacing one
was worth having, because of 0579. A mapping's Who it is for names the
sender by the key's name. Revoking and making a new key meant typing the
same name exactly, and a live key of that name blocked the new one. I
suggested Replace, with the old key working for 24 hours unless stopped
at once, and Dan asked for it.

## What was decided

`POST /sources/:id/keys/:keyId/replace` `{ stopNow? }` (Admin.Configure):

- makes a **new key with the same name**, returned this once;
- the old key records `replaced_by` and `expires_at` (migration `0116`):
  - **24 hours** later by default, so the sender can switch without a
    gap;
  - **at once** with `stopNow`, which also revokes it, for a key that
    may have leaked;
- a key that is revoked, or already replaced, is refused with 409.

A key authenticates only while it is not revoked and not past
`expires_at`. A replaced key no longer holds its name, so the new one is
the only live key by that name. The source's `liveKeys` (0580) counts
only keys still working. A replaced key may still be revoked before its
24 hours are up. Once they are, revoking it says it has already stopped.

**On Process routes**, each working key has **Replace** beside Revoke.
The pop-out:

- names the key and says mappings that name it keep reading;
- has a "Stop the old key now" tick box, unticked by default, and says
  why one would tick it;
- shows the new key once, with Copy, as Make a key does.

A replaced key's row reads "Replaced · stops …" and keeps Revoke. Past
that time it reads "Stopped …", struck through.

**The How to send example** now shows `Bearer <your key>`. It used to
show the start of a live key followed by `…`, which looked like a key to
paste.

`vf-licence` `0229` adds the strings and updates the screen's help.

## Verification

- **`vf-app`**, `https-in.test.ts`, 4 new tests:
  - a key is replaced with one of the same name, the old one stopping
    24 hours later. Both keys work until then; the old one is listed
    with `replacedBy` and `expiresAt`; replacing it again and a new key
    of that name are refused. Past its expiry it gets 401, `liveKeys`
    is 1, and revoking it says it has stopped;
  - `stopNow` stops it at once, as a revoke;
  - a replaced key can still be revoked early;
  - another source's key gets 404, no Admin.Configure gets 403, and a
    revoked key gets 409.

  5 fail against the code before this change. 14 of 14 in the file.
- **`vf-ui`**, `routes.test.ts`, 2 new tests and 3 updated, with the real
  strings:
  - Replace with the box unticked and ticked sends `stopNow` false and
    true, and shows the new key once;
  - a replaced row shows when it stops and offers only Revoke, and a
    stopped one is struck through with nothing to do.

  3 fail against the interface before this change. Worker allowlist:
  the replace path.
- **Migrations** replay: `vf-app` 116, `vf-licence` 229.
- **Full runs**, with 0581 and 0582 together: `vf-app` 3366 tests, of
  which 3364 pass (the two known failures, 0511). `vf-ui` browser 1402 of
  1403 (the known `typography.test.ts` 10px gap), worker 89 of 89.
  `vf-licence` 322 of 322.

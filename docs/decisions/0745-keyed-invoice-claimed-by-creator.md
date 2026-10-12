# 0745: An invoice created by hand is claimed for whoever created it

**Status: built.** vf-app (`upload-route.ts`), vf-licence (strings migration 0344).

## What was asked

Dan, 12 October 2026: *"when a user manually creates an invoice - I think it should be
automatically claimed by their user. This is because they have decided to create an invoice,
therefore they would logically be the person entering and validating the details. rather than
something coming via email, or another channel"*.

## What changed

- **Create an invoice** (0575, 0744): once the invoice is made and started in its process, its
  open task is **claimed for the person who created it** (`claimForCreator`), so it opens
  already theirs to key, and the Timeline says they claimed it.
- **As their own Claim would, so only where they may**: the task is a team's and unclaimed, the
  person is a member of that team, and holds the task's permission for the invoice's company.
  Otherwise it waits for its team as any other invoice. A task named for one person is already
  theirs and is left alone.
- **Only an invoice keyed by hand.** Upload documents, Batch upload, email and every other
  channel are unchanged: nobody chose to key those.
- The Create an invoice card's words say it opens already claimed.

## Tests

vf-app `upload.test.ts`: the open task claimed for its creator with its claim event; not
claimed for someone outside the team or without the task's permission; nothing to claim where
the first stage has no task; the existing keyed and upload tests unchanged and passing.
vf-licence string coverage.

## To deploy

Migration: vf-licence `0344_keyed_claimed_strings.sql`. Deploy vf-app and vf-licence.

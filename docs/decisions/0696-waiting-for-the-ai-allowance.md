# 0696: A document not read for want of AI allowance waits, and is read after the reset

**Status: live** at `66535e8`, pushed and deployed 9 October 2026, migration applied. vf-app; vf-licence migration
`0309_ai_allowance_strings.sql`.

## What was asked

Dan, 9 October 2026, after Workers AI's daily free allowance ran out
(`AiError: 4006`): "please can you look at 'clearer wording when an invoice
wasn't read because the AI allowance ran out.'"

He chose, through AskUserQuestion, **"Wait and read it after reset"** over
keeping it for manual entry, or clearer wording alone.

## What happened before

`createWorkersAiExtractionModel` reported any error other than a time-out as
"the extraction model failed: …", a refusal about the **document**. For an
emailed attachment that meant:

- the part was failed;
- the message was failed, and the sender bounced if it was read on arrival;
- no invoice was made, unlike a time-out, which keeps one for manual entry
  (0163);
- nothing tried again; someone had to find it and press Reprocess.

So every invoice arriving after the allowance ran out was parked as a failure.

## What happens now

**Recognised.** `isAllowanceError()` matches Workers AI's `4006` or `3036`, or
the words "daily free allocation". The adapter raises
`ExtractionRefusal(…, allowance: true)` with the message *"the AI allowance for
today is used up, so this was not read; it will be read after the allowance
resets at 00:00 UTC (…)"*, keeping the model's own words.

**The whole document waits.** One page or a lines call (0688) hitting the
allowance stops the document. No half-read invoice is kept with its lines lost.

**Nothing is made, failed or bounced.** Capture answers `503`, `allowance: true`,
`reason: "ai_allowance"`, instead of keeping an empty invoice for keying.
`captureAttachmentPart` returns `deferred: true` and leaves the part with no
outcome.

**The background reader (0687) waits for the reset.** The message:

- stays "received";
- is leased until 00:05 UTC the next day;
- gets a `read_deferred` event: *"Waiting for the AI allowance, will be read
  after 00:00 UTC"*;
- does not count the try towards `MAX_READS`.

The run then stops, since no other message can be read either. After 00:05 UTC
the next run reads it as normal.

**Where it cannot wait,** it is labelled rather than failed as unreadable:

- **Read on arrival** (storage failed): failed at translation with
  `ai_allowance`, **not bounced**, part left unread.
- **Reprocess:** the same label, so Reprocess after the reset reads it.

The Route monitor explains `ai_allowance` (title, explanation, fix) in English
and German.

**A direct upload** (`POST /sources/:id/capture`) gets `503 ai_allowance` with
the same words.

**The Rules screen** says *"The AI allowance for today is used up, so the rule
could not be worked out. It resets at 00:00 UTC; please try again then. (…)"*
(`rulesModelAllowance`, six languages, `503`), instead of "The rules model did
not answer".

## Tests

`test/ai-allowance.test.ts` (9):

- recognising the codes, and not time-outs or other errors;
- the adapter raising it with the model's words;
- the reader waiting:
  - with the clock at 10:00, the message is held to 00:05 UTC, counts no try,
    and the run stops before the second message;
  - at 23:59 the second message is read and the first left alone;
  - at 00:06 the first is read;
- the next midnight across a month and a year;
- read on arrival: not bounced, labelled `ai_allowance`;
- Reprocess during the outage, then after it;
- a direct capture answered 503 with nothing made;
- a lines call hitting it;
- the Rules screen's 503 and wording.

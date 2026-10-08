# 0691: An Email source's size limit, and a polite refusal

**Status: live** at `66b2f29`, pushed and deployed 8 October 2026, migrations applied.

- vf-app migration `0150_source_email_size_limit.sql`.
- vf-licence migration `0306_email_size_limit_strings.sql`.
- vf-ui: the source panel on the Routes screen.

## What was asked

Dan, 8 October 2026:

> have a cap on file size in emails, and send a polite rejection to the sender
> informing them that the email could not be processed because of a breech of
> the file-size. Perhaps this can be specified in the Source route
> configuration, when an Email is selected?

He chose (AskUserQuestion) the whole email, 10 MB by default, refused as a
bounce. Then:

> I would like to specify the rejection message, and specify the default
> message limit in the source configuration. I would also like default
> rejection message in the 'interface wording' part of the operator menu. The
> message setup in the source configuration would only be used to override.

## What was built

**On the source** (`sources.max_email_mb`, `sources.email_reject_message`):

- the largest email, 1–25 MB. Blank means 10 MB; 25 MB is Cloudflare's own
  limit.
- this source's own message, at most 500 characters. Blank uses the default.
- set on the Routes screen, in an Email source's panel ("Largest email",
  "Message when too large", Save), through `PUT /sources/:id/email-limit`
  (Admin.Configure). The box shows the default message as its placeholder.

**The default message** is the Interface wording key `email.reject.toolarge`,
in English and German. It is edited in the operator console like any other
wording, and reaches vf-app through vf-licence's `GET /ui-strings`, over the
existing service binding, in the environment's language. If vf-licence cannot
be reached, a built-in English copy is used. `{size}` and `{limit}` are filled
in, in MB.

**On arrival**, after the source is known and before anything is stored:

- an email over the limit is refused with `setReject(message)`, so the sender's
  own mail system returns it to them;
- nothing is stored or read;
- the Route monitor shows the message as failed at the gateway, `too_large`,
  with the size, the limit and the words the sender was given. Its card has a
  title, an explanation and a fix (vf-licence 0306);
- the arrival is recorded as `rejected`, `too_large`.

A refused email sent again is read, rather than taken for a repeat: 0687's
same-email check ignores messages refused at the gateway.

## Tests

`test/email-limit-and-shrink.test.ts`:

- the source's message, filled in, wins over the default;
- with no source message, Interface wording's default is used;
- the built-in English is used when vf-licence is unreachable;
- the 10 MB default, and an email within the limit, are handled correctly;
- a refused email sent again is read;
- the limits that can be set are checked;
- only an Email source can be set.

The vf-licence string coverage test includes the new keys.

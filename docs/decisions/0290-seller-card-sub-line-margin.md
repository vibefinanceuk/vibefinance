# 0290 — The Seller card's identifier line was borrowing the sign-in page's own margin

**Status: built.**

---

## What was reported

> The fields beneath the word Seller appear to be aligned to the
> bottom of the card. The Buyer card, details seem aligned to the top.
> To save space, I would like the Seller card orientation to match the
> Buyer card, perhaps there is padding at the bottom of the card that
> could be reduced?

## What was actually happening

Not orientation, and not padding on the card itself — a single element
the Buyer card simply doesn't have. The Seller card alone renders a
`.sub` line beneath its own heading: the supplier's ERP identifier,
site, and pay-site flag. Decision 0227 explicitly gave the Buyer card
none of this, on the reasoning that the header already names the
company.

**The base `.sub` CSS rule was never written for this.** It carries a
34px bottom margin — correct for the sign-in page's own subtitle,
which needs real air beneath a full sentence before the form starts.
Two other contexts already override it for their own, much smaller
needs (`#shell .sub`, `.vhead .sub`); the Seller card's own use never
got the same treatment, so it inherited a login page's own spacing by
default. That's what pushed the fields down — not a wrong alignment,
but 34px of borrowed margin above them that the Buyer card's fields
never had to clear.

**A second problem, found while reading the code that produces it.**
The line rendered unconditionally — a supplier with no ERP identifier,
no site, and not a pay site still produced an empty `.sub`, present in
the layout and carrying its own margin regardless, saying nothing.

## The fix

Two parts, addressing both causes rather than papering over the
visible symptom of one:

- `.parties .sub { margin: 2px 0 8px; }` — scoped precisely to where
  the problem actually is, rather than touching the base rule the
  sign-in page still needs correctly.
- The line itself is now omitted entirely when there is nothing to
  say — no ERP identifier, no site, not a pay site — rather than
  rendering an empty line that reserves space anyway.

## What has coverage

Three tests: the line is absent for a supplier with nothing to report;
present and correct for one with real data (no regression against
decision 0218's own reasoning for why this line exists at all); and
the CSS itself carries the smaller margin, not the sign-in page's
34px. The last of these needed a second pass — the first version
matched on a fixed character offset, which meant it passed trivially
when the rule was removed entirely rather than actually failing, since
an empty slice contains no 34px either. Rewritten to confirm the rule
exists before checking its content, then probed against both faults
directly: the override missing, and the override present but
reintroducing 34px. Each failed the corrected test; neither had failed
the first version.

vf-ui: 49 Worker, 353 browser. No migration.

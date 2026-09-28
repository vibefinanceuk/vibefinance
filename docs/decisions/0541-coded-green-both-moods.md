# 0541 — Coded fields stay Day's pale green at Night, and a coded line's Coding icon turns green

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-ui` and `vf-licence` (one string, migration `0196`); no
`vf-app` change.

## What was asked

> I think I prefer the paler green colour for the back colour used on
> the 'day' branding in the coding segments, when they are completed.
> Would it be possible to update the 'night' configuration, so it uses
> the same green as 'day' to denote a completed segment. Also, when an
> invoice line is coded successfully, would it be possible to change
> the icon on the invoice line such that the icon has a bold green
> outline and a green fill to indicate that coding has been completed
> for the line?

## What was decided

- **A set field card is pale green in both moods.** It uses the fixed
  `--severity-ok-bg`/`--severity-ok-text` pair (decision 0400's "Day's
  paler colours at Night too"), not `--bg-success`, which is dark green
  at Night. The card's own label and tick take fixed colours as well,
  since Night's light text would vanish on pale green. The inputs
  inside keep their own surfaces. The same approach as 0528's amber
  card.
- **A coded line's Coding icon**: the tag's outline drawn heavier
  (2.4) in green (`--border-success`, the same in both moods), its body
  filled with the same pale green, the tick left unfilled. Hover text:
  "Coding — coded".
- **"Coded" means** every coding field this stage shows holds a value,
  with Cost Centre and Project counted as one under AP Setup's
  either/or rule (0540), or each needed under "both allowed". It reads
  what the line holds now, so it turns green as soon as the pop-out
  closes, before Save. It is not green when:
  - a value is not on the Account Coding lists (0511's red mark wins);
  - the line is PO-matched (0537: its coding comes from the PO; the icon
    stays dimmed);
  - the stage shows no coding fields at all.

## Verification

- **`vf-ui` `viewer.test.ts`** (4): coded once every shown field is
  set, cost centre or project counting as one, with the hover text;
  "both allowed" needs each; not coded while a value is off the lists;
  never on a PO-matched line. The two that test a line turning green
  **failed** with the previous `viewer.js`; the two that check it
  stays plain passed there too, as they should.
- `vf-licence` 0196 checked on a replay (2 rows). Browser 1271/1272
  (the known `typography.test.ts` 10px gap). Worker 75/75. `vf-licence`
  320/320.
- Day and Night screenshots of the pop-out after Accept all, and of the
  line table at 2×, checked by eye.

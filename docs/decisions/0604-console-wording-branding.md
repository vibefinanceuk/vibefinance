# 0604: Interface wording and Branding in the operator console

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-admin` and `vf-licence`. No migrations. Deploy vf-licence and
vf-admin.

## What was asked

Dan, 2 October, after the console's side menu (0603): *"Lets wrap up the
operator console with wording and branding"*. Both were in the menu as
*next*.

## What was decided

### Interface wording

Every key in `ui_strings` (0107), its English and the chosen language
side by side, editable in place.

- **Coverage** for each language at the top: English and German complete,
  French, Spanish, Italian and Dutch not started.
- **Found** by key or words, by area (the key's first part, such as
  `library` or `httpsout`), or **only those not yet translated** in the
  chosen language. A hundred at a time, with Show more.
- **Save** per key, the English first where it changed. A change shows
  within five minutes (the strings' cache), with no deployment.
- **For a translator:** *Download those not yet translated* gives a JSON
  file of the keys missing in the chosen language with their English;
  *Upload translations* takes it back, checks every key exists and keeps
  its placeholders, says how many it adds and replaces, and applies all
  or nothing on **Apply**.

**A translation keeps the English placeholders.** The interface replaces
`{name}`, `{n}` and the like, and a translation missing one shows nothing
where the value should be. The screen says so as it is typed and will not
save; `vf-licence` now refuses it too, for one key and for a whole
language (`reason: "placeholders"`). Every German string already keeps
them.

### Branding

A customer's livery (0096): its name and four colours, set by VibeFinance
(0083), never by the customer.

- Chosen by customer, with when and by whom it was last changed.
- Each value **set or VibeFinance's own** (left blank), with a colour
  picker and its hex, and **where it shows**: the fill is the sign-in
  page's wash, mark, focus and button, and primary buttons; the name is
  the product's name on the sign-in page; the bar and chip colours are
  held for screens that use them, which none does yet. Said plainly, so
  setting one does not look broken.
- **A preview** of the sign-in page in the chosen colours.
- **Contrast checked** as it is chosen: white text on the fill, and chip
  text on the chip, under 4.5 to 1 is flagged as hard to read.
- **Save livery**, and **Use VibeFinance's own** (asked once more).

`vf-licence` adds `GET /branding/:customer`, privileged: the livery in
force, what is set, the defaults, and when and by whom. Setting it now
records **the operator Access verified** rather than "operator".

## Verification

- **`vf-licence`**, `console-wording-branding.test.ts`, 4 tests: the
  placeholders a value carries; a translation dropping one refused, one
  key and a whole language, and one keeping them in any order taken;
  English free to change its own; the Branding read, defaults until set,
  then what was set and by whom; privileged, and the verified operator
  recorded. Full run 357 of 357.
- **`vf-admin`**: the wording and branding routes forwarded, and a
  lookalike refused. 14 of 14.
- **The console**, in a browser against the real 2,641 keys: coverage,
  search, area, only untranslated; a translation dropping `{n}` held back,
  then saved with it; a file uploaded, checked and applied; a livery
  changed with the chip contrast flagged, saved, and reset only on the
  second click. Screenshots.

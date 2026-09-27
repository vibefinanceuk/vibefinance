# 0520 — The Documents list: the operator's column order, and status pills

**Status: pushed (`7c1d41f`), deployed, and migration `0185` applied, as confirmed by the operator on 27 September.**

## What was asked

> Please could you update the Document list, so that the order is a
> little different. It should include Document Number (i.e. Invoice
> Number), Status, Amount, Received Date, Due Date, Supplier Name,
> Business Unit, Hands. Please can we also create pill boxes for the
> status, and in the same colouration / shade of the current colour
> scheme used for the different Statuses.

## What was decided

**Column order and defaults** (`COLUMNS` in `documents.js`) now follow
the operator's list exactly. All eight columns are shown by default;
Due Date and Hands were previously off. Type, Recipient and Stage stay
available in the column picker, off by default, after the eight.

**The saved column choice moves to a new key,
`vf.documents.columns.v2`.** A choice saved under the old key would
otherwise have kept Due Date and Hands hidden for anyone who had ever
touched the picker. With the new key, everyone gets the new defaults
once, and their own choices are kept from then on.

**Status is a pill** (`.statuspill`). It uses the colour each status
already had:

- the text keeps that colour;
- the fill is the same family's background tint (`--bg-success`,
  `--bg-warning`, `--bg-accent`, `--surface-1`);
- the edge is that family's border.

So Finished is green, Waiting and Needs keying are amber, Returned to
supplier is blue, In progress and Not in a process are neutral, and
Archived is outlined only. The shape applies only where
`.statuspill` is added, so every other `.status` in the app is
unchanged. Both light and dark themes use the existing tokens, so no
new colours were introduced.

**Headings use the operator's words** (`vf-licence` migration `0185`):

| Key | English | German |
| --- | --- | --- |
| `column.number` | Document Number | Belegnummer |
| `column.received` | Received Date | Eingangsdatum |
| `column.due` | Due Date | Fälligkeitsdatum |
| `column.sender` | Supplier Name | Lieferantenname |

These four keys are only read by the Documents list. `column.unit`
("Business unit") is left as it is, because Access's Org Units table
reads it too.

## What was verified

- **`documents.test.ts`:**
  - The default headings are exactly the operator's eight, in order,
    and the picker ends with Type, Recipient and Stage.
  - Status renders as a pill carrying its status class.
  - A column turned on is saved under the new key.

  Both new tests **failed** with `documents.js` stashed. The file
  passes 37/37.
- **`vf-ui` browser suite:** 1205/1206. The one failure is the known
  `typography.test.ts` `10px` gap. Worker tests: 75/75. `vf-licence`:
  320/320.
- **Screenshots:** every status pill was rendered in Chromium, with the
  real CSS, in light and dark.

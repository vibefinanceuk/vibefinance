# 0677: The invoice viewer's amounts shown as money, in English or German form

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> 1. Could you ensure fields are in currency format where appropriate.
>    For example, Net before VAT, Total with VAT, VAT Amount, Amount
>    Due, Line Net Amount. Also when you click header fields to show all
>    header fields, please correctly display amounts there also.
> 2. Because we intend to support german language, can you comment on
>    the feasibility to support Germany currency amounts. They use
>    xx.xxx,xx, instead of uk xx,xxx.xx … The change could occur only
>    when flipping between language from English to German.

## What was built

### vf-ui `money.js`

**The money fields** (`MONEY_FIELDS`):

- BT-106 *Net before VAT*;
- BT-109 *Total without VAT*;
- BT-110 *VAT amount*;
- BT-112 *Total with VAT*;
- BT-115 *Amount due*;
- BT-131 *Line net amount*;
- BT-146 *Item net price*.

BT-129 (quantity) and BT-152 (VAT rate) are numbers, not money, and are
left as they were.

**`formatMoney(value, currency, field)`:**

- The amount appears in the invoice's own currency (BT-5), grouped, to
  two decimals.
- A unit price may keep up to four, as EN 16931 allows.
- With no currency, or an unknown one, it is a grouped number.
- A value that is not a number is shown as it is, so a mis-keyed value
  is still seen.

**The form follows the language on screen** (`numberLocale()`):

| Language | Example |
| --- | --- |
| English | `£12,500.20` |
| German | `12.500,20 £` |

**`parseAmount(text)`** reads what is shown or typed back to the plain
stored number (`"12500.2"`):

- It reads the language on screen.
- **One allowance:** a single mark followed by one, two or four digits
  can only be a decimal mark, whichever mark it is. So `12500.20`
  typed out of habit on a German screen is still 12500.20.
- `1.234` follows the language: a thousands separator in German, a
  decimal in English.

**`moneyInput()`:**

- shows the money until it is clicked into;
- shows the plain amount to type over while it is edited (`12500.20`,
  or `12500,20` in German);
- shows the money again when it is left.

### Where it shows (vf-ui `viewer.js`)

**The header card and the Header Fields pop-out** both draw through
`field()`:

- a read-only amount is shown as money;
- an editable one is a `moneyInput`.

**The line table:**

- line amounts as money, read-only or editable, right-aligned in tabular
  figures;
- money columns sized for the wider figures (`th.money`, 8.5em), since
  the table is fixed-layout.

**Also shown as money:**

- the running *Lines total … differs by …* line;
- the Coding pop-out's description of a line (`× price = amount`).

### Stored and sent unchanged

- `save()` reads amounts back with `parseAmount()`.
- A line's amount is kept as the plain number as it is typed.
- The server receives exactly what it did before, `12500.2`, whatever
  the language.
- Nothing stored, exported or checked changes.

### German (Dan's question 2)

**Feasible, and done with the same code:** the form follows the language
picker, so switching to Deutsch shows `12.500,20 £` at once.

The risks, and how each is met:

- **Typing.** A German user types `12.500,20`, which is read correctly.
  Someone used to the UK form may type `12500.20` on a German screen;
  that is read as 12500.20 too, by the single-mark allowance. The only
  truly ambiguous entry is `1.234` (three digits after one mark). It
  follows the language on screen, as anyone using that language would
  expect.
- **Stored data is unaffected.** Amounts are stored and sent as plain
  numbers, so the language changes what is shown and nothing else. The
  rule engine, matching, ERP exports, the CSV loads and e-invoices are
  untouched.
- **Elsewhere in the app:** other screens' amounts (purchase orders,
  dashboards, documents) still use their own formatting. Some already
  follow the browser's locale; some show plain numbers. Bringing them
  onto `money.js` is a follow-on, screen by screen.
- **Currency position follows German convention** (`12.500,20 €`, symbol
  after), which is what a German reader expects.

## Verification

- **`vf-ui`** browser:
  - `money.test.ts` (new, 6 tests):
    - English: currency, grouping and negatives; no currency;
      non-numbers; a unit price's four decimals; reading back
      `£12,500.20`, `12500,20` and `1,234`;
    - German: `12.500,20 €` and the plain `12500,20`; reading back
      `12.500,20 €`, `12500.20` and `1.234`.
  - `viewer.test.ts` gains 2 tests:
    - read-only *Net before VAT* and a line's net in GBP, with the
      quantity left plain;
    - an editable *Total with VAT* shows `£15,000.24`, shows `15000.24`
      while edited, shows `£16,250.50` after `16250.5` is typed and
      left, and Save sends `16250.5`.
  - 2 existing expectations now read money (`100.00`, `1,200.00`).
- **Screenshots** of the viewer in English and German, and of the
  Header Fields pop-out, in Day and Night.
- **Full run**: vf-ui browser 1644, of which 1643 pass (the known
  `typography.test.ts` 10px gap).

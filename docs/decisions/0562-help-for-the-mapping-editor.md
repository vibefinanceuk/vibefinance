# 0562: Help written at length, starting with the mapping editor

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-licence`, and needs **`vf-licence` migration
`0213`**. There is no `vf-app` change.

## What was asked

Dan asked what the "Who it is for" field in the mapping editor is for, and
then: "I think perhaps we need a comprehensive description in the 'help'
button for this page".

## What was found

Two problems stood in the way:

- **Help had one paragraph per screen.** `help.screen.<screen>` was shown
  as a single `<p>`. That is enough for a list screen, but not for an
  editor with columns, functions, versions and a card of settings.
- **The mapping editor had no Help of its own.** It set the current
  screen to `routes`, so the nav would light Routes, and Help therefore
  explained the Routes screen instead of the editor.

## What was decided

### Longer help for any screen

A screen's help is now its key followed by any numbered keys:
`help.screen.<screen>`, then `help.screen.<screen>.2`, `.3`, and so on.
Each key holds one line, and `help.js` renders each line by how it starts:

| A line starting with | Becomes |
|---|---|
| `## ` | a heading |
| `- ` | an item in a list |
| anything else | a paragraph |

A screen with only its key reads exactly as before. Ask reads the headings
and list items as well, so its answers are based on the whole text.

There is one line per key, rather than line breaks inside one value, for
two reasons:

- Stored words hold no escape sequences (0546). A test enforces this: a
  literal `\n` would appear on screen as two characters.
- A migration's statements are collapsed onto one line before they run,
  and a translator can work line by line.

### The mapping editor is its own screen

- It sets the screen to `mapping`, so Help explains the editor.
- The nav still lights **Routes**, through `NAV_PARENT` in `tasks.js`.
- Changing org reopens the same mapping, through `go("mapping")` and
  `reopen()`.

### What the help says

The mapping editor's help covers:

- what a mapping is for;
- the two columns;
- drawing a line, including one element feeding several terms, and
  fixed values;
- functions (Fx) and their worked examples;
- **the Mapping card**: Name, **Who it is for** (why the field exists,
  domains, full addresses, several addresses, left empty, the default,
  and which mapping wins when two match), and Lines repeat at;
- Try, Publish and Reprocess, and how versions work;
- what happens when an invoice fails;
- the permissions needed.

The **Routes** help gains *Receiving formats* and *Supplier mappings*
sections.

The **Route monitor** help gains:

- *E-invoice checks*;
- *A supplier's own XML*;
- *Fix and tell*.

All of it is in English and German: 48 keys in `vf-licence` `0213`.

### Also fixed

The `vf-licence` test setup never loaded migrations `0211` and `0212`, so
the string coverage test could not see those strings. It now loads
`0211` to `0213`, and every key they add is on the coverage list.

## Verification

- **`vf-ui`** browser `help.test.ts`, three new tests, using the real
  strings:
  - the editor's help renders as headings, lists and paragraphs, in
    order;
  - the "Who it is for" item is present;
  - no escape sequence and no key appears on screen;
  - the Routes and monitor help are extended;
  - a screen with only its key renders exactly as before.
- **`vf-ui`** browser suite: 1352 of 1353 pass. The one failure is the
  known `typography.test.ts` 10px gap.
- **`vf-licence`**: 322 of 322 pass, including the escape-sequence test
  and string coverage with the new keys.
- **Migrations**: `vf-licence` replays 213.
- **Screenshot** of the editor with Help open, checked by eye: the help
  shows the editor's own text, and the nav still lights Routes.

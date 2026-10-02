# 0608: Access Control and Process Rules

**Status: built and tested locally, not yet pushed or deployed.** It needs
**`vf-licence` migration `0252`** (strings) and nothing else: no code
changes, so no Worker needs deploying. The new names appear within five
minutes of the migration (the strings' cache, 0107).

## What was asked

Dan, 2 October 2026: *"Two small ones - please can you; Rename menu Access
to Access Control. Rename Rule menu to Process Rules"*.

## What was decided

| Key | English | German |
|---|---|---|
| `nav.access` | Access → **Access Control** | Zugriff → **Zugriffssteuerung** |
| `nav.rules` | Rules → **Process Rules** | Regeln → **Prozessregeln** |

The menu item and the screen's heading both read the key, so both change.
The two AP Setup notes that send the reader to a stage's *Rules screen*
now say *Process Rules screen* (*Prozessregeln-Ansicht*). Nothing else in
the interface names either screen.

## Verification

- **`vf-licence`**, `menu-renames.test.ts`, 1 test: both names in English
  and German, and the AP Setup note following. Full run 358 of 358.
- **Migrations** replay: `vf-licence` 252, its assertions holding.
- The `vf-ui` browser tests stub their own strings, so are unaffected.

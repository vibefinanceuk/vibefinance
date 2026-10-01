# 0590: The Route library's layout, from Dan's first look

**Status: built and tested locally, not yet pushed or deployed.** `vf-ui`
only. There are no migrations.

## What was asked

Dan deployed the Route library (0589) on 1 October and sent a
screenshot. He asked for three changes:

1. *"The Library cards are full width, but in the mock-up they are much
   narrower. Perhaps share the screen width with 3 or 4 cards."*
2. *"Please can you put the 'Add to my routes' icon in the top right of
   each card, so that it is consistent with other cards."*
3. *"Please can the Route Library icon be moved to the button panel at
   the top of the screen, separated by a short horizontal line. Similar
   to the Dashboard screen which has an arrange button."*

On (1): his screenshot showed no library styling at all, not even the
initials boxes or the grid. Rendered here in the full app shell, the
cards were already three across. So his browser most likely still held
the previous `app.css`. A hard refresh (Cmd+Shift+R) picks up the new
one. The layout below is still the one he asked for.

## What was decided

1. **Four cards across** on a wide screen, then three below 1600px, two
   below 1150px and one below 720px. These are fixed columns, rather than
   as many as fit, so the count is predictable.
2. **Add to my routes is top right of each card**, in its head beside the
   name, with the icon above the label, as on every other card. It is no
   longer in the card's foot, which keeps Available, In use or Planned.
   Planned connectors have no button.
3. **The Route library button is in the Routes screen's top-right
   buttons**, through `topbar()`'s `right`, as Dashboard's Arrange is. It
   sits left of Night/Day, with the short divider between. It has its own
   icon, `library`, books on a shelf.

## Verification

- **`vf-ui`**, `routes.test.ts`:
  - the library test now checks Add to my routes is in the card's head
    and not its foot; the two add tests click it there;
  - 1 new test: the Routes screen's top-right buttons start with Route
    library, followed by the divider, and it opens the library.

  4 fail against the interface before this change. 34 of 34 in the file.
  Full browser suite: 1417 of 1418 (the known `typography.test.ts` 10px
  gap).
- A screenshot at 2000px wide, in the full app shell, shows four across.

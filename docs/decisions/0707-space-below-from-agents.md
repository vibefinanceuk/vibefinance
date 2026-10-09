# 0707: A space between From agents and the Tasks search bar

**Status: built**, not yet pushed. vf-ui `app.css` only.

Dan, 9 October 2026, with a screenshot: *"please could you create a small space
between the From Agents card and the Invoice search bar?"*

**Why they touched.** Every panel has a 14px bottom margin (0178), and the last panel
in a column has none (`.panel:last-child`). The From agents card (0622) and the
Conversations card (0660) are each drawn inside a holder of their own (`#agentnotes`,
`#receiptconversations`), so each was the last child of its holder and lost its
margin.

**Now** the holders carry the stack's usual 14px while shown. Hidden (no notes, no
conversations), they take no space, as before.

Checked: the typography and Tasks tests (only the existing 10px chip failure).

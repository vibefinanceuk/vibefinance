-- 0163_credit_notes.sql — decision 0731.
--
-- What happens to the invoice a credit note credits, configured in AP
-- Setup › Credit Notes, and what did happen, one row per credit note.

CREATE TABLE credit_note_config (
  id               TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  -- A credit note for an unpaid invoice in full: 'take_out' (Credited at once) or 'confirm'.
  full_unpaid      TEXT NOT NULL DEFAULT 'confirm' CHECK (full_unpaid IN ('take_out', 'confirm')),
  -- For part of an invoice: 'pay' (the ERP nets it) or 'hold' until AP confirms.
  partial          TEXT NOT NULL DEFAULT 'pay' CHECK (partial IN ('pay', 'hold')),
  -- No invoice found: 'review' (AP finds it) or 'process' as it is.
  not_found        TEXT NOT NULL DEFAULT 'review' CHECK (not_found IN ('review', 'process')),
  -- Who confirms: the team's members (NULL: anyone with Admin.Configure).
  confirm_team_id  TEXT REFERENCES org_teams(id),
  -- Suppliers may raise credit notes in the network (step 3).
  network_allowed  INTEGER NOT NULL DEFAULT 1,
  updated_by       TEXT,
  updated_at       TEXT
);
INSERT INTO credit_note_config (id) VALUES ('default');

CREATE TABLE credit_notes (
  credit_note_id TEXT PRIMARY KEY REFERENCES invoice_headers(id),
  -- BT-25 as the document gave it; the invoice found by it, if any.
  reference      TEXT,
  invoice_id     TEXT REFERENCES invoice_headers(id),
  -- 'full' or 'partial' of that invoice; NULL when none was found.
  covers         TEXT CHECK (covers IN ('full', 'partial')),
  -- 'credited': the invoice is Credited; 'netted': it goes on to be paid, the ERP nets
  -- the credit; 'to_confirm': waiting for AP; 'unmatched': processed against no invoice.
  state          TEXT NOT NULL CHECK (state IN ('credited', 'netted', 'to_confirm', 'unmatched')),
  -- The invoice had already gone for payment when the credit note came.
  after_payment  INTEGER NOT NULL DEFAULT 0,
  decided_by     TEXT REFERENCES org_users(id),
  decided_at     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX credit_notes_invoice ON credit_notes(invoice_id);

-- ASSERT: SELECT count(*) FROM credit_note_config == 1
-- ASSERT: SELECT count(*) FROM credit_notes == 0

-- 0040_source_status.sql
-- Decision 0130 — retiring a source, and why deleting one is usually
-- wrong.
--
-- **A document records the source's NAME, not its id.**
-- `mandate.channel` is set from `source.name` at capture (decision
-- 0060), it is a field in the closed vocabulary, and customers write
-- rules against it: *"if mandate.channel is 'AP Mailbox' then..."*.
--
-- So a source is not a row that can simply be removed:
--
-- * **Every invoice that arrived through it** carries its name, and a
--   report grouping by channel would show a name nothing explains.
-- * **Rules reference that name**, and would go on referencing it —
--   silently never firing, which decision 0113 records as the worst
--   kind of rule failure because it looks correct in every listing.
-- * **An issued email address** may be written in a supplier's ERP.
--   Deleting the source does not stop them sending.
--
-- The same reasoning as decision 0078: discarding a document archives
-- it, because a record that says somebody did something is worse than
-- one that says nothing.
--
-- **Deletion is still allowed where it is genuinely harmless** — a
-- source created by mistake, through which nothing has ever arrived and
-- which was never given an address. That case is a correction rather
-- than a change of history, and the route decides which it is.
ALTER TABLE sources ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'retired'));

-- When it stopped accepting documents, and who stopped it.
ALTER TABLE sources ADD COLUMN retired_at TEXT;
ALTER TABLE sources ADD COLUMN retired_by TEXT REFERENCES org_users(id);

-- Point-in-time: nothing is retired yet.
-- ASSERT: SELECT count(*) FROM sources WHERE status != 'active' == 0

-- Standing invariant: a retired source says when and by whom.
--
-- **One without the other is worse than neither.** A retirement nobody
-- can date, or a date attributed to nobody, is a change to how a
-- customer receives invoices with no account of who made it.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE status = 'retired' AND (retired_at IS NULL OR retired_by IS NULL) == 0

-- Standing invariant: an active source claims neither.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE status = 'active' AND (retired_at IS NOT NULL OR retired_by IS NOT NULL) == 0

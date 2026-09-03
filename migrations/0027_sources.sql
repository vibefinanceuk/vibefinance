-- 0027_sources.sql
-- Decision 0060 — sources become their own thing.
--
-- intake_channels has been carrying two jobs. Its rows are arrival
-- points: process-bound, named, receiving whatever a supplier sends.
-- The real customer's only channel, "New Supplier Integration", has
-- taken images, hybrid PDFs and UBL alike.
--
-- But "intake channel" now means a structural handler -- the thing
-- that reads XML, or a PDF/A container, or an image -- selected by
-- detecting what actually arrived. Those are opposite ends of the
-- pipeline sharing one name, and decision 0055 section 2.5 recorded
-- the collision rather than resolving it.
--
-- This resolves it in the direction the operator settled: intake
-- channels are per-process STRUCTURAL handlers, so what needs a new
-- home is the source.
--
-- Deliberately additive. Nothing is dropped, no foreign key moves, and
-- intake_channels is untouched -- because a source row and a
-- structural-channel row are different things and the existing rows
-- are the former. A later migration gives intake_channels its
-- structure column, once every arrival point has a source to be.
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  -- A source feeds exactly one process (decision 0055 section 4).
  -- Classification comes from this binding rather than from the facts:
  -- a customer genuinely controls which address they give which
  -- counterparty, where they cannot reliably assert what structure a
  -- document will have.
  process_id   TEXT NOT NULL REFERENCES processes(id),
  -- The instance name, not the mechanism type. "AP mailbox" and "AR
  -- mailbox" are both email, and a report collapsing them to "email"
  -- answers nothing useful (decision 0055 section 11).
  name         TEXT NOT NULL,
  -- The transport. A closed set: unlike mandate.channel, which is
  -- deliberately a free string, this one is a real enum because the
  -- system has to know how to talk to it.
  mechanism    TEXT NOT NULL CHECK (mechanism IN ('email', 'https', 'sftp', 'file_import', 'edi')),
  -- Where an existing intake_channels row was migrated from, so
  -- historical mandate.channel values remain resolvable. NULL for a
  -- source created directly.
  legacy_channel_id TEXT REFERENCES intake_channels(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (process_id, name)
);

CREATE INDEX idx_sources_process ON sources(process_id);

-- Backfill: every existing intake_channels row IS an arrival point, so
-- each becomes a source. 'https' because that is what they genuinely
-- are today -- every capture route is an HTTP endpoint, and recording
-- them as email or SFTP would assert a transport nobody configured.
--
-- The id is deliberately the SAME as the channel it came from. A new
-- id would strand every stored mandate.channel value, and reusing it
-- means existing provenance keeps resolving with no data migration at
-- all.
INSERT INTO sources (id, process_id, name, mechanism, legacy_channel_id)
SELECT id, process_id, name, 'https', id FROM intake_channels;

-- Point-in-time: the backfill left no channel without a source. Stated
-- this way rather than as a count comparison, because the replay runs
-- against a throwaway database with no rows -- where a count check is
-- vacuously true and proves nothing, while this holds meaningfully on
-- both an empty schema and the real customer's populated one.
--
-- Point-in-time rather than ALWAYS on purpose: once intake_channels
-- becomes structural handlers, a channel legitimately will NOT have a
-- source. This is true at the moment of the backfill and is not a
-- standing property.
-- ASSERT: SELECT count(*) FROM intake_channels WHERE id NOT IN (SELECT id FROM sources) == 0

-- Standing invariant: every source names a real process. The FK
-- enforces it; restated so the replay runner reports it directly,
-- matching every other table here.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE process_id NOT IN (SELECT id FROM processes) == 0

-- Standing invariant: the mechanism stays inside the closed set. The
-- CHECK enforces it at write time; restated so a future change that
-- drops the constraint is caught on the next replay rather than
-- silently permitting 'emial'.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE mechanism NOT IN ('email', 'https', 'sftp', 'file_import', 'edi') == 0

-- Standing invariant: a source always has a name. An unnamed arrival
-- point cannot be reported on, which is most of what a source is for.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE trim(name) = '' == 0

-- Standing invariant: a legacy reference, where present, points at a
-- real channel. A dangling one would mean historical mandate.channel
-- values resolve to nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE legacy_channel_id IS NOT NULL AND legacy_channel_id NOT IN (SELECT id FROM intake_channels) == 0

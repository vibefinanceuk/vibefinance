-- 0028_intake_channel_structure.sql
-- Decision 0061 — intake channels become structural handlers.
--
-- Decision 0060 gave arrival points their own table. This gives intake
-- channels the thing that makes them what decision 0055 says they are:
-- a per-process handler for ONE document structure, selected by
-- detecting what actually arrived.
--
-- Per process rather than shared, because mapping rules are tailored
-- to a process: an AR invoice and an expense receipt want different
-- mappings from the same XML structure.
--
-- The awkward row is the existing one. 'New Supplier Integration' has
-- received images, hybrid PDFs and UBL alike, so it has no single
-- structure -- it was an arrival point, and decision 0060 already made
-- it a source. It is left with a NULL structure and the name says why:
-- a legacy channel, superseded, retired once capture addresses sources
-- rather than channels.
--
-- NULL rather than a guess. Picking one structure for it would assert
-- something false about a row that genuinely handled three.
ALTER TABLE intake_channels ADD COLUMN structure TEXT
  CHECK (structure IS NULL OR structure IN ('structured_xml', 'structured_pdfa', 'image'));

-- Uniqueness on (process_id, structure) is what lets detection choose
-- exactly one channel per structure. It is a partial index rather than
-- a table constraint for a specific reason: SQLite treats NULLs as
-- distinct in a UNIQUE, so a plain constraint would silently permit
-- any number of NULL-structure rows per process while appearing to
-- forbid duplicates. Excluding NULL makes the guarantee real for every
-- row it is supposed to cover, and honest about the legacy rows it is
-- not.
CREATE UNIQUE INDEX idx_intake_channels_process_structure
  ON intake_channels(process_id, structure)
  WHERE structure IS NOT NULL;

-- Seed a full set of structural channels for every process that has an
-- intake channel today. Without these, giving channels a structure
-- would leave no channel able to handle anything.
--
-- Named for what they are rather than for a customer's own naming: a
-- structural channel is platform machinery, not a label anyone chose.
INSERT INTO intake_channels (id, process_id, name, structure)
SELECT DISTINCT process_id || '-xml', process_id, 'Structured XML', 'structured_xml'
FROM intake_channels WHERE structure IS NULL;

INSERT INTO intake_channels (id, process_id, name, structure)
SELECT DISTINCT process_id || '-pdfa', process_id, 'Structured PDF/A', 'structured_pdfa'
FROM intake_channels WHERE structure IS NULL;

INSERT INTO intake_channels (id, process_id, name, structure)
SELECT DISTINCT process_id || '-image', process_id, 'Image', 'image'
FROM intake_channels WHERE structure IS NULL;

-- Point-in-time: every process that had a channel now has all three
-- structural channels. Stated as a count of MISSING combinations
-- rather than a total, so it holds on an empty replay database and
-- meaningfully on a populated one alike.
-- ASSERT: SELECT count(*) FROM (SELECT DISTINCT process_id FROM intake_channels) p CROSS JOIN (SELECT 'structured_xml' AS s UNION SELECT 'structured_pdfa' UNION SELECT 'image') x WHERE NOT EXISTS (SELECT 1 FROM intake_channels c WHERE c.process_id = p.process_id AND c.structure = x.s) == 0

-- Standing invariant: the structure stays inside the closed set. The
-- CHECK enforces it at write time; restated so a future change that
-- drops the constraint is caught on the next replay.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE structure IS NOT NULL AND structure NOT IN ('structured_xml', 'structured_pdfa', 'image') == 0

-- Standing invariant: no process has two channels for one structure.
-- The partial index enforces it; restated because this is the property
-- detection depends on, and a silent violation would mean detection
-- picking arbitrarily between two candidates.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT process_id, structure, count(*) AS n FROM intake_channels WHERE structure IS NOT NULL GROUP BY process_id, structure HAVING n > 1) == 0

-- Standing invariant: a structural channel always belongs to a real
-- process. The FK enforces it; restated to match every other table.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE process_id NOT IN (SELECT id FROM processes) == 0

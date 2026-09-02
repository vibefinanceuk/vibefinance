-- 0019_custom_fields.sql
-- Decision 0041 — customer-defined fields, and typed vocabulary.
--
-- The closed vocabulary stays closed. It becomes closed PER CUSTOMER
-- rather than closed globally: a customer declares a field once, as a
-- real, named, typed entity, and it joins their own vocabulary.
-- Every property that makes the rule engine safe survives — a rule
-- can still only reference declared fields, validateRule() still
-- refuses anything outside the set, and the compiler's prompt still
-- receives a finite, authoritative list.
--
-- Lives in vf-app's own database, not vf-licence's: these are a
-- customer's own configuration, exactly like rule_sets and
-- intake_channels, never control-plane data. And per decision 0041,
-- fields are declared per ENVIRONMENT — a sandbox is genuinely
-- separate infrastructure (decision 0036), and a customer
-- experimenting in sandbox must not silently alter production
-- behaviour. Since each environment has its own database, that
-- separation is structural here, not a column.
CREATE TABLE custom_fields (
  -- The stable identifier rules reference, e.g.
  -- "custom.transport_reference". System-generated from the label
  -- (deriveCustomFieldKey), never customer-typed: avoids collisions,
  -- invalid characters, and two customers' rules being subtly
  -- incompatible in ways nobody notices. Immutable once created --
  -- the label can be edited, this cannot.
  key          TEXT PRIMARY KEY,
  -- What a human calls it. Editable, and deliberately not unique:
  -- two labels that collapse to the same key are refused by the key's
  -- own primary-key constraint, which is the check that matters.
  label        TEXT NOT NULL,
  -- Not decoration. The interpreter is already strictly type-aware at
  -- runtime: greater_than returns false unless BOTH sides are
  -- genuinely numbers. A field extracted as the string "12345" and
  -- compared with greater_than produces a rule that silently never
  -- fires -- no error, no refusal, nothing to investigate. Declaring
  -- the type is what lets validateRule() refuse that at COMPILE time.
  type         TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'boolean')),
  -- What the extraction model is told to look for. The field's real
  -- payload: a vague description produces vague extraction. Also
  -- rendered into the compiler's prompt, so a rule author sees the
  -- same description the extractor works from.
  description  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM custom_fields == 0

-- Standing invariant: every key carries the custom. namespace. This
-- is what guarantees a customer-defined field can never collide with
-- a BT- or BG- Business Term (now, or as EN 16931 evolves) or with an
-- expense field -- and makes a custom field visibly customer-defined
-- wherever it appears.
-- ASSERT ALWAYS: SELECT count(*) FROM custom_fields WHERE key NOT LIKE 'custom.%' == 0

-- Standing invariant: a key is never just the bare prefix. An empty
-- label, or one made entirely of punctuation, would derive to
-- "custom." with nothing after it -- a field nobody could reference
-- meaningfully.
-- ASSERT ALWAYS: SELECT count(*) FROM custom_fields WHERE key = 'custom.' == 0

-- Standing invariant: the declared type is always one the interpreter
-- and OPERATORS_BY_TYPE both understand. Enforced by CHECK at write
-- time too; stated here as a fact the runner re-checks on every
-- replay, independent of whether a future change ever drops the
-- constraint.
-- ASSERT ALWAYS: SELECT count(*) FROM custom_fields WHERE type NOT IN ('text', 'number', 'date', 'boolean') == 0

-- Standing invariant: never an empty label or description. An empty
-- description is the more consequential of the two -- it is what the
-- extraction model is told to look for, so a blank one produces a
-- field that cannot be extracted and a prompt that says nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM custom_fields WHERE trim(label) = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM custom_fields WHERE trim(description) = '' == 0

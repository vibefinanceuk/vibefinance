# 0035 — R2 document storage: real, tested upload and retrieval

Status: settled, 2 September 2026. Extends decision 0013's own R2
design — the first piece of it to move from design-only to real,
tested code, and decision 0033's own precedent (`r2_jurisdiction`) for
what's genuinely buildable ahead of a live bucket existing.

## A real capability discovered before building anything

Confirmed directly against Cloudflare's own current documentation and
a real community example, not assumed: Miniflare (the same local
runtime that has given this project real, tested D1 the entire time)
also simulates R2 locally, with genuine `put()`/`get()` working
against it — no live Cloudflare credentials needed, unlike the `ai`
binding's own documented exception. Verified directly with a minimal
sanity test before committing to the larger build. This changed the
real scope of what this session could do: not just schema, but real,
tested upload/retrieval application code.

## A real design refinement over decision 0013's original sketch

Decision 0013 originally proposed the R2 key reference living on
`invoice_runs`. Confirmed explicitly in conversation rather than
carried forward unquestioned: a new, separate table instead —
`invoice_documents` — because a single invoice can genuinely have more
than one real stored document. A pure UBL/XML invoice (no native
document at all) retains both the raw XML itself and a separately
generated, human-readable PDF rendering — two real documents, one
invoice. `UNIQUE(invoice_id, document_type)` enforces this precisely:
at most one `original` and one `generated_rendering` per invoice,
matching all three of decision 0013's own document cases exactly.

## What's real and tested here

- `migrations/0018_invoice_documents.sql` — the table above. All three
  real invariants (the closed `document_type` set, the foreign key to
  `invoice_headers`, the per-invoice-per-type uniqueness) proven
  directly at the constraint level, not just asserted in a comment.
- `document-storage.ts` — `computeDocumentKey()` (the real
  `{customer}/{year}/{invoice_id}.{ext}` structure, year derived from
  the invoice's own issue date where available), `storeInvoiceDocument()`,
  `retrieveInvoiceDocument()`. R2 upload happens before the D1
  reference is written, deliberately — proven directly with a bucket
  that deliberately fails: reversing the order was confirmed to leave
  a real, dangling D1 reference to an object that was never actually
  stored, before the correct ordering was restored.
- `document-route.ts` and the wired-in `POST`/`GET /invoices/:id/document`
  routes — real HTTP handlers, tested by calling them directly with an
  explicit `customerId` rather than through the shared test
  environment's `SELF.fetch`, matching every other route's own test
  pattern in this project (`wrangler.test.jsonc` deliberately has no
  `vars` block, confirmed by an existing, intentional test elsewhere
  in `index.test.ts` — adding `CUSTOMER_ID` there to suit this feature
  alone would have silently broken that test's own coverage).

## A real architectural gap caught before it became a real problem

`env.DOCUMENTS` is genuinely tenant-scoped data — one bucket per
customer, decision 0013's own design, the same category `env.DB` is
already protected as. `shared/tenant.ts`'s `resolveTenant()` now
returns `documents` alongside `db`, and `DOCUMENTS` was added to
`eslint.config.js`'s `no-restricted-properties` banned-bindings list —
the same structural protection D1 has always had, extended to R2
before any route had a chance to reach for `env.DOCUMENTS` directly.
`documents` is genuinely optional on `TenantContext`, unlike `db`: an
existing customer's Worker may not have this binding configured yet,
which is a real, ordinary state, not a misconfiguration.

## A real, honest testing-infrastructure finding

Miniflare's local R2 simulation is not reset between individual test
cases within the same file the way D1 is via `applyTestSchema()`'s
explicit table-dropping. Found live, writing a test that asserted the
whole bucket was empty after a refused upload — it wasn't, because an
earlier, unrelated test in the same file had already written an
object. Fixed by asserting on the specific key a given test's own
upload would have used, not the bucket's total contents — a more
precise, and more correct, assertion regardless of the isolation
question. Worth keeping in mind for any future R2 test that's tempted
to assert on aggregate bucket state.

## What still requires the operator, and is stated honestly as such

- Actual bucket creation (`wrangler r2 bucket create`) — real
  Cloudflare credentials this session doesn't have.
- R2's own native lifecycle/retention configuration against a real
  bucket — decision 0013's own stated position remains unchanged:
  never a hardcoded retention period without real legal review.
- The real `wrangler.jsonc` binding now has a clear placeholder
  (`REPLACE_WITH_REAL_BUCKET_NAME`) with explicit setup instructions
  in its own comment — the bucket must be created and the placeholder
  replaced before this Worker's next real deploy, or that deploy will
  fail.

## What's still open

- Wiring this into the real `capture-xml` intake path — deliberately
  deferred. Discussed explicitly: the real trade-off is automatic,
  reliable archival against a new failure-mode question (what happens
  when parsing/workflow succeeds but the R2 upload fails) that
  shouldn't be answered implicitly. Standalone first, proven, before
  that coupling.
- Who generates the `generated_rendering` PDF for a pure-XML invoice —
  a real, separate piece of work (something has to actually render a
  human-readable document from structured facts), not solved here.
- Real content-type/extension detection is a small, honest heuristic
  (`extFromContentType`) — good enough for the common real cases
  (PDF, XML, JPEG, PNG), with a generic `.bin` fallback rather than
  guessing wrong for anything else.

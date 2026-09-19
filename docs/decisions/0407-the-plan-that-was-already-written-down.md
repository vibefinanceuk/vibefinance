# 0407 — The plan that was already written down

**Status: investigated, deliberately not built. Recorded so it isn't
lost a second time.**

---

## What was asked

Right after decision 0406 shipped: *"we had previously discussed
rendering invoices as a document, rather than HTML, so that they can
be treated like other images."* Not visible in this session's own
context — a genuine risk that the reasoning behind 0406's iframe
branch would stand unchallenged as if it were the real answer, when
the operator remembered a different, earlier plan.

---

## The investigation

It wasn't a lost conversation. It was already written down, twice,
before decision 0205 ever built anything:

- **Decision 0013's addendum** (31 August): *"Generate a PDF rendering
  from the invoice's structured facts, then store that the same way"*
  — `generated_rendering` was designed as a PDF from the start, stored
  at `{customer}/{year}/{invoice_id}.pdf`, alongside the two other
  document cases (native original, hybrid Factur-X).
- **Decision 0035** (2 September), building the `invoice_documents`
  table that shape assumes: *"Who generates the `generated_rendering`
  PDF for a pure-XML invoice — a real, separate piece of work... not
  solved here."* Left open on purpose, technology deliberately not
  speculated on.

Decision 0205 built HTML instead — for a real reason, not an oversight:
SaxonJS (the only viable XSLT 2.0 processor, the natural route to a
faithful PDF) throws `ReferenceError: abstractNode is not defined` on
import in `workerd`, proven directly rather than assumed. But 0205
never revisited the PDF plan on the page when it made that call — the
document type just quietly became HTML, and nothing since has said so
in one place. Decision 0406 then built an iframe branch to display
that HTML correctly, which is a real fix for a real bug, but not a
return to the original plan — it's a second special case sitting on
top of the first one.

**One more thing worth finding while looking**: decision 0206 already
built correct print pagination for this exact HTML — `@page { size: A4
portrait }`, `break-inside: avoid` on line rows and headings — sitting
unused in an `@media print` block, because nothing has ever printed or
PDF'd this rendering. Any future PDF step that prints this HTML gets
that pagination for free, for exactly the reason 0206 built it.

---

## The real choice, laid out and not decided here

Two genuinely different ways to get from today's HTML to a real PDF:

- **Cloudflare Browser Rendering** (`@cloudflare/puppeteer` + a
  `browser` binding) — print the existing HTML to PDF with
  `page.pdf()`. Reuses 0205/0206/0405 unchanged, inherits 0206's
  pagination rules automatically. Requires enabling the product on the
  account and wiring a live binding — this session has no credentials
  to provision or test that end to end, the same limitation already
  true of the `AI` binding in `vf-app`'s own `wrangler.jsonc`. Real
  per-render Cloudflare cost.
- **A pure-JS layout library** (e.g. `pdf-lib`), building the PDF
  directly from the structured facts already in `invoice_headers`/
  `invoice_lines` — no browser, no new Cloudflare product, fully
  testable locally the way `peppol-render.ts` is today. The cost is
  duplication: the invoice's layout gets built a second time in a
  different API, with no shared code with the HTML rendering, and two
  renderings that can drift.

Asked directly. **The operator's answer: stop here for now.** Decision
0406's iframe fix stands as the real, working answer for the moment —
correct today, not a dead end, and not mistaken for the destination.
This record exists so the next time this comes up, the plan and the
trade-off are in one place rather than remembered piecemeal.

---

## What is not built

Everything in "the real choice" above — no PDF generation, no new
binding, no `pdf-lib` dependency. `peppol-render.ts` and `viewer.js`
are both untouched by this decision.

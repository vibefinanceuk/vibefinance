# VibeFinance — conversation export

From "can cloudflare and d1 be run locally within a customers own
infrastructure" to the present. Exported 29 August 2026.

---

## About this export — please read first

**The questions are verbatim. Not all of the answers are.**

This session ran out of context part-way through and was compacted, which
means the earlier exchanges were replaced in working memory by a summary
and are no longer on disk. I checked: the stored transcript begins at
16:54 on 29 August, at the compaction point. Everything before it — the
whole architecture conversation below — exists now only as (a) your own
messages, which the summary preserved word for word, and (b) the
**VibeFinance Blueprint artifact**, which was the running output of that
conversation and was updated after almost every exchange.

So Part 1 is honest rather than complete: **your questions are verbatim,
and my answers are reconstructed** from the blueprint, marked as such.
They record what was concluded, not the wording it was concluded in.
Where the blueprint states a decision, the reconstruction is reliable;
where the conversation wandered before settling, that texture is gone.

**Part 2 is verbatim on both sides** — those exchanges happened after the
compaction and are recovered directly from the session transcript.

The authoritative artefact remains the blueprint itself. This export is a
record of the path; the blueprint is the destination.

---

# Part 1 — the architecture conversation (reconstructed answers)

## 1.

**Dan:** *"can cloudflare and d1 be run locally within a customers own infrastructure"*

**Reconstruction.** Not in the way the question implies. Cloudflare
Workers and D1 are managed services on Cloudflare's network, not
installable software. What exists locally is `workerd`, the open-source
runtime that Workers execute on, and `wrangler dev`'s local mode, which
runs a SQLite-backed D1 emulation — both are development tools rather
than a supported way to run production inside somebody else's data
centre. There is no on-premises Cloudflare distribution to license.

The practical answer for a customer who says "it must run in our
infrastructure" is that they run it in **their own Cloudflare account**
rather than yours, which gives them ownership, billing, access control
and residency configuration under their own contract. That satisfies most
of what procurement is actually asking for.

## 2.

**Dan:** *"The questions is in the context of a new application I would like to build... I wondered to what extent a solution built for cloudflare and D1 could be migrated to other platforms."*

**Reconstruction.** Portability comes down to how much of the platform you
let into your code. The Worker request/response shape is close to web
standards and ports reasonably; D1 is SQLite over a proprietary binding
API, so the SQL travels and the access layer does not. R2 is S3-compatible
and is the least locked-in piece. Durable Objects and Workers KV are the
most locked-in and were kept out of the design partly for that reason.

The mitigation adopted: keep every platform touch behind a narrow
interface, keep the schema portable SQLite, and treat self-hosting as an
**exit guarantee** — something you can honestly promise in a contract —
rather than as a product you support two ways.

## 3.

**Dan:** *"Because this idea will be my own business venture (VibeFinance), form a support and maintenance perspective, as the company will run light in terms of resources (i.e. only me to start with), I consider a move that requires a customer to manage, monitor and maintain the infrastructure important. As I would not be able to do that myself. I can asset that cloudflare and D1, must be used - but equally, if the customer has their own platform standard, I did not want to restrict them using their own."*

**Reconstruction.** This is the message that set the constraint the whole
blueprint is written against, and it is recorded there as such:
**VibeFinance is a one-person company, and support cost — not build cost —
is the binding constraint.** Several decisions in the document look
over-cautious until read as protecting a single operator's attention.

The resolution: mandate Cloudflare and D1 as the stack, but allow the
instance to live in the customer's own account when their platform
standard requires it. Same build, same migrations, different account —
which keeps one codebase while letting the customer carry the
infrastructure. Self-hosting on another platform stays an exit guarantee,
not a supported second configuration.

## 4.

**Dan:** *"So one D1 instance per customer to seperate data. Would separate workers also be recommended? Each customer would have a different configuration of the technology."*

**Reconstruction.** Yes, and largely because you have no choice: **D1
bindings are declared statically, so a Worker cannot select a different
customer's database per request.** One database per customer therefore
implies one Worker per customer. The blueprint records this as a settled
decision — "one instance per customer per region" — and rules out the
alternative it replaces: a shared multi-tenant schema with a customer
column.

The ceilings are asymmetric and worth remembering: **500 Workers per paid
account against 50,000 D1 databases.** Workers are the scarce resource,
which is why the design spends databases freely and Workers carefully.

## 5.

**Dan:** *"Different features could be enabled per customer, most definitely their sso and ERP will also be different. Wthin the product we / they would create business rules using AI natural language to enact different procedures and outcomes on invoices that are processed. So that configuration could be held in D1 tables, but the execution of those configurations is what I'm unsure of. separate code bases, or single code bases? I think you answered that question above."*

**Reconstruction.** Single codebase, without qualification. The blueprint's
opening line is the answer: **one repository, one `main`, one build
artefact, many deployments.** Everything that differs between customers is
a row in their database or a variable in their config — never a branch,
never a file only one customer runs. Forks are what end small software
companies rather than merely inconveniencing them, and a security fix has
to be one merge.

On executing customer-authored rules, this produced the design's central
idea: **AI at authoring time, deterministic interpretation at execution
time.** A customer describes a rule in their own words; a model compiles
that sentence into a constrained declarative structure; the structure is
stored as rows; at invoice time one shared interpreter reads the rows and
executes them. The natural language is input to a compiler, never a
runtime.

Both alternatives fail. Generating code per customer is the fork problem
wearing a new hat, except now nobody has read the forks — and it means
running untrusted code inside your Worker, which Cloudflare explicitly say
`workerd` alone is not hardened for. Calling a model per invoice is worse
for a domain where the same invoice must produce the same outcome twice.

The vocabulary is closed by design: a fixed catalogue of fields, a fixed
set of operators, a fixed list of actions, bounded nesting depth. The
compiler can only ever emit something the interpreter already runs, and
refusal is a first-class output.

## 6.

**Dan:** *"Yes please - I'd also like a centrally managed licensing and reporting capability, so that I would be able to service subscription payments, check for customer kpi, volume throughputs (anonymously) and validate against licensing. I would also like a framework for product translations, and whitelabeling (reskin) as we have achieved in the compliance corner."*

**Reconstruction.** This added three sections to the blueprint.

**The control plane** lives in your own account and holds customers,
entitlements and payment state. Customer instances never talk to the
payment provider; they fetch a signed licence and push counts. Feature
availability is licence data, not code — which is what lets one build
serve every plan.

**Translations** follow the Compliance Corner model: product strings in
the repository, English as source, one file per language per namespace;
customer-specific wording in their own database as overrides, because a
white-labelled deployment will want "vendor" for "supplier" and "bill" for
"invoice". Resolution order is customer override, then shipped
translation, then English — substituted **server-side, before the response
leaves the Worker**, because client-side substitution alone means anything
that does not run JavaScript sees English. That was the defect that took
two rounds to find on the Compliance Corner and was invisible to every
module-level test.

**White-labelling** is the palette as table rows, one custom property per
row, with components reading properties and never naming a colour — plus
four rules already paid for: every brand clears every contrast floor
before registration (a partner's own colours on a dark ground produced an
alert pill at 2.08:1 against a 3:1 floor, on the colour that says a
penalty applies); size a logo as a box, not a width; apply the theme
before first paint; and never lower a floor to admit a brand.

## 7.

**Dan:** *"separate database for AP automation and AR automation combined in customer database"*

**Reconstruction.** Recorded as settled: **AP and AR share one database per
customer.** The reasoning is that D1 has no cross-database joins or
transactions, and the two sides share nearly all master data — parties,
units, users, authority, rules. Splitting them means reimplementing joins
in application code for no isolation benefit, since both halves belong to
the same customer anyway. The register explicitly rules out both separate
AP/AR databases and `ap_invoices` / `ar_invoices` tables.

## 8.

**Dan:** *"each customer with their own D1"*

**Reconstruction.** Confirmed as the tenancy model, and the point at which
"one instance per customer" became the fixed axis of the architecture
rather than one option among several. Cloudflare's own documentation
describes per-user, per-tenant, per-entity databases as what D1 is
designed for — horizontal scale-out across many small databases rather
than one large one — so this is the sanctioned pattern rather than a
workaround.

## 9.

**Dan:** *"license server is passive, and functionalities continue with the option to block centrally as a hard stop when customer does not pay"*

**Reconstruction.** Recorded as settled, and the principle behind it is
sharper than the instruction: **being unable to reach the licence server
and failing to pay are different events, and only the second may ever
change behaviour.** Silence means carry on, indefinitely. A suspension
arrives as a positive, signed, dated instruction — never as the absence of
one — so your own outage can never become the customer's outage, and there
is a real artefact to test against.

Mechanically: a short signed token carrying customer, plan, features,
entitlement and expiry, signed with a key whose public half is baked into
the build. The instance fetches it on a schedule, caches it in its own
database and verifies it locally on every request. No network call in the
hot path.

A hard stop is staged rather than switched — notice, notice with a date,
then restriction — and is **read-only, not lights out**: new processing
stops, in-flight work finishes, everything stays readable, export keeps
working. Withholding data is never on the table, and not only for
decency's sake: a customer who cannot issue or report an invoice may miss
a statutory deadline, and being the cause of that is a worse position than
being unpaid.

## 10.

**Dan:** *"the internal handling of invoices within the solution, should be based on the specification of peppol biz 3.0 - https://docs.peppol.eu/poacc/billing/3.0/"*

**Reconstruction.** Adopted as the internal representation: the **EN 16931
semantic model as profiled by Peppol BIS Billing 3.0, bound to UBL 2.1**,
covering Invoice and Credit Note — not a bespoke schema that happens to
map to it.

Two arguments carried it. Rules become addressable in a vocabulary the
customer's tax adviser, ERP vendor and auditor already share — *when BT-48
is absent and BT-40 is outside the EU, route to tax review* reads the same
to all four parties. And validation stops being your problem: Peppol
publish the Schematron, so you inherit a conformance suite you did not
write and can say on day one that you validate against the official rules.

## 11.

**Dan:** *"Does R2 have the same ceiling cap as D1?"*

**Reconstruction.** No — the shapes are quite different. D1 caps a single
database at **10 GB, which cannot be raised**, with 50,000 databases per
paid account. R2 has no per-bucket size ceiling and allows up to 1,000,000
buckets. So the storage strategy writes itself: D1 holds structured data
and nothing large; R2 holds anything that grows without bound.

Jurisdictions differ too. D1 offers `eu` and `fedramp` only, with location
hints (`wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`) documented as **best
effort and explicitly not a guarantee**. R2 offers EU, US and FedRAMP.
**Neither offers a UK option**, which is recorded in the blueprint as an
open question to put to Cloudflare.

## 12.

**Dan:** *"Yes - R2 holds the original XML, PDFs, attachments, archived logs. For customers who are multinational, i.e. operating in US and UK, they could have multiple D1 buckets instantiated to serve local compliance needs in terms of data residency"*

**Reconstruction.** This produced the "customer × region" unit. A customer
operating in two jurisdictions gets **a database and a bucket in each**,
both set at creation from the same value in the control plane.

The warning attached to it matters more than the structure: **both are
one-way doors.** Neither D1 nor R2 lets a jurisdiction be changed
afterwards. A database in the EU beside a bucket that is not is a
residency split that fails the first review to look for it and cannot be
repaired without recreating and re-uploading everything.

## 13.

**Dan:** *"The impact of this decision is that minimally D1 per customer, but potentially multiple D1 per customer if operating in multiple geographies."*

**Reconstruction.** Correct, and the arithmetic is comfortable in the
direction that counts. Databases are cheap (50,000 available) and Workers
are not (500), so the design became **one Worker per customer holding a
binding per region**, rather than a Worker per region. A three-region
customer costs three databases and one Worker.

## 14.

**Dan:** *"I think workers can execute anywhere. Customers are only ever concerned for data residency, not execution residency"*

**Reconstruction.** You were right and I had over-specified. I had written
"one Worker per region" into the blueprint on an assumption about
execution locality that customers do not actually make; the correction
went in immediately. Residency clauses in practice constrain **storage at
rest**, which D1 and R2 jurisdictions address, and say nothing about where
code runs.

The blueprint keeps one caveat as an open question: *if* a specific
customer's clause turns on execution location, confirm with Cloudflare
whether a jurisdiction constrains execution or only storage — but do not
design for it before a contract demands it.

## 15.

**Dan:** *"What is Leitweg-ID"*

**Reconstruction.** The German public-sector routing identifier — the
address that tells the federal, state or municipal buyer's system which
authority an invoice belongs to. It is mandatory for B2G e-invoicing under
XRechnung, is structured (coarse, fine and check-digit parts) and is issued
by the relevant public administration rather than chosen by the supplier.

Its significance for the design is that it is **not a new field**: it is
BT-10, the ordinarily optional free-text buyer reference, made mandatory
by XRechnung and constrained to a format with a check digit.

## 16.

**Dan:** *"could we not solve this with country and identifier columns in a table to determine what the system expects for any given invoice, rather than a new column for each?"*

**Reconstruction.** Yes — and this became one of the better structural
decisions in the document. National requirements are handled as
**profiles: constraints on existing terms, addressed by BT**, in
`profiles` and `profile_term_rules` tables held centrally and replicated to
instances.

One refinement on your phrasing: the table is keyed on **profile, not
country**. Germany needs XRechnung for B2G and plain BIS for B2B, and
profile versions run concurrently, so country alone is too coarse a key.

Modelled as a `leitweg_id` column it would have duplicated a term the
document already has, and the next country would have wanted a column of
its own — the fork problem again, at schema level.

## 17.

**Dan:** *"I only expect the invoice format to be modified when it leaves our system for another. I envisage a translator / connection to modify the peppol biz 3.0 version of the file to whatever an external system needs, on entry and exit"*

**Reconstruction.** Adopted exactly: **the stored form is always BIS 3.0;
other formats are translated on entry and exit and never carried
internally.** Adapters then scale as N + M rather than N × M — one per
format in, one per format out — so adding Poland does not touch Italy.

The part worth adding is where the losses go, because translation is lossy
in both directions and the design has to say. An inbound FatturaPA or KSeF
document carries fields the canonical model has no home for, some of which
the customer is legally required to retain. The original in R2 is half the
answer; the other half is a **defined extensions store keyed to the
document** for source-format fragments that do not map — never columns on
the document itself.

Peppol is one wire format, not all of them: Italy's FatturaPA, Poland's
KSeF, Spain's VeriFactu and SII, and Hungary's RTIR are all mandates worth
selling into that do not use it. Normalising on the standard is right
precisely *because* the wire formats differ.

## 18.

**Dan:** *"the data model would need to hold organisation details, possibly multiple different operating units. User details, team detail, privilege / permission / authentication details. each operating unit / organisation will also associate configuration details, for rules that apply to each stage of the business process."*

**Reconstruction.** This produced the organisation and authority section,
whose main contribution is separating three things that get lumped
together:

**Authentication** is who you are — federated to the customer's IdP.
**Authorisation** is which parts of the product you may use.
**Authority** is what you may commit the business to: approve a payables
invoice for this unit, up to this value, in this currency.

The distinction worth keeping is that **authority is domain data, not auth
configuration**, and auditors care about it more than the other two. It is
versioned with effective dates exactly like rules, because "who was
permitted to approve this in March" is the same class of question as
"which rules were in force in March". Bury it in a permissions system and
you cannot answer it.

Configuration then resolves by inheritance — unit, then organisation, then
product default — deliberately the same resolution order as the string
overrides, so nobody has to learn a second pattern. `rule_sets` gained a
**stage** (capture, validation, coding, matching, approval, posting,
archiving) and an optional unit scope, so a subsidiary can carry its own
approval rules while inheriting everything else from the group.

## 19.

**Dan:** *"yes, it may be the case a user is part of a shared service center and operating across business units, and organisations. They would have to be allocated permission for each organisation of which they are part of. But they should have a shared view of all tasks they have responsibility for in one interface, without switching between systems."*

**Reconstruction.** Handled as a **fan-out at read time inside the
customer's own Worker**, which already holds a binding to each of their
regional databases — merged, sorted and rendered. No cross-instance HTTP
and no new infrastructure.

The residency argument for why this is legitimate: a user viewing rows
they are authorised to view is *access*, not a change in where data is
stored. The German invoice stays in the German database and is shown to an
authorised person. What **would** breach residency is materialising a
cross-region worklist table to make the query fast. Aggregate at read,
never by copying.

## 20.

**Dan:** *"Yes - 'shared service centre spans multiple legal organisations that are all one customer — one group, several subsidiaries, possibly several regions'. Companies like Genpact who work on behalf of different customer would not have a shared view. I would like a single UI for BPOs to be able to switch quickly between customers, but not have data 'mingle' in one worklist"*

**Reconstruction.** Built as **a switcher, not a shared view** — and it is
the safer build, with a property worth stating in a security review.

Because there is one Worker per customer holding only that customer's
bindings, **no code path can mingle two clients' data**: a Worker has no
access to another customer's database at all. A session is scoped to
exactly one tenant, and switching re-scopes it rather than widening it.
The isolation is the deployment boundary, not a query filter somebody has
to remember to apply.

Provider access is modelled in the control plane as `service_providers`
and `provider_access_grants`.

## 21.

**Dan:** *"The badge count in one objection that would be settled on contracting, should a BPO be responsible for the data. I like the idea of a badge count. I also like the idea of anonymous counts and KPIs shared from each D1 instance with a At company level, BPO level and My own central view, so I have visibility into usage, adoption and performance. Some companies have made good use of 'community intelligence' centrally to gamify the process. I would like to have that kind of control also"*

**Reconstruction.** This produced the section that separates **two
measurement flows, not one** — because building them as one leads
somewhere bad: they have different legal bases and different failure
modes.

**The account view** is identified, per customer, and exists to run the
business: usage, adoption, error rates, who is stuck. Legitimate under the
service contract, no anonymising required.

**The benchmark pool** is anonymised, consented and reciprocal. Using one
customer's numbers to tell another how they compare is a different purpose
from operating their service, so it is an explicit opt-in, and you
contribute to see. The warning attached: **small cells will kill this
feature if you let them** — with three participants in a segment, a
"benchmark" is a thinly disguised disclosure of a competitor's numbers.
Enforce a minimum cohort size before any figure is shown.

Usage telemetry is `usage_periods` in the control plane, keyed on
(customer, period) so retries and duplicate cron fires cannot double-count.
It carries invoices processed, rules evaluated, active users **as a count
never a list**, and outcome totals — and the blueprint states explicitly
what the payload must never contain: supplier names, invoice numbers,
amounts, rule text, user identities, or anything derived from them.

## 22.

**Dan:** *"I'm going to move to another account session to continue this conversation. Is there anything beyond the BluePrint to share that would help a new session to resume?"*

**Reconstruction.** Yes — and rather than answer in chat I added it to the
blueprint itself, as a section titled **"If you are picking this up
cold"**, on the reasoning that a handover note living in a conversation
you are about to leave is no handover at all. It contains four things:

- **The constraints every decision was made against** — one-person
  company, support cost as the binding constraint, and the Compliance
  Corner as the source of several arguments cited.
- **A decision register** — each decision, why, and *what it rules out*,
  so a fresh session does not re-propose a branch per customer or a shared
  multi-tenant schema.
- **Not decided, and waiting on a real customer** — which adapters the
  first customers need, how long execution logs stay in D1, whether a
  BPO's operators consume the client's seats.
- **Questions outstanding with Cloudflare** — whether the 500-Worker limit
  is liftable the way the D1 limit is, whether any UK residency option
  exists, and whether a jurisdiction constrains execution or only storage.

I also supplied a paste-able preamble covering your working style and
constraints.

## 23.

**Dan:** *"Can you outline the model we have devised here for making changes to github, and cloudflare. such that I can instruct another session to understand the same"*

**Answer (verbatim — this reply came after the compaction):**

> Written up as `claude/change-and-promotion-model.md` in the project, and
> sent as a file.
>
> The eleven sections cover why the sandbox can neither push nor deploy
> (proxy-level, not credentials — worth stating plainly so a new session
> doesn't spend an hour on tokens), the commit → bundle → pull-test →
> `SendUserFile` loop, and then the promotion path you asked me to add.
>
> The part I'd draw your attention to is §3, because writing it out
> surfaced something we've been doing correctly by habit rather than by
> rule: **GitHub and Cloudflare are two separate promotions.** Wrangler
> uploads from your working directory and never consults the remote, so a
> push deploys nothing and a deploy pushes nothing. That makes the running
> order matter — push first so a revert is available, migrations before
> Workers because the chain is additive and new code reading columns that
> don't exist yet is a 500 on the public site, then both Workers back to
> back whenever `shared/` moved. There's also a table of what-changed →
> what-deploys, including the easily-missed case where a root `.html` edit
> is a `site-worker` deploy despite nothing in `site-worker/src` changing.
>
> Two things in there are recorded from your own wrangler comments rather
> than from our conversation: that a dashboard variable flip is
> overwritten by the next deploy, and that the migration chain is
> forward-only so an undo is a new higher-numbered migration.
>
> §10 is the paste-able block for the new session — it now includes your
> half of the loop, so the session knows what you'll actually run and what
> it therefore has to tell you.

---

# Part 2 — after the compaction (verbatim, both sides)

These exchanges are recovered directly from the session transcript and are
reproduced word for word.

---

## 24.

**Dan:** *"thank you - on the vibe finance topic again. Do you propose starting with - Worker directories and names — e.g. is this one Worker to start, or do we already know it'll split (control plane vs. per-tenant instance)?"*

**Answer (verbatim):**

> Two Workers, and the split is already known — but it isn't the split your question names.
>
> The line that's certain from day one is **control plane versus application**, and it's a trust boundary rather than a scaling one. The licence and telemetry server holds cross-customer data, must be unreachable from any customer's bindings, has to fail open when it's down (your "passive, with the option to block centrally"), and will deploy on a completely different cadence from the product. All four of those are reasons to keep it separate now, when it's cheap, rather than extracting it later when it has grown roots into the application's session handling. That one I'd commit to.
>
> The per-tenant split is a different matter, and I'd argue it isn't really a Worker question at all — it's a binding question. I checked the current state before answering, and it's decisive: **D1 bindings are still static in configuration, with no runtime way to select a database by id.** A Cloudflare engineer on the workerd discussion says the workaround is to update the Worker's configuration through the API, and that plans to improve it have no ETA. So "one codebase, per-customer database" cannot be a single ordinary deployment. Three routes out, and they have very different operational costs:
>
> One Worker deployment per customer, each with its own binding, works today and is the obvious reading — but Workers Paid caps at 500 Workers per account, and long before you feel that cap you feel the release: every version is N deploys by one person. For a company that is you, that's the thing that ends the model, not the limit.
>
> The D1 REST API with the database id resolved per request keeps you at one deployment and unlimited customers, at the cost of the binding's latency and — more importantly — an account-scoped token sitting in the Worker, so a routing bug reaches every customer's database rather than one. That's a real widening of the blast radius for a product whose selling point is per-customer isolation.
>
> Workers for Platforms is the sanctioned version of the first option: a dispatcher Worker routes to a per-tenant user Worker, and each user Worker's bindings are set at upload time through the API. Onboarding becomes an API call rather than a deploy, which is the difference that matters to a one-person operation.
>
> So my recommendation is: start with two Workers, `vf-app` and `vf-licence`, and defer the per-tenant decision — **but make the one code discipline now that keeps all three routes open.** Never reference `env.DB` anywhere except a single `resolveTenant(request, env)` that returns a database handle. If query sites reach for the binding directly, you have silently chosen deployment-per-tenant, because that's the only shape that works when the handle is a global. If the handle is injected, the same codebase runs unchanged whether it's bound at deploy, fetched over HTTP, or dispatched. That's a half-day of discipline now against a rewrite later.
>
> Two facts worth adding to the blueprint, because they weren't in what we established earlier. D1 has an account-level ceiling of **1 TB total storage** alongside the 50,000-database and 10 GB-per-database limits — increasable on request, but it means D1 holds structured invoice data only and R2 holds everything heavy, which is what you'd specified anyway. And both that and the 500-Worker cap are *account* limits, which quietly strengthens the case for the model where a customer's instance lives in their own Cloudflare account: the caps reset per customer and stop being your problem at all. That option was on the table for platform-standard reasons; it turns out to have a scaling argument too.
>
> The third Worker, when it comes, will be the adapter layer — ERP connectors and Peppol access point egress. Different failure domain, third-party retries, long timeouts. Split it the day a slow partner starts affecting request latency for everything else, and not before.
>
> Want me to fold this into the blueprint as a resolved decision with the three routes recorded as the alternatives considered?
>
> Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [How to bind D1 databases dynamically (cloudflare/workerd #3564)](https://github.com/cloudflare/workerd/discussions/3564), [Workers for Platforms — bindings for user Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/bindings)

## 25.

**Dan:** *"thank you"*

**Answer (verbatim):**

> You're welcome. The offer stands whenever you want it recorded in the blueprint — and if you'd rather leave the per-tenant route open, the `resolveTenant()` discipline is the only bit that needs to be true in the first commit.

## 27.



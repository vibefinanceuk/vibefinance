# 0591: Outbound mapping (connector framework, slice 3)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs:

- **`vf-app` migration `0123`**, `outbound_mapping_versions`;
- **`vf-licence` migration `0236`**, the strings.

## What was asked

On 1 October Dan agreed the connector framework
(`claude/connector-framework-design.md`). Slice 3 is outbound mapping:
*"the mapping editor pointed outward: try on a real invoice, publish, and
copy to customise"* (design, sections 3.3 and 5). After 0590 he said
*"Yes please"* to starting it.

## What was decided

### The mapping (`shared/connectors/outbound-mapping.ts`)

An outbound mapping turns one VibeFinance invoice
(`vibefinance.invoice.v1`, 0585) into the JSON a target expects. It has
three groups of fields:

- **once per invoice**;
- **each line**, in an array the mapping names (`invoiceLines`);
- **each distribution** of a line's coding, in an array the mapping
  names, placed **inside each line** (Oracle's `invoiceDistributions`) or
  **all on the invoice**, one per distribution (SAP's G/L account items).

Each field has:

- a **name**, as the target spells it. A dot nests (`supplier.id`), and an
  array's name may nest too (`to_SupplierInvoiceItemGLAcct.results`);
- a **source** in the VibeFinance invoice, or a **fixed value**. A field
  reads its own level or one above it: a distribution can read its line's
  description and the invoice's currency, but an invoice field cannot read
  a line's. There are 29 sources, including `distribution.sequence`, a
  running number across the invoice, for SAP's item numbers;
- **functions**: the supplier mappings' closed list (0561), look-up lists
  (0568) included. As inbound, an empty value goes through the functions
  only where one gives a default;
- **required**: empty, the invoice is not sent, and the reason names the
  field.

An empty value is **left out** or **sent as null**, for the whole mapping.

**The standard layout** (`standardOutboundMapping`) is written in the same
terms, and lays out exactly the VibeFinance invoice JSON. A test holds it
to that, byte for byte.

**What it cannot store is refused in words:** a name with a space, a
source that does not exist or is below the field's level, a name used
twice or both as a value and a group (`a` beside `a.b`), a field with no
source and no value, an unknown function, an array with no name.

**XML and CSV output** are not in this slice. JSON covers Oracle Fusion,
SAP's OData API, Sage Intacct's REST API, Business Central and automation
tools.

### Versions (migration `0123`)

`outbound_mapping_versions` holds a Destination's own mapping, one row per
version, keyed by the Destination. As supplier mappings, there is at most
one draft and one live version:

- **Make my own copy** makes version 1, a draft of the standard layout,
  and records what it was copied from (`https-out@1`). From then on it does
  not change when the standard does, as the design said.
- **Saving** edits the draft, or starts a new one from the live version.
- **Try** lays out a real payment-eligible invoice, and keeps it as the
  draft's sample. Nothing is sent.
- **Publish** is refused until the draft has been tried, and while it
  cannot lay out the invoice it is published with; the problems are
  shown. Publishing retires the live version and **sets the Destination's
  format to `mapped`**, so it sends its own mapping from then on.

Going back to the standard layout is the format setting, which now offers
**Its own mapping** once one is published. The mapping is kept.

An **automation webhook** keeps its format fixed (0589), so it has no
copy (`format_fixed`).

### Sending

`buildRequest` lays out the invoice with the live version and the look-up
lists it names. **What it cannot lay out is a failure at once, not
retried and not sent**: the delivery says *"the outbound mapping could
not lay out this invoice: …"* with each field, and its route message fails
with code `outbound_mapping`. The Route monitor explains it and says to
correct the invoice or its list, or change and publish the mapping, then
Send again. **Show what would be sent** lists the same problems first.

Look-up lists in use by a Destination's mapping now show it under **Used
by**, beside supplier mappings.

### Functions from plain words

`POST …/mapping/compile` uses the supplier mappings' compiler (0561),
with worked examples from every value the field's source holds in the
invoice tried. The compiler gains one kind of value, `any`: a field of a
target system may be text or a number, as the instruction makes it.

### Endpoints

All under `Admin.Configure`, as the Destination's other settings:

| Endpoint | Does |
|---|---|
| `GET /route-instances/:id/mapping` | the standard, its versions, the draft or live definition, the sources, the look-up lists, invoices to try, and a sample invoice |
| `POST …/mapping/copy` | Make my own copy |
| `PUT …/mapping` | save the draft |
| `POST …/mapping/try` | lay out an invoice |
| `POST …/mapping/publish` | publish the draft |
| `POST …/mapping/compile` | a function from plain words |

### On screen

**The Destination panel** (Process routes) has a new card, **How each
invoice is laid out**:

- the standard layout, with **Make my own copy**; or
- its own mapping's live and draft versions, whether it is being sent,
  and **Open the mapping**;
- for a connector that keeps its layout, only that it does.

**The outbound mapping editor** (`outbound-editor.js`) is the mapping
editor (0561) pointed outward, and draws its lines with the same code:

- **left**: the VibeFinance invoice, once per invoice, each line, each
  distribution, with the values of the invoice last tried (or the latest
  ready to pay). Fields not yet sent are dimmed;
- **right**: what the Destination sends, in the same three groups, each
  field with where it comes from or its fixed value, `*` where required,
  and Fx where a function changes it;
- choose a field on the left to **Add** it (at its level or below, named
  after it) or **Use it for** the field chosen before;
- choose a field on the right to rename it, make it required, give it a
  fixed value, say what should happen to its value (**Understand**, worked
  examples, **Accept**), remove its function, or **Remove field**;
- **Layout**: the arrays' names, where distributions go, and what an empty
  value becomes;
- **Try it on an invoice**: what it could not lay out, and the JSON;
- **Try**, **Publish** (while there is a draft) and **Back** to the
  Destination on Process routes.

Every change saves the draft. Its own screen for Help
(`outboundmapping`), lighting Process routes in the nav.

## Not built

- **XML and CSV output** (UBL, an ERP's own CSV). JSON only.
- **Rules for the whole invoice** outbound, as 0569 inbound. Functions per
  field only.
- **AI proposing the mapping** from a target's sample or API description.
- **Trying several invoices at once**, and comparing a draft with the
  live version.
- **Mappings shipped by a connector.** Standard and partner connectors
  with their own mapping (Oracle, SAP) come with slice 4, partner
  authoring, and slice 5, the first ERP connector. The definition
  (`ConnectorDefinition`) is ready to carry one.
- **Ordering fields** by dragging. They are sent in the order added.

## Verification

- **`shared`**, `outbound-mapping.test.ts`, 6 tests:
  - the standard layout gives exactly the VibeFinance invoice JSON;
  - an Oracle-shaped layout: names, nesting, a date function, a look-up,
    upper case, a fixed value, empties left out, distributions in lines;
  - an SAP-shaped layout: every distribution on the invoice under a nested
    array name, with its line's description and a running number;
  - problems: a value not in a list, a required empty, a function that
    fails, and empties sent as null;
  - eleven refusals in words;
  - worked-example values.
- **`vf-app`**, `outbound-mapping.test.ts`, 7 tests:
  - the standard and a sample invoice before any copy; copy once;
    `mapped` refused until published;
  - save checked (invalid, unknown list), try with a required empty,
    publish refused until tried and while it fails, then published,
    previewed and sent exactly as tried; the list's Used by;
  - a new draft beside the live version, publishing again retires it,
    and back to the standard keeps the mapping;
  - a delivery it cannot lay out fails at once without a call, and the
    monitor's message fails with `outbound_mapping`;
  - refused for a fixed-format connector, and an unknown Destination;
  - a function compiled with examples from the invoice tried;
  - the router: Admin.Configure only.
- **`vf-ui`**, `routes.test.ts`, 8 new tests with the real strings: the
  card (standard, copy and open the editor; live, draft, sending, the
  format offered; a fixed connector), the editor's two columns and
  lines, adding and using a source (refused below its level), renaming,
  required, a function said and accepted, removing, the layout settings,
  Try, Publish refused and published, and Back. All 8 fail against the
  interface before this change. Worker allowlist: the five paths.
- **Migrations** replay: `vf-app` 123, `vf-licence` 236.
- **Full runs**:
  - `vf-app`: 3408 tests, of which 3406 pass (the two known failures, 0511);
  - `vf-ui`: browser 1426, of which 1425 pass (the known
    `typography.test.ts` 10px gap); worker 103 of 103;
  - `vf-licence`: 322 of 322;
  - `shared`: 413, of which 409 pass, 1 skipped (the three known
    failures).
- A screenshot of the editor with an Oracle-shaped mapping, tried.

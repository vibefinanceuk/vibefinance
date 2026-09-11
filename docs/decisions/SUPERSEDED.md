# What has been superseded

**A record is never deleted or rewritten to agree with a later one.**
What was decided, and why it looked right at the time, is part of why
the current answer is what it is.

That creates a real hazard, and the operator named it:

> Sometimes it feels that when I engage with another session and
> everything is re-read, contradictions appear — however this is just
> the evolution of ideas.

Exactly so. **The contradictions are real and the records are not
wrong** — they are dated. This page is the map, so a reader does not
have to notice on their own.

It has happened twice by accident already: decision 0094's conclusion
sat in `HANDOVER.md`'s *resolved* list as settled for days after
decision 0117 corrected it, and two of decision 0089's open items were
closed by 0090 on the same day and went on reading as open.

---

## How to read a record

| If it says | Then |
| --- | --- |
| **Status: built** | It describes what runs today. |
| **Status: designed, not built** | The reasoning is current; the code is not there. |
| **Superseded by NNNN** | Read NNNN first. This one explains what was believed before. |
| **Superseded in part** | Most of it stands. The named section does not. |
| ~~Struck through~~ | That specific item is done or overturned; the surrounding record stands. |

**A record with no status line predates the convention.** Fifty-four of
them do, and none is known to be wrong — but none has been re-read
against the current system either.

---

## Fully superseded

| Record | By | What changed |
| --- | --- | --- |
| **0094** — the bootstrap administrator was not needed | **0117** | True as far as it went, and it left the customer with **no administrator of their own**. The requester *is* the administrator; `signup_requests` already names them. |

---

## Superseded in part

| Record | By | What changed |
| --- | --- | --- |
| **0045** — multi-page capture | 0046 | Named in the record itself. |
| **0061** — intake channel structure | 0060, 0161 | Channels became sources; the record is retired once capture addresses sources rather than channels. **Decision 0161 entrenched them instead**, creating a channel on arrival because an image had none — the second-best fix, recorded as such, because `intake_capture_events.channel_id` is `NOT NULL`. |
| **0089** — local accounts | 0090 | **Rate limiting** and **lockout** were listed as open and were built the same day. Reset is narrower than it read: an administrator setting a password works today; **self-service** reset is what is missing. |
| **0052** — a line's description has no BT code | 0171 | *"Purely to carry text no rule tests"* was right, and the premise changed: the viewer renders only what the field resolver lists, so a description extracted from every line was **displayed on none**. It is a displayable field now, not a vocabulary one. |
| **0120** — keyed facts merge rather than replace | 0174 | True of **header** facts and never applied to lines. `handleUpsertInvoice` replaced each line wholesale, so decision 0171 making one field read-only turned a latent bug into real data loss. |
| **0144** — an invoice outside a process | 0164 | The record named it: *"editable by anybody with `AP.Validate`."* Nothing could reach one until the document manager made every invoice openable. It is read-only now. |
| **0164** — the editability check runs on every save | 0173 | Widening the check widened what it **refused**: the viewer supplies `BT-126` itself, which is `read`, so every line edit at Validation was rejected for a field nobody touched. |
| **0036** — an invoice belongs to an operating unit | 0226 | The standing invariant said so because *"the operating unit is where payables happen"* — and then matched invoices on `BT-48` and `BT-49`, which are the **taxable company's**. Two different questions sharing one column. **The first invariant this project has inverted**, done with `--refresh-checksums`. |
| **0204** — `ambiguous_unit`, `no_operating_unit` | 0226 | Both existed only because a match on a company had to be forced down to a department. **A company with three departments was never ambiguous.** Deleted rather than fixed. |
| **0207** — pay and purchasing purpose flags | 0218 | Filed among attributes describing *buying* rather than paying. **Right about purchasing and wrong about pay**: an invoice arrives at a pay site, which is what disambiguates three sites sharing one VAT number. |
| **0207** — the supplier email | 0219 | Filed as carried-and-forwarded. **Decision 0031 built `return_to_supplier` with no way to reach one.** |
| **0219** — a separate *Supplier on file* card | 0220 | A viewer showing the document and the form side by side has no room for a card repeating what the card above it says differently. |
| **0224** — the Buyer card's entity-and-unit sub-line | 0227 | Needed while an invoice was assigned to a department beneath a company. Decision 0226 made them the same row, and the line said a name twice. |
| **0010** — the org endpoints are ungated | 0201 | The bootstrap exception was permanent and its reason was not: *"nobody could be authenticated to create the first account"* holds while there is nobody, and stops the moment one person exists. **Anybody who could reach the instance could grant themselves any role.** Now ungated only while `org_users` is empty. |
| **0018** — a generated rendering | 0205 | Created the document type and said why — *"a plain XML invoice has nothing a person can look at"* — and nothing produced one for three months. |
| **0036** — the buyer's identifiers | 0204 | Added `buyer_endpoint`, `vat_id` and `buyer_reference` as *"the identifiers an arriving invoice can be matched against"*, and **nothing read them** until automatic org placement. |
| **0192** — how permissions are scoped | 0194, 0199 | That record left it open and proposed permission pairs. Oracle scopes the **role**; the operator's phrasing put it on the **assignment**, which is better still — one *AP Manager* definition held per org. |
| **0199** — a boundary in one place | 0202, 0203 | Recorded its own gap plainly: *"a person is correctly denied acting and still shown the work."* The task list, then claiming and completing. |
| **0197** — the screen behind the route | 0198 | Field visibility was enforced per unit and reported without one, so a French keyer saw an editable field and got a 403 on save. **Decision 0144 inverted.** |
| **0126** — an address invoices arrive at | 0141 | `INGESTION_DOMAIN` was hardcoded to a domain **nobody owns**. It is configuration now, and an unset one refuses to issue an address. |
| **0130** — retiring a source | 0133 | Deletion was refused outright once an address existed. It now **asks**, because an address reserved and never shared is a mistake to correct. |
| **0135** — the Cloudflare half | 0136 | *"Generated config or one per customer"* was answered by **neither**: the config is data the control plane already held. |
| **0114** — field visibility | 0143, 0144 | Two things. A **stage-wide** restriction replaces listing fields, because a list cannot know about a field added later. And the mechanism was **enforced only by the screen** — the keying route never consulted it, from September until 7 September. |
| **0141** — a domain nobody owned | *itself* | `vibefinance-ai.com` is bound. The record stands; the situation it describes is over. |

---

## Answered, where a record left a question open

| Record | Question | Answer |
| --- | --- | --- |
| **0108** | Should dark and light be a person's setting? | **0139** — yes, with a control. |
| **0111** | What does field visibility vary by? | **0114** — customer and stage, with the org dimension deliberately left out. |
| **0113** | Should extracted codes be validated? | **0116** — yes, against closed lists only. |
| **0122** | The action icons do nothing | **0138** — they work. |
| **0125** | Which domain do addresses live on? | **0141** — configuration, and there isn't one yet. |
| **0140** | Who did what in the control plane? | **Answered in full.** The interface is built (0186), behind Access on a hostname in the zone (0187), and the first action attributable to a person rather than a shared secret is recorded. |
| **0031** | Is the closed vocabulary safe to hand to a customer? | **0153** — yes, and only if they can read the rule back. A compiled condition tree is not something anybody can confirm. |
| **0033** | Is a refusal an error? | **0153** — no. It is warning-coloured, says what cannot be expressed, and says nothing was saved. |
| **0055** | What happens to a document nothing can read? | **0161, 0163** — an invoice with no facts, waiting for a person, **and the screen says so**. A timeout takes the same path, because a model that never answered is not a model that read badly. |
| **0042** | Can a Worker read a scanned PDF? | Still no. **0161** made the consequence visible rather than silent. |
| **0031** | Where does a cost centre belong? | **0194, 0195** — to a **ledger** (Oracle) or **controlling area** (SAP), not to a legal entity. That record kept `BT-133` apart from `org_units` as *"a financial construct, not an organizational one"* and could not name what it belonged to instead. |
| **0001** | Why a database per customer? | Isolation between customers and data residency — **SAP's Client, arrived at independently** (0194). Not a mechanism for splitting one customer up, which is what 0192 first assumed. |
| **0036** | Legal entity and operating unit | **0194** — Oracle's own model, and Oracle EBS's older name for a business unit is literally *Operating Unit*. Reached without knowing it. |
| **0184** | Where does the cost object tree live? | **0195** — under the accounting frame, which is why a chain can cross a company boundary without crossing a chart of accounts. |
| **0036** | Which org does an invoice belong to? | **0226** — the **company** that is billed, not the department that processes it. Decision 0225 named three things sharing the word: the taxable company, the charge coding, and the processing organisation. |
| **0208** | Are we the master or a mirror? | **A mirror.** A customer supplies a spreadsheet; there is no create, no merge and no vendor approval here, because all of that is the ERP's. |
| **0209** | What does *matched* mean? | **That we can name it to the ERP** — not that we recognise the company. An invoice without an ERP identifier cannot be paid however familiar the name on it. |
| **0205** | Can we run OpenPEPPOL's stylesheet? | **No.** It is XSLT 2.0, browsers implement 1.0, and SaxonJS fails on import inside `workerd`. Their design and code lists; our traversal. |
| **0074** | Should `require_second_approval` exist? | Removed, not built. Parallel approval is a workflow question. |
| **0075** | What does sending back mean? | Returning, plus discarding (**0078**). |
| **0094** | Who is the first user? | **0117** — the requester, who becomes the customer's administrator. The record that sat in the handover's *resolved* list as settled for days after this corrected it. |
| **0104** | Do locks expire? | No, and deliberately: a browser closing is undetectable, so any automatic release leaks locks. |
| **0107** | Where do the interface's words live? | D1, in the control plane, so a wording fix is rows rather than a deployment. |
| **0113** | Which font? | **0124** — Carlito, metric-compatible with Calibri and openly licensed. |
| **0119** | Should the line comparison sit in the exceptions panel? | **Not decided.** They are different things — live feedback against a stored verdict — and the distinction was not obvious to the person looking at it. |
| **0121** | How is browser code tested? | `jsdom`, in a second vitest config, with the real modules imported. |
| **0126** | Where do invoices arrive? | A source carries an address derived from its own name, never reissued. |
| **0127** | Does every route accept a session? | Yes, and a test reads the source to refuse one that does not. |
| **0130** | What does deleting a source mean? | Retire where a document carries its name, delete where nothing does, ask where an address was issued (**0133**). |
| **0134** | When should a screen speak? | Only when it cannot show something. |
| **0136** | Where does a Worker's config come from? | The manifest the control plane already holds. |
| **0137** | What is a customer asked at signup? | Their region. Kind is always sandbox, because offering *production* would be offering a mistake. |
| **0139** | Day time or night time? | A person's setting, with a control, and a blue night rather than black. |
| **0142** | Does review need its own screen? | No. Field visibility and a task's own actions were already enough. |
| **0143** | How is a stage made read-only? | As a property, not a list of fields somebody keeps complete. |
| **0144** | Was the screen the only guard? | It was, since September. It is not now. |
| **0114** | Does a review screen need its own code? | **0142** — no. The same screen, with the stage deciding what is editable. |

---

## Where a record was right and the world moved

Not supersession — worth separating, because these read like errors and
are not.

**0039** deliberately built half of provisioning and said so. The other
half exists now (0135, 0136); the record's reasoning about *why* it was
split is still the reason it was safe to.

**0042** says a Worker cannot render a PDF. True, and it was read for
too long as *"this cannot be previewed"* — the browser renders it fine
(0123). The record is correct; the inference drawn from it was not.

**0038**'s approval checkpoint survived automation. A provisioning
script exists now and **cannot run ahead of it**, which is a stronger
statement than the record originally made.

---

## What lives here rather than in the handover

**`HANDOVER.md` holds what is true now.** This page holds what stopped
being true.

The handover kept its own *resolved since* list for a while, and it is
exactly where decision 0094's conclusion sat as settled for days after
decision 0117 corrected it. **Two copies of the same history is one copy
that lies**, and the stale one is always the copy nobody is told to
check.

So: a question answered, a record corrected, a thing struck through —
all of it here. The handover strikes nothing through and carries no
history; when something is done it leaves that page.

## Keeping this current

**A record that supersedes another says so in its own first lines**, and
is added here. Two places, deliberately: a reader arriving at the old
record needs to be told without leaving it, and a reader arriving cold
needs to see the whole picture without reading 141 files.

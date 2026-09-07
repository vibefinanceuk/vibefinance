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
| **0061** — intake channel structure | 0060 | Channels became sources; the record is retired once capture addresses sources rather than channels. |
| **0089** — local accounts | 0090 | **Rate limiting** and **lockout** were listed as open and were built the same day. Reset is narrower than it read: an administrator setting a password works today; **self-service** reset is what is missing. |
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
| **0140** | Who did what in the control plane? | Built. The **interface** is now unblocked — a domain exists. |
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

## Keeping this current

**A record that supersedes another says so in its own first lines**, and
is added here. Two places, deliberately: a reader arriving at the old
record needs to be told without leaving it, and a reader arriving cold
needs to see the whole picture without reading 141 files.

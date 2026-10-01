# 0579: Supplier mappings are shared by every Source route

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` (tests only) and `vf-licence`, and needs
**`vf-licence` migration `0227`**. There is no `vf-app` migration.

## What was asked

Dan tried HTTPS in (0578) live on 1 October with `Rechnung_88240.xml`.
The request worked, but the file was refused:

> *"this is <Rechnung>, a supplier's own XML, and no mapping on this
> route reads it yet"*

That was right by the rules of 0561. Each mapping belonged to the route
it was drawn on, Email in, and its Who it is for named email senders,
which an HTTPS key is not. I suggested sharing mappings across routes,
and Dan asked: *"Can you build the shared mapping concept."*

## What was decided

### A mapping describes a format, not a way in

`mappingFor` and `nearMiss` no longer join on the receiving source's
route. A live mapping for the file's root (or `CSV`) reads it however it
arrives: email, AP upload, HTTPS, and SFTP when it comes. Who it is for
still decides between mappings with the same root, as before.

`supplier_mappings.route_id` stays, as the route the mapping was first
drawn on, and is still returned as `routeId`. No migration.

### Who it is for can name an HTTPS key

Each entry is kept by `senderName`: lower case, trimmed, with runs of
spaces made one. It can be:

- a domain, `@munch.de`;
- an address, `anna@munch.de`;
- **a name with no `@`**, such as `Lager Nord ERP`. It matches a sender
  of exactly that name, which is the key name an HTTPS file was sent
  with.

An email sender is always matched by its address, never its display
name, so `Lager Nord ERP <ap@lagernord.de>` does not match the name. An
entry with a comma, or more than one `@`, is dropped, as malformed
entries were before.

**Map this format** on a file sent over HTTPS makes a mapping for that
key's name, as one drawn from an email is for its domain. Its default
name is the key's name and the root, such as "Lager Nord ERP
<Rechnung>".

### Lists and waiting messages

- `GET /supplier-mappings` lists every mapping. `?route=` is still
  accepted and no longer narrows the list, so the Routes screen shows
  the same mappings under each Source route. Its note now says they are
  shared.
- The failed messages a mapping may read (`waitingFor`) are those from
  any route, for senders it is for.

### Wording

The error text and `vf-licence` `0227` drop "on this route":

- "no mapping reads it yet";
- "the mapping "…" reads <Rechnung>, but is not for lager nord erp";
- the monitor's not-for-sender and not-published explanations;
- "{n} failed messages may now be read";
- the Routes note;
- Who it is for's placeholder;
- mapping help lines 20 and 21.

## For Dan's message from this morning

After deploying, open the `<Rechnung>` mapping, add the key's name to
Who it is for, and Save. Who it is for applies at once, with no
publishing. Then reprocess the failed message in the Route monitor.

## Not built

- **Uploads.** Upload documents passes the person's own address as
  sender, so a mapping for a supplier's domain still does not read a
  file the AP team uploads. Only a mapping for anyone does. Batch upload
  is unaffected, because the person chooses the mapping there.
- **Limiting a mapping to some routes.** No case for it yet.

## Verification

- **`vf-app`**, `https-in.test.ts`, 4 new tests:
  - a mapping drawn on Email in for `@munch.de` refuses the file over
    HTTPS with "is not for lager nord erp". Once Who it is for adds
    "Lager Nord ERP", it reads 88241, and another key on the same source
    is still refused;
  - a mapping for anyone reads it, and `?route=email-in` and
    `?route=https-in` list the same mapping;
  - Map this format from an HTTPS file makes a mapping on HTTPS in for
    `["lager nord erp"]`, named "Lager Nord ERP <Rechnung>". Published,
    it reads the next file;
  - `senderName` and `senderMatches` on domains, addresses, names,
    commas, and display names.

  All 4 fail against the code before this change. In
  `supplier-mappings.test.ts`, the four reasons that said "on this route"
  are updated. With `route-monitor`, `upload` and `batch`: 60 of 60.
- **`vf-ui`**, `mapping-editor.test.ts`: the two expectations with "on
  this route" updated, reading 0227's strings. 31 of 31.
- **`vf-licence`**: migrations replay 227.
- **Full runs**: `vf-app` 3357 tests, of which 3355 pass (the two known
  failures, 0511). `vf-ui` browser 1398 of 1399 (the known
  `typography.test.ts` 10px gap). `vf-licence` 322 of 322.

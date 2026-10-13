# 0762: The supplier confirms it has the order

**Status: live.**

- vf-app:
  - migration 0172;
  - `order-confirm.ts` (new);
  - `orders-out.ts`, `order-sharing.ts`, `index.ts`.
- vf-licence:
  - `portal.ts`, `index.ts`: where an instance is, for the confirm page;
  - strings migration 0356.
- vf-portal:
  - `confirm.html` and `confirm.js` (new);
  - `network.ts`, `index.ts`, `portal.js`, `order-view.js`, `portal.css`.
- vf-ui: `purchase-orders.js`, `order-timeline.js`, `timeline-entry.js`, `orders-out.js`.

## What was asked

Slice 4c of purchase orders. 0759 had planned a link that opened a page with a *Confirm receipt*
button. Dan, 13 October 2026, preferred one click:

> "I would prefer the link to confirm receipt and also take the user to the supplier network,
> where they can see that the purchase order is confirmed. Also, if the supplier does not see the
> email, they should be able to log into the supplier network, and click confirm manually."

Asked about mail scanners, which open every link in an email before a person does, Dan chose to
**confirm when the link opens in a browser**.

## What changed

### The link

Each order email carries a **Confirm receipt** button, and the same link in its text. The wording
says whether it is the order, a change or a cancellation, in English or German. The link is:

`https://network.vibefinance-ai.com/confirm#<environment>.<secret>`

- **The secret is 32 random bytes.** Only its SHA-256 hash is kept, on the send
  (`purchase_order_sends.confirm_token_hash`), and only once the email has gone. The copy of the
  email kept in the Route monitor leaves the secret out.
- **The secret is after the `#`.** A browser never sends that part to a server, so a scanner that
  only fetches the link gets a static page and nothing it can confirm with.
- **The page confirms once it has loaded in a browser.** It posts the secret to the supplier
  network. vf-licence says where that customer's instance is (`GET /portal/environments/:id`,
  public, as an instance's address is no secret). The instance confirms
  (`POST /portal/order-confirm`, no sign-in: the link is the proof).
- **The page then takes the supplier on.** Signed in to the supplier network, it goes straight to
  the order (`/#order=<environment>/<order id>`), where it shows as *Confirmed*. Not signed in, it
  says *Receipt confirmed* and offers *Sign in to see the order*. That opens the order once they
  have signed in.
- **The secret leaves the address bar** as soon as the page has read it.

**The browser that confirmed is kept**, and shown on the Timeline. A scanner that runs pages in a
real browser can still confirm. That is rare, and the Timeline shows it plainly when it happens.

### In the supplier network

An order shared with the supplier (0751) shows:

- **Not confirmed:** a **Confirm receipt** button beside *Invoice this order*, and *Acme Corp asks
  you to confirm you have received this order*.
- **Confirmed:** a green **Confirmed** beside its status, and *You confirmed receipt of this order
  on …*.

Confirming there needs no email. It works for a supplier who never saw the email, and for an order
the customer's own system sent.

### Versions

A confirmation is of one version: the order as released, or a change or cancellation released
after it (`purchase_order_confirmations`, once per version).

- **A change waits to be confirmed again.**
- **An earlier email's link still confirms only the version it carried.** The Timeline says it was
  an earlier version, and the order still waits.
- **Confirming twice is the first confirmation**, said as such.

### In VibeFinance

- **The order's page** shows *Confirmed by the supplier on …, with the link in the email*, or *…,
  in the supplier network (jo@kingsway.example)*. Once sent and not yet confirmed, it shows *The
  supplier has not yet confirmed receipt*.
- **The Timeline** shows *Confirmed by supplier*. Beneath it:
  - which version;
  - whether it was an earlier one;
  - the browser that opened the link.
- **The Orders to suppliers panel** says each email has the button, and that a supplier can
  confirm in the supplier network instead.

**Without an `ENVIRONMENT_ID`**, a deployment's emails have no link, and suppliers confirm in the
supplier network only. The link uses `NETWORK_URL` (the default network address otherwise), as the
message emails do.

### Words (vf-licence 0356)

37 keys, in English and German.

## Tests

- **vf-app** `order-confirm.test.ts`, 4 tests:
  - the link is in the email and is kept here only as a hash, and the Route monitor's copy leaves
    it out;
  - the link confirms once, says which order and from whom, and keeps the browser;
  - a link not made here, or cut short, confirms nothing;
  - a change waits again, and the earlier link confirms only its own version, said on the Timeline;
  - the German email, an email with no link where there is no environment, and a link in an email
    sent by hand;
  - a failed send has no link.
- **vf-app** `order-sharing.test.ts`: confirming in the network, once, as the person signed in. It
  is refused on an order not shared with them, and without a token.
- **vf-licence** `portal.test.ts`: where an instance is, unsigned; an unknown one is not found.
  **vf-licence** string coverage.
- **vf-portal** `network.test.ts`:
  - by link: the instance found, asked, and its answer passed on;
  - unknown, malformed and foreign links are not recognised, and an instance that does not answer
    is said so;
  - in the network: to the customer that link is for, with its own token;
  - the Worker takes the link without a session, but not from another site;
  - the confirm page is served, and its words are defined.
- **vf-ui browser:**
  - the order page's confirmed line, its waiting line, and none when never sent;
  - the Timeline's words;
  - the panel's note.
- **Related suites pass:**
  - vf-app: orders, order sharing, orders out, order PDF and portal (12 files, 197 tests);
  - vf-portal, vf-licence portal and string coverage, and the vf-ui worker;
  - the full vf-ui browser suite, except the known `typography.test.ts` and `signin.test.ts`
    failures.
- **In a browser:**
  - the network's order before and after *Confirm receipt*;
  - the confirm page signed out;
  - the link signed in, landing on the order confirmed with the address cleared;
  - the email, with its button.

## To deploy

Migrations: vf-app `0172_order_confirmations.sql`, vf-licence
`0356_order_confirmation_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal.

The link needs vf-app's `ENVIRONMENT_ID`, which the supplier network already uses. Emails sent
before this deploy have no link; those orders can be confirmed in the supplier network.

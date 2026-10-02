# 0593: Inviting a person, in place of a password set by curl

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-licence`, `vf-admin`, `vf-app` and `vf-ui`. It needs:

- **`vf-licence` migrations `0238`** (invitations) **and `0239`** (strings);
- **a `vf-licence` secret**, the same Resend key `vf-app` sends supplier
  email with:
  ```
  npx wrangler secret put RESEND_API_KEY
  ```
  run in `workers/vf-licence`. The address invitations come from and the
  page they link to are vars in its `wrangler.jsonc`
  (`INVITE_FROM_ADDRESS`, `INVITE_LINK_BASE`).

## What was asked

After step 1 of slice 4 (0592), Dan asked what password a partner's
person has. The answer was none: a password was set with `curl`
(`/credentials`), and access granted with another (`/access`), for every
customer. He asked:

> *"I wondered if we could incorporate the password set up as part of
> user provisioning here. To send the email address of a new user with a
> 6 digit code, and link via which they can confirm their user and set
> themselves a password."*

He chose to build it now, before step 2, and for **the operator and a
customer's own administrators** both.

He was told that a link and a code in one email are one factor, not two:
the token in the link is the protection, and the code helps when the link
is opened on another device or mangled by a mail client.

## What was decided

### The invitation (`vf-licence`, migration `0238`, `invitations.ts`)

An invitation is for **one email, at one customer, to some of its
environments** (all of them, unless named). It is emailed through Resend:

- a link to the shared interface's **welcome page**,
  `https://app.vibefinance-ai.com/welcome.html#t=<token>`. The token is
  32 random bytes, and travels in the fragment, which a browser never
  sends to a server, so it is in no log; the page asks for no referrer;
- a **6-digit code**, drawn uniformly.

Only **hashes** are kept: SHA-256 of the token, and of the token with the
code.

On the welcome page the person enters the code and chooses a password of
at least 12 characters. Accepting **sets their credential and grants
their access** with the functions the operator's routes use
(`setCredential`, `grantAccess`), then they sign in on the usual page.

- **Once**: it is claimed before the credential is set, so the same link
  cannot be used twice at once.
- **For 72 hours**, then expired.
- **Five wrong codes** spend it.
- **A new invitation** for the same person at the same customer cancels
  any still pending.

If the email cannot be sent (Resend refuses, or the key is not set), the
invitation is still made, and says why it was not sent (502 `not_sent`),
so it can be resent once that is fixed.

### Who may invite

| Who | How | Scope |
|---|---|---|
| **The operator** | privileged routes, from the operator console | any customer, all its environments or chosen ones |
| **A customer's administrator** (`Admin.UserManagement`) | the instance asks the control plane with its **own environment key** | that customer and **that environment only**; a delegated administrator only for people in the units they administer |

### Routes

`vf-licence`:

| Route | Who | Does |
|---|---|---|
| `GET /invitations?customerId=` | operator | the latest invitations, no secrets |
| `POST /invitations` `{ email, customerId, environmentIds? }` | operator | invite |
| `POST /invitations/:id/resend`, `/cancel` | operator | a new link and code, or cancel |
| `GET`/`POST /environments/:id/invitations` | that environment's key | its people's invitations, or invite one |
| `POST /invitations/view` `{ token }` | public | who and where, and whether it can be used |
| `POST /invitations/accept` `{ token, code, password }` | public | set the password |

The operator's are recorded in the admin log, as every privileged route.

`vf-app`: `POST /org/users/:id/invite` and `GET /org/users/invitations`,
under `Admin.UserManagement`, through the licence service binding.

`vf-ui` proxies `/invitations/view` and `/invitations/accept` to the
control plane, before anybody is signed in, as it does sign-in itself;
never the operator's routes.

### On screen

**The operator console** (`vf-admin`):

- a new **Invitations** panel: choose a customer, give an email,
  **Invite**; the latest invitations with who sent them (the operator, or
  an administrator in an environment), their state, until when, and
  **Resend** and **Cancel**;
- in **Partners**, each person now says *not invited yet*, *invited,
  until…*, *invitation not sent: why*, *expired*, or *can sign in to the
  sandbox*, with **Invite** or **Invite again**. **Add person** invites at
  once when the sandbox has an environment.

**The Access screen**, People tab (`vf-ui`, `access.js`):

- a **Signing in** column: Not invited, Invited until…, Invitation not
  sent, Can sign in, Expired; with **Invite** or **Invite again**, and
  what happened beneath it;
- **New person** has *Email them an invitation to choose their
  password*, ticked; after Create the pop-out says whether it went.

**The welcome page** (`welcome.html`, `welcome.js`), laid out as the
sign-in page: who it is for and where, the code, the password twice, and
**Set my password**; then *Your password is set* and **Go to sign in**.
It says in words when a link is not valid, expired, replaced, spent or
already used, and how many tries are left after a wrong code. The spent
link leaves the address bar.

Strings in English and German: `vf-licence` `0239`.

### One thing an invitation does not do

It lets a person **sign in**; it does not make them a user **inside** an
instance. A person signing in to an instance where they have no user
record is told *"no account here"*, as before. So:

- from the **Access screen**, which adds the person and invites them
  together, they are ready;
- from the **operator console**, invite people who already have a user
  record in the instance, such as a new customer's or partner sandbox's
  first administrator, created as it is today when the instance is set
  up. They then add and invite their colleagues from Access.

## Not built

- The email in the person's language. It is in English.
- Invitations listed for a customer in the console beyond the latest 30,
  or filtered.
- A password reset ("forgot my password"). The same mechanism would serve
  it, and it is the natural next use.
- Making the instance's user record from the operator console.

## Verification

- **`vf-licence`**, `invitations.test.ts`, 8 tests:
  - the email (link with the token in the fragment, the code, the
    sender), only hashes kept, view, a short password refused, accepted
    with the code typed with a space, the credential and access set, and
    once only;
  - five wrong codes spend it; an unknown token;
  - 72 hours, resend (a new token), a new invitation cancels the pending
    one, cancel;
  - refusals (email, customer, no environment, another customer's
    environment) and *not sent* when email is not configured;
  - the email's words;
  - a partner's person shows their sandbox invitation;
  - the router: an instance invites only for its own environment with
    its own key, and lists its people's; the operator's routes are
    privileged and attributed; view and accept are public.
- **`vf-admin`**: the invitation routes forwarded; view and accept never.
- **`vf-app`**, `invitations-route.test.ts`, 3 tests: asked with the
  environment key by the person's email; what was refused and an
  unreachable control plane passed on; the router's permission and the
  missing configuration.
- **`vf-ui`**: 5 Access tests (the column and its states, Invite and
  what happened, unreadable and no permission, a new person invited, or
  not when unticked) and 3 welcome-page tests (accepted, the password and
  code checks, each reason it cannot be used), with the real strings.
  All 8 fail against the interface before this change. Worker: the two
  public paths proxied and the operator's not; the welcome page's markup
  holds no English and asks for no referrer.
- **The operator console**, in a browser against stubbed routes: Invite,
  Invite again, Add person inviting, the Invitations panel's Invite,
  Resend and Cancel each send what they should. Screenshots of it and the
  welcome page.
- **Migrations** replay: `vf-licence` 239.
- **Full runs**: `vf-app` 3411, of which 3408 pass (the two known failures, 0511, and the known router timeout in `index.test.ts`, "need Admin.Configure, and say what is missing", which passes alone); `vf-ui` browser 1434, of which 1433 pass
  (the known `typography.test.ts` 10px gap), worker 107 of 107;
  `vf-licence` 336 of 336; `vf-admin` 11 of 11.

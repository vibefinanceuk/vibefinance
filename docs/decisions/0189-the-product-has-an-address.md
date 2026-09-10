# 0189 — The product has an address

**Status: configured.** `vf-ui` answers at `app.vibefinance-ai.com`.

---

## `www.` was the question and `app.` is the answer

Asked as *"how should I set up `www.vibefinance-ai.com` to redirect?"*,
and the answer turned on something underneath it:

> Actually you raise a good point — that site would be a marketing page,
> linking to the customer app.

So there are **two things and three names**. The product needs one, and
a marketing site will want `www.` and the apex.

**`app.`, not `www.` and not the apex.** Giving the product one of those
would mean moving it the day the site arrives — or a front page and an
application sharing a hostname, which is a decision nobody would make
deliberately.

**And none of it is a redirect.** A custom domain on the Worker is not a
forward to somewhere else; it is where the thing lives.

---

## What would have broken, and did not

`vf-app` and `vf-licence` both set
`ALLOWED_ORIGINS: https://vf-ui.vibefinance.workers.dev`.

**Adding a route disables `workers.dev`** — decision 0187 found this on
`vf-admin`. So the origin those two trusted was about to stop existing,
and every API call from the new hostname would have been refused: a
browser reporting a CORS failure, and **nothing anywhere saying why.**

Both moved in the same change. A hostname is one setting in three
files, and the two that are not the hostname are the ones that fail
silently.

### And this is not defence in depth

An earlier version of this record said the browser never reaches
`vf-app` directly, and that `ALLOWED_ORIGINS` there was therefore
belt-and-braces. **The operator corrected it**, and the code agrees with
them.

`vf-ui` is **one entry point**: it asks `vf-licence` which instances a
person may reach — `/my-environments`, which *"cannot require a session,
because choosing an instance is what creates one"* — and then proxies to
that instance at `session.instanceUrl`.

**So `vf-app` is directly reachable**, and its `ALLOWED_ORIGINS` is what
decision 0098 says it is: *"which web pages may read a signed-in
person's data."* Pointing it at an address that no longer exists is not
a tidy-up. It is the live setting.

I read `bff: true` in `config.js` and inferred an architecture from a
flag rather than reading the twenty lines that describe it.

---

## What is not built

- **The marketing site.** `www.` and the apex resolve to nothing.
  Cloudflare Pages is the obvious home and it can wait.
- **`vf-app` and `vf-licence` are still on `workers.dev`.** Neither is
  reached by a browser, so neither needs a name — and `vf-app`'s API
  being on Cloudflare's domain rather than the customer's is a thing
  somebody will eventually notice.
- **Nothing tests that the origins agree.** Three files name the same
  hostname and only a deploy would prove they still match.

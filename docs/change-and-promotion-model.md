# The change and promotion model

How work gets authored, reviewed and promoted to production when the
assistant session cannot reach production itself. Written so that a
session which has never seen the repository can be told to follow it.

Two roles throughout: **the session** (an assistant working in an
isolated cloud sandbox with a clone of the repository) and **you** (the
operator, on your own machine, holding the GitHub and Cloudflare
credentials).

---

## 1. The constraint that shapes everything

The session runs in an isolated cloud sandbox. Two things it cannot do:

**It cannot push to GitHub.** The sandbox's git egress is blocked at the
proxy layer. This is infrastructure, not credentials — no personal access
token, deploy key, SSH remote or `credential.helper` setting changes it.
A session that starts debugging authentication here will burn an hour and
end where it started.

**It cannot deploy to Cloudflare.** No `wrangler deploy`, no
`wrangler d1 execute --remote`, no API token. The production account is
yours and stays that way.

So the session is not a deployer. It is an author that hands over
reviewable, verified, self-contained work. You are the only path to
production, deliberately, and the model is built around that rather than
around trying to escape it.

---

## 2. The authoring loop

Every change goes through the same four steps on the session's side.

**Step 1 — commit locally.** Real commits on `main` in the sandbox
working copy, with real messages. The commit message is the primary
written record of *why*; it is what survives when the conversation does
not. One commit per coherent change, not one per file and not one per day.

**Step 2 — bundle the commits.**

```
git bundle create /tmp/<n>.bundle <base>..main
```

`<base>` is the last commit you have confirmed deployed (§4).
**Name the branch ref, not `HEAD`.** `<base>..HEAD` produces a bundle
with no branch name in it, which cannot be pulled by name — it fails on
your side, after you have already downloaded it.

**Step 3 — test the pull before sending it.** The bundle is not the
change; the *pull* is. Simulate your side:

```
git clone -q . /tmp/scratch-clone
cd /tmp/scratch-clone
git checkout -q <base> -B main
git pull -q /tmp/<n>.bundle main
git log --oneline -5
npm test
```

If it does not fast-forward cleanly in the scratch clone, it will not on
your machine either. This step catches wrong bases, missing commits and
bundles built from the wrong ref — all of which otherwise fail after
you have downloaded the file and switched context.

**Step 4 — send it,** and say four things plainly:

- the base commit it applies to;
- what the change does, in a sentence;
- which Workers must be deployed, and whether they must go together (§5);
- whether a migration must be applied, and its number (§6).

Anything else is noise. You are going to read this on the way to a
terminal.

---

## 3. The promotion path, end to end

There are four places the code exists, and they are promoted in a fixed
order. The important thing to understand is that **GitHub and Cloudflare
are two separate promotions.** Pushing does not deploy anything, and
deploying does not push anything. Wrangler uploads from the working
directory on your machine; it never looks at the remote. It is entirely
possible — and has to be actively avoided — to have production running
code that is not in GitHub, or GitHub holding code that is not in
production.

```
  sandbox working copy          author, commit, test
          |
          |  git bundle create /tmp/<n>.bundle <base>..main
          v
  the bundle file               a reviewable unit: a named commit range
          |                     with a stated base
          |  delivered to you as a file
          v
  your local clone              git pull <bundle> main
          |
          +----> GitHub (origin)        git push          — the record
          |
          +----> Cloudflare             npx wrangler deploy — the runtime
```

**The order you run it in, and why.**

```
# 1. take the change
git pull /path/to/<n>.bundle main
git log --oneline -3            # confirm the commits you expected arrived

# 2. record it before you run it
git push

# 3. schema and content first, code second
python3 <migrations-dir>/apply_migrations.py --remote

# 4. the runtime — one command per Worker named in the send message
cd <worker-a> && npx wrangler deploy && cd ..
cd <worker-b> && npx wrangler deploy && cd ..

# 5. verify against the real origin, not the dashboard
curl -sI https://<production-domain>/ | head -1
```

**Push to GitHub before deploying.** If a deploy goes wrong, the fastest
recovery is `git revert` and redeploy, and that is only available if the
commit is on the remote. Pushing first costs three seconds and makes the
repository the reliable description of what is live.

**Migrations before Workers.** An append-only chain is additive — new
tables, columns and rows — so applying it first means the old code is
running against a superset of what it expects, which is harmless.
Deploying code first means new code reading columns that do not exist
yet, which is a 500 on the live site for however long the gap lasts.

**Shared code means every Worker that imports it, back to back.** Any
module imported by more than one Worker has to be deployed to all of them
in the same sitting; deploying one and not the other leaves two halves of
the system running different code against the same database. The send
message must say so explicitly, and the session should check
`git diff --stat <base>..main` for the shared directory rather than
trusting its memory.

**Static assets ride with whichever Worker serves them.** Where a Worker
is configured with an `[assets]` block pointing at a directory, a change
to a file in that directory is a deploy of that Worker even though none
of its source code changed. This is the easiest promotion to miss,
because nothing under `src/` moved.

**Rolling back.** Code rolls back with `git revert <sha>` followed by the
same deploy commands — never by deploying an older checkout, which
desynchronises the remote from production. The migration chain does
**not** roll back: it is append-only, and an undo is a new,
higher-numbered migration that states what it is reversing and why.
Cloudflare also keeps prior Worker versions in the dashboard, which is
the right tool for an emergency five-minute revert, but the repository
must be brought back into line afterwards or the next deploy silently
re-introduces the problem.

**One thing that bites: dashboard edits do not survive a deploy.**
Environment variables and feature flags in `wrangler.toml` can be flipped
in the Cloudflare dashboard for immediate effect, which is genuinely
useful. But the next `wrangler deploy` from the repository resyncs them
from the file and overwrites the dashboard value. A dashboard toggle is a
temporary measure; if it should stick, the file has to change too.
Secrets are the exception — they are set with `wrangler secret put` and
are not in the file at all.

**Where one chain applies to many databases**, promotion stops being a
single command and becomes a rollout. Decide the rule before it is needed:
which database goes first, what is checked between batches, and what
happens when one fails halfway. A per-tenant migration is a fleet
operation, and treating it as a single step is how a chain ends up applied
to some tenants and not others with nothing recording which.

---

## 4. The base commit is the last one *confirmed* deployed

The single most important rule in this model.

`<base>` is not "the last commit the session made." It is not "the tip
of `main` in the sandbox." It is the last commit **you** have confirmed,
by actually seeing it live, is what production is running. Only you can
set it, because only you can see production.

Record it as you go (see §12 — where this lives is per-initiative). The
session reads it before bundling; it does not track deploys itself,
because it cannot see whether one happened.

---

## 5. What deploys when something changes

Write the equivalent of this table for the repository once, and keep it
next to the model. The categories are what matter:

| what changed | what deploys |
|---|---|
| a Worker's own source | that Worker |
| files in a Worker's assets directory | that Worker |
| a module imported by more than one Worker | **all of them, back to back** |
| a migration | the migration run; a Worker deploy only if code reads the new shape |
| tests, tooling, documentation | nothing — they never ship |

The row that causes real incidents is the third. The row people forget is
the second.

---

## 6. Migrations

Schema and content both live in a numbered, append-only chain. Nothing is
edited into the database by hand, and an applied migration is not edited
without saying so.

Migrations carry their own assertions in comments, checked by the runner:

- `-- ASSERT:` — point-in-time. "This migration did what it said."
- `-- ASSERT ALWAYS:` — a standing invariant, re-checked at the end of
  every replay of the whole chain, forever.

Two rules worth carrying over verbatim. If the assertion parser splits a
line on a comparison operator to separate query from expected value, then
**anything containing a comparison inside it must be wrapped in a
subquery**. And a **standing invariant must not hardcode a count**,
because the next legitimate change to the data then forces an edit to an
already-applied migration. Phrase standing invariants as "no row violates
X", never "there are exactly N rows".

```
python3 apply_migrations.py --replay-only        # replay the chain in memory, run every assertion
python3 apply_migrations.py --dry-run --remote   # show what would apply to production
python3 apply_migrations.py --remote             # you run this, not the session
python3 apply_migrations.py --remote --refresh-checksums   # clear drift on a legitimately edited migration
```

The replay-only run belongs in the test suite, so the chain is validated
on every change rather than at deploy time.

---

## 7. The bar a change clears before it is bundled

This is what makes the model work at all — the session cannot deploy, so
it has to be right before it leaves.

**The full suite is green**, not just the suite covering the change.

**Every new check has been watched to fail.** Break the thing it watches,
see it go red, put it back. A test nobody has seen fail is not a test; it
is a comment that takes eight minutes to run. The recurring pattern behind
every one that has been caught doing nothing: *a check that arranges its
own precondition cannot fail on that precondition being wrong.*

**The rendered result was measured, not the instruction issued.** A
property you set tells you what your code did; what the reader sees is a
different measurement. A link that is present is not a link that resolves.
A page that has a URL is not a page anything links to.

**It was run against the real code path, not a mock.** A harness that
calls a render function directly never goes through the router, so every
check can pass against a page the live site refuses to serve. Where a
local preview can serve the actual Worker against a replayed migration
chain, that is the thing to test against — and its known divergences from
production should be written down, because otherwise they get reported as
defects.

**The defect was treated as a class, not an instance.** When you report
one broken row, the fix sweeps the corpus for the rule. The reported row
is very rarely the only one.

---

## 8. After the deploy — verification against the live origin

A green suite is not evidence about production. Real defects get found
after a green suite, by the person looking at the deployed site. So the
loop closes with a measurement against the real origin — one curl,
grepped for the specific thing the change claimed to do:

```
curl -sL "https://<production-domain>/<path>" | grep -o '<pattern>'
```

This is the step that catches the class of problem where the code is
correct and the delivery is not: a header the CDN strips, a route the
asset layer answers before the Worker runs, a cache that is still holding
the previous document. None of it reproduces locally, because locally
there is no CDN in front.

---

## 9. Standing prohibitions for a session working this way

- **Never push, and never try to.** Don't reconfigure remotes, don't hunt
  for tokens, don't propose a GitHub App. It's the proxy.
- **Never deploy**, and never assume something is deployed because it was
  sent.
- **Research is WebSearch and WebFetch only.** Never browser-automation
  tools — those drive a real person's browser. Never bash, curl, python or
  any other means of fetching web content as a way around a blocked
  domain: if WebFetch refuses a domain, report that it could not be
  verified.
- **Say what was not verified.** A mechanical comparison that proves a
  number was not reformatted cannot prove the sentence around it still
  means the same thing, and should not be described as if it could.
- **Edit the generator, not the output.** Where a script produces a file,
  changing the file directly is a change the next regeneration silently
  reverts.

---

## 10. A paste-able instruction for a new session

> You are working on a repository you cannot push and an environment you
> cannot deploy to. The sandbox's git proxy blocks pushes to GitHub —
> this is infrastructure, not credentials, so do not attempt to fix it.
> You have no Cloudflare access.
>
> Deliver work as git bundles. Commit locally on `main`, then
> `git bundle create /tmp/<n>.bundle <base>..main`, naming the branch
> ref rather than `HEAD`. `<base>` is the last commit I have confirmed
> deployed — "this is deployed" from me is the only signal for that; ask
> if you are unsure. Before sending, test the pull in a scratch clone
> reset to `<base>` and run the full suite there. Then send me the bundle
> as a file and tell me, in that message: the base commit, what the change
> does in one sentence, which Workers must be deployed and whether they
> must go together, and whether a migration must be applied and its
> number.
>
> I promote it from there: pull the bundle, push to GitHub, apply
> migrations against production, then `npx wrangler deploy` in each Worker
> directory you named, then verify against the live origin. GitHub and
> Cloudflare are separate promotions — a deploy pushes nothing and a push
> deploys nothing — so tell me both halves.
>
> Before anything is bundled: the full suite is green, every new check has
> been broken and watched to fail, and what you measured is the rendered
> result rather than the instruction you issued. Say what you did not
> verify.
>
> Do not use browser-automation tools — they drive my real browser. Use
> WebSearch and WebFetch for research, and if WebFetch refuses a domain,
> report it as unverified rather than fetching it another way.
>
> I deploy, and I report back what I see. Treat "this is deployed" as the
> start of the next cycle, not the end of the task.

---

## 11. Why it is shaped this way

The model is a response to a hard constraint, but three of its properties
are worth keeping even where the constraint does not apply.

A bundle is **reviewable as a unit**: a named range of commits with a
stated base, which either applies to a known state or does not. There is
no ambiguity about what shipped.

The **human is the deploy gate**, which means every change has to survive
being explained in four lines to someone about to run it. That
explanation is a better filter for half-finished work than any test.

And the **feedback loop is explicitly reopened** after deployment rather
than closed. The person who deploys sees the real thing, and what they
report back is treated as the next input, not as an exception.

---

## 12. What to fill in per initiative

The model above is portable. These are the values it needs:

- the production domain, and a one-line curl that proves a deploy landed;
- the Worker directories and their deployed names;
- which directory holds code shared between Workers;
- where the migration chain lives and what the runner is called;
- where the last-confirmed-deployed commit is recorded;
- the what-changed → what-deploys table from §5;
- the known divergences between local preview and production;
- and, where a chain applies to many databases, the rollout rule.

---

## Filled in for VibeFinance

- **Production domain**: none yet — nothing has been deployed. First
  curl check to be agreed once the first deploy happens.
- **Worker directories**: `workers/vf-app` (deployed name `vf-app`),
  `workers/vf-licence` (deployed name `vf-licence`). See
  docs/decisions/0001-worker-split-and-tenant-resolution.md for why these
  two and not one.
- **Shared code directory**: `shared/` — imported by both `vf-app` and
  `vf-licence` (`@vibefinance/shared`) as of `shared/licensing/`. A
  change here now means both Workers deploy back to back — see §5's
  "module imported by more than one Worker" row, which applies for
  real starting with this bundle, not hypothetically.
- **Migrations**: two independent chains, one per database —
  `migrations/` (against `vf-app-poc`) and
  `workers/vf-licence/migrations/` (against `vf-licence-poc`), both run
  by the same `migrations/apply_migrations.py --migrations-dir <dir>`.
- **Last-confirmed-deployed record**: `DEPLOYED.md` at repo root, one row
  per Worker and one row per database, since the two Workers are promoted
  independently.
- **What-changed → what-deploys**, specific to this repo:

  | what changed | what deploys |
  |---|---|
  | `workers/vf-app/src/**` | `vf-app` |
  | `workers/vf-licence/src/**` | `vf-licence` |
  | `shared/**` | **both `vf-app` and `vf-licence`, back to back** — both import it as of `shared/licensing/` |
  | `migrations/*.sql` | the migration run against `vf-app-poc`; a `vf-app` deploy only if its code reads the new shape |
  | `workers/vf-licence/migrations/*.sql` | the migration run against `vf-licence-poc` (`--migrations-dir workers/vf-licence/migrations`); a `vf-licence` deploy only if its code reads the new shape |
  | a Worker's `wrangler.jsonc` (bindings, compat date/flags, vars, triggers) | that Worker |
  | a Worker's `wrangler.test.jsonc` | nothing ships — test-only, see the divergences entry on why it exists separately from `wrangler.jsonc` |
  | `scripts/*` | nothing ships — run locally by the operator, never deployed |
  | `eslint.config.js`, `*.test.ts`, `docs/**`, this file | nothing |

- **Known divergences between local preview and production** (found
  while building the first test suite, not asserted from memory —
  documented in `workers/vf-app/test/setup.ts`):
  1. `@cloudflare/vitest-pool-workers` tests run inside real workerd, not
     plain Node — arbitrary host-path `readFileSync` does not reliably
     resolve there even with `nodejs_compat`; the migration SQL is
     imported as a bundled string (`?raw`) instead.
  2. D1's `exec()` splits its input by newline and executes each
     non-empty line as its own statement — a multi-line `CREATE TABLE`
     has to be collapsed to one statement per line first. Python's
     `sqlite3.executescript()`, used by `apply_migrations.py
     --replay-only`, has no such restriction, so this collapsing step is
     local-test-only.
  3. Storage does not appear to reset between individual `it()` blocks
     within one test file in this pool-workers version — no
     `isolatedStorage` option was found in the installed release. The
     test setup drops and recreates every table before each test rather
     than relying on framework isolation.
  4. `npm install` in this repo requires `legacy-peer-deps=true` (set in
     `.npmrc`) — a plain install hits a real npm arborist bug
     (`Cannot read properties of null (reading 'edgesOut')`), not a
     dependency conflict that needs resolving by hand.
  5. `apply_migrations.py --remote` took six rounds against real
     Cloudflare infrastructure to get right, and **is now confirmed
     working** — `0001_rule_engine_schema.sql` applied successfully
     against the real `vf-app-poc` database on 29 August 2026 (see
     `DEPLOYED.md`). The individual bugs and fixes are in the git log
     (`cae2429`, `c29052c`, `4ed7104`, `a3e72d5`, `98daf1e`); the
     lessons worth carrying forward without re-reading all five:
     - `wrangler d1 execute --remote` can prompt for interactive
       confirmation; pass `--yes` for any non-interactive/scripted use.
     - `--file=path` (writes) and `--command="..."` (reads) are **not**
       interchangeable despite both accepting arbitrary SQL: `--file`
       appears to route through a bulk import/upload path that reports
       execution statistics instead of returning query rows, so any
       code that needs row data back must use `--command` — but
       `--command` breaks on large multi-line/multi-statement SQL
       (mis-tokenized somewhere between subprocess, npx, and wrangler's
       own argument parser), so DDL and other write-only statements
       must use `--file` instead. The two failure modes only became
       distinguishable by running against real infrastructure and
       reading wrangler's actual output — none of this was guessable
       from the CLI's `--help` text or general docs alone.
     - The bookkeeping table (`_migrations`) needs its own idempotent
       `CREATE TABLE IF NOT EXISTS` step before it's ever queried, since
       a brand-new D1 database won't have it yet.
  6. `npx wrangler deploy` from inside a Worker directory (e.g.
     `workers/vf-app`) fails to resolve `@vibefinance/shared` — an npm
     workspace package with no build step, `main` pointing straight at
     `index.ts` — with `Could not resolve "@vibefinance/shared"`, until
     `npm install` has been run from the **repo root** at least once.
     Not a wrangler or esbuild bug: the workspace symlink
     (`node_modules/@vibefinance/shared` → `../../shared`) that makes
     the import resolvable at all is created by the root-level install,
     and running `npm install` from inside a Worker subdirectory alone
     does not create it. Confirmed on 29 August 2026 — `npm install` at
     the repo root, no code or config change, resolved it. Worth
     checking this before reaching for Wrangler's `alias` config field
     (the workaround its own error message suggests), per Cloudflare's
     own troubleshooting order: verify the package is actually
     installed before aliasing around a resolution failure.
  7. Declaring an `ai` binding in a Worker's `wrangler.jsonc` breaks
     **every** test in that Worker under `@cloudflare/vitest-pool-workers`,
     not just tests that touch it — the pool tries to open a real remote
     connection for any declared `ai` binding before a single test runs,
     since Workers AI has no local-simulation equivalent to D1's, and
     that connection needs `CLOUDFLARE_API_TOKEN`, which this session
     doesn't have. `workers/vf-app/wrangler.test.jsonc` is a deliberate
     near-duplicate of `wrangler.jsonc` without the `ai` block, used only
     by `vitest.config.ts`; the `d1_databases` block must be kept in
     sync by hand between the two files (accepted trade-off — see the
     file's own comment for why the `database_id` half of that can't
     actually drift into a real problem).
  8. The root-level `npx tsc --noEmit` has never actually been a clean
     check for this repo — confirmed by running it against the commit
     immediately before this one, not assumed: it already failed with
     `Cannot find module 'cloudflare:test'` for every test file that
     imports it, because the root `tsconfig.json` doesn't know about the
     ambient types `@cloudflare/vitest-pool-workers` provides at
     test-run time through its own mechanism, separate from the project-
     wide compile. Not introduced by anything in this session; recorded
     here because it's the kind of gap that's easy to mistake for a
     regression the next time someone runs `tsc` directly and sees red.
     `npm test` (which runs `vitest`, not `tsc`) is unaffected and
     remains the real check.
  9. `apply_migrations.py --replay-only` used to be a strictly weaker
     check than real D1 for foreign key violations: D1 enforces FK
     constraints by default (Cloudflare's own docs: "identical to the
     behaviour you would observe when setting PRAGMA foreign_keys = on
     in SQLite for every transaction"), but plain SQLite — and
     therefore Python's `sqlite3` module — defaults this off. Confirmed
     directly (a fresh `sqlite3` connection's own `PRAGMA foreign_keys`
     reports `0`), not assumed from the conflicting claims found while
     researching this. Fixed by adding `PRAGMA foreign_keys = ON` to
     the replay connection; the resulting `sqlite3.IntegrityError` on a
     real violation is caught and reported the same way every other
     failure mode in this tool is, not as a bare traceback.
  10. `vitest` (this repo's actual test runner, via `esbuild`) does not
      type-check — it transpiles and runs. Two real bugs shipped past a
      fully green `npm test` and were only caught by `npx tsc --noEmit`:
      a `Uint8Array<ArrayBufferLike>` vs. `BufferSource` generic
      mismatch in `shared/licensing/token.ts` (harmless at runtime,
      real at the type level), and `workers/vf-app/src/index.ts`'s
      `scheduled()` handler being declared with 2 parameters instead of
      the real Workers platform's 3 (`event, env, ctx`) — invisible to
      every test because nothing in this repo called it with fewer
      arguments than it needed. Neither is fixed by running `tsc` more
      often by habit; both are the kind of thing worth remembering to
      run it for before trusting a green `npm test` completely,
      especially after touching a public function signature.
  11. A plain `fetch()` from *inside* a deployed Worker to another
      Worker's `*.workers.dev` URL silently 404s — confirmed live, the
      first time either scheduled inter-Worker call was ever actually
      exercised in production rather than from a terminal. Not a bug in
      this codebase; a deliberate Cloudflare anti-loop restriction on
      `workers.dev` subdomains, confirmed against Cloudflare's own docs.
      Fixed with a Service Binding (`workers/vf-app/wrangler.jsonc`'s
      `services` block) — see docs/decisions/0005-service-binding.md
      for the full diagnosis and fix. Declaring a `services` binding in
      `wrangler.test.jsonc` would hit the same class of problem the
      `ai` binding did (a real remote connection, or a second auxiliary
      Worker, neither available here) — tests inject a fake
      `Fetcher`-shaped object directly onto `env` instead, the same
      established pattern as the `ai` binding and the licence public
      key.

- **Rollout rule for a chain applied to many databases**: not yet
  decided — the Blueprint lists this as open ("not decided, and waiting
  on a real customer"). `apply_migrations.py --remote` currently takes a
  single `--database` name; a fleet-wide rollout command does not exist
  yet and is Blueprint build-order step 5 ("Fleet tooling").

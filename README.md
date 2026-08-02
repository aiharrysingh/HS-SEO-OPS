# HS SEO Ops

SEO operations tool with a white-label client view. See
[docs/hs-seo-ops-plan.md](docs/hs-seo-ops-plan.md) for the plan this is built against.

**Phases 1 and 2 are built.**

- **Phase 1 — Content Performance Tracker.** Every blog and landing page across
  all clients, with clicks and impressions from Search Console, and performance
  measured from go-live at week 1, month 1, month 3 and month 6.
- **Phase 2 — Weekly & monthly reports.** Drafted from the data by a
  deterministic rule engine, reviewed and approved by a human, exported branded.

**No LLM is used anywhere in this tool.** Reports are computed, not written —
see [plan §4](docs/hs-seo-ops-plan.md) for the decision and what it trades away.

## Run it

```bash
npm install
npm run setup   # migrate + seed demo data
npm run dev
```

Open <http://localhost:3000>. No accounts, no API keys, no database to
provision — it comes up with three demo clients and a year of realistic
traffic.

## What's on screen

| Route | What it does |
|---|---|
| `/` | Portfolio: every client, 28-day clicks with change, trend, sync state |
| `/clients/[id]` | The tracker. Stat tiles, daily clicks and impressions, and the page table in two views — current window, or measured from each page's go-live |
| `/clients/[id]/pages/[id]` | One page: milestones, full history since publish, and a table of every daily value |
| `/clients/[id]/reports` | Report list, generate buttons, and the draft→approved time |
| `/clients/[id]/reports/[id]` | Edit and approve, with the figures the report was built from alongside |
| `/reports/[id]/export` | Branded, print-first client copy (print to PDF) |

The page table sorts on any column, filters by type, and searches title, path
and target keyword.

## Database

Postgres either way — the only thing that changes is the connection string.

- **`DATABASE_URL` unset** → [PGlite](https://pglite.dev), an embedded Postgres
  writing to `.pglite/`. Real Postgres SQL, nothing to install or sign up for.
- **`DATABASE_URL` set** → any Postgres. Neon, Supabase, your own.

The same migrations in `drizzle/` apply to both.

```bash
npm run db:generate   # schema.ts -> SQL, after editing the schema
npm run db:migrate    # apply migrations
npm run db:seed       # replace all data with the demo set
npm run db:reset      # drop everything (refuses to touch a remote database)
```

## Signing in

Team members sign in with Google. Copy `.env.example` to `.env.local` and set
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI` and `SESSION_SECRET`. The first person to sign in
becomes admin; after that, sign-in isn't open sign-up — an admin adds new
teammates as a `users` row (by email) before they can sign in.

`/account` lists every Search Console property that signed-in Google account
has read access to (via `sites.list`, using that person's own OAuth grant —
separate from the service account below, which is what actually pulls data on
a schedule) and lets you link one to a client.

Every screen under the app shell and every mutating API route requires a
session; `src/proxy.ts` (Next 16's renamed Middleware) does a cookie-presence
check to redirect quickly, but `src/lib/auth.ts` — checked in the layout and
in each route handler — is what actually enforces it, per Next's own guidance
that Proxy alone isn't a session/authorization solution.

The client-facing `/reports/[id]/export` view stays open without login, as it
already was — there's no client-side auth yet (plan defers that to a magic
link), so it's unchanged rather than silently locked.

## Search Console

Two ways to authorise a client's sync — pick whichever fits, per client:

**A team member's Google sign-in (no setup)** — on `/account`, every property
that signed-in Google account can see is listed. Linking one to a client (or
creating a client straight from it) records whose sign-in that was; syncing
then uses that person's own OAuth grant. If they can already see the property
on `/account`, it can sync immediately — nothing to configure.

**A shared service account (works without depending on one person's login)**
— copy `.env.example` to `.env.local` and fill in the Google values:

1. Create a service account and enable the Search Console API.
2. In Search Console, add the service account's email as a user on each
   property (read access is enough).
3. Set `gsc_property` on each client row — `sc-domain:example.com` for a domain
   property, or the full URL for a URL-prefix one.

`syncClient` tries a client's linked Google account first, then falls back to
the service account (see `resolveAuth` in `src/lib/gsc.ts`). A client needs
only one of the two.

Then **Sync now** on a client screen, or schedule the nightly pull:

```
GET /api/cron/nightly
Authorization: Bearer $CRON_SECRET
```

It refuses to run without `CRON_SECRET` set — otherwise anyone could burn the
day's quota. Returns `207` if any client failed, so a partial failure doesn't
read as success.

A client with neither a linked Google account nor the service account
configured gets a clear per-client error instead of syncing failing quietly.

### What sync does

Pulls `page` × `date` rows, which keeps each client to a few hundred rows a day
— far inside the free quota. It re-pulls the last 5 days every run, because GSC
revises recent days after first publishing them, and matches URLs on a
normalised form (trailing slash, `www.`, query string) so a stored URL that
differs cosmetically doesn't silently report zero. URLs that GSC returns but
aren't in `pages` are reported back as unmatched rather than auto-created — the
publish date and target keyword on a page are curated, not derivable.

## Reports

Point `SEO_REFERENCES_DIR` at the unzipped Cowork skills folder (the one
containing `client-report/`), then hit **Generate weekly** or **Generate
monthly** on a client's Reports screen. Drafts appear immediately.

```
GET /api/cron/weekly-reports                    # schedule after the nightly pull
GET /api/cron/weekly-reports?cadence=monthly
Authorization: Bearer $CRON_SECRET
```

### How a report is written

There is no model. `src/lib/findings.ts` is a rule engine: each rule reads the
computed figures and either fires with its evidence attached or stays silent.
`reportWriter.ts` lays the fired findings out in the `client-report` house
format. The same data always produces the same report, byte for byte.

Rules currently implemented — AI Overview signature (impressions held, clicks
fell, position flat) · confirmed-update date matching · branded vs non-branded
divergence · ranking loss vs CTR compression vs demand drop · seasonality via
year-on-year · movement concentrated in one page · pages that fell to zero · new
pages still maturing · **and an explicit "unexplained, here is what to check"
when nothing fits.** That last one matters most: the standard says to admit when
you can't explain a movement, and a rule engine does that where a narrator
would invent a cause.

The trade is prose polish and novel causes. A human still edits every draft —
the target was an hour down to under fifteen minutes, not zero.

### The dated facts

`current-state.md` is read at runtime, never baked into the source. Its
`Last verified` date drives a staleness banner past 60 days and a warning inside
the report itself, and its confirmed-update table is parsed to date-match traffic
movements — the standard's "match the date first" rule, done arithmetically.
With `SEO_REFERENCES_DIR` unset, generation refuses rather than falling back.

## Decisions made while building

**The Search Console lag (plan §6 left this open).** Every window in the app
ends at the last day GSC is expected to have settled — today minus 3 days — and
that cutoff is stated on every screen. Both halves matter: the lagging window
keeps the numbers honest, and printing the date stops the weekly "why doesn't
this include the weekend" question. It is one constant, `GSC_LAG_DAYS` in
[src/lib/dates.ts](src/lib/dates.ts); change it there and the whole app moves.

**Average position reads in places, not percent.** "Position rose 5.6%" is not
how the job is done, and percent misleads — the same one-place move is 33% at
position 3 and 2% at position 50. Position deltas show places, and the arrow
tracks rank movement, so up means moved up the results even though the number
went down.

**Milestones are withheld until they complete.** A page 40 days old shows no
Month 3 figure rather than a partial one, because a partial number invites
exactly the wrong comparison.

## Layout

```
src/
  app/
    (app)/                     sidebar shell + screens, incl. account
    login/                     Google sign-in
    api/auth/google/           OAuth start + callback
    api/auth/logout/
    api/clients/[id]/sync/     manual sync
    api/clients/[id]/reports/  generate a draft
    api/clients/[id]/gsc-property/  link a discovered property to a client
    api/reports/[id]/          save, approve
    api/cron/nightly/          scheduled pull for all clients
    api/cron/weekly-reports/   scheduled drafts
  components/                  charts, table, tiles, nav/user menu
  db/                          schema, connection, migrate, seed, reset
  lib/
    dates.ts                   the GSC lag decision, milestone and period windows
    metrics.ts                 tracker rollup queries
    gsc.ts                     Search Console ingest (page×date and date×query)
    brand.ts                   branded vs non-branded classification
    reportData.ts              the figures a report is built from
    findings.ts                the diagnosis rules
    reportWriter.ts            house-format markdown assembly
    updates.ts                 confirmed-update timeline parsing
    references.ts              shared skill files, loaded and dated
    format.ts                  number and delta formatting
    session.ts                 signed session cookie (HMAC, no library)
    auth.ts                    getCurrentUser / requireUser / authGuard
    googleOAuth.ts              Google sign-in (separate from the service account in gsc.ts)
    gscAccounts.ts              sites.list for the signed-in Google account
```

## Notes

- Colours come from a validated data-viz palette; the two series hues clear the
  colourblind-separation and contrast checks against both the light and dark
  surface. Don't swap a hue without re-validating.
- Charts are plain SVG — no chart library. Clicks and impressions get separate
  plots rather than a shared two-axis one, which would invent a relationship
  between them.
- `npm run typecheck` and `npm run lint` both pass clean.

## Not built yet

Phases 3–5 from the plan: content calendar and keyword suggestions, landing page
audits, content review. `query_metrics` already holds what Phase 3 needs for
opportunity terms, and `audits` and `client_state` are in the schema, so none of
them need a migration to start.

**Client-side auth is not built** — only the team's Google sign-in is. The
plan calls for a separate magic-link flow for clients viewing their own
report; `/reports/[id]/export` stays unauthenticated in the meantime, same as
before this login system existed.

**Two things the plan asks for that only you can supply** (§9, §11): the baseline
numbers — minutes per weekly report today, hours per month assembling
performance data — and Search Console access for one pilot client. Without the
first, the draft→approved metric on the reports screen has nothing to be
measured against; without the second, everything here runs on demo data.

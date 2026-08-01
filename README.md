# HS SEO Ops

SEO operations tool with a white-label client view. See
[docs/hs-seo-ops-plan.md](docs/hs-seo-ops-plan.md) for the plan this is built against.

**Phase 1 — Content Performance Tracker — is built.** Every blog and landing
page across all clients, with clicks and impressions from Search Console, and
performance measured from go-live at week 1, month 1, month 3 and month 6.

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

## Search Console

Copy `.env.example` to `.env.local` and fill in the Google values:

1. Create a service account and enable the Search Console API.
2. In Search Console, add the service account's email as a user on each
   property (read access is enough).
3. Set `gsc_property` on each client row — `sc-domain:example.com` for a domain
   property, or the full URL for a URL-prefix one.

Then **Sync now** on a client screen, or schedule the nightly pull:

```
GET /api/cron/nightly
Authorization: Bearer $CRON_SECRET
```

It refuses to run without `CRON_SECRET` set — otherwise anyone could burn the
day's quota. Returns `207` if any client failed, so a partial failure doesn't
read as success.

Without credentials the app runs normally on stored data; sync reports that it
isn't configured rather than failing quietly.

### What sync does

Pulls `page` × `date` rows, which keeps each client to a few hundred rows a day
— far inside the free quota. It re-pulls the last 5 days every run, because GSC
revises recent days after first publishing them, and matches URLs on a
normalised form (trailing slash, `www.`, query string) so a stored URL that
differs cosmetically doesn't silently report zero. URLs that GSC returns but
aren't in `pages` are reported back as unmatched rather than auto-created — the
publish date and target keyword on a page are curated, not derivable.

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
    (app)/                     sidebar shell + screens
    api/clients/[id]/sync/     manual sync
    api/cron/nightly/          scheduled pull for all clients
  components/                  charts, table, tiles
  db/                          schema, connection, migrate, seed, reset
  lib/
    dates.ts                   the GSC lag decision and milestone windows
    metrics.ts                 every rollup query
    gsc.ts                     Search Console ingest
    format.ts                  number and delta formatting
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

Phases 2–5 from the plan: weekly reports, content calendar and keyword
suggestions, landing page audits, content review. The schema already carries
`reports`, `audits` and `client_state` so those phases don't need a migration to
start. Auth is also not built — there is no login, so don't expose this yet.

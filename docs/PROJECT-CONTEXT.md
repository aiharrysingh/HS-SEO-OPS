# HS SEO Ops — Project Context

**Purpose of this file:** everything a new session (human or AI) needs to pick
up this project without re-reading the code or re-asking questions. Read this
first, then [hs-seo-ops-plan.md](hs-seo-ops-plan.md) only if you need the
original reasoning.

Last updated: **2 August 2026**. Working tree clean at commit `b3afe0b`.

---

## 1. What this is

An internal SEO operations tool for the agency, with a white-label client
portal. It replaces the manual work of assembling weekly client reports,
tracking whether published content actually performed, deciding what to write
next, auditing sites, and checking drafts before publishing.

It is **not** a rank tracker, not a backlink tool, not an all-in-one Ahrefs
replacement. Plan §1 is explicit about that.

---

## 2. Hard constraints — do not violate these

These came from the user directly and override any default approach.

1. **No LLM anywhere in the tool.** No `ANTHROPIC_API_KEY`, no OpenAI, no model
   calls of any kind. Every "insight" is produced by a deterministic rule
   engine over real data. Verbatim: *"i donot want ANTHROPIC_API_KEY, no llm is
   to be usedd in this tool all just algorithm and filter"*.
2. **Real API data only.** Verbatim: *"i want to use real api information.
   donot use AI"*. Nothing may be estimated, inferred or made up. If a check
   couldn't run, the UI says "not checked" — it never counts as a pass.
3. **Plain language in explanations.** No fluffy words, no marketing tone.
4. **The UI must be readable by someone used to Ahrefs and SEMrush.** The user
   found an earlier version too complicated. Navigation is now a sidebar with
   named sections.

Note: plan §4 originally chose between three architectures (App calls Anthropic
API / App orchestrates Cowork skills / No LLM at all). **Option C — no LLM —
was chosen and is built.** The skill files are used as a *specification* for
what the rule engines must produce, not as runtime prompts.

---

## 3. Stack and environment

| Thing | Value |
|---|---|
| Framework | **Next.js 16.2.12**, App Router, Turbopack |
| Middleware | **Renamed to Proxy** — the file is [src/proxy.ts](../src/proxy.ts), not `middleware.ts` |
| `params` / `searchParams` | **Promises** — must be `await`ed |
| ORM | Drizzle 0.45 + `postgres-js` |
| Database | **Local Postgres 17 cluster** at `%LOCALAPPDATA%\hsseoops-pg`, port **5433** |
| Google APIs | `googleapis@173` — searchconsole, analyticsdata v1beta, analyticsadmin v1beta, pagespeedonline v5, oauth2 |
| Styling | Tailwind v4, tokens in [globals.css](../src/app/globals.css) |
| Auth | HMAC-signed session cookie ([session.ts](../src/lib/session.ts)); separate magic-link token ([magicLink.ts](../src/lib/magicLink.ts)) |

**AGENTS.md is binding:** this Next.js version has breaking changes from
training data. Read `node_modules/next/dist/docs/` before writing framework
code.

### Starting Postgres after a reboot

It is a standalone cluster, not a Windows service. It does not come back on its
own:

```powershell
Start-Process "C:\Program Files\PostgreSQL\17\bin\postgres.exe" `
  -ArgumentList "-D","$env:LOCALAPPDATA\hsseoops-pg\data","-p","5433" -WindowStyle Hidden
```

Use `Start-Process`. Running `pg_ctl` inline from a tool shell reports a false
failure — the server starts, then dies when the shell's process group is torn
down at timeout.

### Env vars (`.env.local`, documented in `.env.example`)

| Var | State | Notes |
|---|---|---|
| `DATABASE_URL` | set | `postgres://postgres@127.0.0.1:5433/hs_seo_ops` |
| `SEO_REFERENCES_DIR` | set | Points at the Cowork skills folder. Report generation **refuses** if unset rather than using stale baked-in facts. |
| `PAGESPEED_API_KEY` | set | ⚠️ This key was pasted into a chat transcript. **Rotate it.** |
| `GOOGLE_OAUTH_*` | set | Client ID/secret/redirect |
| `SESSION_SECRET` | set | Signs the session cookie |
| `CRON_SECRET` | **unset** | Cron endpoints refuse to run without it — nothing is scheduled today |

Scripts load env via [src/db/env.ts](../src/db/env.ts) (`.env.local` then
`.env`). **A scratch script that imports `src/db` directly without first
importing `src/db/env` will silently fall back to the stale `.pglite` folder
and read the wrong data.** Always `import "./src/db/env";` first.

---

## 4. What was planned vs what was built

All five phases plus the client portal are built and running against real data.

| Plan phase | Status | Where |
|---|---|---|
| **1 — Content Performance Tracker** | Built | [metrics.ts](../src/lib/metrics.ts), [gsc.ts](../src/lib/gsc.ts), client dashboard |
| **2 — Weekly & monthly reports** | Built | [reportData.ts](../src/lib/reportData.ts), [reportWriter.ts](../src/lib/reportWriter.ts), [findings.ts](../src/lib/findings.ts) |
| **3 — Content calendar + keyword suggestions** | Built | [opportunities.ts](../src/lib/opportunities.ts), `/clients/[id]/content` |
| **4 — Landing page audits** | Built | [audit.ts](../src/lib/audit.ts), `/clients/[id]/audits` |
| **5 — Content review** | Built | [draftReview.ts](../src/lib/draftReview.ts), `/clients/[id]/review` |
| **§8 — Client-facing portal** | Built | [clientPortal.ts](../src/lib/clientPortal.ts), `/portal/*` |

### Added beyond the plan (user requests during the build)

- **Google/Gmail OAuth login** — team sign-in, first user becomes admin, no
  open sign-up.
- **Custom date ranges everywhere** — presets plus arbitrary from/to, clamped
  to the GSC data cutoff and a 480-day ceiling.
- **Multi-country filter** — Looker-Studio style, site-level only.
- **GA4 analytics screen** — live-queried with a 5-minute in-memory cache.
- **Sidebar navigation** — Overview / Content plan / Draft review / Site audit
  / Analytics / Reports.
- **Page import from GSC** and **publish-date detection** from each page's own
  structured metadata.

### Deviations from the plan, stated honestly

- **The §9 stop-gate was skipped.** The plan says: *"If the numbers don't move,
  stop … rather than building Phase 3."* Phases 3–5 were built without that
  measurement happening, because the user asked to keep going. The measurement
  is still outstanding (see §8 below).
- **9 tables, not the plan's 7.** `query_metrics` and `country_metrics` were
  added — the first is the only way to get the branded/non-branded split and
  opportunity terms; the second the only way to filter by country.
- **Nightly pull is not scheduled.** The endpoint exists; nothing calls it.

---

## 5. Data model (9 tables)

Defined in [src/db/schema.ts](../src/db/schema.ts), migrations `0000`–`0006`.

| Table | Grain | Notes |
|---|---|---|
| `clients` | one per client | brand terms, GSC + GA4 property, `gscAuthUserId`/`ga4AuthUserId`, sync status |
| `pages` | one per URL | title, publish date, status (`live`/`draft`), target keyword |
| `page_metrics` | client × page × date | the core GSC table |
| `query_metrics` | client × date × query | site-level, **not** page×query — page×query would blow the 50k pairs/day limit |
| `country_metrics` | client × date × country | site-wide totals, ISO alpha-3 |
| `reports` | one per client per cadence per period | markdown, status, `input_snapshot`, `generated_at`→`approved_at` |
| `audits` | one per run | full `AuditResult` as jsonb |
| `client_state` | key/value | misc per-client state |
| `users` | one per person | role: `admin` / `member` / `client` |

**Migration sequence (established convention — follow it exactly):**
stop the dev server → `npm run db:generate` → **read the generated SQL** →
`npm run db:migrate` → restart. The dev server caches its DB connection.

---

## 6. Current data state (2 Aug 2026)

| | |
|---|---|
| Clients | 2 — Yourteaminindia, Signitysolutions (both GSC **and** GA4 linked) |
| Pages tracked | 2,180 |
| Page metric rows | 647,673 |
| Query metric rows | 4,066,691 |
| Country metric rows | 151,180 |
| Date coverage | 2025-04-07 → 2026-07-30 (~16 months) |
| Audits run | 12 |
| Reports | 3 generated, **0 approved** |
| Users | 1 |
| Pages with no publish date | **1,256 of 2,180** |
| Pages with a target keyword | **0** |

---

## 7. Behaviour worth knowing before changing anything

These are decisions with reasons behind them. Changing them without knowing why
will reintroduce bugs that were already fixed.

- **GSC lag is 3 days**, defined once as `GSC_LAG_DAYS` in
  [dates.ts](../src/lib/dates.ts). `dataCutoff()` derives from it and every
  window clamps to it. Change it in one place and the whole app moves.
- **`INITIAL_BACKFILL_DAYS = 480`** (16 months, GSC's retention ceiling).
  `RESETTLE_DAYS = 5` re-pulls recent days because GSC revises them.
- **A first sync takes minutes.** There's no fake progress bar — GSC doesn't
  report a total up front, so the button shows honest elapsed time, survives a
  page refresh, and polls a cheap status endpoint.
- **`SYNC_STALE_AFTER_MINUTES = 15`** — a sync claim older than this is treated
  as a crashed process so the button can't wedge forever.
- **Publish dates only come from what a page says about itself** —
  `article:published_time`, schema.org `datePublished`, or
  `time[itemprop=datePublished]`. **Sitemap `lastmod` is deliberately rejected**:
  it records modification, so every updated post would date as recent, and a
  wrong publish date silently produces a wrong "month 3" number that reads as
  real.
- **Crawling client sites is throttled on purpose** — concurrency 4, a 400ms
  pause between batches, and an abort if 70% of a batch fails. At concurrency 6
  this tool once made ~1,200 requests to a client's production site and started
  getting refused on nearly everything.
- **Country-filtered numbers are property-wide; unfiltered headline tiles are
  tracked-pages-only.** These two will never reconcile. The labels say which
  basis is in use, and the page table shows an explicit notice when a country
  filter is on. Do not quietly swap the basis.
- **Status colour always ships with a written label** (Pass/Fail, Critical/
  Serious/Warning/Note). Never colour alone — colourblind readers and print.
- **PageSpeed calls must go through `googleapis`, not `fetch`.** Node's
  undici throws an uncatchable `TransformError` decompressing the large gzipped
  Lighthouse response. Timeout is **120s** — real calls take 20–75s.
- **Report generation refuses when `SEO_REFERENCES_DIR` is unset**, and states
  in its own output when `current-state.md` is more than 60 days old.

---

## 8. What is left — and it is not code

Nothing in the plan remains to *build*. Everything outstanding needs the user.

1. **§9 baselines.** How many minutes a weekly report takes today, and how many
   hours a month go into assembling data. Only the user has these numbers, and
   without them there is no way to say whether the tool worked.
2. **Approve one report end to end and time it.** 3 reports exist, 0 approved,
   so the `generated_at → approved_at` metric is empty. Plan §9's target is
   **under 15 minutes of human time per report**.
3. **Schedule the nightly sync.** Set `CRON_SECRET` and point a scheduler at
   `GET /api/cron/nightly`, then `GET /api/cron/weekly-reports` after it.
4. **1,256 pages still have no publish date** — the milestone columns (week 1,
   month 1, month 3, month 6) are blank for those. Re-run *Detect dates*; what
   remains must be typed in by hand.
5. **0 pages have a target keyword** — content-plan matching is weaker without
   them.
6. **§11.1** — confirm the real client count and how many get weekly reports.
   Two clients are loaded today.
7. **Rotate `PAGESPEED_API_KEY`** — it was pasted into a chat transcript.

The plan's own warning is worth repeating: *the most common way tools like this
fail isn't bugs — it's being finished and never used.* Items 1 and 2 are the
ones that matter this week.

---

## 9. Bugs already found and fixed — don't reintroduce them

| Bug | Cause | Fix |
|---|---|---|
| Database destroyed, twice | PGlite corrupted by force-killing the dev server mid-write, and again by hot-editing `gsc.ts` while a sync was running inside it | Migrated to real Postgres on 5433 |
| Sync crash: *"ON CONFLICT DO UPDATE cannot affect row a second time"* | `normaliseUrl` collapses `/page` and `/page/` into one page, so GSC's two rows collided in one INSERT | Merge by `(pageId, date)` with impression-weighted position |
| 84 of 90 days silently empty | A crashed sync left partial rows that set a high-water mark the resume logic trusted forever | `hasCompletedSync` gate before trusting the resume point |
| New dimensions only backfilled 6 days | A clamp in `pageStart` contradicted its own docstring | Clamp removed |
| Content plan said "write this" for terms already covered | Plural/spacing mismatch — `/blog/guide-to-llm-leaderboards` didn't match "llm leaderboard" | `stem()` and `squash()` in [opportunities.ts](../src/lib/opportunities.ts) |
| Draft review flagged clean prose as critical | No absolute floors — one loaded word or 2 keyword occurrences tripped it | Floors: `vocabTotal >= 4 && per1000 >= 2`, stuffing needs `occurrences >= 5` |
| PageSpeed never returned | Three separate causes: undici decompression crash, then two too-short timeouts | `googleapis` client, 120s timeout |
| Core Web Vitals numbers vanished when they passed | A finding only fires on failure, so passing values were never stored | `cwv` field added to `AuditResult` |

**Two wrong diagnoses I made** — worth remembering as a pattern: I twice blamed
a flaky network for sync hangs. An isolated test showed every call completing in
~1s. The real cause was the size of the 480-day pull. Test the assumption before
reporting a cause.

---

## 10. Screens

**Team app** (requires a team sign-in; `role === "client"` is rejected with 403):

| Route | What it does |
|---|---|
| `/` | Portfolio — all clients, one row each |
| `/clients/[id]` | Overview — scorecards, charts, page table, milestones |
| `/clients/[id]/content` | Content plan — opportunities split into *write* and *improve* |
| `/clients/[id]/review` | Draft review — paste a draft, get findings |
| `/clients/[id]/audits` | Site audit — severity tiles, Core Web Vitals, findings |
| `/clients/[id]/analytics` | GA4 — users, sessions, bounce, channels, sources |
| `/clients/[id]/reports` | Report list, generate, edit, approve |
| `/account` | Link GSC and GA4 properties to clients |
| `/reports/[id]/export` | Branded print view, outside the app shell |

**Client portal** (`/portal/*`) — magic-link sign-in, read-only, scoped to one
client **at the data layer**: the portal functions take no `clientId` argument
at all, they resolve it from the session, so a client cannot request another
client's data by changing a URL.

---

## 11. Commands

```bash
npm run dev          # dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # must be clean before calling anything done
npm run db:generate  # generate a migration (dev server must be stopped)
npm run db:migrate   # apply migrations
```

Verification convention: **typecheck, lint and build must all pass**, and the
behaviour must be confirmed by looking at the actual page content — not just an
HTTP 200.

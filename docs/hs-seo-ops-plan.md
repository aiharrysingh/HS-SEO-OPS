# HS SEO Ops — Project Plan

SEO operations tool with a white-label client view.
Goal: reduce agency hours on recurring SEO delivery.

---

## 1. What this is, and what it isn't

**It is:** a scheduled data layer plus a workflow runner, with a branded read-only
view for clients.

**It is not:** a Semrush or Ahrefs competitor. It does not generate keyword volume,
backlink data, or SERP rankings from scratch. It reads what Google gives away
free, and optionally what the agency already pays for.

Say this out loud during the build whenever someone suggests a feature. Most
scope creep on tools like this comes from drifting toward rebuilding a data
vendor.

### Why it exists
Weekly client reporting is the largest recurring time cost — roughly an hour per
client per week. Content calendar planning, keyword suggestions, and performance
tracking all draw on the same GSC data that reporting needs, and are currently
assembled by hand, separately, each time.

Build the data layer once and four jobs collapse into one.

### Explicitly out of scope for v1
- Social media management
- Paid ads management
- Content writing
- Anything requiring a paid SERP API
- Public signup, billing, multi-tenant isolation for strangers

---

## 2. Users

**Internal (primary).** The SEO team using it. Full access, runs workflows, edits
outputs, overrides anything. Roughly 5–10 people.

**Client (secondary).** Read-only, branded, sees the current report and content
performance. Never sees intermediate outputs or the machinery. Roughly 10% of
the surface area — build it after the internal side works.

No public signup. Accounts are created by an admin.

---

## 3. Build order

Ordered by hours saved per unit of build effort.

### Phase 1 — Content Performance Tracker
The foundation. Small, boring, and everything else depends on it.

Every blog and landing page across all clients, with publish date, pulling clicks
and impressions from GSC nightly. Performance tracked from go-live: week 1,
month 1, month 3, month 6.

Volume is low — roughly 200 new pages a year, low thousands of URLs in total
across all clients. This sits comfortably inside GSC's free API limits and needs
no data warehouse.

**Ships when:** a team member can open a client, see every page with current
clicks and impressions, and nobody has updated a spreadsheet by hand.

### Phase 2 — Weekly Reports
The actual time sink. Built on Phase 1's data, so most of the work is already done.

Scheduled generation, draft produced automatically, human edits, branded export.
Must diagnose movement rather than list metrics — see the `client-report` skill
for the standard.

**Ships when:** a weekly report takes under 15 minutes of human time instead of an hour.

### Phase 3 — Content Calendar + Keyword Suggestions
Draws on a year of "this piece earned these clicks" rather than instinct.
Combines historical performance, GSC opportunity terms (positions 5–20 with
impressions), and competitor gaps.

**Ships when:** next month's calendar can be drafted from evidence in one sitting.

### Phase 4 — Landing Page Audits
On-demand, using the existing `seo-audit-runner` logic. Stored per client so
audits are comparable over time.

### Phase 5 — Content Review
Last, deliberately. At 23 pieces a month and 12 minutes each, this is ~4.5 hours
monthly and a tool realistically halves it. Roughly 2 hours saved.

**Do not build this into the app until Phases 1–3 are live.** The team can run
`draft-auditor` in Cowork today at zero development cost and get most of the
benefit immediately.

---

## 4. Architecture decision: how workflows run

This is the decision to make before writing code.

### Option A — App calls the Anthropic API directly
Workflows are prompts inside the application.

Pros: predictable cost, full control over output format, no dependency on
another product, straightforward to test.
Cons: skill logic gets duplicated. The app and the team's Cowork skills drift
apart, and the SEO knowledge has to be maintained in two places.

### Option B — App orchestrates Cowork / the skill files
The app schedules and stores; skills carry the logic.

Pros: one source of truth. Improve `client-report` and both the app and the team
improve together.
Cons: less control over exact output shape, more moving parts, harder to unit test.

### Recommendation: A, with the skills as source material
Call the API directly, but generate prompts *from the skill files* rather than
rewriting the logic by hand. Keep `shared/references/current-state.md` as a file
the app loads at runtime, exactly as the skills do.

This gives control and testability, while keeping one place to update SEO facts.
When FAQ rich results die or a Core Web Vitals threshold changes, one file changes.

**Non-negotiable:** the app must not hard-code volatile SEO facts into prompts.
That file is loaded at runtime and dated. If it goes stale the app says so in its
output.

---

## 5. Data model

Minimal. Resist adding tables until something needs them.

```
clients
  id, name, domain, gsc_property, ga4_property_id,
  branding (logo, colours), created_at

pages
  id, client_id, url, type (blog | landing), title,
  published_at, target_keyword, status, created_at

page_metrics                      -- one row per page per day
  page_id, date, clicks, impressions, ctr, position
  UNIQUE (page_id, date)

reports
  id, client_id, period_start, period_end, status (draft|approved|sent),
  content, generated_at, approved_by

audits
  id, client_id, url, findings (json), created_at

client_state                      -- mirrors the skills' state file
  client_id, open_findings (json), notes, updated_at

users
  id, email, role (admin | seo | client), client_id (nullable)
```

Notes:
- `page_metrics` is the only table that grows. At low-thousands of URLs it stays
  small for years. No partitioning needed.
- `client_state` intentionally mirrors `clients/<name>.md` from the orchestrator
  skill, so app and Cowork stay in sync.
- Store report content as markdown. Render to HTML or PDF at export time.

---

## 6. Integrations

### Free — build against these first
| Source | Use | Notes |
|---|---|---|
| **GSC API** | Core metrics | Free. 25k rows/request, 50k page-keyword pairs/property/day, **2–3 day lag**. Service account auth. |
| **GA4 Data API** | Sessions, conversions | Free. Quota-based. |
| **PageSpeed Insights** | Core Web Vitals | Free. Field data where available. |
| **Google Business Profile** | Local | Free. Only if hospitality clients need it. |

### Paid — bring your own key, optional
| Source | Use | Notes |
|---|---|---|
| **Ahrefs** | Keywords, backlinks, gaps | Official MCP server. Credit-based; MCP and REST share one budget. |
| **Semrush** | Same | Official MCP server. Advanced tier required and includes **zero** units — bought separately. |

The app must work fully without either. If neither is connected, the affected
features fall back to GSC-only and say so.

### Deliberately not integrated
- **SERP/rank tracking APIs.** No free option exists. Adds real per-client monthly
  cost. Ahrefs/Semrush already provide this for clients where you have seats.
- **Looker Studio.** It's a visualisation layer, not a data source. If clients want
  it, export to Sheets and let them connect it themselves.

### The GSC lag matters
Two to three days. A Monday report cannot include the weekend. Either date reports
to a lagging window or state the cutoff on the report. Decide this once and be
consistent, or clients will ask every week.

---

## 7. Suggested stack

Optimised for one or two developers and low volume — not for scale you don't have.

- **Framework:** Next.js (App Router). One codebase for UI and API routes.
- **Database:** Postgres. Supabase or Neon if you'd rather not run it.
- **Auth:** Whatever's native to the host. Google OAuth for the team, magic link
  for clients.
- **Scheduling:** cron via the host's scheduler. Nightly GSC pull, weekly report
  generation.
- **AI:** Anthropic API. Skills as prompt source.
- **Export:** markdown → HTML → PDF.

Avoid: microservices, a queue system, Kubernetes, a separate frontend. At this
volume they're cost without benefit.

---

## 8. Client-facing view

Build after Phase 2. Deliberately thin:

- Branded — client logo, agency colours
- Current report, plus history
- Content performance — their pages, clicks, impressions, trend
- Nothing editable, nothing intermediate, no raw findings

Serve on a subdomain per client or a path with client-scoped auth. Every query
filtered by `client_id` at the data layer, not in the UI — the one place where
getting it wrong is genuinely serious.

---

## 9. Measuring whether this worked

The stated goal is agency hours. Instrument it from day one or you will not know.

Before building, record: average minutes to produce one weekly report, and hours
per month spent assembling content performance data.

After each phase, measure the same thing.

Target for Phase 2: weekly report under 15 minutes of human time, down from ~60.

If the numbers don't move, stop and find out why rather than building Phase 3.
Internal tools most often fail by being finished and unused.

---

## 10. Risks

**Nobody uses it.** The commonest failure for internal tools. Mitigate by making
Phase 1 remove work rather than add it — the sheet fills itself, nobody has to
maintain it. If the first thing you ship creates a new chore, adoption dies.

**Scope creep toward a full marketing suite.** SMM, ads, and content writing will
all get suggested. Each is a separate product. Refuse in v1.

**Skill drift.** The app and the Cowork skills diverge until they give different
answers for the same client. Mitigate with the shared `current-state.md` loaded at
runtime.

**Stale SEO facts.** The single most likely source of an embarrassing client
deliverable. The reference file is dated and the app surfaces the date.

**GSC lag misread as a bug.** Document it, state it on reports.

---

## 11. First week

1. Confirm client count and how many get weekly reports — this sizes the payoff
2. Set up GSC and GA4 service account access for one pilot client
3. Schema and migrations for `clients`, `pages`, `page_metrics`
4. Nightly GSC pull for that one client
5. A single table view: pages, publish date, clicks, impressions

One client, one view, real data. Everything after that is expansion.

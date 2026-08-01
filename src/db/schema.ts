/**
 * Schema for HS SEO Ops — mirrors §5 of docs/hs-seo-ops-plan.md.
 *
 * Deliberately minimal. `page_metrics` and `query_metrics` are the only tables
 * expected to grow; everything else stays in the hundreds of rows for years.
 */
import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const PAGE_TYPES = ["blog", "landing"] as const;
export const PAGE_STATUSES = ["live", "draft", "archived"] as const;
export const REPORT_STATUSES = ["draft", "approved", "sent"] as const;
export const REPORT_CADENCES = ["weekly", "monthly"] as const;
export const USER_ROLES = ["admin", "seo", "client"] as const;

export type PageType = (typeof PAGE_TYPES)[number];
export type PageStatus = (typeof PAGE_STATUSES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportCadence = (typeof REPORT_CADENCES)[number];
export type UserRole = (typeof USER_ROLES)[number];

export type Branding = {
  logoUrl?: string;
  /** Hex, used for the client-facing view's accent. */
  primaryColor?: string;
};

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  /** e.g. "sc-domain:example.com" or "https://example.com/" */
  gscProperty: text("gsc_property"),
  ga4PropertyId: text("ga4_property_id"),
  branding: jsonb("branding").$type<Branding>().notNull().default({}),
  /**
   * Terms that mark a search query as branded — the client's name, common
   * misspellings, sub-brands. Classification happens at query time rather than
   * at sync, so refining this list retroactively corrects every past report
   * instead of only future ones.
   */
  brandTerms: text("brand_terms")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /**
   * When the nightly GSC pull last completed for this client. Distinct from the
   * latest metric *date* — the plan requires surfacing staleness, and "the job
   * has not run since Tuesday" is a different failure from "GSC has no data yet".
   */
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type").$type<PageType>().notNull().default("blog"),
    title: text("title").notNull(),
    /** Go-live date. Milestone windows (week 1, month 1/3/6) are measured from here. */
    publishedAt: date("published_at"),
    targetKeyword: text("target_keyword"),
    status: text("status").$type<PageStatus>().notNull().default("live"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("pages_client_url_unique").on(t.clientId, t.url),
    index("pages_client_idx").on(t.clientId),
  ],
);

/** One row per page per day, straight from GSC. */
export const pageMetrics = pgTable(
  "page_metrics",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    position: real("position").notNull().default(0),
  },
  (t) => [
    unique("page_metrics_page_date_unique").on(t.pageId, t.date),
    index("page_metrics_date_idx").on(t.date),
  ],
);

/**
 * One row per client per day per search query, site-level (not page × query).
 *
 * This is what makes the branded vs non-branded split possible — the
 * `client-report` skill calls that "the number that reflects the work" — and it
 * is also where Phase 3's opportunity terms (positions 5–20) will come from.
 * Neither is derivable from `page_metrics`.
 *
 * Site-level is deliberate: page × query would multiply row count by the page
 * count and run into GSC's 50k page-keyword-pairs/property/day ceiling, and the
 * report doesn't need the pairing.
 *
 * Growth: roughly (distinct queries per day) × 480 days × clients. Expect low
 * millions of rows within a year or two — comfortable for Postgres, but this
 * and `page_metrics` are the two tables to watch if client count multiplies.
 */
export const queryMetrics = pgTable(
  "query_metrics",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    position: real("position").notNull().default(0),
  },
  (t) => [
    unique("query_metrics_client_date_query_unique").on(
      t.clientId,
      t.date,
      t.query,
    ),
    index("query_metrics_client_date_idx").on(t.clientId, t.date),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    cadence: text("cadence").$type<ReportCadence>().notNull().default("weekly"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").$type<ReportStatus>().notNull().default("draft"),
    /** Markdown. Rendered to HTML/PDF at export time. */
    content: text("content").notNull().default(""),
    /**
     * What the team actually did this period. The skill is blunt that a report
     * listing metrics without connecting them to the work "reads like a weather
     * forecast" — this is the input that stops that happening.
     */
    workDelivered: text("work_delivered").notNull().default(""),
    /**
     * The computed facts handed to the model. Kept so a report is reproducible,
     * auditable, and renderable beside its own numbers without recomputing.
     */
    inputSnapshot: jsonb("input_snapshot"),
    /** Model that wrote the draft, and the date on the SEO facts it was given. */
    model: text("model"),
    referenceDate: date("reference_date"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    /** With `generated_at`, the closest automatic proxy for plan §9's hours saved. */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
  },
  (t) => [
    unique("reports_client_period_unique").on(
      t.clientId,
      t.cadence,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  findings: jsonb("findings").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Mirrors `clients/<name>.md` from the orchestrator skill so app and Cowork stay in sync. */
export const clientState = pgTable("client_state", {
  clientId: uuid("client_id")
    .primaryKey()
    .references(() => clients.id, { onDelete: "cascade" }),
  openFindings: jsonb("open_findings").notNull().default([]),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: text("role").$type<UserRole>().notNull().default("seo"),
  /** Set only for role = "client"; scopes every query to one client. */
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Client = typeof clients.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type PageMetric = typeof pageMetrics.$inferSelect;
export type QueryMetric = typeof queryMetrics.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Audit = typeof audits.$inferSelect;

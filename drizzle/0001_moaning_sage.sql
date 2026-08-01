CREATE TABLE "query_metrics" (
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" real DEFAULT 0 NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	CONSTRAINT "query_metrics_client_date_query_unique" UNIQUE("client_id","date","query")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_terms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "cadence" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "work_delivered" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "input_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reference_date" date;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "query_metrics" ADD CONSTRAINT "query_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "query_metrics_client_date_idx" ON "query_metrics" USING btree ("client_id","date");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_period_unique" UNIQUE("client_id","cadence","period_start","period_end");
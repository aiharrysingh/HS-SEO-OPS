CREATE TABLE "country_metrics" (
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"country" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" real DEFAULT 0 NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	CONSTRAINT "country_metrics_client_date_country_unique" UNIQUE("client_id","date","country")
);
--> statement-breakpoint
ALTER TABLE "country_metrics" ADD CONSTRAINT "country_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "country_metrics_client_date_idx" ON "country_metrics" USING btree ("client_id","date");
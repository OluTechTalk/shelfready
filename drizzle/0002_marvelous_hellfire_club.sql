CREATE TABLE "fix_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"handle" text NOT NULL,
	"check_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"change" jsonb NOT NULL,
	"before" jsonb,
	"source" text NOT NULL,
	"evidence" text,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"audit_run_id" integer,
	"edited" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fix_proposals" ADD CONSTRAINT "fix_proposals_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fix_proposals_open_uq" ON "fix_proposals" USING btree ("product_id","kind","target") WHERE "fix_proposals"."status" in ('pending', 'approved', 'needs_merchant');
CREATE TABLE "audit_llm_cache" (
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"rubric_version" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_llm_cache_content_hash_model_rubric_version_pk" PRIMARY KEY("content_hash","model","rubric_version")
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rubric_version" text NOT NULL,
	"model" text NOT NULL,
	"store_score" real NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_scores" (
	"run_id" integer NOT NULL,
	"product_id" text NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"score" real NOT NULL,
	"band" text NOT NULL,
	"checks" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "audit_scores_run_id_product_id_pk" PRIMARY KEY("run_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "audit_scores" ADD CONSTRAINT "audit_scores_run_id_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;
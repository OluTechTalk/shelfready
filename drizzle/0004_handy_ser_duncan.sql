CREATE TABLE "eval_results" (
	"run_id" integer NOT NULL,
	"task_id" text NOT NULL,
	"outcome" text NOT NULL,
	"success" boolean NOT NULL,
	"steps" integer NOT NULL,
	"tool_calls" integer NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"transcript" jsonb NOT NULL,
	CONSTRAINT "eval_results_run_id_task_id_pk" PRIMARY KEY("run_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"catalog" text NOT NULL,
	"model" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "mcp_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"result_count" integer,
	"latency_ms" integer NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

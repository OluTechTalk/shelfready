CREATE TABLE "model_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"route" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"raw" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

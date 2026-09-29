CREATE TABLE "playground_replays" (
	"prompt" text PRIMARY KEY NOT NULL,
	"chunks" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

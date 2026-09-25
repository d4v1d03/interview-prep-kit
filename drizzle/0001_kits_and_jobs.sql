CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"step_attempts" integer DEFAULT 0 NOT NULL,
	"state" jsonb,
	"error" jsonb,
	"lease_until" timestamp with time zone,
	"lease_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"company_url" text NOT NULL,
	"jd" text NOT NULL,
	"days" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"kit" jsonb,
	"context" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_kit_id_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."kits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kits" ADD CONSTRAINT "kits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_kit_idx" ON "jobs" USING btree ("kit_id","created_at");--> statement-breakpoint
CREATE INDEX "kits_user_idx" ON "kits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "kits_fingerprint_idx" ON "kits" USING btree ("user_id","fingerprint");
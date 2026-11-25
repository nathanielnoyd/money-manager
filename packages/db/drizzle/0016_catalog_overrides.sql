CREATE TABLE "catalog_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"slug" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"custom" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"as_of" date,
	"note" text,
	"user_id" uuid,
	"via" text NOT NULL,
	"token_id" uuid,
	"reverts_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_overrides" (
	"household_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"slug" text NOT NULL,
	"patch" jsonb NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_overrides_household_id_entity_slug_pk" PRIMARY KEY("household_id","entity","slug")
);
--> statement-breakpoint
ALTER TABLE "catalog_changes" ADD CONSTRAINT "catalog_changes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_changes" ADD CONSTRAINT "catalog_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_changes" ADD CONSTRAINT "catalog_changes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_overrides" ADD CONSTRAINT "catalog_overrides_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_changes_household_id_created_at_index" ON "catalog_changes" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_changes_household_id_entity_slug_index" ON "catalog_changes" USING btree ("household_id","entity","slug");
CREATE TYPE "public"."budget_mode" AS ENUM('flexible', 'zero_based');--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"target_amount" bigint NOT NULL,
	"target_date" date,
	"account_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"manual_amount" bigint DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"cadence" text NOT NULL,
	"interval_days" integer NOT NULL,
	"expected_amount" bigint NOT NULL,
	"last_amount" bigint NOT NULL,
	"last_date" date NOT NULL,
	"next_date" date NOT NULL,
	"occurrences" integer NOT NULL,
	"category_id" uuid,
	"price_change" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rollover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "budget_mode" "budget_mode" DEFAULT 'flexible' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_items_category_id_month_index" ON "budget_items" USING btree ("category_id","month");--> statement-breakpoint
CREATE INDEX "budget_items_household_id_month_index" ON "budget_items" USING btree ("household_id","month");--> statement-breakpoint
CREATE INDEX "goals_household_id_index" ON "goals" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_series_merchant_id_direction_index" ON "recurring_series" USING btree ("merchant_id","direction");--> statement-breakpoint
CREATE INDEX "recurring_series_household_id_next_date_index" ON "recurring_series" USING btree ("household_id","next_date");
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"value" bigint NOT NULL,
	"cost_basis" bigint,
	"as_of" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider_security_id" text NOT NULL,
	"symbol" text,
	"name" text NOT NULL,
	"type" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"price" numeric(24, 8),
	"price_as_of" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "notifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "securities" ADD CONSTRAINT "securities_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_account_id_security_id_index" ON "holdings" USING btree ("account_id","security_id");--> statement-breakpoint
CREATE INDEX "holdings_household_id_index" ON "holdings" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_household_id_kind_key_index" ON "notification_log" USING btree ("household_id","kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_household_id_provider_security_id_index" ON "securities" USING btree ("household_id","provider_security_id");
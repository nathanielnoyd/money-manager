CREATE TABLE "merchant_reward_categories" (
	"household_id" uuid NOT NULL,
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"reward_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_category_map" (
	"household_id" uuid NOT NULL,
	"category_id" uuid PRIMARY KEY NOT NULL,
	"reward_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_reward_overrides" (
	"household_id" uuid NOT NULL,
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"reward_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"card_slug" text NOT NULL,
	"opened_on" date,
	"activations" text[] DEFAULT '{}'::text[] NOT NULL,
	"choices" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_cards_accountId_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "rewards" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider_category" text;--> statement-breakpoint
ALTER TABLE "merchant_reward_categories" ADD CONSTRAINT "merchant_reward_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_reward_categories" ADD CONSTRAINT "merchant_reward_categories_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_category_map" ADD CONSTRAINT "reward_category_map_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_category_map" ADD CONSTRAINT "reward_category_map_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_reward_overrides" ADD CONSTRAINT "transaction_reward_overrides_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_reward_overrides" ADD CONSTRAINT "transaction_reward_overrides_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_reward_categories_household_id_index" ON "merchant_reward_categories" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "reward_category_map_household_id_index" ON "reward_category_map" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transaction_reward_overrides_household_id_index" ON "transaction_reward_overrides" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "wallet_cards_household_id_index" ON "wallet_cards" USING btree ("household_id");
CREATE TABLE "points_balances" (
	"household_id" uuid NOT NULL,
	"program_slug" text NOT NULL,
	"balance" bigint NOT NULL,
	"as_of" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_balances_household_id_program_slug_pk" PRIMARY KEY("household_id","program_slug")
);
--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD COLUMN "signup_bonus" jsonb;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD COLUMN "credits_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "points_balances" ADD CONSTRAINT "points_balances_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
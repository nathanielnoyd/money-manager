ALTER TYPE "public"."connection_status" ADD VALUE 'linking' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_split_parent_id_index" ON "transactions" USING btree ("split_parent_id");
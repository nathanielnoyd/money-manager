CREATE INDEX "audit_log_user_id_index" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_group_id_index" ON "categories" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "holdings_security_id_index" ON "holdings" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "imports_account_id_index" ON "imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "invites_household_id_index" ON "invites" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "merchants_default_category_id_index" ON "merchants" USING btree ("default_category_id");--> statement-breakpoint
CREATE INDEX "recurring_series_category_id_index" ON "recurring_series" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "sessions_household_id_index" ON "sessions" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "sync_runs_household_id_started_at_index" ON "sync_runs" USING btree ("household_id","started_at");--> statement-breakpoint
CREATE INDEX "transaction_tags_tag_id_index" ON "transaction_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transaction_tags_household_id_index" ON "transaction_tags" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transactions_merchant_id_index" ON "transactions" USING btree ("merchant_id");
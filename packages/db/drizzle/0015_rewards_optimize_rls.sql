-- Row-level security for points balances (same household policy as 0001_rls.sql).
ALTER TABLE points_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON points_balances
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- Row-level security for file imports (same household policy as 0001_rls.sql).
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON imports
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- Row-level security for Phase 3 tables (same household policy as 0001_rls.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['securities', 'holdings', 'notification_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id())',
      t
    );
  END LOOP;
END $$;

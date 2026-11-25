-- Row-level security for catalog overrides and their history (same household policy as 0001_rls.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_overrides', 'catalog_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- The monthly catalog refresh runs across households before it has a household scope.
-- Like digest_households(), this returns ids only.
CREATE FUNCTION catalog_refresh_households() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT h.id FROM households h
    WHERE coalesce((h.ai ->> 'enabled')::boolean, false)
      AND coalesce((h.ai ->> 'catalogRefresh')::boolean, false)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_refresh_households() FROM PUBLIC;

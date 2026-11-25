-- Row-level security: every household-scoped row is visible to the application role
-- only when it belongs to the household set for the current transaction via
--   SELECT set_config('app.household_id', '<uuid>', true);
-- If the setting is missing, the helper returns NULL and every policy matches nothing (fail closed).
-- Superusers (used only by the migrate job) bypass RLS; the app connects as the
-- non-superuser, NOBYPASSRLS role `mm_app` created by src/cli/migrate.ts.

CREATE FUNCTION app_household_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.household_id', true), '')::uuid $$;
--> statement-breakpoint

ALTER TABLE households ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON households
  USING (id = app_household_id()) WITH CHECK (id = app_household_id());
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invites', 'connections', 'accounts', 'balance_snapshots', 'category_groups',
    'categories', 'merchants', 'tags', 'transactions', 'transaction_tags', 'rules', 'sync_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Audit log: readable only for the current household; instance-level rows (household_id NULL)
-- can be written but are only readable by an administrator.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_read ON audit_log FOR SELECT USING (household_id = app_household_id());
--> statement-breakpoint
CREATE POLICY audit_write ON audit_log FOR INSERT
  WITH CHECK (household_id IS NULL OR household_id = app_household_id());
--> statement-breakpoint

-- The worker must find connections that are due for sync across all households before it
-- knows which household to scope to. This narrowly-scoped SECURITY DEFINER function returns
-- only ids (no secrets); the worker then processes each connection inside that household's scope.
CREATE FUNCTION due_connections(max_rows integer) RETURNS TABLE (id uuid, household_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.household_id FROM connections c
    WHERE c.status = 'active'
      AND c.provider NOT IN ('manual', 'file')
      AND (c.next_sync_at IS NULL OR c.next_sync_at <= now())
    ORDER BY c.next_sync_at NULLS FIRST
    LIMIT least(max_rows, 500)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION due_connections(integer) FROM PUBLIC;

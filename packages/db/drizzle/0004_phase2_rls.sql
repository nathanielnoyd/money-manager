-- Row-level security for Phase 2 tables (same household policy as 0001_rls.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_items', 'recurring_series', 'goals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Accepting an invite happens before the invitee belongs to any household, so the app
-- can't see the (RLS-protected) invites table yet. This function returns exactly one
-- invite, and only to someone who already holds its secret token (looked up by hash).
CREATE FUNCTION find_invite(p_token_hash text)
  RETURNS TABLE (id uuid, household_id uuid, email text, role member_role, expires_at timestamptz, accepted_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT i.id, i.household_id, i.email, i.role, i.expires_at, i.accepted_at
    FROM invites i WHERE i.token_hash = p_token_hash
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION find_invite(text) FROM PUBLIC;

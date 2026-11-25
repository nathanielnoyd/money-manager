-- Row-level security for agent tokens (same household policy as 0001_rls.sql).
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_isolation ON api_tokens
  USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
--> statement-breakpoint

-- An MCP request arrives with only a bearer token, before any household scope exists.
-- Like find_invite(), this returns exactly one row, and only to someone who already
-- holds the token (looked up by its SHA-256 hash). The hash itself is not returned.
CREATE FUNCTION find_api_token(p_token_hash text)
  RETURNS TABLE (id uuid, household_id uuid, user_id uuid, scopes text[], max_role member_role,
                 expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.household_id, t.user_id, t.scopes, t.max_role, t.expires_at, t.revoked_at, t.last_used_at
    FROM api_tokens t WHERE t.token_hash = p_token_hash
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION find_api_token(text) FROM PUBLIC;

-- The scheduler now also returns connections that are still linking. A new link is normally
-- picked up at once through NOTIFY; if the worker missed that (it was restarting, or its
-- listener had dropped), the connection used to stay at "Linking…" for good.
CREATE OR REPLACE FUNCTION due_connections(max_rows integer) RETURNS TABLE (id uuid, household_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.household_id FROM connections c
    WHERE c.status IN ('active', 'linking')
      AND c.provider NOT IN ('manual', 'file')
      AND (c.next_sync_at IS NULL OR c.next_sync_at <= now())
    ORDER BY c.next_sync_at NULLS FIRST
    LIMIT least(max_rows, 500)
  $$;

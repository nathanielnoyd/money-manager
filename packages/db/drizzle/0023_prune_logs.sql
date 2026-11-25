-- Hourly housekeeping across households. The worker runs it before it has any household scope,
-- so, like due_connections(), it is a narrow SECURITY DEFINER function: it only deletes old log
-- rows and closes abandoned sync runs, and returns counts.
--
-- - sync_runs: a run still "running" after an hour belongs to a worker that stopped mid-sync;
--   mark it failed, so the app stops showing "Syncing…". Finished runs older than 90 days go.
-- - ai_usage: kept 400 days (the app shows 30 days; the token limit uses the current month).
-- - notification_log: kept 400 days. Every alert key includes a date or a one-off id, so an
--   alert this old can't be sent again by deleting its row.
CREATE FUNCTION prune_logs(OUT stale_runs integer, OUT sync_runs integer, OUT ai_usage integer, OUT notifications integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE sync_runs SET status = 'failed', finished_at = now(),
      error = coalesce(error, 'The worker stopped before this sync finished.')
      WHERE status = 'running' AND started_at < now() - interval '1 hour';
    GET DIAGNOSTICS stale_runs = ROW_COUNT;
    DELETE FROM sync_runs WHERE status <> 'running' AND started_at < now() - interval '90 days';
    GET DIAGNOSTICS sync_runs = ROW_COUNT;
    DELETE FROM ai_usage WHERE created_at < now() - interval '400 days';
    GET DIAGNOSTICS ai_usage = ROW_COUNT;
    DELETE FROM notification_log WHERE sent_at < now() - interval '400 days';
    GET DIAGNOSTICS notifications = ROW_COUNT;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION prune_logs() FROM PUBLIC;

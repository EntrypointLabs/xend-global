CREATE TABLE capacity_counters (
  key text PRIMARY KEY,
  count integer NOT NULL,
  total_raw numeric(78,0) NOT NULL,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
-- Keep the allowance already consumed by live authorizations. Deploy this
-- migration and the new backend with old authorization writers stopped.
INSERT INTO capacity_counters (key, count, total_raw, expires_at)
SELECT 'cap:cluster:' || COALESCE(execution_cluster, 'legacy') || ':consumer:' || consumer_id || ':day:' || to_char(authorized_at, 'YYYYMMDD'),
       count(*)::integer, sum(usdc_settlement_raw::numeric),
       (date_trunc('day', authorized_at) AT TIME ZONE 'UTC') + interval '26 hours'
FROM payment_intents
WHERE authorized_at IS NOT NULL AND consumer_id IS NOT NULL AND mode = 'live'
  AND authorized_at >= (now() AT TIME ZONE 'UTC') - interval '32 days'
GROUP BY execution_cluster, consumer_id, date_trunc('day', authorized_at), to_char(authorized_at, 'YYYYMMDD');
--> statement-breakpoint
INSERT INTO capacity_counters (key, count, total_raw, expires_at)
SELECT 'cap:cluster:' || COALESCE(execution_cluster, 'legacy') || ':consumer:' || consumer_id || ':month:' || to_char(authorized_at, 'YYYYMM'),
       count(*)::integer, sum(usdc_settlement_raw::numeric),
       (date_trunc('month', authorized_at) AT TIME ZONE 'UTC') + interval '1 month 2 days'
FROM payment_intents
WHERE authorized_at IS NOT NULL AND consumer_id IS NOT NULL AND mode = 'live'
  AND authorized_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
GROUP BY execution_cluster, consumer_id, date_trunc('month', authorized_at), to_char(authorized_at, 'YYYYMM');

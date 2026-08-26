CREATE INDEX IF NOT EXISTS notifications_user_created_type_idx
  ON public.notifications (user_id, created_at DESC, type);

CREATE OR REPLACE FUNCTION public.public_analytics_summary(target_user_id uuid, from_date date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT type, currency, amount, COALESCE(department_name, 'Без отдела') AS department_name
    FROM public.transactions
    WHERE user_id = target_user_id AND date >= from_date
  ),
  currency_totals AS (
    SELECT type, currency, SUM(amount) amount, COUNT(*) transaction_count
    FROM filtered GROUP BY type, currency
  ),
  department_totals AS (
    SELECT department_name, currency,
      COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) income,
      COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) expense
    FROM filtered GROUP BY department_name, currency
  ),
  notification_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE type = 'deposit' OR metadata ->> 'document_type' = 'deposit') income,
      COUNT(*) FILTER (WHERE type NOT IN ('push_subscription', 'rule_request', 'deposit')
        AND COALESCE(metadata ->> 'document_type', '') <> 'deposit') expense
    FROM public.notifications
    WHERE user_id = target_user_id AND created_at >= from_date::timestamptz
  )
  SELECT jsonb_build_object(
    'currencyTotals', COALESCE((SELECT jsonb_agg(to_jsonb(currency_totals)) FROM currency_totals), '[]'::jsonb),
    'departmentTotals', COALESCE((SELECT jsonb_agg(to_jsonb(department_totals)) FROM department_totals), '[]'::jsonb),
    'notificationTotals', COALESCE((SELECT to_jsonb(notification_totals) FROM notification_totals), '{"income":0,"expense":0}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.public_analytics_summary(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_analytics_summary(uuid, date) TO service_role;

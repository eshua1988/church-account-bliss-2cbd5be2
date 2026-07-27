CREATE OR REPLACE FUNCTION public.public_analytics_summary(target_user_id uuid, from_date date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH filtered AS MATERIALIZED (
    SELECT
      t.date,
      t.type,
      t.currency,
      t.amount,
      COALESCE(t.department_name, 'Без отдела') AS department_name,
      COALESCE(c.name, 'Без категории') AS category_name
    FROM public.transactions t
    LEFT JOIN public.categories c ON c.id = t.category_id
    WHERE t.user_id = target_user_id AND t.date >= from_date
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
  category_totals AS (
    SELECT category_name, currency,
      COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) income,
      COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) expense,
      COUNT(*) FILTER (WHERE type = 'income') income_count,
      COUNT(*) FILTER (WHERE type = 'expense') expense_count
    FROM filtered GROUP BY category_name, currency
  ),
  daily_totals AS (
    SELECT date, currency,
      COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) income,
      COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) expense,
      COUNT(*) FILTER (WHERE type = 'income') income_count,
      COUNT(*) FILTER (WHERE type = 'expense') expense_count
    FROM filtered GROUP BY date, currency ORDER BY date
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
    'categoryTotals', COALESCE((SELECT jsonb_agg(to_jsonb(category_totals)) FROM category_totals), '[]'::jsonb),
    'dailyTotals', COALESCE((SELECT jsonb_agg(to_jsonb(daily_totals)) FROM daily_totals), '[]'::jsonb),
    'notificationTotals', COALESCE((SELECT to_jsonb(notification_totals) FROM notification_totals), '{"income":0,"expense":0}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.public_analytics_summary(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_analytics_summary(uuid, date) TO service_role;

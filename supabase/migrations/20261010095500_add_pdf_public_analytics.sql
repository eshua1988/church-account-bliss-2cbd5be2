-- Public analytics can be built from either bank operations or independently
-- archived PDF records.  Both sources return the same response shape.
CREATE OR REPLACE FUNCTION public.public_analytics_summary(
  target_user_id uuid,
  from_date date,
  analytics_source text DEFAULT 'bank'
)
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
    WHERE analytics_source = 'bank'
      AND t.user_id = target_user_id
      AND t.date >= from_date

    UNION ALL

    SELECT
      p.document_date AS date,
      p.type,
      p.currency,
      p.amount,
      COALESCE(p.department_name, 'Без отдела') AS department_name,
      COALESCE(c.name, 'Без категории') AS category_name
    FROM public.pdf_archive_entries p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE analytics_source = 'pdf'
      AND p.user_id = target_user_id
      AND p.document_date >= from_date
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
  source_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE type = 'income') income,
      COUNT(*) FILTER (WHERE type = 'expense') expense
    FROM filtered
  )
  SELECT jsonb_build_object(
    'currencyTotals', COALESCE((SELECT jsonb_agg(to_jsonb(currency_totals)) FROM currency_totals), '[]'::jsonb),
    'departmentTotals', COALESCE((SELECT jsonb_agg(to_jsonb(department_totals)) FROM department_totals), '[]'::jsonb),
    'categoryTotals', COALESCE((SELECT jsonb_agg(to_jsonb(category_totals)) FROM category_totals), '[]'::jsonb),
    'dailyTotals', COALESCE((SELECT jsonb_agg(to_jsonb(daily_totals)) FROM daily_totals), '[]'::jsonb),
    'notificationTotals', COALESCE((SELECT to_jsonb(source_totals) FROM source_totals), '{"income":0,"expense":0}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.public_analytics_summary(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_analytics_summary(uuid, date, text) TO service_role;

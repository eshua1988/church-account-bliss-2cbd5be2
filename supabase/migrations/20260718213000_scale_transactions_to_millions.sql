-- Keep transaction queries fast when an account contains millions of rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS transactions_user_date_created_idx
  ON public.transactions (user_id, date DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS transactions_user_type_date_idx
  ON public.transactions (user_id, type, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS transactions_user_currency_date_idx
  ON public.transactions (user_id, currency, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS transactions_user_category_date_idx
  ON public.transactions (user_id, category_id, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS transactions_description_trgm_idx
  ON public.transactions USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS transactions_bank_title_trgm_idx
  ON public.transactions USING gin (bank_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS transactions_department_name_trgm_idx
  ON public.transactions USING gin (department_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS transactions_comment_trgm_idx
  ON public.transactions USING gin (comment gin_trgm_ops);

-- Maintain totals incrementally, so opening the dashboard never scans a million rows.
CREATE TABLE IF NOT EXISTS public.transaction_currency_summaries (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  income numeric NOT NULL DEFAULT 0,
  expense numeric NOT NULL DEFAULT 0,
  transaction_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, currency)
);

ALTER TABLE public.transaction_currency_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own transaction summaries"
  ON public.transaction_currency_summaries;
CREATE POLICY "Users can view their own transaction summaries"
  ON public.transaction_currency_summaries
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.adjust_transaction_currency_summary(
  target_user_id uuid,
  target_currency text,
  income_delta numeric,
  expense_delta numeric,
  count_delta bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.transaction_currency_summaries
    (user_id, currency, income, expense, transaction_count)
  VALUES
    (target_user_id, target_currency, income_delta, expense_delta, count_delta)
  ON CONFLICT (user_id, currency) DO UPDATE SET
    income = transaction_currency_summaries.income + EXCLUDED.income,
    expense = transaction_currency_summaries.expense + EXCLUDED.expense,
    transaction_count = transaction_currency_summaries.transaction_count + EXCLUDED.transaction_count;

  DELETE FROM public.transaction_currency_summaries
  WHERE user_id = target_user_id
    AND currency = target_currency
    AND transaction_count <= 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_transaction_currency_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.adjust_transaction_currency_summary(
      OLD.user_id,
      OLD.currency,
      CASE WHEN OLD.type = 'income' THEN -OLD.amount ELSE 0 END,
      CASE WHEN OLD.type = 'expense' THEN -OLD.amount ELSE 0 END,
      -1
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.adjust_transaction_currency_summary(
      NEW.user_id,
      NEW.currency,
      CASE WHEN NEW.type = 'income' THEN NEW.amount ELSE 0 END,
      CASE WHEN NEW.type = 'expense' THEN NEW.amount ELSE 0 END,
      1
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_transaction_currency_summary(uuid, text, numeric, numeric, bigint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_transaction_currency_summary()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS maintain_transaction_currency_summary ON public.transactions;
CREATE TRIGGER maintain_transaction_currency_summary
AFTER INSERT OR UPDATE OF user_id, currency, type, amount OR DELETE
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.update_transaction_currency_summary();

-- Initial backfill for existing data.
INSERT INTO public.transaction_currency_summaries
  (user_id, currency, income, expense, transaction_count)
SELECT
  user_id,
  currency,
  COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
  COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0),
  COUNT(*)
FROM public.transactions
GROUP BY user_id, currency
ON CONFLICT (user_id, currency) DO UPDATE SET
  income = EXCLUDED.income,
  expense = EXCLUDED.expense,
  transaction_count = EXCLUDED.transaction_count;

-- Read already prepared totals instead of downloading every transaction.
CREATE OR REPLACE FUNCTION public.transaction_currency_totals()
RETURNS TABLE (
  currency text,
  income numeric,
  expense numeric,
  balance numeric,
  transaction_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    summaries.currency,
    summaries.income,
    summaries.expense,
    summaries.income - summaries.expense AS balance,
    summaries.transaction_count
  FROM public.transaction_currency_summaries AS summaries
  WHERE summaries.user_id = auth.uid()
  ORDER BY summaries.currency;
$$;

REVOKE ALL ON FUNCTION public.transaction_currency_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transaction_currency_totals() TO authenticated;

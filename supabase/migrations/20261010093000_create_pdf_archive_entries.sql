-- PDF archive entries are accounting records extracted from document metadata.
-- They deliberately do not reference Storage objects, so the accounting data
-- remains available even if the original PDF is later removed.
CREATE TABLE IF NOT EXISTS public.pdf_archive_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_notification_id uuid,
  receipt_index integer NOT NULL DEFAULT 0,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'PLN',
  category_id text,
  department_name text,
  basis text,
  issued_to text,
  document_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_notification_id, receipt_index)
);

CREATE INDEX IF NOT EXISTS pdf_archive_entries_user_date_idx
  ON public.pdf_archive_entries(user_id, document_date DESC, created_at DESC);

ALTER TABLE public.pdf_archive_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own PDF archive entries"
  ON public.pdf_archive_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Backfill existing archived documents. A deposit notification can contain
-- multiple receipts, all stored in metadata.receipts; legacy documents use the
-- metadata object as one receipt.
INSERT INTO public.pdf_archive_entries (
  user_id, source_notification_id, receipt_index, type, amount, currency,
  category_id, department_name, basis, issued_to, document_date, created_at
)
SELECT
  n.user_id,
  n.id,
  (receipt.ordinality - 1)::integer,
  CASE WHEN n.metadata->>'archive_type' = 'income' THEN 'income' ELSE 'expense' END,
  (receipt.value->>'amount')::numeric,
  COALESCE(NULLIF(receipt.value->>'currency', ''), NULLIF(n.metadata->>'currency', ''), 'PLN'),
  COALESCE(NULLIF(receipt.value->>'category_id', ''), NULLIF(n.metadata->>'category_id', '')),
  COALESCE(NULLIF(receipt.value->>'department_name', ''), NULLIF(receipt.value->>'basis', ''), NULLIF(n.metadata->>'department_name', ''), NULLIF(n.metadata->>'basis', '')),
  COALESCE(NULLIF(receipt.value->>'basis', ''), NULLIF(n.metadata->>'basis', '')),
  COALESCE(NULLIF(receipt.value->>'issued_to', ''), NULLIF(n.metadata->>'issued_to', ''), n.title),
  COALESCE(NULLIF(receipt.value->>'date', '')::date, NULLIF(n.metadata->>'date', '')::date, n.created_at::date),
  n.created_at
FROM public.notifications AS n
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(n.metadata->'receipts') = 'array' AND jsonb_array_length(n.metadata->'receipts') > 0
      THEN n.metadata->'receipts'
    ELSE jsonb_build_array(n.metadata)
  END
) WITH ORDINALITY AS receipt(value, ordinality)
WHERE n.metadata ? 'archived_at'
  AND COALESCE(receipt.value->>'amount', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
ON CONFLICT (source_notification_id, receipt_index) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.pdf_archive_entries;

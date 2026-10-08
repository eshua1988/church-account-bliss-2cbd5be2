ALTER TABLE public.google_sheet_exports
  ADD COLUMN IF NOT EXISTS period_mode text NOT NULL DEFAULT 'day'
    CHECK (period_mode IN ('day', 'week', 'month', 'year')),
  ADD COLUMN IF NOT EXISTS period_from text,
  ADD COLUMN IF NOT EXISTS period_to text;

ALTER TABLE public.registration_sheet_sources
  ADD COLUMN IF NOT EXISTS amount_column text NOT NULL DEFAULT '';

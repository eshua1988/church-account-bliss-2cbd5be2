ALTER TABLE public.public_export_sheet_targets
  ADD COLUMN IF NOT EXISTS search_keyword text NOT NULL DEFAULT '';

ALTER TABLE public.registration_sheet_sources
  ADD COLUMN IF NOT EXISTS search_keyword text NOT NULL DEFAULT '';

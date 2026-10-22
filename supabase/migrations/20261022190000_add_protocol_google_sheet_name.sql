ALTER TABLE public.protocol_link_settings
  ADD COLUMN IF NOT EXISTS google_sheet_name text NOT NULL DEFAULT '';

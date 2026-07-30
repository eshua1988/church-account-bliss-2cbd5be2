-- Independent Google Sheets used as registration sources for public transaction links.
CREATE TABLE IF NOT EXISTS public.registration_sheet_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL DEFAULT '',
  sheet_range text NOT NULL DEFAULT 'A:Z',
  name_columns text NOT NULL DEFAULT 'A:B',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, spreadsheet_id, sheet_name, sheet_range)
);

ALTER TABLE public.registration_sheet_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their registration sheet sources"
  ON public.registration_sheet_sources FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE INDEX IF NOT EXISTS registration_sheet_sources_owner_idx
  ON public.registration_sheet_sources(owner_user_id);

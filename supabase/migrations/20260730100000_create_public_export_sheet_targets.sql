CREATE TABLE IF NOT EXISTS public.public_export_sheet_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL DEFAULT '',
  sheet_range text NOT NULL DEFAULT 'A:Z',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, spreadsheet_id, sheet_name, sheet_range)
);

ALTER TABLE public.public_export_sheet_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their public export sheets"
  ON public.public_export_sheet_targets FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

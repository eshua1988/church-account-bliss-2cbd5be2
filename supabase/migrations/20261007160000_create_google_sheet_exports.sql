CREATE TABLE IF NOT EXISTS public.google_sheet_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  export_type text NOT NULL CHECK (export_type IN ('transactions', 'pdf')),
  spreadsheet_id text NOT NULL,
  sheet_range text NOT NULL DEFAULT 'A:Z',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_sheet_exports_user_idx ON public.google_sheet_exports(user_id, created_at);

ALTER TABLE public.google_sheet_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own Google Sheets exports"
  ON public.google_sheet_exports FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Preserve existing single-export settings as the first independent exports.
INSERT INTO public.google_sheet_exports (user_id, export_type, spreadsheet_id, sheet_range)
SELECT user_id, 'transactions', spreadsheet_id, COALESCE(NULLIF(sheet_range, ''), 'A:Z')
FROM public.profiles
WHERE spreadsheet_id IS NOT NULL AND spreadsheet_id <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.google_sheet_exports (user_id, export_type, spreadsheet_id, sheet_range)
SELECT user_id, 'pdf', archived_pdf_spreadsheet_id, COALESCE(NULLIF(archived_pdf_sheet_range, ''), 'A:Z')
FROM public.profiles
WHERE archived_pdf_spreadsheet_id IS NOT NULL AND archived_pdf_spreadsheet_id <> ''
ON CONFLICT DO NOTHING;

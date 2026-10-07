-- Repair migration for environments whose REST schema cache was created before
-- the archived-PDF export fields were introduced.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_pdf_spreadsheet_id text,
  ADD COLUMN IF NOT EXISTS archived_pdf_sheet_range text,
  ADD COLUMN IF NOT EXISTS archived_pdf_insert_row integer NOT NULL DEFAULT 2;

-- Make the newly added columns available to the Supabase REST API immediately.
NOTIFY pgrst, 'reload schema';

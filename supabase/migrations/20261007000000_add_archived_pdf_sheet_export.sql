-- Settings for the one-way export of archived PDF notifications.
-- This migration is safe to rerun: every new column uses IF NOT EXISTS.
-- Keep this separate from the full transaction synchronisation range.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_pdf_spreadsheet_id text,
  ADD COLUMN IF NOT EXISTS archived_pdf_sheet_range text,
  ADD COLUMN IF NOT EXISTS archived_pdf_insert_row integer NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.profiles.archived_pdf_sheet_range IS
  'Google Sheets range used for archived PDF notification exports, e.g. ''Sheet14''!A:E';
COMMENT ON COLUMN public.profiles.archived_pdf_insert_row IS
  '1-based row where the newest archived PDF record is inserted; normally directly below the headers.';

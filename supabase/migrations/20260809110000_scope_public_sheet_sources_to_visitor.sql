-- A public link can be used by several people. Store each visitor's Google
-- Sheet configuration separately so links are not shown to other visitors.
ALTER TABLE public.registration_sheet_sources
  ADD COLUMN IF NOT EXISTS requester_name text NOT NULL DEFAULT '';

ALTER TABLE public.public_export_sheet_targets
  ADD COLUMN IF NOT EXISTS requester_name text NOT NULL DEFAULT '';

ALTER TABLE public.registration_sheet_sources
  DROP CONSTRAINT IF EXISTS registration_sheet_sources_owner_user_id_spreadsheet_id_sheet_name_sheet_range_key;
ALTER TABLE public.public_export_sheet_targets
  DROP CONSTRAINT IF EXISTS public_export_sheet_targets_owner_user_id_spreadsheet_id_sheet_name_sheet_range_key;

CREATE UNIQUE INDEX IF NOT EXISTS registration_sheet_sources_visitor_unique_idx
  ON public.registration_sheet_sources(owner_user_id, requester_name, spreadsheet_id, sheet_name, sheet_range);
CREATE UNIQUE INDEX IF NOT EXISTS public_export_sheet_targets_visitor_unique_idx
  ON public.public_export_sheet_targets(owner_user_id, requester_name, spreadsheet_id, sheet_name, sheet_range);

CREATE INDEX IF NOT EXISTS registration_sheet_sources_visitor_idx
  ON public.registration_sheet_sources(owner_user_id, requester_name);
CREATE INDEX IF NOT EXISTS public_export_sheet_targets_visitor_idx
  ON public.public_export_sheet_targets(owner_user_id, requester_name);

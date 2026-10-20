ALTER TABLE public.protocol_link_settings
  ADD COLUMN IF NOT EXISTS councils jsonb;

UPDATE public.protocol_link_settings
SET councils = jsonb_build_array(
  jsonb_build_object('id', 'elders', 'name', 'Пресвитерский совет', 'attendees', COALESCE(attendees, '[]'::jsonb)),
  jsonb_build_object('id', 'church', 'name', 'Церковный совет', 'attendees', '[]'::jsonb)
)
WHERE councils IS NULL;

ALTER TABLE public.protocol_link_settings
  ALTER COLUMN councils SET DEFAULT '[{"id":"elders","name":"Пресвитерский совет","attendees":[]},{"id":"church","name":"Церковный совет","attendees":[]}]'::jsonb,
  ALTER COLUMN councils SET NOT NULL;

ALTER TABLE public.protocol_documents
  DROP CONSTRAINT IF EXISTS protocol_documents_council_check;
